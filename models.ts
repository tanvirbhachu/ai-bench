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
// Some providers have difficulty with structured output generation especially on low tier models.
// You can go to your OpenRouter settings and manually control which providers to use or exclude.
//
// We recommend using GPT-OSS 20B from Groq since it's cheap, reliable and really fast.
// But we can't force Groq as a provider so Gemini it is.
export const judgeModel: BenchmarkModel = {
	name: "google/gemini-2.5-flash-lite",
	llm: openrouter("google/gemini-2.5-flash-lite", {
		reasoning: { exclude: false, effort: "low" },
	}),
};

// =============================================================================
// Models
// =============================================================================
// Add your own models here. The entire test suite will be run against each model.
// You can add as many models as you want but we recommend keeping it to a reasonable number.

export const models: BenchmarkModel[] = [
	{
		name: "xAI: Grok Code Fast 1",
		llm: openrouter("x-ai/grok-code-fast-1", {
			reasoning: { exclude: false, effort: "low" },
		}),
	},
	{
		name: "Google: Gemini 2.5 Flash",
		llm: openrouter("google/gemini-2.5-flash", {
			reasoning: { exclude: false, effort: "low" },
		}),
	},
	{
		name: "Z.AI: GLM 4.6",
		llm: openrouter("z-ai/glm-4.6", {
			reasoning: { exclude: false, effort: "low" },
		}),
	},
];
