import type React from "react";
import { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import Spinner from "ink-spinner";
import { useBenchmarkStore, type ActiveRun } from "./use-benchmark-store.ts";
import type { BenchmarkRunner } from "./persistence.ts";
import type { RunResult } from "./index.tsx";

function useTerminalWidth(): number {
    const { stdout } = useStdout();
    const [width, setWidth] = useState(stdout?.columns ?? 80);

    useEffect(() => {
        if (!stdout) return;

        const handleResize = () => {
            setWidth(stdout.columns ?? 80);
        };

        stdout.on("resize", handleResize);
        return () => {
            stdout.off("resize", handleResize);
        };
    }, [stdout]);

    return width;
}

const Header: React.FC<{
    benchmarkName: string;
    modelsCount: number;
    totalRuns: number;
    runsPerTest: number;
    parallelLimit: number;
    terminalWidth: number;
}> = ({ benchmarkName, modelsCount, totalRuns, runsPerTest, parallelLimit, terminalWidth }) => {
    const separatorWidth = Math.min(terminalWidth, 100);

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text bold color="cyan">
                    {"=".repeat(separatorWidth)}
                </Text>
            </Box>
            <Box>
                <Text bold color="cyan">
                    {" "}
                    AIBench - Benchmark Runner
                </Text>
            </Box>
            <Box>
                <Text bold color="cyan">
                    {"=".repeat(separatorWidth)}
                </Text>
            </Box>
            <Box marginTop={1}>
                <Text>
                    <Text dimColor>Benchmark:</Text> <Text bold>{benchmarkName}</Text>
                </Text>
            </Box>
            <Box>
                <Text>
                    <Text dimColor>Models:</Text> {modelsCount}
                    {"  "}
                    <Text dimColor>Total Runs:</Text> {totalRuns}
                    {"  "}
                    <Text dimColor>Runs/Test:</Text> {runsPerTest}
                    {"  "}
                    <Text dimColor>Parallel:</Text> {parallelLimit}
                </Text>
            </Box>
        </Box>
    );
};

const ProgressStats: React.FC<{
    totalRuns: number;
    completedRuns: number;
    successfulRuns: number;
    failedRuns: number;
    elapsedMs: number;
    totalTokens: number;
}> = ({
    totalRuns,
    completedRuns,
    successfulRuns,
    failedRuns,
    elapsedMs,
    totalTokens,
}) => {
        const successRate =
            completedRuns > 0 ? ((successfulRuns / completedRuns) * 100).toFixed(1) : "0.0";
        const elapsed = (elapsedMs / 1000).toFixed(1);
        const progress =
            totalRuns > 0 ? ((completedRuns / totalRuns) * 100).toFixed(0) : "0";

        // Progress bar
        const barWidth = 30;
        const filledWidth = Math.round(
            (completedRuns / Math.max(totalRuns, 1)) * barWidth,
        );
        const emptyWidth = barWidth - filledWidth;
        const progressBar = `[${"#".repeat(filledWidth)}${"-".repeat(emptyWidth)}]`;

        return (
            <Box flexDirection="column" marginBottom={1}>
                <Box>
                    <Text dimColor>Progress: </Text>
                    <Text color="cyan">{progressBar}</Text>
                    <Text>
                        {" "}
                        {completedRuns}/{totalRuns} ({progress}%)
                    </Text>
                </Box>
                <Box>
                    <Text>
                        <Text color="green">[PASS] {successfulRuns}</Text>
                        {"  "}
                        <Text color="red">[FAIL] {failedRuns}</Text>
                        {"  "}
                        <Text dimColor>Rate:</Text>{" "}
                        <Text color={Number(successRate) >= 80 ? "green" : Number(successRate) >= 50 ? "yellow" : "red"}>
                            {successRate}%
                        </Text>
                    </Text>
                </Box>
                <Box>
                    <Text>
                        <Text dimColor>Elapsed:</Text> {elapsed}s{"  "}
                        <Text dimColor>Tokens Used:</Text> {totalTokens.toLocaleString()}
                    </Text>
                </Box>
            </Box>
        );
    };

const ActiveRunsIndicator: React.FC<{
    activeRuns: ActiveRun[];
}> = ({ activeRuns }) => {
    const count = activeRuns.length;

    if (count === 0) {
        return (
            <Box marginBottom={1}>
                <Text dimColor>No active runs</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text color="yellow">
                    <Spinner type="dots" />
                </Text>
                <Text>
                    {" "}
                    {count} test{count !== 1 ? "s" : ""} running...
                </Text>
            </Box>
            {activeRuns.map((run) => (
                <Box key={`${run.testName}-${run.modelName}-${run.runIndex}`} marginLeft={3}>
                    <Text dimColor>
                        • {run.testName} ({run.modelName.split("/").pop() ?? run.modelName}) - Run {run.runIndex + 1}
                    </Text>
                </Box>
            ))}
        </Box>
    );
};

const TableRow: React.FC<{
    cells: Array<{ content: string; width: number; color?: string }>;
    isHeader?: boolean;
}> = ({ cells, isHeader = false }) => {
    return (
        <Box>
            {cells.map((cell, idx) => (
                <Box key={`${cell.content}-${idx}`} width={cell.width}>
                    <Text
                        bold={isHeader}
                        color={cell.color as undefined}
                        dimColor={isHeader}
                    >
                        {cell.content.padEnd(cell.width).substring(0, cell.width)}
                    </Text>
                </Box>
            ))}
        </Box>
    );
};

const LiveRunsTable: React.FC<{
    completedResults: RunResult[];
    terminalWidth: number;
}> = ({ completedResults, terminalWidth }) => {
    const separatorWidth = Math.min(terminalWidth, 100);

    // Column widths
    const cols = {
        status: 8,
        test: 25,
        model: 25,
        run: 5,
        duration: 10,
        tokens: 10,
    };

    // Sort by timestamp (newest first)
    const sortedResults = [...completedResults].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return (
        <Box flexDirection="column">
            <Box marginBottom={0}>
                <Text bold dimColor>
                    {"-".repeat(separatorWidth)}
                </Text>
            </Box>
            <TableRow
                isHeader
                cells={[
                    { content: "STATUS", width: cols.status },
                    { content: "TEST", width: cols.test },
                    { content: "MODEL", width: cols.model },
                    { content: "RUN", width: cols.run },
                    { content: "TIME(ms)", width: cols.duration },
                    { content: "TOKENS", width: cols.tokens },
                ]}
            />
            <Box marginBottom={0}>
                <Text dimColor>{"-".repeat(separatorWidth)}</Text>
            </Box>
            {sortedResults.length === 0 ? (
                <Box>
                    <Text dimColor>No completed runs yet...</Text>
                </Box>
            ) : (
                sortedResults.map((result) => {
                    const key = `${result.testName}-${result.modelName}-${result.runIndex}-${result.timestamp}`;
                    return (
                        <TableRow
                            key={key}
                            cells={[
                                {
                                    content: result.success ? "[PASS]" : "[FAIL]",
                                    width: cols.status,
                                    color: result.success ? "green" : "red",
                                },
                                { content: result.testName, width: cols.test },
                                {
                                    content: result.modelName.split("/").pop() ?? result.modelName,
                                    width: cols.model,
                                },
                                { content: String(result.runIndex + 1), width: cols.run },
                                { content: String(result.durationMs), width: cols.duration },
                                {
                                    content: result.tokenUsage.total.toLocaleString(),
                                    width: cols.tokens,
                                },
                            ]}
                        />
                    );
                })
            )}
        </Box>
    );
};

type ModelStats = {
    modelName: string;
    totalRuns: number;
    successfulRuns: number;
    avgDurationMs: number;
    totalTokens: number;
};

const FinalSummary: React.FC<{
    completedResults: RunResult[];
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    elapsedMs: number;
    totalTokens: number;
    terminalWidth: number;
}> = ({
    completedResults,
    totalRuns,
    successfulRuns,
    failedRuns,
    elapsedMs,
    totalTokens,
    terminalWidth,
}) => {
        const separatorWidth = Math.min(terminalWidth, 100);
        const successRate =
            totalRuns > 0 ? ((successfulRuns / totalRuns) * 100).toFixed(1) : "0.0";

        // Calculate per-model stats
        const modelStatsMap = new Map<string, ModelStats>();
        for (const result of completedResults) {
            const existing = modelStatsMap.get(result.modelName);
            if (existing) {
                existing.totalRuns++;
                if (result.success) existing.successfulRuns++;
                existing.avgDurationMs += result.durationMs;
                existing.totalTokens += result.tokenUsage.total;
            } else {
                modelStatsMap.set(result.modelName, {
                    modelName: result.modelName,
                    totalRuns: 1,
                    successfulRuns: result.success ? 1 : 0,
                    avgDurationMs: result.durationMs,
                    totalTokens: result.tokenUsage.total,
                });
            }
        }

        // Calculate averages
        const modelStats = Array.from(modelStatsMap.values()).map((stats) => ({
            ...stats,
            avgDurationMs: Math.round(stats.avgDurationMs / stats.totalRuns),
            successRate: ((stats.successfulRuns / stats.totalRuns) * 100).toFixed(1),
        }));

        // Column widths for model summary
        const cols = {
            model: 30,
            runs: 8,
            rate: 10,
            avgTime: 12,
            tokens: 12,
        };

        return (
            <Box flexDirection="column" marginTop={1}>
                <Box>
                    <Text bold color="cyan">
                        {"=".repeat(separatorWidth)}
                    </Text>
                </Box>
                <Box>
                    <Text bold color="cyan">
                        {" "}
                        BENCHMARK COMPLETE
                    </Text>
                </Box>
                <Box>
                    <Text bold color="cyan">
                        {"=".repeat(separatorWidth)}
                    </Text>
                </Box>

                <Box flexDirection="column" marginTop={1} marginBottom={1}>
                    <Box>
                        <Text>
                            <Text dimColor>Total Runs:</Text> {totalRuns}
                        </Text>
                    </Box>
                    <Box>
                        <Text>
                            <Text dimColor>Successful:</Text>{" "}
                            <Text color="green">{successfulRuns}</Text>
                            {"  "}
                            <Text dimColor>Failed:</Text> <Text color="red">{failedRuns}</Text>
                        </Text>
                    </Box>
                    <Box>
                        <Text>
                            <Text dimColor>Success Rate:</Text>{" "}
                            <Text color={Number(successRate) >= 80 ? "green" : Number(successRate) >= 50 ? "yellow" : "red"}>
                                {successRate}%
                            </Text>
                        </Text>
                    </Box>
                    <Box>
                        <Text>
                            <Text dimColor>Total Time:</Text> {(elapsedMs / 1000).toFixed(2)}s
                        </Text>
                    </Box>
                    <Box>
                        <Text>
                            <Text dimColor>Total Tokens:</Text> {totalTokens.toLocaleString()}
                        </Text>
                    </Box>
                </Box>

                {modelStats.length > 0 && (
                    <Box flexDirection="column">
                        <Box>
                            <Text bold>Per-Model Summary:</Text>
                        </Box>
                        <Box marginTop={0}>
                            <Text dimColor>{"-".repeat(separatorWidth)}</Text>
                        </Box>
                        <TableRow
                            isHeader
                            cells={[
                                { content: "MODEL", width: cols.model },
                                { content: "RUNS", width: cols.runs },
                                { content: "RATE", width: cols.rate },
                                { content: "AVG TIME", width: cols.avgTime },
                                { content: "TOKENS", width: cols.tokens },
                            ]}
                        />
                        <Box>
                            <Text dimColor>{"-".repeat(separatorWidth)}</Text>
                        </Box>
                        {modelStats.map((stats) => (
                            <TableRow
                                key={stats.modelName}
                                cells={[
                                    {
                                        content:
                                            stats.modelName.split("/").pop() ?? stats.modelName,
                                        width: cols.model,
                                    },
                                    { content: String(stats.totalRuns), width: cols.runs },
                                    {
                                        content: `${stats.successRate}%`,
                                        width: cols.rate,
                                        color: Number(stats.successRate) >= 80 ? "green" : Number(stats.successRate) >= 50 ? "yellow" : "red",
                                    },
                                    { content: `${stats.avgDurationMs}ms`, width: cols.avgTime },
                                    {
                                        content: stats.totalTokens.toLocaleString(),
                                        width: cols.tokens,
                                    },
                                ]}
                            />
                        ))}
                    </Box>
                )}
            </Box>
        );
    };

export const BenchmarkApp: React.FC<{
    runner: BenchmarkRunner;
    benchmarkName: string;
    modelsCount: number;
    parallelLimit: number;
    totalTests: number;
    runsPerTest: number;
}> = ({ runner, benchmarkName, modelsCount, parallelLimit, totalTests, runsPerTest }) => {
    const terminalWidth = useTerminalWidth();
    const state = useBenchmarkStore(runner, {
        benchmarkName,
        modelsCount,
        parallelLimit,
        totalTests,
        runsPerTest,
    });

    return (
        <Box flexDirection="column">
            <Header
                benchmarkName={state.benchmarkName}
                modelsCount={state.modelsCount}
                totalRuns={state.totalTests * state.runsPerTest}
                runsPerTest={state.runsPerTest}
                parallelLimit={state.parallelLimit}
                terminalWidth={terminalWidth}
            />

            <ProgressStats
                totalRuns={state.totalRuns}
                completedRuns={state.completedRuns}
                successfulRuns={state.successfulRuns}
                failedRuns={state.failedRuns}
                elapsedMs={state.elapsedMs}
                totalTokens={state.totalTokens}
            />

            {!state.isComplete && <ActiveRunsIndicator activeRuns={state.activeRuns} />}

            <LiveRunsTable completedResults={state.completedResults} terminalWidth={terminalWidth} />

            {state.isComplete && (
                <FinalSummary
                    completedResults={state.completedResults}
                    totalRuns={state.totalRuns}
                    successfulRuns={state.successfulRuns}
                    failedRuns={state.failedRuns}
                    elapsedMs={state.elapsedMs}
                    totalTokens={state.totalTokens}
                    terminalWidth={terminalWidth}
                />
            )}

            {state.errors.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    <Text bold color="red">
                        Errors:
                    </Text>
                    {state.errors.map((err, idx) => (
                        <Box key={`${err.testName}-${err.modelName}-${err.message}-${idx}`}>
                            <Text color="red">
                                - {err.testName} ({err.modelName}): {err.message}
                            </Text>
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
};