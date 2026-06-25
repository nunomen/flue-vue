import type { FlueClient } from '@flue/sdk';
import type {
	App,
	InjectionKey,
	MaybeRefOrGetter,
	Plugin,
	PropType,
	ShallowRef,
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
	watch,
} from 'vue';
import type { CreateFluePluginOptions } from './types.ts';

export type FlueClientSource = Readonly<ShallowRef<FlueClient>>;

export const flueClientKey: InjectionKey<FlueClientSource> = Symbol('flue-client');

const missingClientMessage = 'Flue composables require a client option or provided Flue client';

export function createFluePlugin(options: CreateFluePluginOptions): Plugin {
	const clientSource = createFlueClientSource(options.client);
	return {
		install(app: App) {
			app.provide(flueClientKey, clientSource);
		},
	};
}

export function provideFlueClient(client: FlueClient): void {
	provide(flueClientKey, createFlueClientSource(client));
}

export function useFlueClient(): FlueClient {
	return requireFlueClientSource().value;
}

export function useFlueClientSource(
	override?: MaybeRefOrGetter<FlueClient | undefined>,
): FlueClientSource {
	if (override === undefined) return requireFlueClientSource();

	const source = computed(() => {
		const client = toValue(override);
		if (!client) throw new Error(missingClientMessage);
		return toProvidedClient(client);
	});

	// Resolve eagerly so missing override clients fail at setup time.
	source.value;
	return source;
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
		const clientSource = createFlueClientSource(props.client);
		provide(flueClientKey, clientSource);

		watch(
			() => props.client,
			(client) => {
				clientSource.value = toProvidedClient(client);
			},
			{ flush: 'sync' },
		);

		return () => slots.default?.() ?? h('span', { hidden: true });
	},
});

function requireFlueClientSource(): FlueClientSource {
	const source = inject(flueClientKey, undefined);
	if (!source) throw new Error(missingClientMessage);
	return source;
}

function createFlueClientSource(client: FlueClient): ShallowRef<FlueClient> {
	return shallowRef(toProvidedClient(client));
}

function toProvidedClient(client: FlueClient): FlueClient {
	return markRaw(toRaw(client));
}

