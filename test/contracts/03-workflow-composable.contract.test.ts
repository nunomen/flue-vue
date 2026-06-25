import { describe, it } from 'vitest';

describe('useFlueWorkflow Vue contracts', () => {
	it.todo('requires a client even while dormant without runId');
	it.todo('stays dormant without runId and returns empty idle refs');
	it.todo('accepts plain values, refs, computed refs, and getters for runId');
	it.todo('accepts plain values, refs, computed refs, and getters for client');
	it.todo('does not recreate a run observer when computed option values are unchanged');
	it.todo('replaces the observer when runId changes');
	it.todo('replaces the observer when client changes');
	it.todo('returns refs that survive destructuring');
	it.todo('starts observing only after component mount');
	it.todo('does not open streams during server-side setup');
	it.todo('disposes the observer on component unmount');
	it.todo('disposes the observer when an enclosing effectScope stops');
	it.todo('uses shallow snapshot storage so workflow events are not deeply proxied');
	it.todo('replays completed workflow run history');
	it.todo('selects log events into logs while preserving all events');
	it.todo('reports running after run_start');
	it.todo('reports running after run_resume');
	it.todo('reports completed and exposes result from successful run_end');
	it.todo('reports errored and exposes error from failing run_end');
	it.todo('reports disconnected when the stream closes without run_end');
	it.todo('treats 401 as terminal disconnected');
	it.todo('treats 403 as terminal disconnected');
	it.todo('treats 404 as terminal disconnected');
	it.todo('retries transient failures from the concrete durable checkpoint');
	it.todo('dedupes redelivered workflow events');
	it.todo('does not reconnect after completed terminal state');
	it.todo('does not reconnect after errored terminal state');
	it.todo('does not reconnect after clean closure without run_end');
	it.todo('ignores stale checkpoints from disposed observers after replacement starts');
	it.todo('does not cancel server-side work when local observation is disposed');
});

