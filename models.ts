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
//
// Note, that the model must have the ability to generate structured outputs.
// We recommend using GPT-OSS 20B — it's fast, cheap and works

export const judgeModel: BenchmarkModel = {
	name: "openai/gpt-oss-20b",
	llm: openrouter("openai/gpt-oss-20b"),
	providerOptions: {
		openrouter: {
			// some providers have broken structured output generation. But Groq works and is super fast.
			order: ["groq"],
		},
	},
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
	},
];
