# repro-webmcp
Reproduce any application state and see the real UI instantly

We don't run your tests. We create the state you need to see.

- Target
-AI coding agentsを使ってWebアプリを開発する開発者

- Problem
-特定状態のUIを確認したいだけなのに、その状態を作る作業が面倒。

- Scope
-自然言語 → WebMCP → semantic state生成 → isolated session → 実Webアプリをその状態で描画。

- Not Scope
-テスト実行、PASS/FAIL判定、Visual Regression、Browser Agent、Playwright代替。

## How It Works

`repro-webmcp` consists of two layers:

### 1. Runtime Library

The runtime is embedded into your web application and exposes safe, reproducible application states through WebMCP.

Instead of creating a separate MCP tool for every scenario, Repro exposes a small, stable interface such as:

```text
list_states
reproduce_state
reset_state
```

Application-specific states are expressed as parameters:

```json
{
  "plan": "free",
  "usage_count": 9,
  "subscription_status": "expired"
}
```

The goal is simple:

> **Describe the state you want to see → Repro creates it → open the real application UI in that state.**

Repro does not decide whether the UI is correct. Humans, coding agents, Playwright, or other QA tools can inspect the resulting UI.

---

### 2. Developer CLI

The CLI helps developers integrate and maintain Repro without manually describing every application state.

```bash
npm install -D repro-webmcp
npx repro init
```

`repro init` analyzes the application and generates the initial Repro configuration and adapters.

It can inspect signals such as:

* authentication
* database schemas / ORM models
* feature flags
* existing fixtures and test utilities
* subscription and plan states
* usage limits
* onboarding states

Generated configuration is reviewed by the developer before it becomes available to Repro.

As the application evolves:

```bash
npx repro scan
```

Repro analyzes the latest code and identifies newly introduced states that may be useful to reproduce.

For example:

```text
Detected new reproducible states:

+ subscription_status
+ customer_rank
+ onboarding_step

Existing:
✓ plan
✓ usage_count
```

The developer can then approve and add them.

### Proposed CLI

```bash
repro init      # Initialize Repro for an existing application
repro scan      # Discover new reproducible states from the latest code
repro add       # Add an approved state to the Repro configuration
repro doctor    # Validate configuration and safety boundaries
```

AI-assisted discovery happens during development, not inside the production runtime.

This keeps the deployed runtime small and predictable while allowing the Repro configuration to evolve alongside the application.

## Design Principle

Repro does **not** try to become another test runner or browser agent.

Its responsibility ends at:

```text
Application code
      ↓
Discover reproducible states
      ↓
Developer approval
      ↓
WebMCP
      ↓
Create isolated application state
      ↓
Render the real UI
```

Browser agents, humans, and testing tools can take over from there.

> **We don't run your tests. We create the state you need to see.**
