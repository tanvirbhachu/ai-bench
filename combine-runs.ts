// =============================================================================
// AI-BENCH - Run Aggregation Utility
// =============================================================================
// This file combines individual run JSON files into a comprehensive summary.
// It can be run standalone or imported by index.ts.
// =============================================================================

import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { RunResultSchema, type RunResult } from "./index.ts";

// Results directory where summaries are saved
const RESULTS_DIR = "results";

export type TestSummary = {
	testName: string;
	totalRuns: number;
	successfulRuns: number;
	failedRuns: number;
	successRate: number;
	avgDurationMs: number;
	avgTokenUsage: {
		input: number;
		output: number;
		reasoning: number;
		total: number;
	};
	runs: RunResult[];
};

export type ModelSummary = {
	modelName: string;
	totalTests: number;
	totalRuns: number;
	successfulRuns: number;
	failedRuns: number;
	successRate: number;
	totalDurationMs: number;
	avgDurationMs: number;
	totalTokenUsage: {
		input: number;
		output: number;
		reasoning: number;
		total: number;
	};
	avgTokenUsage: {
		input: number;
		output: number;
		reasoning: number;
		total: number;
	};
	testSummaries: TestSummary[];
};

export type BenchmarkSummary = {
	generatedAt: string;
	totalModels: number;
	totalTests: number;
	totalRuns: number;
	overallSuccessRate: number;
	totalDurationMs: number;
	totalTokens: number;
	modelSummaries: ModelSummary[];
};

async function readRunFiles(modelDir: string): Promise<RunResult[]> {
	const files = await readdir(modelDir);
	const jsonFiles = files.filter((f) => f.endsWith(".json"));

	const results: RunResult[] = [];

	for (const file of jsonFiles) {
		try {
			const content = await readFile(join(modelDir, file), "utf-8");
			const parsed = JSON.parse(content);
			const validated = RunResultSchema.parse(parsed);
			results.push(validated as unknown as RunResult);
		} catch {
			console.warn(`⚠️  Skipping invalid run file: ${file}`);
		}
	}

	return results;
}

function computeTestSummary(testName: string, runs: RunResult[]): TestSummary {
	const totalRuns = runs.length;
	const successfulRuns = runs.filter((r) => r.success).length;
	const failedRuns = totalRuns - successfulRuns;
	const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;

	const totalDuration = runs.reduce((sum, r) => sum + r.durationMs, 0);
	const avgDurationMs = totalRuns > 0 ? totalDuration / totalRuns : 0;

	const totalTokens = {
		input: runs.reduce((sum, r) => sum + r.tokenUsage.input, 0),
		output: runs.reduce((sum, r) => sum + r.tokenUsage.output, 0),
		reasoning: runs.reduce((sum, r) => sum + (r.tokenUsage.reasoning ?? 0), 0),
		total: runs.reduce((sum, r) => sum + r.tokenUsage.total, 0),
	};

	const avgTokenUsage = {
		input: totalRuns > 0 ? totalTokens.input / totalRuns : 0,
		output: totalRuns > 0 ? totalTokens.output / totalRuns : 0,
		reasoning: totalRuns > 0 ? totalTokens.reasoning / totalRuns : 0,
		total: totalRuns > 0 ? totalTokens.total / totalRuns : 0,
	};

	return {
		testName,
		totalRuns,
		successfulRuns,
		failedRuns,
		successRate,
		avgDurationMs,
		avgTokenUsage,
		runs,
	};
}

function computeModelSummary(
	modelName: string,
	runs: RunResult[],
): ModelSummary {
	// Group runs by test name
	const runsByTest = new Map<string, RunResult[]>();
	for (const run of runs) {
		const existing = runsByTest.get(run.testName) ?? [];
		existing.push(run);
		runsByTest.set(run.testName, existing);
	}

	// Compute test summaries
	const testSummaries: TestSummary[] = [];
	for (const [testName, testRuns] of runsByTest) {
		testSummaries.push(computeTestSummary(testName, testRuns));
	}

	// Sort test summaries by name
	testSummaries.sort((a, b) => a.testName.localeCompare(b.testName));

	// Compute model-level stats
	const totalRuns = runs.length;
	const successfulRuns = runs.filter((r) => r.success).length;
	const failedRuns = totalRuns - successfulRuns;
	const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;

	const totalDurationMs = runs.reduce((sum, r) => sum + r.durationMs, 0);
	const avgDurationMs = totalRuns > 0 ? totalDurationMs / totalRuns : 0;

	const totalTokenUsage = {
		input: runs.reduce((sum, r) => sum + r.tokenUsage.input, 0),
		output: runs.reduce((sum, r) => sum + r.tokenUsage.output, 0),
		reasoning: runs.reduce((sum, r) => sum + (r.tokenUsage.reasoning ?? 0), 0),
		total: runs.reduce((sum, r) => sum + r.tokenUsage.total, 0),
	};

	const avgTokenUsage = {
		input: totalRuns > 0 ? totalTokenUsage.input / totalRuns : 0,
		output: totalRuns > 0 ? totalTokenUsage.output / totalRuns : 0,
		reasoning: totalRuns > 0 ? totalTokenUsage.reasoning / totalRuns : 0,
		total: totalRuns > 0 ? totalTokenUsage.total / totalRuns : 0,
	};

	return {
		modelName,
		totalTests: runsByTest.size,
		totalRuns,
		successfulRuns,
		failedRuns,
		successRate,
		totalDurationMs,
		avgDurationMs,
		totalTokenUsage,
		avgTokenUsage,
		testSummaries,
	};
}

/**
 * Combines all runs for a specific model into a summary
 */
export async function combineModelRuns(
	runsDir: string,
	modelName: string,
): Promise<ModelSummary | null> {
	const modelDir = join(runsDir, modelName);

	if (!existsSync(modelDir)) {
		console.warn(`⚠️  Model directory not found: ${modelDir}`);
		return null;
	}

	const runs = await readRunFiles(modelDir);

	if (runs.length === 0) {
		console.warn(`⚠️  No valid runs found for model: ${modelName}`);
		return null;
	}

	return computeModelSummary(modelName, runs);
}

/**
 * Combines runs from a specific benchmark run directory
 * @param runDir - The full path to the run directory (e.g., runs/sample-text-benchmark-2025-01-01T00-00-00-000Z)
 * @param benchmarkName - The benchmark name (without timestamp)
 * @param runTimestamp - The timestamp of the run
 * @param outputFilename - Optional custom output filename (without extension)
 */
export async function combineRunDir(
	runDir: string,
	benchmarkName: string,
	runTimestamp: string,
	outputFilename?: string,
): Promise<BenchmarkSummary> {
	const resolvedRunDir = resolve(process.cwd(), runDir);

	if (!existsSync(resolvedRunDir)) {
		console.log(`📁 Run directory not found: ${resolvedRunDir}`);
		return {
			generatedAt: new Date().toISOString(),
			totalModels: 0,
			totalTests: 0,
			totalRuns: 0,
			overallSuccessRate: 0,
			totalDurationMs: 0,
			totalTokens: 0,
			modelSummaries: [],
		};
	}

	// Find all model directories within the run directory
	const entries = await readdir(resolvedRunDir, { withFileTypes: true });
	const modelDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

	if (modelDirs.length === 0) {
		console.log("📭 No model run directories found in run directory.");
		return {
			generatedAt: new Date().toISOString(),
			totalModels: 0,
			totalTests: 0,
			totalRuns: 0,
			overallSuccessRate: 0,
			totalDurationMs: 0,
			totalTokens: 0,
			modelSummaries: [],
		};
	}

	console.log(`📊 Combining runs from ${modelDirs.length} model(s)...`);

	// Combine runs for each model
	const modelSummaries: ModelSummary[] = [];
	for (const modelDir of modelDirs) {
		const summary = await combineModelRuns(resolvedRunDir, modelDir);
		if (summary) {
			modelSummaries.push(summary);
		}
	}

	// Sort model summaries by name
	modelSummaries.sort((a, b) => a.modelName.localeCompare(b.modelName));

	// Compute overall stats
	const totalRuns = modelSummaries.reduce((sum, m) => sum + m.totalRuns, 0);
	const successfulRuns = modelSummaries.reduce(
		(sum, m) => sum + m.successfulRuns,
		0,
	);
	const overallSuccessRate =
		totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;
	const totalDurationMs = modelSummaries.reduce(
		(sum, m) => sum + m.totalDurationMs,
		0,
	);
	const totalTokens = modelSummaries.reduce(
		(sum, m) => sum + m.totalTokenUsage.total,
		0,
	);

	// Count unique tests across all models
	const uniqueTests = new Set<string>();
	for (const model of modelSummaries) {
		for (const test of model.testSummaries) {
			uniqueTests.add(test.testName);
		}
	}

	const summary: BenchmarkSummary = {
		generatedAt: new Date().toISOString(),
		totalModels: modelSummaries.length,
		totalTests: uniqueTests.size,
		totalRuns,
		overallSuccessRate,
		totalDurationMs,
		totalTokens,
		modelSummaries,
	};

	// Ensure results directory exists
	const resultsDir = resolve(process.cwd(), RESULTS_DIR);
	await mkdir(resultsDir, { recursive: true });

	// Determine output filename
	const filename = outputFilename
		? `${outputFilename}-summary.json`
		: `${benchmarkName}-${runTimestamp}-summary.json`;
	const summaryPath = join(resultsDir, filename);

	await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
	console.log(`📄 Summary written to: ${summaryPath}`);

	return summary;
}

/**
 * Combines all runs across all benchmark run directories (for --combine-only mode)
 * Scans the runs directory for benchmark-timestamp directories and combines the most recent one
 * @param runsDir - The runs directory containing benchmark-timestamp subdirectories
 * @param outputFilename - Optional custom output filename (without extension)
 */
export async function combineAllRuns(
	runsDir: string,
	outputFilename?: string,
): Promise<BenchmarkSummary> {
	const resolvedDir = resolve(process.cwd(), runsDir);

	if (!existsSync(resolvedDir)) {
		console.log(`📁 Creating runs directory: ${resolvedDir}`);
		await mkdir(resolvedDir, { recursive: true });
		return {
			generatedAt: new Date().toISOString(),
			totalModels: 0,
			totalTests: 0,
			totalRuns: 0,
			overallSuccessRate: 0,
			totalDurationMs: 0,
			totalTokens: 0,
			modelSummaries: [],
		};
	}

	// Find all benchmark run directories (format: {benchmark}-{timestamp})
	const entries = await readdir(resolvedDir, { withFileTypes: true });
	const runDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

	if (runDirs.length === 0) {
		console.log("📭 No benchmark run directories found.");
		return {
			generatedAt: new Date().toISOString(),
			totalModels: 0,
			totalTests: 0,
			totalRuns: 0,
			overallSuccessRate: 0,
			totalDurationMs: 0,
			totalTokens: 0,
			modelSummaries: [],
		};
	}

	// Sort by name (timestamp is part of name, so this gives us chronological order)
	runDirs.sort();

	// Get the most recent run directory
	const mostRecentRunDir = runDirs[runDirs.length - 1];

	if (!mostRecentRunDir) {
		console.log("📭 No benchmark run directories found.");
		return {
			generatedAt: new Date().toISOString(),
			totalModels: 0,
			totalTests: 0,
			totalRuns: 0,
			overallSuccessRate: 0,
			totalDurationMs: 0,
			totalTokens: 0,
			modelSummaries: [],
		};
	}

	console.log(`📊 Processing most recent benchmark run: ${mostRecentRunDir}`);

	// Extract benchmark name and timestamp from directory name
	// Format: {benchmark}-{timestamp} where timestamp is like 2025-01-01T00-00-00-000Z
	const timestampMatch = mostRecentRunDir.match(
		/-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)$/,
	);
	let benchmarkName: string;
	let runTimestamp: string;

	if (timestampMatch?.[1]) {
		runTimestamp = timestampMatch[1];
		benchmarkName = mostRecentRunDir.slice(0, -runTimestamp.length - 1);
	} else {
		// Fallback: use the whole dir name as benchmark name
		benchmarkName = mostRecentRunDir;
		runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
	}

	return combineRunDir(
		join(runsDir, mostRecentRunDir),
		benchmarkName,
		runTimestamp,
		outputFilename,
	);
}

// =============================================================================
// Standalone CLI Support
// =============================================================================

// Run if executed directly
if (import.meta.main) {
	const runsDir = process.argv[2] ?? "runs";
	const outputFilename = process.argv[3]; // Optional output filename
	console.log(`🔄 Combining runs from: ${runsDir}`);

	combineAllRuns(runsDir, outputFilename)
		.then((summary) => {
			console.log("");
			console.log("═".repeat(60));
			console.log("📊 Benchmark Summary");
			console.log("═".repeat(60));
			console.log(`   Models: ${summary.totalModels}`);
			console.log(`   Tests: ${summary.totalTests}`);
			console.log(`   Total runs: ${summary.totalRuns}`);
			console.log(`   Success rate: ${summary.overallSuccessRate.toFixed(1)}%`);
			console.log(
				`   Total time: ${(summary.totalDurationMs / 1000).toFixed(2)}s`,
			);
			console.log(`   Total tokens: ${summary.totalTokens}`);
			console.log("");
		})
		.catch((error) => {
			console.error("❌ Error combining runs:", error);
			process.exit(1);
		});
}
