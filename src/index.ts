export type ReproState = Record<string, unknown>;
export type ReproConfig = { states: Record<string, ReproState> };
export type ReproToolResult = { content: Array<{ type: "text"; text: string }> };
export type ReproRuntime = {
  getState: () => ReproState | null;
  listStates: () => string[];
  reproduceState: (name: string) => ReproState;
  resetState: () => null;
};

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => ReproToolResult;
};
type WebMCPContext = { registerTool: (tool: WebMCPTool) => void };

export function defineRepro<T>(config: T): T {
  return config;
}

export function createReproRuntime(
  config: ReproConfig,
  onStateChange: (state: ReproState | null) => void = () => {},
): ReproRuntime {
  let currentState: ReproState | null = null;
  return {
    getState: () => currentState,
    listStates: () => Object.keys(config.states),
    reproduceState: (name) => {
      const state = config.states[name];
      if (!state) throw new Error(`Unknown Repro state: ${name}`);
      currentState = { ...state };
      onStateChange(currentState);
      return currentState;
    },
    resetState: () => {
      currentState = null;
      onStateChange(null);
      return null;
    },
  };
}

function textResult(value: unknown): ReproToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function registerWebMCPTools(runtime: ReproRuntime): void {
  const browser = globalThis as typeof globalThis & {
    document?: { modelContext?: WebMCPContext };
    navigator?: { modelContext?: WebMCPContext };
  };
  const modelContext = browser.document?.modelContext ?? browser.navigator?.modelContext;
  if (!modelContext) throw new Error("WebMCP is not available in this browser.");

  modelContext.registerTool({
    name: "list_states",
    description: "List the reproducible application states.",
    inputSchema: { type: "object", properties: {} },
    execute: () => textResult(runtime.listStates()),
  });
  modelContext.registerTool({
    name: "reproduce_state",
    description: "Reproduce a named application state in the current UI.",
    inputSchema: {
      type: "object",
      properties: { state: { type: "string", enum: runtime.listStates() } },
      required: ["state"],
    },
    execute: (input) => textResult(runtime.reproduceState(String(input.state))),
  });
  modelContext.registerTool({
    name: "reset_state",
    description: "Reset the application to its default state.",
    inputSchema: { type: "object", properties: {} },
    execute: () => textResult(runtime.resetState()),
  });
}
