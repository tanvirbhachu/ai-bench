import { resolve } from "path";
import { existsSync } from "fs";
import { z } from "zod/v3";
import { cac } from "cac";
import { BenchmarkRunner } from "./persistence.ts";
import { BenchmarkApp } from "./react-ui.tsx";
import { render } from "ink";
import type { JSONValue, LanguageModelV1 } from "ai";
import { generateObject } from "ai";
import { DEFAULT_BENCHMARK, DEFAULT_CONCURRENCY, DEFAULT_TEST_RUNS_PER_MODEL, DEFAULT_TIMEOUT_SECONDS, RUNS_DIRECTORY } from "./constants.ts";
import { models as configuredModels } from "./models.ts";

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
		console.error("[ERROR] Environment configuration error:");
		console.error(result.error.format());
		process.exit(1);
	}

	return result.data;
}

export type BenchmarkModel = {
	name: string;
	llm: LanguageModelV1;
	providerOptions?: Record<string, JSONValue>;
	reasoning?: boolean;
};

/**
 * Validation result returned by validation functions
 */
export type ValidationResult = {
	success: boolean;
	reason: string;
};

type BaseBenchmarkTest = {
	name: string;
	prompt: string;
	description?: string;
};

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

export type Benchmark = {
	judgeModel: BenchmarkModel;
	tests: BenchmarkTest[];
};

export type TokenUsage = {
	input: number;
	output: number;
	reasoning: number;
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
	type: "text" | "structured-output";
	prompt: string;
	expectedAnswer?: string;
	success: boolean;
	reason: string;
	durationMs: number;
	tokenUsage: TokenUsage;
	rawOutput: unknown;
	judgeOutput?: unknown;
	/** Duration of judge model evaluation (only for text tests) */
	judgeDurationMs?: number;
	/** Token usage of judge model (only for text tests) */
	judgeTokenUsage?: TokenUsage;
};

/**
 * Zod schema for TokenUsage (reusable)
 */
const TokenUsageSchema = z.object({
	input: z.number(),
	output: z.number(),
	reasoning: z.number().optional(),
	total: z.number(),
});

/**
 * Zod schema for validating RunResult when reading from disk
 */
export const RunResultSchema = z.object({
	testName: z.string(),
	modelName: z.string(),
	runIndex: z.number(),
	timestamp: z.string(),
	type: z.enum(["text", "structured-output"]),
	prompt: z.string(),
	expectedAnswer: z.string().optional(),
	success: z.boolean(),
	reason: z.string(),
	durationMs: z.number(),
	tokenUsage: TokenUsageSchema,
	rawOutput: z.unknown(),
	judgeOutput: z.unknown().optional(),
	judgeDurationMs: z.number().optional(),
	judgeTokenUsage: TokenUsageSchema.optional(),
});

/**
 * CLI options schema
 */
export const CLIOptionsSchema = z.object({
	benchmark: z.string().default(DEFAULT_BENCHMARK),
	runs: z.coerce.number().int().positive().default(DEFAULT_TEST_RUNS_PER_MODEL),
	parallel: z.coerce.number().int().positive().default(DEFAULT_CONCURRENCY),
	model: z.string().optional(),
	outputDir: z.string().default(RUNS_DIRECTORY),
	combineOnly: z.boolean().default(false),
	output: z.string().optional(), // Custom output filename for the summary
	timeout: z.coerce.number().int().positive().default(DEFAULT_TIMEOUT_SECONDS), // Timeout in seconds for each test
});

export type CLIOptions = z.infer<typeof CLIOptionsSchema>;

function extractBenchmarkName(benchmarkPath: string): string {
	return benchmarkPath.replace(/\.ts$/, "");
}

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

function renderBenchmarkUI(
	runner: BenchmarkRunner,
	benchmarkName: string,
	modelsCount: number,
	parallelLimit: number,
	totalTests: number,
	runsPerTest: number,
): { waitUntilExit: () => Promise<void>; unmount: () => void } {
	const instance = render(
		<BenchmarkApp
			runner={runner}
			benchmarkName={benchmarkName}
			modelsCount={modelsCount}
			parallelLimit={parallelLimit}
			totalTests={totalTests}
			runsPerTest={runsPerTest}
		/>,
	);
	return instance;
}

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

function loadModels(modelName?: string): BenchmarkModel[] {
	if (configuredModels.length === 0) {
		throw new Error("No models configured in models.ts");
	}

	// If a specific model is requested, filter by name
	if (modelName) {
		const model = configuredModels.find((m) => m.name === modelName);

		if (!model) {
			const availableModels = configuredModels.map((m) => m.name).join(", ");

			throw new Error(
				`Model '${modelName}' not found. Available models: ${availableModels}`,
			);
		}

		return [model];
	}

	return configuredModels;
}

/**
 * Verifies that the judge model supports object generation
 * by making a simple test call with a minimal schema
 */
async function verifyJudgeModelCapability(judgeModel: BenchmarkModel): Promise<void> {
	console.log(`[CHECK] Verifying judge model '${judgeModel.name}' supports object generation...`);

	const testSchema = z.object({
		ready: z.boolean(),
	});

	try {
		await generateObject({
			model: judgeModel.llm,
			schema: testSchema,
			prompt: "Respond with ready: true",
			providerOptions: judgeModel.providerOptions ? { openrouter: judgeModel.providerOptions } : undefined,
			abortSignal: AbortSignal.timeout(30000), // 30 second timeout for capability check
		});
		console.log(`[OK] Judge model '${judgeModel.name}' supports object generation`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Judge model '${judgeModel.name}' does not support object generation (required for judging text responses).\n` +
			`Error: ${errorMessage}\n` +
			`Please use a model that supports structured outputs as your judge model.`
		);
	}
}

async function main() {
	// Validate environment
	validateEnv();

	// Setup CLI
	const cli = cac("ai-bench");

	cli
		.command("[...args]", "Run benchmarks")
		.option("-b, --benchmark <file>", "Benchmark file to run", {
			default: DEFAULT_BENCHMARK,
		})
		.option("-r, --runs <number>", "Number of runs per test", { default: DEFAULT_TEST_RUNS_PER_MODEL })
		.option("-p, --parallel <number>", "Number of tests to run in parallel", {
			default: DEFAULT_CONCURRENCY,
		})
		.option("-m, --model <name>", "Specific model to use from models.ts")
		.option("-o, --output-dir <path>", "Output directory for run results", {
			default: RUNS_DIRECTORY,
		})
		.option("-t, --timeout <seconds>", "Timeout in seconds for each test", {
			default: DEFAULT_TIMEOUT_SECONDS,
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
					timeout: options.timeout,
				});

				// Extract benchmark name from filename
				const benchmarkName = extractBenchmarkName(parsedOptions.benchmark);

				// If combine-only mode, just aggregate and exit
				if (parsedOptions.combineOnly) {
					const { combineAllRuns } = await import("./combine-runs.ts");
					await combineAllRuns(parsedOptions.outputDir, parsedOptions.output);
					console.log("[OK] Run combination complete!");
					return;
				}

				// Load benchmark and models (silent - UI will display info)
				const benchmark = await loadBenchmark(parsedOptions.benchmark);
				const models = loadModels(parsedOptions.model);

				const hasTextTests = benchmark.tests.some((test) => test.type === "text");

				// Verify judge model supports object generation before starting
				if (hasTextTests) {
					await verifyJudgeModelCapability(benchmark.judgeModel);
				}

				// Calculate total tests (tests * models)
				const totalTests = benchmark.tests.length * models.length;

				// Create and configure runner
				const runner = new BenchmarkRunner({
					models,
					benchmark,
					runsPerTest: parsedOptions.runs,
					parallelLimit: parsedOptions.parallel,
					outputDir: parsedOptions.outputDir,
					benchmarkName,
					timeoutSeconds: parsedOptions.timeout,
				});

				// Render the React Ink UI
				renderBenchmarkUI(
					runner,
					benchmarkName,
					models.length,
					parsedOptions.parallel,
					totalTests,
					parsedOptions.runs,
				);

				// Allow UI to mount and attach listeners
				await new Promise((resolve) => setTimeout(resolve, 100));

				// Run benchmarks
				await runner.run();

				// Wait a moment for UI to update with final state
				await new Promise((resolve) => setTimeout(resolve, 200));

				// Combine results - pass the specific run directory and optional output name
				const { combineRunDir } = await import("./combine-runs.ts");
				await combineRunDir(
					runner.getRunDir(),
					runner.getBenchmarkName(),
					runner.getRunTimestamp(),
					parsedOptions.output,
				);

				console.log("\n[OK] Results saved and combined!");
			} catch (error) {
				console.error(
					"[ERROR]",
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
