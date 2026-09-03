import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectSafeCrossModuleSource, detectSafeModuleStateSource, detectSafeAdapterSource, detectsTypeScriptProject, scanProject, writeScanConfig, type Primitive, type ScanCandidate } from "./scanner.js";

const ADAPTER_SCAFFOLD = "export default {\n  applyReproState(_state) {\n    // Connect _state to the application state source here.\n  },\n  resetReproState() {\n    // Restore the application state source here.\n  },\n};\n";

const AGENT_TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "agent-integration.md");

const AGENT_INSTRUCTION = (candidates: ScanCandidate[]): string => {
  const evidence = candidates.map((candidate) => {
    const values = Object.entries(candidate.state).map(([key, value]) => key + " = " + JSON.stringify(value)).join(", ");
    const sources = candidate.evidence.slice(0, 3).map((item) => item.file + ":" + item.line).join(", ");
    return "- " + candidate.name + " (" + values + "): " + sources;
  }).join("\n");
  return readFileSync(AGENT_TEMPLATE_PATH, "utf8").replace("{{SCAN_EVIDENCE}}", evidence);
};

export type SetupResult = {
  configFile?: string;
  bundleFile?: string;
  bootstrapFile?: string;
  htmlFile?: string;
  adapterFile?: string;
  agentInstructionFile?: string;
  adapterMode?: "auto-generated" | "auto-instrumented" | "cross-module auto-instrumented" | "manual adapter required";
  candidates: ScanCandidate[];
};

function browserBootstrap(states: Record<string, Record<string, Primitive>>): string {
  return `import { createReproRuntime, registerWebMCPTools } from "./vendor/repro-webmcp.js";
import adapter from "./repro.adapter.js";

export const runtime = createReproRuntime(${JSON.stringify({ states }, null, 2)}, undefined, { adapter });
globalThis.reproRuntime = runtime;
try {
  await registerWebMCPTools(runtime);
} catch {
  // WebMCP is optional; the application remains usable without it.
}
`;
}

function generatedCrossAdapter(source: { ownerPath: string; renderPath: string }): string {
  const ownerPath = source.ownerPath.startsWith(".") ? source.ownerPath : "./" + source.ownerPath;
  const renderPath = source.renderPath.startsWith(".") ? source.renderPath : "./" + source.renderPath;
  return "import { __reproSetState, __reproResetState } from \"" + ownerPath + "\";\n" +
    "import { render } from \"" + renderPath + "\";\n\n" +
    "export default {\n" +
    "  applyReproState: (stateData) => { __reproSetState(stateData); render(); },\n" +
    "  resetReproState: () => { __reproResetState(); render(); },\n" +
    "};\n";
}

function instrumentCrossModuleState(rootDir: string, source: { ownerPath: string; bindingName: string; initialState: Primitive }): void {
  const path = join(rootDir, source.ownerPath);
  const current = readFileSync(path, "utf8");
  if (current.includes("/* repro cross-module auto-instrumentation */")) return;
  const block = "\n\n/* repro cross-module auto-instrumentation */\n" +
    "export function __reproSetState(nextState) {\n" +
    "  " + source.bindingName + " = nextState;\n" +
    "}\n" +
    "export function __reproResetState() {\n" +
    "  " + source.bindingName + " = " + JSON.stringify(source.initialState) + ";\n" +
    "}\n";
  writeFileSync(path, current + block, "utf8");
}

function generatedModuleAdapter(source: { modulePath: string }): string {
  return "import { __reproSetState, __reproResetState } from \"" + source.modulePath + "\";\n\nexport default {\n  applyReproState: __reproSetState,\n  resetReproState: __reproResetState,\n};\n";
}

function instrumentModuleState(rootDir: string, source: { modulePath: string; bindingName: string; renderName: string; initialState: Primitive }): void {
  const path = join(rootDir, source.modulePath.slice(2));
  const current = readFileSync(path, "utf8");
  if (current.includes("/* repro auto-instrumentation */")) return;
  const initial = JSON.stringify(source.initialState);
  const block = "\n\n/* repro auto-instrumentation */\n" +
    "export function __reproSetState(nextState) {\n" +
    "  " + source.bindingName + " = nextState;\n" +
    "  " + source.renderName + "();\n" +
    "}\n" +
    "export function __reproResetState() {\n" +
    "  " + source.bindingName + " = " + initial + ";\n" +
    "  " + source.renderName + "();\n" +
    "}\n";
  writeFileSync(path, current + block, "utf8");
}

function generatedAdapter(source: { modulePath: string; exportName: string }): string {
  return "import { " + source.exportName + " } from \"" + source.modulePath + "\";\n\nexport default {\n  applyReproState: (stateData) => " + source.exportName + ".setState(stateData),\n  resetReproState: () => " + source.exportName + ".reset(),\n};\n";
}

function wireHtml(rootDir: string, bootstrapFile: string): string | undefined {
  const htmlPath = join(rootDir, "index.html");
  if (!existsSync(htmlPath)) return undefined;
  const source = readFileSync(htmlPath, "utf8");
  const tag = `<script type="module" src="./${bootstrapFile}"></script>`;
  if (source.includes(tag)) return "index.html (already wired)";
  if (!/<\/body>/i.test(source)) return undefined;
  writeFileSync(htmlPath, source.replace(/<\/body>/i, `  ${tag}\n</body>`), "utf8");
  return "index.html";
}

export function setupProject(rootDir: string): SetupResult {
  const candidates = scanProject(rootDir);
  if (candidates.length === 0) return { candidates };

  const format = detectsTypeScriptProject(rootDir) ? "ts" : "js";
  const existingConfig = ["repro.config.js", "repro.config.ts"].find((file) => existsSync(join(rootDir, file)));
  const configFile = existingConfig ?? writeScanConfig(rootDir, candidates, format);
  const bundleFile = "vendor/repro-webmcp.js";
  const bundlePath = join(rootDir, bundleFile);
  mkdirSync(dirname(bundlePath), { recursive: true });
  if (!existsSync(bundlePath)) {
    const packageBundle = join(dirname(fileURLToPath(import.meta.url)), "browser.bundle.js");
    copyFileSync(packageBundle, bundlePath);
  }

  const adapterFile = "repro.adapter.js";
  const crossSource = detectSafeCrossModuleSource(rootDir);
  const moduleSource = crossSource ? undefined : detectSafeModuleStateSource(rootDir);
  const safeAdapter = crossSource || moduleSource ? undefined : detectSafeAdapterSource(rootDir);
  const adapterMode = crossSource ? "cross-module auto-instrumented" : moduleSource ? "auto-instrumented" : safeAdapter ? "auto-generated" : "manual adapter required";
  const adapterPath = join(rootDir, adapterFile);
  if (!existsSync(adapterPath)) {
    if (crossSource) {
      instrumentCrossModuleState(rootDir, crossSource);
      writeFileSync(adapterPath, generatedCrossAdapter({ ownerPath: crossSource.ownerPath, renderPath: crossSource.renderPath }), "utf8");
    } else if (moduleSource) {
      instrumentModuleState(rootDir, moduleSource);
      writeFileSync(adapterPath, generatedModuleAdapter(moduleSource), "utf8");
    } else {
      writeFileSync(adapterPath, safeAdapter ? generatedAdapter(safeAdapter) : ADAPTER_SCAFFOLD, "utf8");
    }
  }

  let agentInstructionFile: string | undefined;
  if (adapterMode === "manual adapter required") {
    const instructionPath = join(rootDir, ".repro", "AGENTS.md");
    if (!existsSync(instructionPath)) {
      mkdirSync(dirname(instructionPath), { recursive: true });
      writeFileSync(instructionPath, AGENT_INSTRUCTION(candidates), "utf8");
      agentInstructionFile = ".repro/AGENTS.md";
    }
  }

  const bootstrapFile = "repro.setup.js";
  const bootstrapPath = join(rootDir, bootstrapFile);
  if (!existsSync(bootstrapPath)) {
    const states = Object.fromEntries(candidates.map((candidate) => [candidate.name, candidate.state]));
    writeFileSync(bootstrapPath, browserBootstrap(states), "utf8");
  }
  const htmlFile = wireHtml(rootDir, bootstrapFile);
  return { configFile, bundleFile, bootstrapFile, htmlFile, adapterFile, agentInstructionFile, adapterMode, candidates };
}
