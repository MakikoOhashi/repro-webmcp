# repro-webmcp

Repro discovers application states from existing JavaScript / TypeScript code and makes those states reproducible through WebMCP.

> **We do not run your tests. We create the state you need to see.**

Repro helps developers inspect the real application UI in difficult-to-reach states such as an expired subscription, failed payment, loading, error, or usage limit.

## Quick start

Install the published package:

~~~bash
npm install -D repro-webmcp@0.1.1
~~~

Initialize a minimal config and scan the application code:

~~~bash
npx repro init
npx repro scan
~~~

Use npx repro scan --dry-run to inspect candidates without writing a config.

repro init supports JavaScript and TypeScript configs:

~~~bash
npx repro init --format js
npx repro init --format ts
~~~

Without an explicit format, Repro chooses TypeScript when a tsconfig.json, TypeScript dependency, or TypeScript source is present. Otherwise it creates JavaScript config.

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
