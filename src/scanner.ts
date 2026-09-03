import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

export type ScanEvidence = { file: string; line: number };
export type InferenceSource = "fixture" | "union" | "enum" | "conditional" | "state";
export type ScanCandidate = { name: string; state: Record<string, Primitive>; evidence: ScanEvidence[]; priority: number; inference: InferenceSource; score: number; reason: string };

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const EXCLUDED = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", "out"]);
const STATE_KEYS = new Set(["plan", "subscription", "subscription_status", "usage", "usage_count", "role", "status", "entitlement", "istrial", "is_trial", "onboarding_step", "customer_rank"]);
const FIXTURE_PARTS = new Set(["fixture", "fixtures", "mock", "mocks", "test", "tests", "__tests__", "stories", "storybook", "seed", "seeds"]);
const HIGH_PRIORITY_KEYS = new Set(["plan", "subscription", "billing", "payment", "status", "account_status", "entitlement", "usage", "limit", "quota", "role", "auth", "authenticated", "loading", "error", "empty", "trial", "expired", "suspended", "disabled", "unavailable", "failed"]);
const HIGH_PRIORITY_VALUES = new Set(["expired", "failed", "suspended", "unavailable", "unauthenticated", "disabled", "trial", "free", "limit", "empty", "error", "loading"]);
const WORKFLOW_KEYS = new Set(["mode", "phase", "stage", "step", "onboarding_step"]);

export type Primitive = string | number | boolean | { [key: string]: Primitive };

function keyName(name: ts.PropertyName | ts.BindingName | ts.EntityName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText();
}

function stateKey(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, "");
}

function literalValue(node: ts.Expression): Primitive | undefined {
  if (ts.isLiteralTypeNode(node)) return literalValue(node.literal);
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return ts.isStringLiteral(node) ? node.text : Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  return undefined;
}

function expressionKey(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return stateKey(node.text);
  if (ts.isPropertyAccessExpression(node)) return stateKey(node.name.text);
  return undefined;
}

function candidateName(state: Record<string, Primitive>): string {
  const plan = state.plan;
  const subscription = state.subscription_status ?? state.subscription;
  if (typeof plan === "string" && typeof subscription === "string") return `${plan}_${subscription}`;
  if (typeof state.usage === "number" || typeof state.usage_count === "number") {
    const usage = state.usage ?? state.usage_count;
    if (typeof usage === "number" && usage >= 10) return "usage_limit";
  }
  if (typeof state.status === "string") return state.status;
  if (typeof state.role === "string") return state.role;
  for (const value of Object.values(state)) {
    if (value && typeof value === "object" && typeof value.reason === "string") return value.reason;
  }
  if (typeof state.entitlement === "boolean" && state.entitlement === false) return "without_entitlement";
  if (typeof state.is_trial === "boolean") return state.is_trial ? "trial" : "not_trial";
  const values = Object.values(state).filter((value): value is string => typeof value === "string");
  return values.length > 0 ? values.join("_").replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase() : "detected_state";
}

function isStateKey(key: string): boolean {
  return STATE_KEYS.has(key.toLowerCase()) || /^(is|has)[A-Z_]/.test(key) || /_(status|stage|step|mode)$/.test(key) || /^(phase|stage|step|mode|tier)$/.test(key);
}

function primitiveValues(state: Record<string, Primitive>): Primitive[] {
  return Object.values(state).flatMap((value) => value && typeof value === "object" ? primitiveValues(value) : [value]);
}

function scoreCandidate(state: Record<string, Primitive>, inference: InferenceSource, file: string): { score: number; reason: string } {
  const normalizedKeys = Object.keys(state).map((key) => stateKey(key).toLowerCase());
  const values = primitiveValues(state).map((value) => typeof value === "string" ? value.toLowerCase() : String(value).toLowerCase());
  let score = 0;
  const reasons: string[] = [];
  const semanticKeys = normalizedKeys.filter((key) => HIGH_PRIORITY_KEYS.has(key) || [...HIGH_PRIORITY_KEYS].some((priority) => key.includes(priority)));
  if (semanticKeys.length > 0) { score += semanticKeys.length * 30; reasons.push("high-value semantic key"); }
  const importantValues = values.filter((value) => HIGH_PRIORITY_VALUES.has(value));
  if (importantValues.length > 0) { score += importantValues.length * 35; reasons.push("high-value state value"); }
  const workflowKeys = normalizedKeys.filter((key) => WORKFLOW_KEYS.has(key));
  if (workflowKeys.length > 0) { score -= workflowKeys.length * 25; reasons.push("internal workflow state"); }
  if (inference === "conditional") {
    score += 20; reasons.push("conditional branch");
    if (/\.(?:jsx|tsx)$/.test(file)) { score += 30; reasons.push("UI conditional (JSX/TSX)"); }
  } else if (inference === "fixture") { score += 10; reasons.push("fixture or mock"); }
  return { score, reason: reasons.length > 0 ? reasons.join("; ") : "detected application state" };
}

function objectStateValue(node: ts.Expression): Primitive | undefined {
  const primitive = literalValue(node);
  if (primitive !== undefined) return primitive;
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const value: Record<string, Primitive> = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const nested = objectStateValue(property.initializer);
    if (nested !== undefined) value[stateKey(keyName(property.name))] = nested;
  }
  return Object.keys(value).length > 0 ? value : undefined;
}

function objectState(node: ts.ObjectLiteralExpression): Record<string, Primitive> {
  const state: Record<string, Primitive> = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = stateKey(keyName(property.name));
    const value = objectStateValue(property.initializer);
    if (value !== undefined && (key !== "states" && (isStateKey(key) || ts.isObjectLiteralExpression(property.initializer)))) state[key] = value;
  }
  return state;
}

function conditionState(node: ts.Expression): Record<string, Primitive> | undefined {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const left = conditionState(node.left);
    const right = conditionState(node.right);
    if (left && right) return { ...left, ...right };
    return left ?? right;
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    const leftKey = expressionKey(node.left);
    const rightValue = literalValue(node.right);
    if (leftKey && isStateKey(leftKey) && rightValue !== undefined) {
      if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.EqualsEqualsToken) return { [leftKey]: rightValue };
      if (operator === ts.SyntaxKind.GreaterThanEqualsToken || operator === ts.SyntaxKind.GreaterThanToken || operator === ts.SyntaxKind.LessThanEqualsToken || operator === ts.SyntaxKind.LessThanToken) return { [leftKey]: rightValue };
    }
    const rightKey = expressionKey(node.right);
    const leftValue = literalValue(node.left);
    if (rightKey && isStateKey(rightKey) && leftValue !== undefined && (operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.EqualsEqualsToken)) return { [rightKey]: leftValue };
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const key = expressionKey(node.operand);
    return key ? { [key]: false } : undefined;
  }
  if (ts.isIdentifier(node) && (node.text.startsWith("is") || node.text.startsWith("has"))) return { [stateKey(node.text)]: true };
  return undefined;
}

function isFixtureFile(file: string): boolean {
  if (file === "repro.config.js" || file === "repro.config.ts") return true;
  return file.split(/[\\/]/).some((part) => FIXTURE_PARTS.has(part.toLowerCase()) || FIXTURE_PARTS.has(part.toLowerCase().replace(/s$/, "")));
}

function evidenceFor(source: ts.SourceFile, node: ts.Node, file: string): ScanEvidence {
  return { file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
}

function typeKey(name: string): string {
  return stateKey(name.replace(/^(Account|User)/, ""));
}

function collectFromFile(source: ts.SourceFile, file: string): ScanCandidate[] {
  const candidates: ScanCandidate[] = [];
  const priority = isFixtureFile(file) ? 0 : 3;
  const add = (state: Record<string, Primitive>, node: ts.Node, candidatePriority = priority, inference: InferenceSource = priority === 0 ? "fixture" : "state"): void => {
    if (Object.keys(state).length === 0) return;
    const ranking = scoreCandidate(state, inference, file);
    candidates.push({ name: candidateName(state), state, evidence: [evidenceFor(source, node, file)], priority: candidatePriority, inference, ...ranking });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && ts.isUnionTypeNode(node.type)) {
      const key = typeKey(node.name.text);
      for (const member of node.type.types) {
        const value = literalValue(member as unknown as ts.Expression);
        if (typeof value === "string") add({ [key]: value }, node, 1, "union");
      }
    }
    if (ts.isEnumDeclaration(node)) {
      const key = typeKey(node.name.text);
      for (const member of node.members) {
        const value = member.initializer ? literalValue(member.initializer) : member.name.getText();
        if (typeof value === "string") add({ [key]: value }, member, 1, "enum");
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const state = objectState(node);
      if (Object.keys(state).some((key) => isStateKey(key))) {
        add(state, node, priority, priority === 0 ? "fixture" : "state");
        const usageKey = Object.hasOwn(state, "usage") ? "usage" : "usage_count";
        if (typeof state[usageKey] === "number" && state[usageKey] >= 10) add({ [usageKey]: state[usageKey] }, node, priority, priority === 0 ? "fixture" : "state");
      }
    }
    if (ts.isBinaryExpression(node) || ts.isPrefixUnaryExpression(node) || ts.isIdentifier(node)) {
      const state = conditionState(node as ts.Expression);
      if (state && (ts.isBinaryExpression(node) || ts.isPrefixUnaryExpression(node))) add(state, node, 2, "conditional");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return candidates;
}

function isReproArtifact(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const file = normalized.slice(normalized.lastIndexOf("/") + 1);
  return /^repro(?:\.generated)?\.config\.(?:js|ts)$/.test(file) || file === "repro.setup.js" || file === "repro.adapter.js" || normalized.split("/").includes(".repro") || (normalized.split("/").includes("vendor") && file === "repro-webmcp.js");
}

function scanFiles(rootDir: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      if (EXCLUDED.has(entry)) continue;
      const path = join(directory, entry);
      let info;
      try { info = statSync(path); } catch { continue; }
      if (info.isDirectory()) visit(path);
      else if (info.isFile() && !isReproArtifact(path) && SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) files.push(path);
    }
  };
  visit(rootDir);
  return files.sort();
}

function stableState(state: Record<string, Primitive>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b))));
}


export type SafeAdapterSource = { modulePath: string; exportName: string; };

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(ts.getModifiers(node as ts.HasModifiers)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function hasCallableProperty(object: ts.ObjectLiteralExpression, name: string): boolean {
  return object.properties.some((property) => {
    if (ts.isMethodDeclaration(property)) return keyName(property.name) === name;
    if (ts.isPropertyAssignment(property) && keyName(property.name) === name) {
      return ts.isFunctionExpression(property.initializer) || ts.isArrowFunction(property.initializer);
    }
    return false;
  });
}

export function detectSafeAdapterSource(rootDir: string): SafeAdapterSource | undefined {
  for (const path of scanFiles(rootDir)) {
    if (!path.endsWith(".js")) continue;
    let sourceText: string;
    try { sourceText = readFileSync(path, "utf8"); } catch { continue; }
    const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) || !hasExportModifier(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "appState" || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
        if (hasCallableProperty(declaration.initializer, "setState") && hasCallableProperty(declaration.initializer, "reset")) {
          return { modulePath: "./" + relative(rootDir, path).replaceAll("\\", "/"), exportName: declaration.name.text };
        }
      }
    }
  }
  return undefined;
}

export type SafeModuleStateSource = { modulePath: string; bindingName: string; renderName: string; initialState: Primitive };

export function detectSafeModuleStateSource(rootDir: string): SafeModuleStateSource | undefined {
  for (const path of scanFiles(rootDir)) {
    if (!path.endsWith(".js")) continue;
    let sourceText: string;
    try { sourceText = readFileSync(path, "utf8"); } catch { continue; }
    const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const render = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && hasExportModifier(statement) && statement.name?.text === "render");
    if (!render) continue;
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) || !hasExportModifier(statement) || !(statement.declarationList.flags & ts.NodeFlags.Let)) continue;
      const declaration = statement.declarationList.declarations[0];
      if (!declaration || !ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const initialState = objectStateValue(declaration.initializer);
      if (initialState === undefined || typeof initialState !== "object") continue;
      return {
        modulePath: "./" + relative(rootDir, path).replaceAll("\\", "/"),
        bindingName: declaration.name.text,
        renderName: "render",
        initialState,
      };
    }
  }
  return undefined;
}

export type SafeCrossModuleSource = {
  ownerPath: string;
  bindingName: string;
  getterName: string;
  initialState: Primitive;
  renderPath: string;
  renderName: string;
};

function moduleSpecifierPath(rootDir: string, importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = join(rootDir, dirname(importer), specifier);
  const candidates = [base, base + ".js", join(base, "index.js")];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ? relative(rootDir, found).replaceAll("\\", "/") : undefined;
}

export function detectSafeCrossModuleSource(rootDir: string): SafeCrossModuleSource | undefined {
  const owners: Array<{ ownerPath: string; bindingName: string; getterName: string; initialState: Primitive }> = [];
  for (const path of scanFiles(rootDir)) {
    if (!path.endsWith(".js")) continue;
    let sourceText: string;
    try { sourceText = readFileSync(path, "utf8"); } catch { continue; }
    const stateMatch = sourceText.match(/(?:^|\n)\s*let\s+([A-Za-z_$][\w$]*)\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!stateMatch) continue;
    const bindingName = stateMatch[1];
    const jsonText = stateMatch[2].replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
    let initialState: Primitive | undefined;
    try { initialState = JSON.parse(jsonText) as Primitive; } catch { continue; }
    const getterMatch = sourceText.match(/export\s+function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[\s\S]*?return\s+([A-Za-z_$][\w$]*)\s*;/);
    if (typeof initialState === "object" && initialState !== null && getterMatch?.[2] === bindingName) {
      owners.push({ ownerPath: relative(rootDir, path).replaceAll("\\", "/"), bindingName, getterName: getterMatch[1], initialState });
    }
  }
  for (const owner of owners) {
    for (const renderPath of scanFiles(rootDir).filter((path) => path.endsWith(".js"))) {
      if (renderPath === join(rootDir, owner.ownerPath)) continue;
      let sourceText: string;
      try { sourceText = readFileSync(renderPath, "utf8"); } catch { continue; }
      const importer = relative(rootDir, renderPath).replaceAll("\\", "/");
      const importMatch = sourceText.match(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/);
      const renderMatch = sourceText.match(/export\s+function\s+render\s*\(/);
      if (importMatch && importMatch[1].split(",").some((name) => name.trim() === owner.getterName) && renderMatch && moduleSpecifierPath(rootDir, importer, importMatch[2]) === owner.ownerPath && sourceText.includes(owner.getterName + "(")) {
        return { ...owner, renderPath: importer, renderName: "render" };
      }
    }
  }
  return undefined;
}

export function detectsTypeScriptProject(rootDir: string): boolean {
  if (existsSync(join(rootDir, "tsconfig.json"))) return true;
  return scanFiles(rootDir).some((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
}

export function scanProject(rootDir: string, maxCandidates = 20): ScanCandidate[] {
  const candidates: ScanCandidate[] = [];
  for (const path of scanFiles(rootDir)) {
    let sourceText: string;
    try { sourceText = readFileSync(path, "utf8"); } catch { continue; }
    const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".jsx") ? ts.ScriptKind.JSX : path.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
    candidates.push(...collectFromFile(source, relative(rootDir, path).replaceAll("\\\\", "/")));
  }
  const byState = new Map<string, ScanCandidate>();
  for (const candidate of candidates) {
    const key = stableState(candidate.state);
    const existing = byState.get(key);
    if (existing) {
      existing.evidence.push(...candidate.evidence.filter((item) => !existing.evidence.some((old) => old.file === item.file && old.line === item.line)));
      existing.priority = Math.min(existing.priority, candidate.priority);
      if (candidate.score > existing.score) Object.assign(existing, { score: candidate.score, reason: candidate.reason, inference: candidate.inference });
    } else byState.set(key, { ...candidate, evidence: [...candidate.evidence] });
  }
  const byName = new Map<string, ScanCandidate>();
  for (const candidate of byState.values()) {
    const existing = byName.get(candidate.name);
    if (!existing) {
      byName.set(candidate.name, candidate);
      continue;
    }
    const preferred = candidate.score > existing.score || (candidate.score === existing.score && (candidate.priority < existing.priority || Object.keys(candidate.state).length > Object.keys(existing.state).length)) ? candidate : existing;
    const other = preferred === candidate ? existing : candidate;
    preferred.evidence.push(...other.evidence.filter((item) => !preferred.evidence.some((old) => old.file === item.file && old.line === item.line)));
    byName.set(candidate.name, preferred);
  }
  return [...byName.values()].sort((a, b) => b.score - a.score || a.priority - b.priority || a.name.localeCompare(b.name) || a.evidence[0].file.localeCompare(b.evidence[0].file)).slice(0, maxCandidates);
}

export function generatedConfig(candidates: ScanCandidate[]): string {
  const states = Object.fromEntries(candidates.map((candidate) => [candidate.name, candidate.state]));
  return `import { defineRepro } from "repro-webmcp";\n\nexport default defineRepro({\n  states: ${JSON.stringify(states, null, 2).replace(/^/gm, "  ")},\n});\n`;
}

export function writeScanConfig(rootDir: string, candidates: ScanCandidate[], format: "js" | "ts"): string | undefined {
  const base = `repro.config.${format}`;
  const target = existsSync(join(rootDir, base)) ? `repro.generated.config.${format}` : base;
  const path = join(rootDir, target);
  if (existsSync(path)) return undefined;
  writeFileSync(path, generatedConfig(candidates), "utf8");
  return target;
}

export function formatScanResults(candidates: ScanCandidate[]): string {
  if (candidates.length === 0) return "Repro found no reproducible states.";
  const lines = [`Repro found ${candidates.length} reproducible state${candidates.length === 1 ? "" : "s"}:`];
  for (const candidate of candidates) {
    lines.push("", `✓ ${candidate.name}`, `  score: ${candidate.score}`, `  reason: ${candidate.reason}`, `  inference: ${candidate.inference}`);
    for (const [key, value] of Object.entries(candidate.state)) lines.push(`  ${key} = ${JSON.stringify(value)}`);
    for (const evidence of candidate.evidence.slice(0, 3)) lines.push(`  source: ${evidence.file}:${evidence.line}`);
  }
  return lines.join("\n");
}

export function scanAndGenerate(rootDir: string, options: { dryRun?: boolean; format: "js" | "ts" }): { candidates: ScanCandidate[]; generatedFile?: string; output: string } {
  const candidates = scanProject(rootDir);
  const output = formatScanResults(candidates);
  if (options.dryRun || candidates.length === 0) return { candidates, output };
  const generatedFile = writeScanConfig(rootDir, candidates, options.format);
  return { candidates, generatedFile, output: `${output}\n\nGenerated: ${generatedFile ?? "no file (generated config already exists)"}` };
}
