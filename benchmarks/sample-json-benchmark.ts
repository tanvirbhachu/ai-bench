// =============================================================================
// AI-BENCH - Sample Text Benchmark
// =============================================================================
// This is a sample benchmark file demonstrating json-based tests.
// JSON tests will be validated using Zod schemas to ensure the output is valid.
// =============================================================================

import { judgeModel } from "../models.ts";
import type { Benchmark, BenchmarkTest } from "../index.tsx";
import z from "zod/v3";

const tests: BenchmarkTest[] = [
	{
		name: "json-generation",
		type: "structured-output",
		prompt:
			"Return the most popular services/technologies for the following categories: backend, frontend, database, hosting, styling.",
		description:
			"Simple enum test using common web technologies. Coding architecture is widely available and easy to pull off.",
		schema: z.object({
			backendFramework: z.enum([
				"nextjs",
				"express",
				"fastapi",
				"flask",
				"hono",
			]),
			frontendFramework: z.enum([
				"nextjs",
				"react",
				"vue",
				"svelte",
				"angular",
			]),
			database: z.enum([
				"neon",
				"supabase",
				"planetscale",
				"vercel postgres",
				"mongodb",
			]),
			hostingProvider: z.enum(["vercel", "railway", "flyio"]),
			stylingFramework: z.enum([
				"tailwind",
				"chakra",
				"mui",
				"styled-components",
			]),
		}),
	},
	{
		name: "json-generation-high",
		type: "structured-output",
		prompt:
			"Generate a couple of example projects focusing on specific roles and seniority levels.",
		description:
			"Introduces `z.discriminatedUnion` and `z.literal`. This is fairly high-level and is meant to test schema support within models.",
		schema: z
			.array(
				z.object({
					complexity: z.enum(["Low", "Medium", "High", "Enterprise"]),
					role: z.enum([
						"Frontend Lead",
						"Backend Developer",
						"Full-Stack Engineer",
						"DevOps Specialist",
						"UI/UX Designer",
					]),
					seniority: z.enum(["Junior", "Mid-level", "Senior", "Principal"]),
					projectName: z.string(),
					projectDescription: z.string(),
					architecture: z.discriminatedUnion("projectType", [
						z.object({
							projectType: z.literal("Monolith"),
							framework: z.enum([
								"Next.js",
								"Ruby on Rails",
								"Django",
								"Laravel",
							]),
						}),
						z.object({
							projectType: z.literal("Microservices"),
							services: z
								.array(
									z.object({
										serviceName: z.string(),
										language: z.enum(["TypeScript", "Python", "Go", "Rust"]),
									}),
								)
								.min(2),
						}),
						z.object({
							projectType: z.literal("Serverless"),
							provider: z.enum([
								"AWS Lambda",
								"Vercel Functions",
								"Google Cloud Functions",
							]),
							runtime: z.enum(["Node.js", "Python", "Deno"]),
						}),
					]),
					language: z.enum(["TypeScript", "Python", "Go", "Rust"]),
					database: z.discriminatedUnion("dbType", [
						z.object({
							dbType: z.literal("SQL"),
							engine: z.enum(["PostgreSQL", "MySQL", "SQLite"]),
							orm: z.enum(["Prisma", "Drizzle", "SQLAlchemy", "Active Record"]),
						}),
						z.object({
							dbType: z.literal("NoSQL"),
							engine: z.enum(["MongoDB", "Firestore", "DynamoDB"]),
						}),
					]),
				}),
			)
			.min(1),
	},
];

const benchmark: Benchmark = {
	judgeModel,
	tests,
};

export default benchmark;
