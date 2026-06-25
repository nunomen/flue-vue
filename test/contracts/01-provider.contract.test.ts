import { describe, it } from 'vitest';

describe('client provision contracts', () => {
	it.todo('createFluePlugin provides the exact client instance through a typed injection key');
	it.todo('createFluePlugin marks the client raw so Vue does not proxy SDK methods or stream objects');
	it.todo('createFluePlugin isolates clients across two Vue app instances');
	it.todo('provideFlueClient provides a setup-local client without installing the app plugin');
	it.todo('FlueProvider provides the client to default slot descendants');
	it.todo('FlueProvider updates descendants when its client prop identity changes');
	it.todo('useFlueClient throws a clear error when no client is provided');
	it.todo('composables throw the same clear error when neither provider nor client option exists');
	it.todo('client option override wins over injected app client');
	it.todo('client option accepts refs and getters');
	it.todo('client option replacement recreates active observers');
});

