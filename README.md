# open-ai-bench (Beta)

So, we see all these tests for AI like the ones on [Artificial Analysis](https://artificialanalysis.ai/models) but what if you want to run your own tests? 

Well, thats what this is for. You define your models, define your tests and that's about it.

## What makes this special?

- You have your `testing` model generate an answer to a test question and then also define the expected real-world answer. We then use a secondary `judge` model to determine whether the testing model gave the correct answer or not.

- You can test structured outputs (which mean the model generates a JSON response). Eg, you're testing a model's ability to scrape data and turn it into JSON.

- A benchmark is defined within a `.ts` file, which means you can create a benchmark and share it with anyone else.

## Features

- 🎯 **Type-Safe**: Full TypeScript with Zod validation for all inputs and outputs
- 🎨 **Rich TUI**: The TUI looks cool
- 🔒 **Crash-Proof**: Write-ahead log strategy ensures no data loss
- 🌐 **Universal**: Benchmarks any model via OpenRouter using the Vercel AI SDK
- 📊 **Comprehensive Metrics**: Tracks success rates, token usage, duration, and more
- 🔄 **Two Test Modes**:
  - **Structured Output**: Validates responses against Zod schemas
  - **Text**: Uses LLM-as-a-judge pattern for evaluation
- ⚡ **Parallel Execution**: Configurable concurrency for faster benchmarks
- 📈 **Detailed Reports**: Aggregated JSON summaries with per-model and per-test statistics

## Installation

```bash
bun install
```

## Setup

### 1. Environment Variables

Create a `.env` file and simply add your OpenRouter API key. You can get one from [OpenRouter](https://openrouter.ai/).

```bash
OPENROUTER_API_KEY="sk-your-api-key-here"
```

### 2. Configure Models

Edit `models.ts` to define the models you want to benchmark:

```typescript
export const models: BenchmarkModel[] = [
  {
    name: "openai/gpt-4o",
    llm: openrouter("openai/gpt-4o"),
    reasoning: false,
  },
  {
    name: "anthropic/claude-3.5-sonnet",
    llm: openrouter("anthropic/claude-3.5-sonnet"),
    reasoning: false,
  },
];
```

### 3. Create Benchmarks

Benchmarks are TypeScript files in the `benchmarks/` directory. See the sample files for examples:

- `sample-text-benchmark.ts` - Text-based tests with LLM judging
- `sample-json-benchmark.ts` - Structured output tests with schema validation

## Usage

### Basic Usage

```bash
bun run index.tsx
```

This runs the default benchmark (`sample-text-benchmark.ts`) with default settings.

### CLI Options

```bash
bun run index.tsx [options]
```

**Options:**

- `-b, --benchmark <file>` - Benchmark file to run (default: `sample-text-benchmark.ts`)
- `-r, --runs <number>` - Number of runs per test (default: `1`)
- `-p, --parallel <number>` - Number of tests to run in parallel (default: `1`)
- `-m, --model <name>` - Specific model to use from `models.ts` (optional)
- `-o, --output-dir <path>` - Output directory for run results (default: `runs`)
- `--output <name>` - Custom output filename for the summary (without extension)
- `--combine-only` - Only combine existing runs, don't run benchmarks

### Examples

Run a specific benchmark with 3 runs per test:

```bash
bun run index.tsx --benchmark sample-json-benchmark.ts --runs 3
```

Run with parallel execution (5 concurrent tests):

```bash
bun run index.tsx --parallel 5
```

Test a specific model:

```bash
bun run index.tsx --model gpt4
```

Combine existing runs into a summary:

```bash
bun run index.tsx --combine-only
```

## Persistence Strategy

We don't want to waste AI tokens in the event of a cancel or failure. So, we use a write-ahead log (WAL) strategy:

- Each run is saved immediately upon completion to `runs/{benchmark}-{timestamp}/{model}/{timestamp}-{test}.json`
- Final summary is generated in `results/{benchmark}-{timestamp}-summary.json`
- This ensures data is never lost, even if the process crashes

### Test Types

#### Structured Output Tests

Tests the model's ability to generate valid structured data:

```typescript
{
  name: "json-generation",
  type: "structured-output",
  prompt: "Return popular web technologies...",
  schema: z.object({
    backendFramework: z.enum(["nextjs", "express", ...]),
    frontendFramework: z.enum(["react", "vue", ...]),
    // ...
  }),
}
```

#### Text Tests

Tests general knowledge or reasoning with LLM-as-a-judge:

```typescript
{
  name: "basic-qa-literature",
  type: "text",
  prompt: "Who wrote 'Crime and Punishment'?",
  expectedAnswer: "Fyodor Dostoevsky",
}
```

## Output Format

### Individual Run Results

Each run is saved as JSON with:

- Test name, model name, run index
- Success status and reason
- Duration and token usage (input, output, reasoning, total)
- Raw output and judge output (if applicable)

### Summary Report

The aggregated summary includes:

- Overall statistics (total runs, success rate, duration, tokens)
- Per-model summaries with averages
- Per-test summaries with success rates
- Complete run history
