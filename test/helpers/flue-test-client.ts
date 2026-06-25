import type { FlueClient, FlueEventStream } from '@flue/sdk';
import { vi } from 'vitest';

export function createTestClient(overrides: Partial<FlueClient> = {}): FlueClient {
	return {
		agents: {
			prompt: vi.fn(),
			send: vi.fn(),
			wait: vi.fn(),
			stream: vi.fn(),
		},
		runs: {
			get: vi.fn(),
			stream: vi.fn(),
			events: vi.fn(),
		},
		workflows: {
			invoke: vi.fn(),
			run: vi.fn(),
		},
		...overrides,
	} as FlueClient;
}

export function finiteStream<T>(events: T[], offset = 'offset-1'): FlueEventStream<T> {
	return {
		offset,
		cancel: vi.fn(),
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
		},
	};
}

export function pendingStream<T>(offset = '-1'): FlueEventStream<T> & { push(event: T): void } {
	const values: T[] = [];
	let wake: (() => void) | undefined;
	let canceled = false;
	return {
		offset,
		push(event) {
			values.push(event);
			wake?.();
		},
		cancel() {
			canceled = true;
			wake?.();
		},
		async *[Symbol.asyncIterator]() {
			while (!canceled) {
				const value = values.shift();
				if (value !== undefined) yield value;
				else await new Promise<void>((resolve) => (wake = resolve));
			}
		},
	};
}

