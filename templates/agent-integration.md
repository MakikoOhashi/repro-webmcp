# Repro application bridge

This is the standard Repro integration instruction. Run `npx repro scan` and use the scan-discovered states as the source of truth; do not manually redefine Repro states or create one fixture per state.

## Task

Implement one development-only, generic bridge from Repro stateData to the application's existing state source, store, or module boundary. Reuse the application's normal render/update path.

## Discovered state evidence

{{SCAN_EVIDENCE}}

## Safety requirements

- Identify the existing application state source, store, or module boundary.
- Do not enumerate state names in the adapter.
- Do not add state-specific if/switch branches.
- Do not write to the DOM directly.
- Do not mutate production data.
- Do not call real auth, payment, email, webhook, or notification services.
- Avoid network side effects.
- Preserve ordinary application behavior.
- Verify that reproduce_state changes the actual UI and reset_state restores it.
