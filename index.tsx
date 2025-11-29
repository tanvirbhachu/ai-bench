import { resolve } from "path";
import { existsSync } from "fs";
import { z } from "zod/v3";
import { cac } from "cac";
import { BenchmarkRunner } from "./persistence.ts";
import { BenchmarkApp } from "./react-ui.tsx";
import { render } from "ink";
import type { LanguageModelV1 } from "ai";

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
					console.log("[OK] Run combination complete!");
					return;
				}

				// Load benchmark and models (silent - UI will display info)
				const benchmark = await loadBenchmark(parsedOptions.benchmark);
				const models = await loadModels(parsedOptions.model);

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
