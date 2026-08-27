import { createReproRuntime, defineRepro, registerWebMCPTools } from "../dist/index.js";

const config = defineRepro({
  states: {
    free_expired: { plan: "free", subscription_status: "expired", usage_count: 9 },
    pro_active: { plan: "pro", subscription_status: "active", usage_count: 2 },
  },
});

const status = document.querySelector("#status");
const message = document.querySelector("#message");
function render(state) {
  document.querySelector("#plan").textContent = state?.plan ?? "default";
  document.querySelector("#subscription_status").textContent = state?.subscription_status ?? "none";
  document.querySelector("#usage_count").textContent = state?.usage_count ?? "0";
  message.textContent = state ? "Reproduced application state" : "Default application state";
}

const runtime = createReproRuntime(config, render, { ttlMs: 15 * 60 * 1000 });
render(runtime.getState());
try {
  registerWebMCPTools(runtime);
  status.textContent = "WebMCP tools registered: list_states, reproduce_state, reset_state";
} catch {
  status.textContent = "WebMCP unavailable";
}
