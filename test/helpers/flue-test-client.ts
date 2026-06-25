import type { FlueClient, FlueEventStream } from '@flue/sdk';
import { vi } from 'vitest';

export function createTestClient(overrides: Partial<FlueClient> = {}): FlueClient {
	return {
		agents: {
			prompt: vi.fn(),
			send: vi.fn(),
			wait: vi.fn(),
			stream: vi.fn(() => pendingStream()),
		},
		runs: {
			get: vi.fn(),
			stream: vi.fn(() => pendingStream()),
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

export function throwingStream<T>(error: unknown, offset = 'offset-error'): FlueEventStream<T> {
	return {
		offset,
		cancel: vi.fn(),
		async *[Symbol.asyncIterator]() {
			throw error;
		},
	};
}

export function failingStream<T>(events: T[], error: unknown, offset = 'offset-error'): FlueEventStream<T> {
	return {
		offset,
		cancel: vi.fn(),
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
			throw error;
		},
	};
}

export function pendingStream<T>(
	offset = '-1',
): FlueEventStream<T> & { push(event: T): void; close(): void; fail(error: unknown): void } {
	const values: T[] = [];
	let wake: (() => void) | undefined;
	let canceled = false;
	let closed = false;
	let failure: unknown;
	const cancel = vi.fn(() => {
		canceled = true;
		wake?.();
	});
	return {
		offset,
		push(event) {
			values.push(event);
			wake?.();
		},
		close() {
			closed = true;
			wake?.();
		},
		fail(error) {
			failure = error;
			closed = true;
			wake?.();
		},
		cancel,
		async *[Symbol.asyncIterator]() {
			while (!canceled) {
				const value = values.shift();
				if (value !== undefined) yield value;
				else if (failure !== undefined) throw failure;
				else if (closed) return;
				else await new Promise<void>((resolve) => (wake = resolve));
			}
		},
	};
}
