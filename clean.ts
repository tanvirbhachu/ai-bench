#!/usr/bin/env bun

import { cac } from "cac";
import { rm, readdir, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const cli = cac("clean");

cli
	.option("--remove-runs", "Remove all files in the runs directory")
	.option("--remove-results", "Remove all files in the results directory")
	.help();

const { options } = cli.parse();

const runsDir = join(process.cwd(), "runs");
const resultsDir = join(process.cwd(), "results");

async function cleanRuns() {
	try {
		if (!existsSync(runsDir)) {
			console.log("runs directory does not exist, skipping...");
			return;
		}

		const entries = await readdir(runsDir);
		if (entries.length === 0) {
			console.log("runs directory is already empty");
			return;
		}

		// Remove all contents but keep the directory
		for (const entry of entries) {
			const entryPath = join(runsDir, entry);
			await rm(entryPath, { recursive: true, force: true });
		}

		console.log("✓ Removed all runs");
	} catch (error) {
		console.error("Error removing runs:", error);
		process.exit(1);
	}
}

async function cleanResults() {
	try {
		if (!existsSync(resultsDir)) {
			console.log("results directory does not exist, skipping...");
			return;
		}

		const entries = await readdir(resultsDir);
		if (entries.length === 0) {
			console.log("results directory is already empty");
			return;
		}

		// Remove all contents but keep the directory
		for (const entry of entries) {
			const entryPath = join(resultsDir, entry);
			await rm(entryPath, { recursive: true, force: true });
		}

		console.log("✓ Removed all results");
	} catch (error) {
		console.error("Error removing results:", error);
		process.exit(1);
	}
}

async function main() {
	if (!options.removeRuns && !options.removeResults) {
		console.log("No options specified. Use --remove-runs and/or --remove-results");
		cli.outputHelp();
		process.exit(1);
	}

	if (options.removeRuns) {
		await cleanRuns();
	}

	if (options.removeResults) {
		await cleanResults();
	}
}

main();

