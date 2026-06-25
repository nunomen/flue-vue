# Changelog

## Unreleased

- Expanded workflow observer contracts for `run_resume`, shallow event snapshots, terminal disconnect status codes, redelivered event dedupe, and no-reconnect terminal states.
- Hardened Vue lifecycle coverage for stream observers, including SSR no-op setup, component unmount disposal, standalone `effectScope` cleanup, independent concurrent observers, and stale callback protection.
- Started the Vue adapter implementation by splitting the public API into focused provider, bridge, agent, workflow, and type modules.
- Added reactive Flue client provision through the plugin, setup-local provider, and `<FlueProvider>`, including raw client storage and client replacement support.
- Added a shared Vue lifecycle bridge for starting, subscribing to, replacing, and disposing external stream observers.
- Implemented early `useFlueAgent()` and `useFlueWorkflow()` behavior for dormant state, mounted observation, client/identity replacement, workflow replay/status/log handling, and agent send admission with optimistic local messages.
- Activated provider, early agent, and early workflow contract coverage, expanding the passing test suite while leaving deeper reducer, retry, SSR, and documentation contracts as todos.
- Added agent instructions requiring meaningful changelog updates for future changes.
