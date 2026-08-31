export type ReproState = Record<string, unknown>;
export type ReproConfig = { states: Record<string, ReproState> };
export type ReproToolResult = { content: Array<{ type: "text"; text: string }> };
export type ReproStateListener = (state: ReproState | null) => void;
export type ReproSession = {
  id: string;
  expiresAt: number;
  isActive: () => boolean;
  end: () => void;
  assertActive: () => void;
  isExternalSideEffectAllowed: () => false;
  blockExternalSideEffect: () => never;
};
export type ReproRuntime = {
  getState: () => ReproState | null;
  getSession: () => ReproSession | null;
  listStates: () => string[];
  reproduceState: (name: string) => ReproState;
  resetState: () => null;
  subscribe: (listener: ReproStateListener) => () => void;
};

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<ReproToolResult>;
};
type WebMCPContext = { registerTool: (tool: WebMCPTool) => Promise<void> };

export function defineRepro<T>(config: T): T {
  return config;
}

export function createReproRuntime(
  config: ReproConfig,
  onStateChange: (state: ReproState | null) => void = () => {},
  options: { ttlMs?: number } = {},
): ReproRuntime {
  let currentState: ReproState | null = null;
  let session: ReproSession | null = null;
  const listeners = new Set<ReproStateListener>();

  const notifyStateChange = (state: ReproState | null): void => {
    try {
      onStateChange(state);
    } catch {
      // Application render callbacks must not break the runtime.
    }
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // One subscriber must not prevent other subscribers from receiving updates.
      }
    }
  };

  const createSession = (): ReproSession => {
    const ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    let active = true;
    const expiresAt = Date.now() + ttlMs;
    const timer = setTimeout(() => {
      active = false;
      currentState = null;
      session = null;
      notifyStateChange(null);
    }, ttlMs);

    const created: ReproSession = {
      id: `repro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expiresAt,
      isActive: () => active && Date.now() < expiresAt,
      end: () => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        currentState = null;
        if (session?.id === created.id) session = null;
        notifyStateChange(null);
      },
      assertActive: () => {
        if (!created.isActive()) throw new Error("Repro session has expired.");
      },
      isExternalSideEffectAllowed: () => false,
      blockExternalSideEffect: () => {
        throw new Error("External side effects are disabled in Repro mode.");
      },
    };
    return created;
  };

  return {
    getState: () => (session?.isActive() ? currentState : null),
    getSession: () => (session?.isActive() ? session : null),
    listStates: () => Object.keys(config.states),
    reproduceState: (name) => {
      const state = config.states[name];
      if (!state) throw new Error(`Unknown Repro state: ${name}`);
      session?.end();
      session = createSession();
      currentState = { ...state };
      notifyStateChange(currentState);
      return currentState;
    },
    resetState: () => {
      session?.end();
      return null;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      try {
        listener(session?.isActive() ? currentState : null);
      } catch {
        // A listener error during initial notification is isolated.
      }
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

async function textResult(value: unknown): Promise<ReproToolResult> {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        repro_mode: true,
        message: "Preview only. No real users, orders, payments, emails, webhooks, or notifications are affected.",
        data: value,
      }),
    }],
  };
}

export async function registerWebMCPTools(runtime: ReproRuntime): Promise<void> {
  const browser = globalThis as typeof globalThis & {
    document?: { modelContext?: WebMCPContext };
    navigator?: { modelContext?: WebMCPContext };
  };
  const modelContext = browser.document?.modelContext ?? browser.navigator?.modelContext;
  if (!modelContext) throw new Error("WebMCP is not available in this browser.");

  await modelContext.registerTool({
    name: "list_states",
    description: "List reproducible application states. Preview only; no real data is changed.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => textResult(runtime.listStates()),
  });
  await modelContext.registerTool({
    name: "reproduce_state",
    description: "Reproduce a named application state in an isolated, temporary Repro session.",
    inputSchema: {
      type: "object",
      properties: { state: { type: "string", enum: runtime.listStates() } },
      required: ["state"],
    },
    execute: async (input) => textResult(runtime.reproduceState(String(input.state))),
  });
  await modelContext.registerTool({
    name: "reset_state",
    description: "End the temporary Repro session and reset the application.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => textResult(runtime.resetState()),
  });
}
