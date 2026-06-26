import type { FlueClient } from '@flue/sdk';
import { expectTypeOf, test } from 'vitest';
import type { ComputedRef, MaybeRefOrGetter, Plugin, Ref } from 'vue';
import { computed, shallowRef } from 'vue';
import {
	createFluePlugin,
	type UIMessage,
	type UIMessagePart,
	useFlueAgent,
	useFlueWorkflow,
	type FlueProviderProps,
	type UseFlueAgentOptions,
	type UseFlueAgentResult,
	type UseFlueAgentReturn,
	type UseFlueWorkflowOptions,
	type UseFlueWorkflowResult,
	type UseFlueWorkflowReturn,
} from '../../src/index.ts';

declare const client: FlueClient;

test('agent options accept Vue-native maybe ref or getter inputs', () => {
	const id = shallowRef<string | undefined>('ticket-8472');
	const options: UseFlueAgentOptions = {
		name: computed(() => 'triage'),
		id,
		history: () => 'all',
		live: shallowRef('sse'),
		client: () => client,
	};

	expectTypeOf(options.name).toMatchTypeOf<MaybeRefOrGetter<string>>();
	expectTypeOf(options.id).toMatchTypeOf<MaybeRefOrGetter<string | undefined> | undefined>();
});

test('agent return values are refs and actions', () => {
	const agent = useFlueAgent({ name: 'triage', id: 'ticket-8472', client });

	expectTypeOf(agent).toMatchTypeOf<UseFlueAgentReturn>();
	expectTypeOf(agent).toMatchTypeOf<UseFlueAgentResult>();
	expectTypeOf(agent.messages).toMatchTypeOf<ComputedRef<UIMessage[]>>();
	expectTypeOf(agent.status.value).toEqualTypeOf<'idle' | 'connecting' | 'submitted' | 'streaming' | 'error'>();
	expectTypeOf(agent.historyReady).toMatchTypeOf<Ref<boolean>>();
	expectTypeOf(agent.error.value).toEqualTypeOf<Error | undefined>();
	expectTypeOf(agent.sendMessage).parameters.toMatchTypeOf<[string, ...unknown[]]>();
	expectTypeOf(agent.sendMessage).returns.resolves.toEqualTypeOf<void>();
});

test('workflow options accept Vue-native maybe ref or getter inputs', () => {
	const runId = shallowRef<string | undefined>('run-1');
	const options: UseFlueWorkflowOptions = {
		runId,
		client: () => client,
	};

	expectTypeOf(options.runId).toMatchTypeOf<MaybeRefOrGetter<string | undefined> | undefined>();
});

test('workflow return values are refs', () => {
	const workflow = useFlueWorkflow({ runId: 'run-1', client });

	expectTypeOf(workflow).toMatchTypeOf<UseFlueWorkflowReturn>();
	expectTypeOf(workflow).toMatchTypeOf<UseFlueWorkflowResult>();
	expectTypeOf(workflow.events).toMatchTypeOf<ComputedRef<unknown[]>>();
	expectTypeOf(workflow.logs).toMatchTypeOf<ComputedRef<unknown[]>>();
	expectTypeOf(workflow.status.value).toEqualTypeOf<
		'idle' | 'connecting' | 'running' | 'completed' | 'errored' | 'disconnected'
	>();
});

test('plugin factory accepts a Flue client', () => {
	expectTypeOf(createFluePlugin({ client })).toMatchTypeOf<Plugin>();
	expectTypeOf({ client }).toMatchTypeOf<FlueProviderProps>();
});

test('UIMessage supports data parts', () => {
	const dataPart: Extract<UIMessagePart, { type: `data-${string}` }> = {
		type: 'data-progress',
		id: 'setup',
		data: { step: 1 },
	};
	const message: UIMessage = {
		id: 'data:["progress","setup"]',
		role: 'assistant',
		parts: [dataPart],
	};

	expectTypeOf(dataPart).toMatchTypeOf<{ type: `data-${string}`; data: unknown }>();
	expectTypeOf(message.parts).toMatchTypeOf<UIMessagePart[]>();
});
