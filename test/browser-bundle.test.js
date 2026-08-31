import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const bundlePath = join(process.cwd(), "dist/browser.bundle.js");

test("browser bundle imports and runs as a single copied file", async () => {
  const source = readFileSync(bundlePath, "utf8");
  assert.doesNotMatch(source, /\bimport\s/);
  assert.doesNotMatch(source, /sourceMappingURL/);

  const vendorDir = mkdtempSync(join(tmpdir(), "repro-browser-bundle-"));
  const vendorPath = join(vendorDir, "repro-webmcp.js");
  copyFileSync(bundlePath, vendorPath);
  const browser = await import(pathToFileURL(vendorPath).href);

  const runtime = browser.createReproRuntime({ states: { ready: { plan: "free" } } });
  let observed = "not-called";
  const unsubscribe = runtime.subscribe((state) => { observed = state?.plan ?? null; });
  assert.equal(observed, null);
  runtime.reproduceState("ready");
  assert.equal(observed, "free");
  unsubscribe();
  runtime.resetState();
  assert.equal(typeof browser.registerWebMCPTools, "function");
});
