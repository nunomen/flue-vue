import { describe, it } from 'vitest';

describe('Vue lifecycle and SSR contracts', () => {
	it.todo('agent composable can be created inside an effectScope and cleaned up with stop');
	it.todo('workflow composable can be created inside an effectScope and cleaned up with stop');
	it.todo('agent composable does not call client.agents.stream during SSR render');
	it.todo('workflow composable does not call client.runs.stream during SSR render');
	it.todo('agent composable opens stream after hydration/mount on client');
	it.todo('workflow composable opens stream after hydration/mount on client');
	it.todo('relative baseUrl behavior remains delegated to user-created SDK client');
	it.todo('multiple concurrent component instances observe independently');
	it.todo('shared app client does not imply shared conversation state');
	it.todo('scope disposal before first async stream event does not publish stale snapshots');
});

