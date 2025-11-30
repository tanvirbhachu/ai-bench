import { generateText, generateObject } from "ai";
import EventEmitter from "events";
import pLimit from "p-limit";
import z from "zod";
import {
	type BenchmarkTest,
	type StructuredOutputBenchmarkTest,
	type TokenUsage,
	type RunResult,
	type BenchmarkModel,
	type Benchmark,
	validateSimpleResponse,
	type TextBenchmarkTest,
} from ".";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

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
	"run:error": {
		testName: string;
		modelName: string;
		runIndex: number;
		error: Error;
	};
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
	private timeoutSeconds: number;
	private results: RunResult[] = [];

	constructor(config: {
		models: BenchmarkModel[];
		benchmark: Benchmark;
		runsPerTest: number;
		parallelLimit: number;
		outputDir: string;
		benchmarkName: string;
		timeoutSeconds: number;
	}) {
		super();
		this.models = config.models;
		this.benchmark = config.benchmark;
		this.runsPerTest = config.runsPerTest;
		this.parallelLimit = config.parallelLimit;
		this.outputDir = config.outputDir;
		this.benchmarkName = config.benchmarkName;
		this.timeoutSeconds = config.timeoutSeconds;
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
				runIndex,
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
			// Emit run:complete so UI updates counters and progress
			this.emit("run:complete", failedResult);
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
			providerOptions: model.providerOptions
				? { openrouter: model.providerOptions }
				: undefined,
			abortSignal: AbortSignal.timeout(this.timeoutSeconds * 1000),
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
		_modelName: string,
	): Promise<{
		success: boolean;
		reason: string;
		tokensUsed: number;
		rawJudgeOutput: unknown;
	}> {
		// for some reason, OpenRouter's structured out generation is a little weird, especially on low tier models.
		const judgePrompt = `TASK: Evaluate if the model's response correctly answers the given prompt. YOU MUST RESPOND WITH A JSON OBJECT CONTAINING:

		INSTRUCTIONS:
        1. Consider accuracy, completeness, and relevance.
        2. If an expected answer is provided, check if the response aligns with it (exact wording is not required).
		3. Your response must be a valid JSON object. Nothing else is acceptable.

        You must respond with a JSON object containing:
        - "success": boolean (true if the response is correct/acceptable, false otherwise)
        - "reason": string (brief explanation of your judgment)

        PROMPT GIVEN TO MODEL:
        ${test.prompt}

        ${test.expectedAnswer ? `EXPECTED ANSWER (for reference):\n${test.expectedAnswer}\n` : ""}

        MODEL'S RESPONSE:
        ${response}
		
		GIVEN THE ABOVE, RESPOND WITH A VALID JSON OBJECT`;

		try {
			const judgeResponse = await generateObject({
				model: this.benchmark.judgeModel.llm,
				schema: z.object({
					success: z.boolean(),
					reason: z.string(),
				}),
				output: "object",
				providerOptions: this.benchmark.judgeModel.providerOptions
					? { openrouter: this.benchmark.judgeModel.providerOptions }
					: undefined,
				prompt: judgePrompt,
				abortSignal: AbortSignal.timeout(this.timeoutSeconds * 1000),
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
			providerOptions: model.providerOptions
				? { openrouter: model.providerOptions }
				: undefined,
			abortSignal: AbortSignal.timeout(this.timeoutSeconds * 1000),
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
