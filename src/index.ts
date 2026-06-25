import type {
	AgentPromptImage,
	AttachedAgentEvent,
	FlueClient,
	FlueEvent,
	LiveMode,
	PromptUsage,
} from '@flue/sdk';
import type {
	App,
	ComputedRef,
	InjectionKey,
	MaybeRefOrGetter,
	Plugin,
	PropType,
	SlotsType,
} from 'vue';
import {
	computed,
	defineComponent,
	h,
	inject,
	markRaw,
	provide,
	shallowRef,
	toRaw,
	toValue,
} from 'vue';

export type { AgentPromptImage, AttachedAgentEvent, FlueEvent, PromptUsage } from '@flue/sdk';

export type UIMessagePart =
	| { type: 'text'; text: string; state?: 'streaming' | 'done' }
	| { type: 'reasoning'; text: string; state?: 'streaming' | 'done' }
	| ({ type: 'dynamic-tool'; toolName: string; toolCallId: string } & (
			| { state: 'input-available'; input: unknown; output?: never; errorText?: never }
			| { state: 'output-available'; input: unknown; output: unknown; errorText?: never }
			| { state: 'output-error'; input: unknown; output?: never; errorText: string }
	  ))
	| { type: 'file'; mediaType: string; url: string };

export interface UIMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	metadata?: {
		usage?: PromptUsage;
		model?: { provider: string; id: string };
		[key: string]: unknown;
	};
	parts: UIMessagePart[];
}

export type AgentStatus = 'idle' | 'connecting' | 'submitted' | 'streaming' | 'error';
export type WorkflowStatus =
	| 'idle'
	| 'connecting'
	| 'running'
	| 'completed'
	| 'errored'
	| 'disconnected';

export interface SendMessageOptions {
	images?: AgentPromptImage[];
}

export type AgentHistory = number | 'all';

export interface AgentSnapshot {
	messages: UIMessage[];
	status: AgentStatus;
	historyReady: boolean;
	error: Error | undefined;
}

export interface WorkflowSnapshot {
	events: FlueEvent[];
	logs: Extract<FlueEvent, { type: 'log' }>[];
	status: WorkflowStatus;
	result: unknown;
	error: unknown;
}

export interface UseFlueAgentOptions {
	name: MaybeRefOrGetter<string>;
	id?: MaybeRefOrGetter<string | undefined>;
	history?: MaybeRefOrGetter<AgentHistory | undefined>;
	live?: MaybeRefOrGetter<LiveMode | undefined>;
	client?: MaybeRefOrGetter<FlueClient | undefined>;
}

export interface UseFlueAgentReturn {
	messages: ComputedRef<UIMessage[]>;
	status: ComputedRef<AgentStatus>;
	historyReady: ComputedRef<boolean>;
	error: ComputedRef<Error | undefined>;
	sendMessage(message: string, options?: SendMessageOptions): Promise<void>;
}

export interface UseFlueWorkflowOptions {
	runId?: MaybeRefOrGetter<string | undefined>;
	client?: MaybeRefOrGetter<FlueClient | undefined>;
}

export interface UseFlueWorkflowReturn {
	events: ComputedRef<FlueEvent[]>;
	logs: ComputedRef<Extract<FlueEvent, { type: 'log' }>[]>;
	status: ComputedRef<WorkflowStatus>;
	result: ComputedRef<unknown>;
	error: ComputedRef<unknown>;
}

export interface CreateFluePluginOptions {
	client: FlueClient;
}

export const flueClientKey: InjectionKey<FlueClient> = Symbol('flue-client');

const emptyAgentSnapshot: AgentSnapshot = {
	messages: [],
	status: 'idle',
	historyReady: false,
	error: undefined,
};

const emptyWorkflowSnapshot: WorkflowSnapshot = {
	events: [],
	logs: [],
	status: 'idle',
	result: null,
	error: undefined,
};

export function createFluePlugin(options: CreateFluePluginOptions): Plugin {
	const client = markRaw(options.client);
	return {
		install(app: App) {
			app.provide(flueClientKey, client);
		},
	};
}

export function provideFlueClient(client: FlueClient): void {
	provide(flueClientKey, markRaw(client));
}

export function useFlueClient(): FlueClient {
	const client = inject(flueClientKey, undefined);
	if (!client) throw new Error('useFlueClient() requires createFluePlugin() or FlueProvider');
	return client;
}

export const FlueProvider = defineComponent({
	name: 'FlueProvider',
	props: {
		client: {
			type: Object as PropType<FlueClient>,
			required: true,
		},
	},
	slots: Object as SlotsType<{ default?: () => unknown }>,
	setup(props, { slots }) {
		provideFlueClient(toRaw(props.client));
		return () => slots.default?.() ?? h('span');
	},
});

export function useFlueAgent(options: UseFlueAgentOptions): UseFlueAgentReturn {
	resolveFlueClient(options.client);
	const snapshot = shallowRef(emptyAgentSnapshot);

	return {
		messages: computed(() => snapshot.value.messages),
		status: computed(() => snapshot.value.status),
		historyReady: computed(() => snapshot.value.historyReady),
		error: computed(() => snapshot.value.error),
		async sendMessage() {
			if (!toValue(options.id)) throw new Error('useFlueAgent() cannot send without an agent id');
			throw new Error('useFlueAgent() streaming implementation is not implemented yet');
		},
	};
}

export function useFlueWorkflow(options: UseFlueWorkflowOptions = {}): UseFlueWorkflowReturn {
	resolveFlueClient(options.client);
	const snapshot = shallowRef(emptyWorkflowSnapshot);

	return {
		events: computed(() => snapshot.value.events),
		logs: computed(() => snapshot.value.logs),
		status: computed(() => snapshot.value.status),
		result: computed(() => snapshot.value.result),
		error: computed(() => snapshot.value.error),
	};
}

function resolveFlueClient(override?: MaybeRefOrGetter<FlueClient | undefined>): FlueClient {
	const client = override === undefined ? inject(flueClientKey, undefined) : toValue(override);
	if (!client) throw new Error('Flue composables require a client option or provided Flue client');
	return client;
}
