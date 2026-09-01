import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanAndGenerate, scanProject } from "../dist/scanner.js";
import { execFileSync } from "node:child_process";

const tempProject = () => mkdtempSync(join(tmpdir(), "repro-scan-test-"));
const fixtureSource = `
type Plan = "free" | "pro";
type Subscription = "active" | "expired";
const fixture = { plan: "free", subscription: "expired", usage: 10 };
const isExpired = plan === "free" && subscription === "expired";
const isFree = plan === "free";
const nested = { entitlement: { entitled: false, reason: "expired" } };
`;

test("scan detects combined conditions, unions, fixtures, and dedupes states", () => {
  const root = tempProject();
  writeFileSync(join(root, "Billing.tsx"), fixtureSource);
  writeFileSync(join(root, "broken.js"), "const = ;");
  const candidates = scanProject(root);
  const combined = candidates.filter((candidate) => candidate.name === "free_expired");

  assert.equal(combined.length, 1);
  assert.deepEqual(combined[0].state, { plan: "free", subscription: "expired" });
  assert.equal(combined[0].evidence.length >= 1, true);
  assert.equal(candidates.some((candidate) => candidate.name === "pro"), true);
  assert.equal(candidates.some((candidate) => candidate.name === "usage_limit"), true);
  assert.equal(candidates.some((candidate) => candidate.name === "expired"), true);
});

test("scan output is deterministic and generated config is safe", () => {
  const root = tempProject();
  writeFileSync(join(root, "src.ts"), fixtureSource);
  const first = scanProject(root);
  const second = scanProject(root);
  assert.deepEqual(first, second);

  const result = scanAndGenerate(root, { format: "ts" });
  assert.equal(result.generatedFile, "repro.config.ts");
  assert.equal(existsSync(join(root, "repro.config.ts")), true);
  assert.match(readFileSync(join(root, "repro.config.ts"), "utf8"), /free_expired/);
});

test("scan never overwrites an existing config and supports dry-run", () => {
  const root = tempProject();
  writeFileSync(join(root, "source.ts"), fixtureSource);
  writeFileSync(join(root, "repro.config.ts"), "const config = { plan: \"from_config\" };");
  const result = scanAndGenerate(root, { format: "ts" });
  assert.equal(result.generatedFile, "repro.generated.config.ts");
  assert.equal(readFileSync(join(root, "repro.config.ts"), "utf8"), "const config = { plan: \"from_config\" };");
  assert.equal(result.candidates.every((candidate) => candidate.evidence.every((item) => item.file !== "repro.config.ts")), true);

  const dryRoot = tempProject();
  writeFileSync(join(dryRoot, "source.ts"), fixtureSource);
  const dry = scanAndGenerate(dryRoot, { format: "js", dryRun: true });
  assert.equal(dry.generatedFile, undefined);
  assert.equal(existsSync(join(dryRoot, "repro.config.js")), false);
});

test("repro scan CLI prints evidence and writes config", () => {
  const root = tempProject();
  writeFileSync(join(root, "src.tsx"), fixtureSource);
  const output = execFileSync(process.execPath, [join(process.cwd(), "dist/cli.js"), "scan"], { cwd: root, encoding: "utf8" });
  assert.match(output, /Repro found/);
  assert.match(output, /source: src.tsx:/);
  assert.equal(existsSync(join(root, "repro.config.ts")), true);
});


test("ranks UI-critical states above internal workflow states", () => {
  const root = tempProject();
  writeFileSync(join(root, "Ranking.tsx"), `
    if (mode === "continue") {}
    if (subscription === "expired") { return <ExpiredBanner />; }
    if (paymentStatus === "failed") { return <PaymentError />; }
  `);
  const candidates = scanProject(root);
  const names = candidates.map((candidate) => candidate.name);
  assert.ok(names.indexOf("expired") >= 0);
  assert.ok(names.indexOf("failed") >= 0);
  assert.ok(names.indexOf("continue") >= 0);
  assert.ok(names.indexOf("expired") < names.indexOf("continue"));
  assert.ok(names.indexOf("failed") < names.indexOf("continue"));
  const expired = candidates.find((candidate) => candidate.name === "expired");
  assert.equal(expired?.inference, "conditional");
  assert.match(expired?.reason ?? "", /high-value|UI conditional/);
});
