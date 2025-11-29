import { EventEmitter } from "events";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";

import { z } from "zod/v3";
import { cac } from "cac";
import pLimit from "p-limit";
import { generateText, generateObject, type LanguageModelV1 } from "ai";

const EnvSchema = z.object({
	OPENROUTER_API_KEY: z
		.string()
		.min(1, "OPENROUTER_API_KEY is required")
		.refine((key: string) => key.startsWith("sk-"), {
			message: "OPENROUTER_API_KEY should start with 'sk-'",
		}),
});

function validateEnv(): { OPENROUTER_API_KEY: string } {
	const result = EnvSchema.safeParse(process.env);
	if (!result.success) {
		console.error("❌ Environment configuration error:");
		console.error(result.error.format());
		process.exit(1);
	}
	return result.data;
}

/**
 * Represents a model configuration for benchmarking
 */
export type BenchmarkModel = {
	name: string;
	llm: LanguageModelV1;
	providerOptions?: Record<string, unknown>;
	reasoning?: boolean;
};

/**
 * Validation result returned by validation functions
 */
export type ValidationResult = {
	success: boolean;
	reason: string;
};

/**
 * Base benchmark test with common properties
 */
type BaseBenchmarkTest = {
	name: string;
	prompt: string;
	description?: string;
};

/**
 * Text-based benchmark test (uses judge model for evaluation)
 */
export type TextBenchmarkTest = BaseBenchmarkTest & {
	type: "text";
	expectedAnswer?: string;
};

/**
 * Structured output benchmark test (uses schema validation)
 */
export type StructuredOutputBenchmarkTest = BaseBenchmarkTest & {
	type: "structured-output";
	schema: z.ZodTypeAny;
	validation?: (result: unknown, schema: z.ZodTypeAny) => ValidationResult;
};

/**
 * Discriminated union of all benchmark test types
 */
export type BenchmarkTest = TextBenchmarkTest | StructuredOutputBenchmarkTest;

/**
 * Complete benchmark configuration
 */
export type Benchmark = {
	judgeModel: BenchmarkModel;
	tests: BenchmarkTest[];
};

/**
 * Token usage statistics
 */
export type TokenUsage = {
	input: number;
	output: number;
	reasoning?: number;
	total: number;
};

/**
 * Result of a single benchmark run
 */
export type RunResult = {
	testName: string;
	modelName: string;
	runIndex: number;
	timestamp: string;
	success: boolean;
	reason: string;
	durationMs: number;
	tokenUsage: TokenUsage;
	rawOutput: unknown;
	judgeOutput?: unknown;
};

/**
 * Zod schema for validating RunResult when reading from disk
 */
export const RunResultSchema = z.object({
	testName: z.string(),
	modelName: z.string(),
	runIndex: z.number(),
	timestamp: z.string(),
	success: z.boolean(),
	reason: z.string(),
	durationMs: z.number(),
	tokenUsage: z.object({
		input: z.number(),
		output: z.number(),
		reasoning: z.number().optional(),
		total: z.number(),
	}),
	rawOutput: z.unknown(),
	judgeOutput: z.unknown().optional(),
});

/**
 * CLI options schema
 */
export const CLIOptionsSchema = z.object({
	benchmark: z.string().default("sample-text-benchmark.ts"),
	runs: z.coerce.number().int().positive().default(1),
	parallel: z.coerce.number().int().positive().default(1),
	model: z.string().optional(),
	outputDir: z.string().default("runs"),
	combineOnly: z.boolean().default(false),
	output: z.string().optional(), // Custom output filename for the summary
});

export type CLIOptions = z.infer<typeof CLIOptionsSchema>;

/**
 * Extracts benchmark name from filename (removes .ts extension)
 */
function extractBenchmarkName(benchmarkPath: string): string {
	return benchmarkPath.replace(/\.ts$/, "");
}

/**
 * Validates that a response exists and is an object
 */
export const validateResponseExists = (response: unknown): boolean => {
	if (!response || typeof response !== "object") {
		return false;
	}
	return true;
};

/**
 * Default validation for structured output tests
 * Uses zod schema to validate the response
 */
export const validateSimpleResponse = (
	response: unknown,
	schema: z.ZodTypeAny,
): ValidationResult => {
	if (!validateResponseExists(response)) {
		return {
			success: false,
			reason: "Response is not an object or doesn't exist.",
		};
	}
	const result = schema.safeParse(response);
	if (!result.success) {
		return {
			success: false,
			reason: result.error.message,
		};
	}
	return {
		success: true,
		reason: "Test passed - schema validation successful",
	};
};

// =============================================================================
// Persistence Utilities (WAL Strategy)
// =============================================================================

/**
 * Sanitizes a string to be safe for use in filenames
 */
function sanitizeForFilename(str: string): string {
	return str
		.replace(/[^a-zA-Z0-9-_]/g, "-")
		.replace(/-+/g, "-")
		.substring(0, 100);
}

/**
 * Saves a run result to disk atomically
 * @param runDir - The benchmark run directory (e.g., runs/sample-text-benchmark-2025-01-01T00-00-00-000Z)
 * @param result - The run result to save
 */
async function saveRunResult(
	runDir: string,
	result: RunResult,
): Promise<string> {
	// Create model subdirectory within the benchmark run directory
	const modelDir = join(runDir, sanitizeForFilename(result.modelName));

	// Ensure directory exists
	await mkdir(modelDir, { recursive: true });

	// Generate filename
	const timestamp = result.timestamp.replace(/[:.]/g, "-");
	const testName = sanitizeForFilename(result.testName);
	const filename = `${timestamp}-${testName}-run${result.runIndex}.json`;
	const filepath = join(modelDir, filename);

	// Write atomically (write to temp file then rename)
	const tempPath = `${filepath}.tmp`;
	await writeFile(tempPath, JSON.stringify(result, null, 2), "utf-8");

	// Rename to final path (atomic on most filesystems)
	await Bun.write(filepath, await Bun.file(tempPath).text());
	(await Bun.file(tempPath).exists()) &&
		(await import("fs/promises")).unlink(tempPath).catch(() => {});

	return filepath;
}

type RunnerEvents = {
	"run:start": { testName: string; modelName: string; runIndex: number };
	"run:complete": RunResult;
	"run:error": { testName: string; modelName: string; error: Error };
	"benchmark:start": { totalTests: number; runsPerTest: number };
	"benchmark:complete": { results: RunResult[] };
};

export class BenchmarkRunner extends EventEmitter {
	private models: BenchmarkModel[];
	private benchmark: Benchmark;
	private runsPerTest: number;
	private parallelLimit: number;
	private outputDir: string;
	private benchmarkName: string;
	private runTimestamp: string;
	private runDir: string;
	private results: RunResult[] = [];

	constructor(config: {
		models: BenchmarkModel[];
		benchmark: Benchmark;
		runsPerTest: number;
		parallelLimit: number;
		outputDir: string;
		benchmarkName: string;
	}) {
		super();
		this.models = config.models;
		this.benchmark = config.benchmark;
		this.runsPerTest = config.runsPerTest;
		this.parallelLimit = config.parallelLimit;
		this.outputDir = config.outputDir;
		this.benchmarkName = config.benchmarkName;
		// Generate timestamp at construction time (shared across all runs in this session)
		this.runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
		// Build the run directory path: runs/{benchmark}-{timestamp}
		this.runDir = join(
			this.outputDir,
			`${sanitizeForFilename(this.benchmarkName)}-${this.runTimestamp}`,
		);
	}

	/**
	 * Get the benchmark name for this run
	 */
	getBenchmarkName(): string {
		return this.benchmarkName;
	}

	/**
	 * Get the timestamp for this run session
	 */
	getRunTimestamp(): string {
		return this.runTimestamp;
	}

	/**
	 * Get the run directory path
	 */
	getRunDir(): string {
		return this.runDir;
	}

	override emit<K extends keyof RunnerEvents>(
		event: K,
		payload: RunnerEvents[K],
	): boolean {
		return super.emit(event, payload);
	}

	override on<K extends keyof RunnerEvents>(
		event: K,
		listener: (payload: RunnerEvents[K]) => void,
	): this {
		return super.on(event, listener as (...args: unknown[]) => void);
	}

	async run(): Promise<RunResult[]> {
		const totalTests = this.benchmark.tests.length * this.models.length;
		this.emit("benchmark:start", {
			totalTests,
			runsPerTest: this.runsPerTest,
		});

		const limit = pLimit(this.parallelLimit);
		const tasks: Promise<void>[] = [];

		for (const model of this.models) {
			for (const test of this.benchmark.tests) {
				for (let runIndex = 0; runIndex < this.runsPerTest; runIndex++) {
					tasks.push(
						limit(async () => {
							await this.executeRun(model, test, runIndex);
						}),
					);
				}
			}
		}

		await Promise.all(tasks);

		this.emit("benchmark:complete", { results: this.results });
		return this.results;
	}

	private async executeRun(
		model: BenchmarkModel,
		test: BenchmarkTest,
		runIndex: number,
	): Promise<void> {
		this.emit("run:start", {
			testName: test.name,
			modelName: model.name,
			runIndex,
		});

		const startTime = Date.now();
		let result: RunResult;

		try {
			if (test.type === "text") {
				result = await this.executeTextTest(model, test, runIndex, startTime);
			} else {
				result = await this.executeStructuredTest(
					model,
					test,
					runIndex,
					startTime,
				);
			}

			// Save result immediately (WAL strategy)
			await saveRunResult(this.runDir, result);
			this.results.push(result);
			this.emit("run:complete", result);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.emit("run:error", {
				testName: test.name,
				modelName: model.name,
				error: err,
			});

			// Still save failed results
			const failedResult: RunResult = {
				testName: test.name,
				modelName: model.name,
				runIndex,
				timestamp: new Date().toISOString(),
				success: false,
				reason: `Error: ${err.message}`,
				durationMs: Date.now() - startTime,
				tokenUsage: { input: 0, output: 0, total: 0 },
				rawOutput: JSON.stringify(err, null, 2),
			};
			await saveRunResult(this.runDir, failedResult);
			this.results.push(failedResult);
		}
	}

	private async executeTextTest(
		model: BenchmarkModel,
		test: TextBenchmarkTest,
		runIndex: number,
		startTime: number,
	): Promise<RunResult> {
		// Generate response from model under test
		const response = await generateText({
			model: model.llm,
			prompt: test.prompt,
		});

		const durationMs = Date.now() - startTime;
		const tokenUsage: TokenUsage = {
			input: response.usage?.promptTokens ?? 0,
			output: response.usage?.completionTokens ?? 0,
			total:
				(response.usage?.promptTokens ?? 0) +
				(response.usage?.completionTokens ?? 0),
		};

		// Use judge model to evaluate the response
		const judgeResult = await this.judgeTextResponse(
			test,
			response.text,
			model.name,
		);

		// Add judge tokens to total
		tokenUsage.total += judgeResult.tokensUsed;

		return {
			testName: test.name,
			modelName: model.name,
			runIndex,
			timestamp: new Date().toISOString(),
			success: judgeResult.success,
			reason: judgeResult.reason,
			durationMs,
			tokenUsage,
			rawOutput: response.text,
			judgeOutput: judgeResult.rawJudgeOutput,
		};
	}

	private async judgeTextResponse(
		test: TextBenchmarkTest,
		response: string,
		modelName: string,
	): Promise<{
		success: boolean;
		reason: string;
		tokensUsed: number;
		rawJudgeOutput: unknown;
	}> {
		const judgePrompt = `You are an expert judge evaluating an AI model's response. 

        TASK: Evaluate if the model's response correctly answers the given prompt.

        PROMPT GIVEN TO MODEL:
        ${test.prompt}

        ${test.expectedAnswer ? `EXPECTED ANSWER (for reference):\n${test.expectedAnswer}\n` : ""}

        MODEL'S RESPONSE:
        ${response}

        INSTRUCTIONS:
        1. Think step-by-step about whether the response correctly addresses the prompt.
        2. Consider accuracy, completeness, and relevance.
        3. If an expected answer is provided, check if the response aligns with it (exact wording is not required).

        Respond with a JSON object containing:
        - "success": boolean (true if the response is correct/acceptable, false otherwise)
        - "reason": string (brief explanation of your judgment)`;

		try {
			const judgeResponse = await generateObject({
				model: this.benchmark.judgeModel.llm,
				schema: z.object({
					success: z.boolean(),
					reason: z.string(),
				}),
				prompt: judgePrompt,
			});

			const judgeResult = judgeResponse.object as {
				success: boolean;
				reason: string;
			};

			return {
				success: judgeResult.success,
				reason: judgeResult.reason,
				tokensUsed:
					(judgeResponse.usage?.promptTokens ?? 0) +
					(judgeResponse.usage?.completionTokens ?? 0),
				rawJudgeOutput: judgeResult,
			};
		} catch (error) {
			console.error("Judge evaluation failed:", error);

			// Fallback if judge fails
			return {
				success: false,
				reason: `Judge evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
				tokensUsed: 0,
				rawJudgeOutput: null,
			};
		}
	}

	private async executeStructuredTest(
		model: BenchmarkModel,
		test: StructuredOutputBenchmarkTest,
		runIndex: number,
		startTime: number,
	): Promise<RunResult> {
		const response = await generateObject({
			model: model.llm,
			schema: test.schema,
			prompt: test.prompt,
		} as unknown as Parameters<typeof generateObject>[0]);

		const durationMs = Date.now() - startTime;
		const tokenUsage: TokenUsage = {
			input: response.usage?.promptTokens ?? 0,
			output: response.usage?.completionTokens ?? 0,
			total:
				(response.usage?.promptTokens ?? 0) +
				(response.usage?.completionTokens ?? 0),
		};

		// Validate the response
		const validationFn = test.validation ?? validateSimpleResponse;
		const validationResult = validationFn(response.object, test.schema);

		return {
			testName: test.name,
			modelName: model.name,
			runIndex,
			timestamp: new Date().toISOString(),
			success: validationResult.success,
			reason: validationResult.reason,
			durationMs,
			tokenUsage,
			rawOutput: response.object,
		};
	}
}

// =============================================================================
// REGION: React Ink UI Stubs (Future Implementation)
// =============================================================================

// Placeholder for future Ink UI components
// The architecture supports connecting BenchmarkRunner events to React state
// via a custom useBenchmarkStore hook that subscribes to the EventEmitter

/*
import React from 'react';
import { render, Box, Text } from 'ink';

const App: React.FC<{ runner: BenchmarkRunner }> = ({ runner }) => {
  // Future: Use useBenchmarkStore to subscribe to runner events
  return (
    <Box flexDirection="column">
      <Text>AIBench - Running benchmarks...</Text>
    </Box>
  );
};
*/

async function loadBenchmark(benchmarkPath: string): Promise<Benchmark> {
	const fullPath = resolve(process.cwd(), "benchmarks", benchmarkPath);

	if (!existsSync(fullPath)) {
		throw new Error(`Benchmark file not found: ${fullPath}`);
	}

	const module = await import(fullPath);
	const benchmark = module.default as Benchmark;

	if (!benchmark || !benchmark.tests || !benchmark.judgeModel) {
		throw new Error(
			`Invalid benchmark file: must export a default Benchmark object with 'tests' and 'judgeModel'`,
		);
	}

	return benchmark;
}

async function loadModels(modelName?: string): Promise<BenchmarkModel[]> {
	const modelsPath = resolve(process.cwd(), "models.ts");

	if (!existsSync(modelsPath)) {
		throw new Error(`Models file not found: ${modelsPath}`);
	}

	const module = await import(modelsPath);

	// If a specific model is requested, find it
	if (modelName) {
		const model = module[modelName] || module.default;
		if (!model) {
			throw new Error(`Model '${modelName}' not found in models.ts`);
		}
		return [model];
	}

	// Otherwise, use the default exported models array or single model
	if (Array.isArray(module.models)) {
		return module.models;
	}

	if (module.textModel) {
		return [module.textModel];
	}

	if (module.default) {
		return Array.isArray(module.default) ? module.default : [module.default];
	}

	throw new Error("No models found in models.ts");
}

async function main() {
	// Validate environment
	validateEnv();

	// Setup CLI
	const cli = cac("ai-bench");

	cli
		.command("[...args]", "Run benchmarks")
		.option("-b, --benchmark <file>", "Benchmark file to run", {
			default: "sample-text-benchmark.ts",
		})
		.option("-r, --runs <number>", "Number of runs per test", { default: 1 })
		.option("-p, --parallel <number>", "Number of tests to run in parallel", {
			default: 1,
		})
		.option("-m, --model <name>", "Specific model to use from models.ts")
		.option("-o, --output-dir <path>", "Output directory for run results", {
			default: "runs",
		})
		.option(
			"--output <name>",
			"Custom output filename for the summary (without extension)",
		)
		.option(
			"--combine-only",
			"Only combine existing runs, don't run benchmarks",
		)
		.action(async (_args: string[], options: Record<string, unknown>) => {
			try {
				// Parse and validate options
				const parsedOptions = CLIOptionsSchema.parse({
					benchmark: options.benchmark,
					runs: options.runs,
					parallel: options.parallel,
					model: options.model,
					outputDir: options.outputDir,
					combineOnly: options.combineOnly,
					output: options.output,
				});

				// Extract benchmark name from filename
				const benchmarkName = extractBenchmarkName(parsedOptions.benchmark);

				// If combine-only mode, just aggregate and exit
				if (parsedOptions.combineOnly) {
					const { combineAllRuns } = await import("./combine-runs.ts");
					await combineAllRuns(parsedOptions.outputDir, parsedOptions.output);
					console.log("✅ Run combination complete!");
					return;
				}

				console.log("🚀 AIBench - Starting benchmark run");
				console.log(`   Benchmark: ${parsedOptions.benchmark}`);
				console.log(`   Runs per test: ${parsedOptions.runs}`);
				console.log(`   Parallel: ${parsedOptions.parallel}`);
				console.log(`   Output: ${parsedOptions.outputDir}`);
				console.log("");

				// Load benchmark and models
				const benchmark = await loadBenchmark(parsedOptions.benchmark);
				const models = await loadModels(parsedOptions.model);

				console.log(`📋 Loaded ${benchmark.tests.length} tests`);
				console.log(
					`🤖 Testing ${models.length} model(s): ${models.map((m) => m.name).join(", ")}`,
				);
				console.log("");

				// Create and configure runner
				const runner = new BenchmarkRunner({
					models,
					benchmark,
					runsPerTest: parsedOptions.runs,
					parallelLimit: parsedOptions.parallel,
					outputDir: parsedOptions.outputDir,
					benchmarkName,
				});

				// Wire up event listeners for console output
				runner.on("run:start", ({ testName, modelName, runIndex }) => {
					console.log(
						`▶️  Starting: ${testName} (${modelName}) [Run ${runIndex + 1}]`,
					);
				});

				runner.on("run:complete", (result) => {
					const status = result.success ? "✅" : "❌";
					console.log(
						`${status} Complete: ${result.testName} (${result.modelName}) - ${result.durationMs}ms`,
					);
					if (!result.success) {
						console.log(`   Reason: ${result.reason}`);
					}
				});

				runner.on("run:error", ({ testName, modelName, error }) => {
					console.error(
						`❌ Error: ${testName} (${modelName}): ${error.message}`,
					);
				});

				runner.on("benchmark:complete", ({ results }) => {
					console.log("");
					console.log("═".repeat(60));
					console.log("📊 Benchmark Complete!");
					console.log("═".repeat(60));

					const successful = results.filter((r) => r.success).length;
					const total = results.length;
					const successRate = ((successful / total) * 100).toFixed(1);

					console.log(`   Total runs: ${total}`);
					console.log(`   Successful: ${successful} (${successRate}%)`);
					console.log(`   Failed: ${total - successful}`);

					const totalTokens = results.reduce(
						(sum, r) => sum + r.tokenUsage.total,
						0,
					);
					const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);
					console.log(`   Total tokens: ${totalTokens}`);
					console.log(`   Total time: ${(totalTime / 1000).toFixed(2)}s`);
					console.log("");
				});

				// Run benchmarks
				await runner.run();

				// Combine results - pass the specific run directory and optional output name
				const { combineRunDir } = await import("./combine-runs.ts");
				await combineRunDir(
					runner.getRunDir(),
					runner.getBenchmarkName(),
					runner.getRunTimestamp(),
					parsedOptions.output,
				);

				console.log("✅ Results saved and combined!");
			} catch (error) {
				console.error(
					"❌ Error:",
					error instanceof Error ? error.message : String(error),
				);
				process.exit(1);
			}
		});

	cli.help();
	cli.version("0.1.0");

	cli.parse();
}

// Run if this is the main module
main().catch(console.error);
