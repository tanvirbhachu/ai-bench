// =============================================================================
// AI-BENCH - Model Configurations
// =============================================================================
// This file defines the models to be used in benchmarks.
// Models are configured using the OpenRouter provider via the Vercel AI SDK.
// =============================================================================

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { BenchmarkModel } from "./index.tsx";

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

// =============================================================================
// Models
// =============================================================================
// Add your own models here. The entire test suite will be run against each model.
// You can add as many models as you want but we recommend keeping it to a reasonable number.

export const models: BenchmarkModel[] = [
	{
		name: "openai/gpt-5-nano",
		llm: openrouter("openai/gpt-5-nano"),
		reasoning: true,
	},
];
