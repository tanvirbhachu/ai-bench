// =============================================================================
// AI-BENCH - Sample Text Benchmark
// =============================================================================
// This is a sample benchmark file demonstrating text-based tests.
// Text tests use an LLM `judging` model to evaluate responses.
// =============================================================================

import { judgeModel } from "../models.ts";
import type { Benchmark, BenchmarkTest } from "../index.ts";

const tests: BenchmarkTest[] = [
	{
		name: "basic-qa-literature",
		type: "text",
		prompt: "Who wrote the novel 'Crime and Punishment'?",
		description: "Tests basic factual knowledge about classic literature",
		expectedAnswer: "Fyodor Dostoevsky",
	},
	{
		name: "basic-qa-science",
		type: "text",
		prompt: "What is the chemical symbol for gold?",
		description: "Tests basic chemistry knowledge",
		expectedAnswer: "Au",
	},
	{
		name: "basic-qa-geography",
		type: "text",
		prompt: "What is the capital city of Japan?",
		description: "Tests basic geography knowledge",
		expectedAnswer: "Tokyo",
	},
	{
		name: "reasoning-math",
		type: "text",
		prompt:
			"If a train travels at 60 miles per hour for 2.5 hours, how far does it travel? Show your work.",
		description: "Tests basic mathematical reasoning",
		expectedAnswer: "150 miles",
	},
	{
		name: "instruction-following",
		type: "text",
		prompt:
			"List exactly 3 primary colors. Respond with only the colors, separated by commas.",
		description: "Tests ability to follow specific instructions",
		expectedAnswer: "Red, Blue, Yellow",
	},
];

const benchmark: Benchmark = {
	judgeModel,
	tests,
};

export default benchmark;
