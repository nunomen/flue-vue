import type { ShallowRef } from 'vue';
import { getCurrentInstance, onMounted, onScopeDispose, shallowRef, watch } from 'vue';
import type { SubscribableSnapshot } from './core/types.ts';
export type { SubscribableSnapshot } from './core/types.ts';

export interface UseSubscribableSnapshotOptions<TSnapshot, TIdentity, TObserver extends SubscribableSnapshot<TSnapshot>> {
	emptySnapshot: TSnapshot;
	getIdentity(): TIdentity | undefined;
	createObserver(identity: TIdentity): TObserver;
	isEqual?(left: TIdentity, right: TIdentity): boolean;
	onObserverChange?(observer: TObserver | undefined): void;
}

export function useSubscribableSnapshot<
	TSnapshot,
	TIdentity,
	TObserver extends SubscribableSnapshot<TSnapshot>,
>(
	options: UseSubscribableSnapshotOptions<TSnapshot, TIdentity, TObserver>,
): ShallowRef<TSnapshot> {
	const snapshot = shallowRef(options.emptySnapshot) as ShallowRef<TSnapshot>;
	let mounted = false;
	let started = false;
	let identity: TIdentity | undefined;
	let observer: TObserver | undefined;
	let unsubscribe: (() => void) | undefined;

	function publish(nextObserver = observer) {
		if (!nextObserver || nextObserver !== observer) return;
		snapshot.value = nextObserver.getSnapshot();
	}

	function disposeObserver() {
		unsubscribe?.();
		unsubscribe = undefined;
		observer?.dispose();
		observer = undefined;
		identity = undefined;
		started = false;
		options.onObserverChange?.(undefined);
	}

	function startObserver() {
		if (!observer || started) return;
		started = true;
		observer.start();
		publish(observer);
	}

	watch(
		() => options.getIdentity(),
		(nextIdentity) => {
			if (nextIdentity === undefined) {
				disposeObserver();
				snapshot.value = options.emptySnapshot;
				return;
			}

			if (identity !== undefined && options.isEqual?.(identity, nextIdentity)) return;

			disposeObserver();
			identity = nextIdentity;
			observer = options.createObserver(nextIdentity);
			const activeObserver = observer;
			unsubscribe = activeObserver.subscribe(() => publish(activeObserver));
			options.onObserverChange?.(activeObserver);
			publish(activeObserver);
			if (mounted) startObserver();
		},
		{ immediate: true, flush: 'sync' },
	);

	if (getCurrentInstance()) {
		onMounted(() => {
			mounted = true;
			startObserver();
		});
	} else {
		mounted = true;
		startObserver();
	}

	onScopeDispose(disposeObserver);

	return snapshot;
}
