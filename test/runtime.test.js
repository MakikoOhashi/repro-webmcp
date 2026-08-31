import test from "node:test";
import assert from "node:assert/strict";
import { createReproRuntime } from "../dist/index.js";
import * as browser from "../dist/browser.js";
import * as packagedBundle from "repro-webmcp/browser-bundle";

test("browser entry exports runtime APIs", () => {
  assert.equal(browser.createReproRuntime, createReproRuntime);
  assert.equal(typeof browser.registerWebMCPTools, "function");
  assert.equal(typeof packagedBundle.createReproRuntime, "function");
});

test("subscribe notifies initially, on reproduce, and on reset", () => {
  const runtime = createReproRuntime({ states: { free_expired: { plan: "free" } } });
  const received = [];
  const unsubscribe = runtime.subscribe((state) => received.push(state));

  assert.deepEqual(received, [null]);
  runtime.reproduceState("free_expired");
  assert.deepEqual(received.at(-1), { plan: "free" });
  runtime.resetState();
  assert.equal(received.at(-1), null);

  unsubscribe();
  runtime.reproduceState("free_expired");
  assert.equal(received.length, 3);
  runtime.resetState();
});

test("subscriber exceptions do not break other subscribers", () => {
  const runtime = createReproRuntime({ states: { ready: { ok: true } } });
  const received = [];
  runtime.subscribe(() => { throw new Error("listener failure"); });
  runtime.subscribe((state) => received.push(state));

  assert.doesNotThrow(() => runtime.reproduceState("ready"));
  assert.deepEqual(received, [null, { ok: true }]);
  assert.doesNotThrow(() => runtime.resetState());
  assert.equal(received.at(-1), null);
});
