import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const cli = join(process.cwd(), "dist/cli.js");
const runInit = (cwd, ...args) => execFileSync(process.execPath, [cli, "init", ...args], { cwd, encoding: "utf8" });
const tempProject = () => mkdtempSync(join(tmpdir(), "repro-cli-test-"));

test("init --format js creates repro.config.js", () => {
  const cwd = tempProject();
  const output = runInit(cwd, "--format", "js");
  assert.match(output, /Created: repro.config.js/);
  assert.match(readFileSync(join(cwd, "repro.config.js"), "utf8"), /defineRepro/);
});

test("init --format ts creates repro.config.ts", () => {
  const cwd = tempProject();
  const output = runInit(cwd, "--format=ts");
  assert.match(output, /Created: repro.config.ts/);
  assert.equal(readFileSync(join(cwd, "repro.config.ts"), "utf8").includes("defineRepro"), true);
});

test("init auto-detects TypeScript and defaults to JavaScript otherwise", () => {
  const tsProject = tempProject();
  writeFileSync(join(tsProject, "tsconfig.json"), "{}");
  runInit(tsProject);
  assert.equal(readFileSync(join(tsProject, "repro.config.ts"), "utf8").includes("defineRepro"), true);

  const jsProject = tempProject();
  runInit(jsProject);
  assert.equal(readFileSync(join(jsProject, "repro.config.js"), "utf8").includes("defineRepro"), true);
});

test("explicit format wins and existing config is not overwritten", () => {
  const cwd = tempProject();
  writeFileSync(join(cwd, "tsconfig.json"), "{}");
  runInit(cwd, "--format", "js");
  const configPath = join(cwd, "repro.config.js");
  const original = readFileSync(configPath, "utf8");
  const output = runInit(cwd, "--format", "ts");
  assert.match(output, /repro.config.js already exists/);
  assert.equal(readFileSync(configPath, "utf8"), original);
});
