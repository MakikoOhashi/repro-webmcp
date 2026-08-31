# This repo is for hackathon  https://webmcp.devpost.com/


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
### Verified integration

The MVP flow was verified with real WebMCP in Cloudflare Browser Run: all three tools were discovered, `free_expired` was reproduced in an isolated session, the TEST / REPRO MODE indicator was shown, and `reset_state` returned the application to its normal state.


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
---

## Repro Mode Safety / Repro Mode の安全設計

Repro can run against a deployed web application, but reproduced states must never mutate real user data or trigger real-world side effects.

Repro はデプロイ済みの Web アプリ上でも利用できます。ただし、再現された状態が実ユーザーデータを変更したり、現実の副作用を発生させたりしてはいけません。

### Isolated Repro Sessions / 隔離された Repro Session

Every reproduction runs inside an isolated Repro Session.

すべての状態再現は、隔離された Repro Session 内で実行します。

```text id="hs26en"
reproduce_state(...)
        ↓
Create isolated Repro Session
        ↓
Generate simulated application state
        ↓
Render the real application UI
        ↓
Expire and clean up automatically
```

A Repro Session must not modify real users, orders, subscriptions, payments, or other production records.

Repro Session は、実ユーザー、注文、契約、決済、その他の本番レコードを変更しません。

External side effects such as payments, emails, webhooks, notifications, and real order submission must be disabled or sandboxed.

決済、メール、Webhook、通知、実注文の送信などの外部副作用は、無効化または sandbox 化します。

Temporary Repro data should have a TTL and be automatically removed after the session expires.

一時的に生成された Repro データには TTL を設定し、セッション終了後に自動削除します。

---

### Agent Confirmation / Agent 側での明示

After reproducing a state, the Agent should explicitly explain that the state is simulated.

状態を再現した際、Agent はそれがシミュレーションであることを明示します。

Example:

> **Repro state created. No real order, payment, email, or external action was executed.**

例：

> **状態を再現しました。実際の注文、決済、メール送信、その他の外部処理は実行されていません。**

This confirmation should be returned even if the person invoking Repro is not the original application developer.

この確認は、Repro を実行したユーザーがアプリの開発者本人でない場合にも表示します。

---

### Visible Repro Mode / UI 上での明示

Agent confirmation alone is not sufficient.

チャット上の通知だけでは十分ではありません。

While a Repro Session is active, the application UI should display a persistent indicator such as:

Repro Session が有効な間、Web アプリには以下のような表示を常時出します。

> **TEST / REPRO MODE**
> This is a simulated state. No real order, payment, or external action has been executed.

日本語例：

> **TEST / REPRO MODE**
> これは再現されたテスト状態です。実際の注文・決済・外部処理は実行されていません。

For sensitive interfaces such as payments, e-commerce, subscriptions, financial dashboards, or administrative screens, Repro may additionally display a persistent `REPRO MODE` watermark.

決済、EC、契約、金融情報、管理画面など、実データと誤認されるリスクが高い画面では、`REPRO MODE` のウォーターマークを重ねて表示することもできます。

This reduces the risk of screenshots from a simulated state being mistaken for evidence of a real transaction or production state.

これにより、Repro で生成した画面のスクリーンショットが、実際の取引・注文・契約・本番状態の証憑として誤認されるリスクを抑えます。

---

### Safety Checks / 安全性チェック

`repro doctor` should verify the application's Repro configuration before deployment or use.

`repro doctor` は、デプロイや利用前に Repro の安全設定を検証します。

```text id="u0mx1m"
✓ Repro session isolated
✓ Production mutations blocked
✓ External side effects disabled
✓ Repro banner enabled
✓ Repro watermark configured
✓ TTL configured
✓ Cleanup configured
```

The core principle is:

基本原則：

> **Reproduce production-like UI states without mutating production data.**

> **本番データを変更することなく、本番同等の UI 状態を再現する。**

