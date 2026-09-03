# repro-webmcp

Repro discovers application states from existing JavaScript / TypeScript code and makes those states reproducible through WebMCP.

> **We do not run your tests. We create the state you need to see.**

Repro helps developers inspect the real application UI in difficult-to-reach states such as an expired subscription, failed payment, loading, error, or usage limit.

## npm authentication on a VPS

For npm authentication on the VPS, use the web/browser flow:

~~~bash
npm login --auth-type=web
npm whoami
~~~

Use this before publishing. Do not request or invent an OTP unless npm explicitly requires one for the account.

## Quick start

Install the published package:

~~~bash
npm install -D repro-webmcp@0.1.3
~~~

Initialize a minimal config and scan the application code:

~~~bash
npx repro init
npx repro scan
~~~

Use npx repro scan --dry-run to inspect candidates without writing a config.

Repro's agent-native flow is:

1. Run npx repro scan to discover semantic states and source evidence.
2. Run npx repro setup. A supported high-confidence pattern can use zero-code auto-integration.
3. Otherwise, setup expands the npm-bundled templates/agent-integration.md into .repro/AGENTS.md with the scan evidence. A coding agent connects one generic bridge to the existing application state boundary and normal render path.
4. Use the WebMCP tools list_states, reproduce_state, and reset_state to inspect the actual application UI.

> Repro discovers the states. If your app needs a custom connection, Repro gives your coding agent the integration instructions automatically.

After reviewing the discovered states, run the explicit setup step for a static HTML / ES modules app:

~~~bash
npx repro setup
~~~

This creates the generated config, copies the self-contained browser runtime to `vendor/repro-webmcp.js`, and wires a root `index.html` to `repro.setup.js`. Existing Repro config files and existing setup files are not overwritten. The generated browser bootstrap registers `list_states`, `reproduce_state`, and `reset_state`; connect the generated adapter to the application's existing state source for real UI updates. Projects with another HTML entrypoint should import `repro.setup.js` from that entrypoint.


repro init supports JavaScript and TypeScript configs:

~~~bash
npx repro init --format js
npx repro init --format ts
~~~

Without an explicit format, Repro chooses TypeScript when a tsconfig.json, TypeScript dependency, or TypeScript source is present. Otherwise it creates JavaScript config.

### Setup adapter

`repro setup` also creates `repro.adapter.js`. Connect this one generic boundary to the application's existing state source; do not repeat or rename discovered states:

~~~js
export default {
  applyReproState(state) {
    appState.replace(state);
  },
  resetReproState() {
    appState.restore();
  },
};
~~~

The adapter changes the application's normal state source, so its existing render path updates the real UI. It does not write to the DOM, call a network, or mutate production data. Re-running setup preserves an existing adapter.

Safe adapter auto-generation is limited to an explicitly exported JavaScript `appState` object with callable `setState` and `reset` methods. When that exact shape is not found, setup generates the manual adapter scaffold and reports `manual adapter required`; it does not guess React, Redux, Zustand, Context, auth, or server state.

When setup cannot safely identify an application state boundary, it expands the versioned instruction bundled at `templates/agent-integration.md` into `.repro/AGENTS.md` with project-specific scan evidence. The coding-agent instruction asks for one generic bridge to the existing state source and render path; it does not ask for manual Repro scenarios or state-specific adapter branches.

Automatic zero-code UI state reproduction currently supports the narrow, statically identifiable module-level JavaScript pattern of an exported mutable object state plus an exported `render()` function in the same module. `repro setup` adds development-only hooks that assign generic scan-generated state data and call that existing render path. Other architectures, including the current Coaching auth module, fall back to the standardized adapter and are reported as `manual adapter required`.

The supported auto-instrumentation scope also includes a narrow cross-module JavaScript pattern: a module-level mutable state with an exported getter, plus a separate JavaScript module that imports that getter and exports `render()`. When statically verified, setup adds development-only generic hooks to the owner and re-runs the existing render path. Other architectures fall back to `manual adapter required`.

## Automatic state discovery

repro scan is deterministic, local, AST-based heuristic static analysis. It supports JavaScript, TypeScript, JSX, and TSX source files.

For example, ordinary application code such as:

~~~tsx
if (subscription === "expired") {
  return <ExpiredBanner />;
}

if (paymentStatus === "failed") {
  return <PaymentError />;
}
~~~

can produce candidates such as expired and failed, including source-file and line evidence. Candidates can come from:

- UI conditional branches
- compound conditions
- literal unions and enums
- fixtures, mocks, tests, stories, and seeds
- state-like object literals

The scanner ranks semantic and UI-related states above internal workflow states, removes duplicate candidates deterministically, and limits output to 20 candidates. It does not use an LLM, network access, a database, or application source rewriting.

If repro.config.js or repro.config.ts already exists, repro scan does not overwrite it. It writes a generated config under a separate filename.

No manually written Repro scenario is required for the discovery step, but the application still determines how a discovered state is rendered.

## WebMCP tools

The runtime exposes three tools when the browser provides the WebMCP registration API:

~~~text
list_states
reproduce_state
reset_state
~~~

- list_states lists states in the loaded Repro config.
- reproduce_state applies one named state to a temporary Repro Session.
- reset_state ends the session and returns the runtime to its normal state.

The runtime also provides getState(), getSession(), and a framework-independent subscription API:

~~~js
const unsubscribe = runtime.subscribe((state) => {
  renderApp(state);
});
~~~

Subscribers receive the current state immediately (null initially), then receive reproduction and reset updates. Calling unsubscribe() removes the listener. Listener exceptions are isolated from the runtime.

## How it works

~~~text
Existing application code
        ↓
   npx repro scan
        ↓
Detected state candidates + evidence
        ↓
Generated Repro config
        ↓
Repro Runtime
        ↓
WebMCP tools
        ↓
The existing application UI
~~~

Backend tests answer whether the system can reach a state. Repro is for seeing what the real UI looks like in that state. It does not replace a test runner, browser agent, Playwright, or visual regression tool.

## Safety and isolation

Each reproduced state creates an isolated, temporary Repro Session. Sessions have a TTL and are cleaned up when they expire or are reset. The session API reports external side effects as disabled and can explicitly block an application operation:

~~~js
const session = runtime.getSession();
session?.assertActive();
session?.blockExternalSideEffect();
~~~

Tool responses include this safety message:

> Preview only. No real users, orders, payments, emails, webhooks, or notifications are affected.

Applications must route sensitive operations through their own sandbox or Repro safety boundary. Repro does not connect to production databases, create real users, submit real orders, or provide an automatic repro doctor safety audit.

The included demo displays TEST / REPRO MODE and REPRO MODE as visible safety indicators. These demo indicators are static HTML; the runtime does not provide a banner or watermark helper.

## Browser and no-build usage

Bundler projects can use the public browser subpath:

~~~js
import {
  createReproRuntime,
  registerWebMCPTools,
} from "repro-webmcp/browser";
~~~

For a static HTML + ES modules application, copy the single self-contained browser bundle:

~~~bash
cp node_modules/repro-webmcp/dist/browser.bundle.js \\
  public/vendor/repro-webmcp.js
~~~

Then import the copied file by relative URL:

~~~js
import {
  createReproRuntime,
  registerWebMCPTools,
} from "./vendor/repro-webmcp.js";
~~~

The bundle is an ESM file and does not require dist/index.js or Node-only dependencies at runtime.

## Live demo and validation

Live demo: https://repro-webmcp.pages.dev/demo/

In a WebMCP-capable browser, the demo attempts to register the three tools. In an ordinary browser without WebMCP, the UI remains visible and displays WebMCP unavailable.

The runtime and demo flow were verified with real WebMCP for the hand-written demo states: tool discovery, isolated reproduction, visible demo indicators, and reset. Scan-generated states have deterministic local and package-level coverage. A real-browser validation of a scan-generated state is not claimed here.

## Current limitations

- State discovery is heuristic AST-based static analysis, not full program or type analysis.
- No LLM or natural-language state inference is included.
- Framework-specific deep analysis and backend adapters are not included.
- repro add and repro doctor are not implemented in 0.1.1.
- The scanner can suggest a state; application code determines how that state is rendered.
- WebMCP requires a compatible browser API. Unsupported browsers use the demo fallback but cannot invoke the tools.

## Development

~~~bash
npm test
npm run build
npm pack --dry-run
~~~

## Links

- GitHub: https://github.com/MakikoOhashi/repro-webmcp
- npm package: https://www.npmjs.com/package/repro-webmcp
- Live demo: https://repro-webmcp.pages.dev/demo/

## License

MIT
