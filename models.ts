// =============================================================================
// AI-BENCH - Model Configurations
// =============================================================================
// This file defines the models to be used in benchmarks.
// Models are configured using the OpenRouter provider via the Vercel AI SDK.
// =============================================================================

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { BenchmarkModel } from "./index.ts";

const openrouter = createOpenRouter({
	apiKey: process.env.OPENROUTER_API_KEY,
});

// =============================================================================
// Judge Model
// =============================================================================
// This model is used to evaluate text responses from models. It's recommended that
// you use a fairly light and fast model, as it's only checking whether the response
// can be considered `correct` based on the expected answer.

export const judgeModel: BenchmarkModel = {
	name: "openai/gpt-oss-20b:free",
	llm: openrouter("openai/gpt-oss-20b:free"),
	reasoning: false,
};

export const models: BenchmarkModel[] = [
	{
		name: "x-ai/grok-4.1-fast:free",
		llm: openrouter("x-ai/grok-4.1-fast:free"),
		reasoning: false,
	},
	{
		name: "z-ai/glm-4.5-air:free",
		llm: openrouter("z-ai/glm-4.5-air:free"),
		reasoning: false,
	},
];
