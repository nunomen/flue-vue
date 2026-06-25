# Changelog

## Unreleased

- Expanded workflow documentation and typechecked examples to show SDK invocation with message-like input separately from `useFlueWorkflow()` run observation.
- Clarified README positioning by marking the package as non-official, describing it as a Vue adapter instead of an internal workspace, and renaming the opening API section to Basic Usage.
- Completed the remaining contract topics by adding agent optimistic echo reconciliation, hydration/send race handling, transient retry and reconnect behavior, workflow checkpoint retries, and local-disposal assertions.
- Removed stale documentation TODO placeholders and activated the relative `baseUrl` lifecycle contract against SDK-owned clients.
- Documented provider-component, workflow observation, Nuxt, SSR, return-ref, status, message-part, and local-disposal behavior, with typechecked example contracts.
- Added streamed agent message reduction for text, reasoning, tool calls, terminal reconciliation, model/usage metadata, live offset continuation, and initial `404` empty-history handling.
- Expanded workflow observer contracts for `run_resume`, shallow event snapshots, terminal disconnect status codes, redelivered event dedupe, and no-reconnect terminal states.
- Hardened Vue lifecycle coverage for stream observers, including SSR no-op setup, component unmount disposal, standalone `effectScope` cleanup, independent concurrent observers, and stale callback protection.
- Started the Vue adapter implementation by splitting the public API into focused provider, bridge, agent, workflow, and type modules.
- Added reactive Flue client provision through the plugin, setup-local provider, and `<FlueProvider>`, including raw client storage and client replacement support.
- Added a shared Vue lifecycle bridge for starting, subscribing to, replacing, and disposing external stream observers.
- Implemented early `useFlueAgent()` and `useFlueWorkflow()` behavior for dormant state, mounted observation, client/identity replacement, workflow replay/status/log handling, and agent send admission with optimistic local messages.
- Activated provider, early agent, and early workflow contract coverage to guide the implementation from public contracts.
- Added agent instructions requiring meaningful changelog updates for future changes.
