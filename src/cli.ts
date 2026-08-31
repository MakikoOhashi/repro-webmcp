#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
} else {
  console.error("Usage: repro init [--format js|ts]");
  process.exitCode = 1;
}
