import { useState, useEffect, useRef, useCallback } from "react";
import type { BenchmarkRunner } from "./persistence.ts";
import type { RunResult } from "./index.tsx";

export type ActiveRun = {
	testName: string;
	modelName: string;
	runIndex: number;
	startTime: number;
};

export type BenchmarkStoreState = {
	// Config info
	benchmarkName: string;
	totalTests: number;
	runsPerTest: number;
	modelsCount: number;
	parallelLimit: number;

	// Progress
	totalRuns: number;
	completedRuns: number;
	successfulRuns: number;
	failedRuns: number;

	// Timing
	startTime: number | null;
	elapsedMs: number;

	// Tokens
	totalTokens: number;

	// Active runs
	activeRuns: ActiveRun[];

	// Completed runs
	completedResults: RunResult[];

	// Errors
	errors: Array<{ testName: string; modelName: string; message: string }>;

	// Status
	isComplete: boolean;
};

export function useBenchmarkStore(
	runner: BenchmarkRunner,
	config: {
		benchmarkName: string;
		modelsCount: number;
		parallelLimit: number;
		totalTests: number;
		runsPerTest: number;
	},
): BenchmarkStoreState {
	// Calculate total runs from config (avoid race condition with benchmark:start event)
	const initialTotalRuns = config.totalTests * config.runsPerTest;

	const [state, setState] = useState<BenchmarkStoreState>({
		benchmarkName: config.benchmarkName,
		totalTests: config.totalTests,
		runsPerTest: config.runsPerTest,
		modelsCount: config.modelsCount,
		parallelLimit: config.parallelLimit,
		totalRuns: initialTotalRuns,
		completedRuns: 0,
		successfulRuns: 0,
		failedRuns: 0,
		startTime: Date.now(), // Start timing immediately
		elapsedMs: 0,
		totalTokens: 0,
		activeRuns: [],
		completedResults: [],
		errors: [],
		isComplete: false,
	});

	// Throttle state updates
	const pendingUpdates = useRef<Partial<BenchmarkStoreState>>({});
	const updateScheduled = useRef(false);
	const activeRunsRef = useRef<ActiveRun[]>([]);
	const completedResultsRef = useRef<RunResult[]>([]);
	const errorsRef = useRef<
		Array<{ testName: string; modelName: string; message: string }>
	>([]);

	// Immediate update for critical changes (active runs)
	const forceUpdate = useCallback(() => {
		setState((prev) => {
			// Extract activeRuns, completedResults, and errors from pendingUpdates if present
			// to ensure they're always set from refs, not from pendingUpdates
			const {
				activeRuns: _,
				completedResults: __,
				errors: ___,
				...otherPendingUpdates
			} = pendingUpdates.current;

			return {
				...prev,
				...otherPendingUpdates,
				// Always set these from refs to ensure they're up-to-date
				activeRuns: [...activeRunsRef.current],
				completedResults: [...completedResultsRef.current],
				errors: [...errorsRef.current],
			};
		});
		pendingUpdates.current = {};
		updateScheduled.current = false;
	}, []);

	// Throttled update for less critical changes
	const scheduleUpdate = useCallback(() => {
		if (updateScheduled.current) return;
		updateScheduled.current = true;

		setTimeout(() => {
			forceUpdate();
		}, 50);
	}, [forceUpdate]);

	// Elapsed time ticker
	useEffect(() => {
		if (state.isComplete) return;

		const interval = setInterval(() => {
			setState((prev) => ({
				...prev,
				elapsedMs: Date.now() - (prev.startTime ?? Date.now()),
			}));
		}, 100);

		return () => clearInterval(interval);
	}, [state.isComplete]);

	// Subscribe to runner events
	useEffect(() => {
		const handleBenchmarkStart = (payload: {
			totalTests: number;
			runsPerTest: number;
		}) => {
			const totalRuns = payload.totalTests * payload.runsPerTest;

			pendingUpdates.current = {
				...pendingUpdates.current,
				totalTests: payload.totalTests,
				runsPerTest: payload.runsPerTest,
				totalRuns,
				startTime: Date.now(),
			};

			scheduleUpdate();
		};

		const handleRunStart = (payload: {
			testName: string;
			modelName: string;
			runIndex: number;
		}) => {
			const newActiveRun: ActiveRun = {
				...payload,
				startTime: Date.now(),
			};

			activeRunsRef.current = [...activeRunsRef.current, newActiveRun];

			// Use immediate update for active runs so they show up
			forceUpdate();
		};

		const handleRunComplete = (result: RunResult) => {
			activeRunsRef.current = activeRunsRef.current.filter(
				(run) =>
					!(
						run.testName === result.testName &&
						run.modelName === result.modelName &&
						run.runIndex === result.runIndex
					),
			);
			completedResultsRef.current.push(result);

			const completedRuns = completedResultsRef.current.length;
			const successfulRuns = completedResultsRef.current.filter(
				(r) => r.success,
			).length;
			const failedRuns = completedRuns - successfulRuns;
			const totalTokens = completedResultsRef.current.reduce(
				(sum, r) => sum + r.tokenUsage.total,
				0,
			);

			pendingUpdates.current = {
				...pendingUpdates.current,
				completedRuns,
				successfulRuns,
				failedRuns,
				totalTokens,
			};
			// Use immediate update for completed runs to show results right away
			forceUpdate();
		};

		const handleRunError = (payload: {
			testName: string;
			modelName: string;
			runIndex: number;
			error: Error;
		}) => {
			activeRunsRef.current = activeRunsRef.current.filter(
				(run) =>
					!(
						run.testName === payload.testName &&
						run.modelName === payload.modelName &&
						run.runIndex === payload.runIndex
					),
			);
			errorsRef.current.push({
				testName: payload.testName,
				modelName: payload.modelName,
				message: payload.error.message,
			});
			scheduleUpdate();
		};

		const handleBenchmarkComplete = (_payload: { results: RunResult[] }) => {
			pendingUpdates.current = {
				...pendingUpdates.current,
				isComplete: true,
			};
			// Force immediate update on completion
			setState((prev) => ({
				...prev,
				...pendingUpdates.current,
				activeRuns: [...activeRunsRef.current],
				completedResults: [...completedResultsRef.current],
				errors: [...errorsRef.current],
				elapsedMs: Date.now() - (prev.startTime ?? Date.now()),
			}));
		};

		runner.on("benchmark:start", handleBenchmarkStart);
		runner.on("run:start", handleRunStart);
		runner.on("run:complete", handleRunComplete);
		runner.on("run:error", handleRunError);
		runner.on("benchmark:complete", handleBenchmarkComplete);

		return () => {
			runner.removeListener("benchmark:start", handleBenchmarkStart);
			runner.removeListener("run:start", handleRunStart);
			runner.removeListener("run:complete", handleRunComplete);
			runner.removeListener("run:error", handleRunError);
			runner.removeListener("benchmark:complete", handleBenchmarkComplete);
		};
	}, [runner, scheduleUpdate, forceUpdate]);

	return state;
}
