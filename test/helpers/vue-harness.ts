import { mount } from '@vue/test-utils';
import type { Component, Plugin } from 'vue';
import { defineComponent, h } from 'vue';

export function mountSetup<T>(
	setup: () => T,
	options: { plugins?: Plugin[]; provide?: Record<PropertyKey, unknown> } = {},
): { exposed: T; unmount(): void } {
	let exposed!: T;
	const Probe = defineComponent({
		name: 'ComposableProbe',
		setup() {
			exposed = setup();
			return () => h('div');
		},
	});
	const wrapper = mount(Probe as Component, {
		global: {
			plugins: options.plugins ?? [],
			provide: options.provide,
		},
	});
	return {
		get exposed() {
			return exposed;
		},
		unmount: () => wrapper.unmount(),
	};
}

