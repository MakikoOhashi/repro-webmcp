import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const tempProject = () => mkdtempSync(join(tmpdir(), "repro-setup-test-"));

test("setup generates config, browser bootstrap, bundle, and HTML wiring", () => {
  const root = tempProject();
  writeFileSync(join(root, "index.html"), "<!doctype html><body><h1>App</h1></body>");
  writeFileSync(join(root, "App.jsx"), "if (subscription === \"expired\") { return <Expired />; }");
  const output = execFileSync(process.execPath, [join(process.cwd(), "dist/cli.js"), "setup"], { cwd: root, encoding: "utf8" });
  assert.match(output, /Repro setup found 1 reproducible state/);
  assert.equal(existsSync(join(root, "repro.config.js")), true);
  assert.equal(existsSync(join(root, "vendor/repro-webmcp.js")), true);
  assert.equal(existsSync(join(root, "repro.setup.js")), true);
  assert.equal(existsSync(join(root, "repro.adapter.js")), true);
  assert.match(readFileSync(join(root, "repro.setup.js"), "utf8"), /repro\.adapter\.js/);
  assert.match(readFileSync(join(root, "repro.setup.js"), "utf8"), /expired/);
  assert.match(readFileSync(join(root, "index.html"), "utf8"), /repro\.setup\.js/);
});

test("setup does not duplicate HTML wiring", () => {
  const root = tempProject();
  writeFileSync(join(root, "index.html"), "<body></body>");
  writeFileSync(join(root, "App.js"), "if (status === \"error\") {};");
  const cli = join(process.cwd(), "dist/cli.js");
  execFileSync(process.execPath, [cli, "setup"], { cwd: root });
  execFileSync(process.execPath, [cli, "setup"], { cwd: root });
  const html = readFileSync(join(root, "index.html"), "utf8");
  assert.equal((html.match(/repro\.setup\.js/g) ?? []).length, 1);
});

test("setup auto-generates an adapter only for explicit exported appState", () => {
  const root = tempProject();
  writeFileSync(join(root, "App.js"), "export const appState = { setState(nextState) {}, reset() {} };\nif (subscription === \"expired\") {};");
  const output = execFileSync(process.execPath, [join(process.cwd(), "dist/cli.js"), "setup"], { cwd: root, encoding: "utf8" });
  assert.match(output, /Adapter: auto-generated/);
  assert.match(readFileSync(join(root, "repro.adapter.js"), "utf8"), /from ".\/App\.js"/);
  assert.match(readFileSync(join(root, "repro.adapter.js"), "utf8"), /appState\.setState/);
});

test("setup reports manual adapter fallback when no safe source is found", () => {
  const root = tempProject();
  writeFileSync(join(root, "App.jsx"), "if (subscription === \"expired\") {};");
  const output = execFileSync(process.execPath, [join(process.cwd(), "dist/cli.js"), "setup"], { cwd: root, encoding: "utf8" });
  assert.match(output, /Adapter: manual adapter required/);
  assert.match(readFileSync(join(root, "repro.adapter.js"), "utf8"), /Connect _state/);
  const instruction = readFileSync(join(root, ".repro/AGENTS.md"), "utf8");
  assert.match(instruction, /npx repro scan/);
  assert.match(instruction, /Do not enumerate state names/);
  assert.match(instruction, /auth, payment, email/);
  assert.match(readFileSync(join(process.cwd(), "templates/agent-integration.md"), "utf8"), /\{\{SCAN_EVIDENCE\}\}/);
  assert.doesNotMatch(instruction, /\{\{SCAN_EVIDENCE\}\}/);
  assert.match(instruction, /subscription/);
});

test("setup auto-instruments an exported module state with an exported render", () => {
  const root = tempProject();
  writeFileSync(join(root, "state.js"), "export let currentState = { status: \"loading\" };\nexport function render() {}\nrender();");
  writeFileSync(join(root, "App.jsx"), "if (currentState.status === \"unauthenticated\") {};");
  const output = execFileSync(process.execPath, [join(process.cwd(), "dist/cli.js"), "setup"], { cwd: root, encoding: "utf8" });
  assert.match(output, /Adapter: auto-instrumented/);
  assert.match(readFileSync(join(root, "state.js"), "utf8"), /repro auto-instrumentation/);
  assert.match(readFileSync(join(root, "repro.adapter.js"), "utf8"), /__reproSetState/);
});

test("setup auto-instruments a cross-module getter and render path", () => {
  const root = tempProject();
  writeFileSync(join(root, "auth.js"), "let currentAuthState = { status: \"authenticated\" };\nexport function getCurrentAuthState() { return currentAuthState; }");
  writeFileSync(join(root, "render.js"), "import { getCurrentAuthState } from \"./auth.js\";\\nexport function render() { globalThis.ui = getCurrentAuthState().status === \"unauthenticated\" ? \"SignedOut\" : \"SignedIn\"; }\\nrender();");
  writeFileSync(join(root, "App.jsx"), "if (getCurrentAuthState().status === \"unauthenticated\") {};");
  const output = execFileSync(process.execPath, [join(process.cwd(), "dist/cli.js"), "setup"], { cwd: root, encoding: "utf8" });
  assert.match(output, /Adapter: cross-module auto-instrumented/);
  assert.match(readFileSync(join(root, "auth.js"), "utf8"), /repro cross-module auto-instrumentation/);
  assert.match(readFileSync(join(root, "repro.adapter.js"), "utf8"), /__reproResetState/);
  assert.match(readFileSync(join(root, "repro.adapter.js"), "utf8"), /render\.js/);
});
