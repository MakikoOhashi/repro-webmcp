#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectsTypeScriptProject, scanAndGenerate } from "./scanner.js";
import { setupProject } from "./setup.js";

const CONFIG_FILES = ["repro.config.js", "repro.config.ts"];
const INITIAL_CONFIG = `import { defineRepro } from "repro-webmcp";

export default defineRepro({
  states: {},
});
`;

function hasTypeScriptProject(): boolean {
  if (existsSync(join(process.cwd(), "tsconfig.json"))) return true;
  const packagePath = join(process.cwd(), "package.json");
  if (!existsSync(packagePath)) return false;
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return Boolean(
      packageJson.dependencies?.typescript ||
      packageJson.devDependencies?.typescript,
    );
  } catch {
    return false;
  }
}

function parseFormat(args: string[]): "js" | "ts" | undefined {
  const index = args.indexOf("--format");
  const equalsValue = args.find((arg) => arg.startsWith("--format="))?.slice(9);
  const value = index >= 0 ? args[index + 1] : equalsValue;
  if (value === undefined) return undefined;
  if (value === "js" || value === "ts") return value;
  console.error("Unknown format. Use --format js or --format ts.");
  process.exitCode = 1;
  return undefined;
}

function scan(args: string[]): void {
  const result = scanAndGenerate(process.cwd(), {
    dryRun: args.includes("--dry-run"),
    format: detectsTypeScriptProject(process.cwd()) ? "ts" : "js",
  });
  console.log(result.output);
}

function setup(): void {
  const result = setupProject(process.cwd());
  if (result.candidates.length === 0) {
    console.log("Repro setup found no reproducible states.");
    return;
  }
  console.log(`Repro setup found ${result.candidates.length} reproducible state${result.candidates.length === 1 ? "" : "s"}.`);
  if (result.configFile) console.log(`Created: ${result.configFile}`);
  console.log(`Created: ${result.bundleFile}`);
  console.log(`Created: ${result.bootstrapFile}`);
  console.log(`Created: ${result.adapterFile}`);
  console.log(`Adapter: ${result.adapterMode}`);
  if (result.agentInstructionFile) console.log(`Created: ${result.agentInstructionFile}`);
  console.log(result.htmlFile ? `Wired: ${result.htmlFile}` : "HTML entrypoint not found; import repro.setup.js from the browser entrypoint.");
}

function init(args: string[]): void {
  const requestedFormat = parseFormat(args);
  if (process.exitCode) return;

  for (const filename of CONFIG_FILES) {
    if (existsSync(join(process.cwd(), filename))) {
      console.log(`${filename} already exists.`);
      return;
    }
  }

  const format = requestedFormat ?? (hasTypeScriptProject() ? "ts" : "js");
  const filename = `repro.config.${format}`;
  writeFileSync(join(process.cwd(), filename), INITIAL_CONFIG, "utf8");
  console.log("Repro initialized.");
  console.log(`Created: ${filename}`);
}

const [command, ...args] = process.argv.slice(2);

if (command === "init") {
  init(args);
} else if (command === "scan") {
  scan(args);
} else if (command === "setup") {
  setup();
} else {
  console.error("Usage: repro init [--format js|ts] | repro scan [--dry-run] | repro setup");
  process.exitCode = 1;
}
