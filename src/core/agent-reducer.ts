/*
 * Portions derived from @flue/react in withastro/flue.
 * Licensed under Apache License 2.0.
 * Modifications Copyright 2026 Nuno Mendes.
 */

import { IMAGE_DATA_OMITTED, type AttachedAgentEvent } from '@flue/sdk';
import type { AgentDataEvent, AgentSnapshot, AgentStreamEvent, UIMessage, UIMessagePart } from './types.js';

export const emptyAgentSnapshot: AgentSnapshot = {
	messages: [],
	status: 'idle',
	historyReady: false,
	error: undefined,
};

export function reduceAgentEvent(snapshot: AgentSnapshot, event: AgentStreamEvent): AgentSnapshot {
	let messages = snapshot.messages;

	if (event.type === 'message_start' || event.type === 'message_end') {
		const message = messageFromEvent(event, snapshot.messages);
		messages = message
			? message.role === 'user'
				? reconcileUserMessage(snapshot.messages, event, message)
				: upsertMessage(removeAssistantAlias(snapshot.messages, event, message.id), message)
			: snapshot.messages;
	} else if (event.type === 'text_delta') {
		messages = canPlaceAssistantDelta(event)
			? upsertAssistantMessage(snapshot.messages, event, (message) => ({
					...message,
					parts: appendTextDelta(message.parts, event.text),
				}))
			: snapshot.messages;
	} else if (event.type === 'thinking_start') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			parts: upsertReasoningStart(message.parts, event.contentIndex),
		}));
	} else if (event.type === 'thinking_delta') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			parts: appendReasoningDelta(message.parts, event.delta, event.contentIndex ?? 0),
		}));
	} else if (event.type === 'thinking_end') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			parts: finishReasoningPart(message.parts, event.content, event.contentIndex ?? 0),
		}));
	} else if (event.type === 'tool_start') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			parts: upsertToolStart(message.parts, event),
		}));
	} else if (event.type === 'tool') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			parts: upsertToolResult(message.parts, event),
		}));
	} else if (event.type === 'turn') {
		messages = upsertAssistantMessage(snapshot.messages, event, (message) => ({
			...message,
			metadata: metadataFromTurn(event, message.metadata),
		}));
	} else if (event.type === 'data') {
		messages = upsertDataMessage(snapshot.messages, event);
	}

	if (event.type === 'idle') {
		return { ...snapshot, messages, status: 'idle', error: undefined };
	}

	if (event.type === 'submission_settled' && event.outcome === 'failed') {
		return { ...snapshot, messages, status: 'error', error: normalizeError(event.error) };
	}

	if (
		event.type === 'message_start' ||
		event.type === 'text_delta' ||
		event.type === 'thinking_start' ||
		event.type === 'thinking_delta' ||
		event.type === 'thinking_end' ||
		event.type === 'tool_start' ||
		event.type === 'tool' ||
		event.type === 'turn'
	) {
		return { ...snapshot, messages, status: 'streaming' };
	}

	return { ...snapshot, messages };
}

export function mergeHydratedAndLocalMessages(
	hydratedMessages: UIMessage[],
	localMessages: UIMessage[],
): UIMessage[] {
	const next = hydratedMessages.slice();
	for (const localMessage of localMessages) {
		if (!isOptimisticMessage(localMessage)) continue;
		if (hasDurableSubmission(next, localMessage.id)) continue;
		next.push(localMessage);
	}
	return next;
}

export function adjustPendingStatus(snapshot: AgentSnapshot, pendingSubmissions: Set<string>): AgentSnapshot {
	if (snapshot.status !== 'idle' || pendingSubmissions.size === 0) return snapshot;
	return {
		...snapshot,
		status: 'submitted',
	};
}

export function imageToMessagePart(image: { data: string; mimeType: string }): UIMessagePart {
	return {
		type: 'file',
		mediaType: image.mimeType,
		url: imageUrl(image.data, image.mimeType),
	};
}

export function optimisticMessageId(submissionId: string): string {
	return `local:${submissionId}`;
}

export function agentEventKey(event: AgentStreamEvent): string {
	return [
		event.instanceId,
		event.dispatchId ?? event.submissionId ?? '',
		event.eventIndex,
		event.timestamp,
	].join(':');
}

export function normalizeError(error: unknown): Error {
	if (error instanceof Error) return error;
	if (isRecord(error) && typeof error.message === 'string') return new Error(error.message);
	return new Error(String(error));
}

export function isStatusError(error: unknown, status: number): boolean {
	return isRecord(error) && error.status === status;
}

export function isTerminalStreamError(error: unknown): boolean {
	return isStatusError(error, 401) || isStatusError(error, 403);
}

function messageFromEvent(
	event: Extract<AttachedAgentEvent, { type: 'message_start' | 'message_end' }>,
	existingMessages: UIMessage[],
): UIMessage | undefined {
	const value = event.message;
	if (!isRecord(value) || !('role' in value) || value.role === 'toolResult') return undefined;

	const done = event.type === 'message_end';

	if (value.role === 'user') {
		const existing = existingMessages.find((item) => item.id === messageId(event, 'user'));
		return {
			id: messageId(event, 'user'),
			role: 'user',
			metadata: existing?.metadata,
			parts: mergeAuthoritativeParts(existing?.parts ?? [], messageContentParts(value.content, done)),
		};
	}

	if (value.role === 'assistant') {
		const existing =
			existingMessages.find((item) => item.id === messageId(event, 'assistant')) ??
			existingMessages.find((item) => item.id === fallbackAssistantMessageId(event));
		return {
			id: messageId(event, 'assistant'),
			role: 'assistant',
			metadata: existing?.metadata,
			parts: mergeAuthoritativeParts(existing?.parts ?? [], messageContentParts(value.content, done)),
		};
	}

	return undefined;
}

function reconcileUserMessage(
	messages: UIMessage[],
	event: AttachedAgentEvent,
	durableMessage: UIMessage,
): UIMessage[] {
	if (!event.submissionId) return upsertMessage(messages, durableMessage);

	const submissionId = event.submissionId;
	const localIndex = messages.findIndex((message) => message.id === optimisticMessageId(submissionId));
	if (localIndex === -1) return upsertMessage(messages, durableMessage);

	const localMessage = messages[localIndex];
	const next = messages.filter((message) => message.id !== durableMessage.id);
	const targetIndex = next.findIndex((message) => message.id === optimisticMessageId(submissionId));
	if (targetIndex === -1) return upsertMessage(next, durableMessage);
	next[targetIndex] = mergeDurableUserMessage(localMessage, durableMessage);
	return next;
}

function mergeDurableUserMessage(localMessage: UIMessage | undefined, durableMessage: UIMessage): UIMessage {
	if (!localMessage) return durableMessage;

	return {
		...durableMessage,
		parts: durableMessage.parts.map((part, index) => {
			if (part.type !== 'file' || part.url !== IMAGE_DATA_OMITTED) return part;
			const localPart = localMessage.parts[index];
			if (localPart?.type !== 'file') return part;
			return {
				...part,
				url: localPart.url,
			};
		}),
	};
}

function hasDurableSubmission(messages: UIMessage[], optimisticId: string): boolean {
	const submissionId = optimisticId.slice('local:'.length);
	return messages.some((message) => message.id === userMessageId(submissionId));
}

function isOptimisticMessage(message: UIMessage): boolean {
	return message.id.startsWith('local:');
}

function canPlaceAssistantDelta(event: AttachedAgentEvent): boolean {
	return Boolean(event.submissionId || event.dispatchId || event.turnId);
}

function messageContentParts(content: unknown, done: boolean): UIMessagePart[] {
	const state = done ? 'done' : 'streaming';
	if (typeof content === 'string') return [{ type: 'text', text: content, state }];
	if (!Array.isArray(content)) return [];

	return content.flatMap((part): UIMessagePart[] => {
		if (!isRecord(part)) return [];
		if (part.type === 'text' && typeof part.text === 'string') {
			return [{ type: 'text', text: part.text, state }];
		}
		if (part.type === 'thinking' && typeof part.thinking === 'string') {
			return [{ type: 'reasoning', text: part.thinking, state }];
		}
		if (part.type === 'image' && typeof part.mimeType === 'string' && typeof part.data === 'string') {
			return [{ type: 'file', mediaType: part.mimeType, url: imageUrl(part.data, part.mimeType) }];
		}
		if (
			part.type === 'toolCall' &&
			typeof part.name === 'string' &&
			typeof part.id === 'string'
		) {
			return [
				{
					type: 'dynamic-tool',
					state: 'input-available',
					toolName: part.name,
					toolCallId: part.id,
					input: isRecord(part.arguments) ? part.arguments : {},
				},
			];
		}
		return [];
	});
}

function appendTextDelta(parts: UIMessagePart[], delta: string): UIMessagePart[] {
	const next = parts.slice();
	const index = findLastPartIndex(next, (part): part is Extract<UIMessagePart, { type: 'text' }> =>
		part.type === 'text' && part.state === 'streaming',
	);
	if (index === -1) return [...next, { type: 'text', text: delta, state: 'streaming' }];
	const part = next[index];
	if (part?.type !== 'text') return next;
	next[index] = { ...part, text: `${part.text}${delta}`, state: 'streaming' };
	return next;
}

function upsertReasoningStart(parts: UIMessagePart[], contentIndex: number | undefined): UIMessagePart[] {
	const index = contentIndex === undefined ? -1 : findReasoningPartIndex(parts, contentIndex);
	if (index !== -1) return parts;
	return [...parts, { type: 'reasoning', text: '', state: 'streaming' }];
}

function appendReasoningDelta(parts: UIMessagePart[], delta: string, contentIndex: number): UIMessagePart[] {
	const next = parts.slice();
	const index = findReasoningPartIndex(next, contentIndex);
	if (index === -1) return [...next, { type: 'reasoning', text: delta, state: 'streaming' }];
	const part = next[index];
	if (part?.type !== 'reasoning' || part.state === 'done') return next;
	next[index] = { ...part, text: `${part.text}${delta}`, state: 'streaming' };
	return next;
}

function finishReasoningPart(parts: UIMessagePart[], content: string, contentIndex: number): UIMessagePart[] {
	const next = parts.slice();
	const index = findReasoningPartIndex(next, contentIndex);
	if (index === -1) return [...next, { type: 'reasoning', text: content, state: 'done' }];
	const part = next[index];
	if (part?.type !== 'reasoning') return next;
	next[index] = { ...part, text: content, state: 'done' };
	return next;
}

function upsertDataMessage(messages: UIMessage[], event: AgentDataEvent): UIMessage[] {
	const id =
		event.id === undefined
			? `data-event:${agentEventKey(event)}`
			: `data:${JSON.stringify([event.name, event.id])}`;
	const part: UIMessagePart = {
		type: `data-${event.name}`,
		...(event.id === undefined ? {} : { id: event.id }),
		data: event.data,
	};
	return upsertMessage(messages, { id, role: 'assistant', parts: [part] });
}

function upsertToolStart(
	parts: UIMessagePart[],
	event: Extract<AttachedAgentEvent, { type: 'tool_start' }>,
): UIMessagePart[] {
	const next = parts.slice();
	const index = next.findIndex((part) => part.type === 'dynamic-tool' && part.toolCallId === event.toolCallId);
	const input = event.args ?? {};
	if (index === -1) {
		return [
			...next,
			{
				type: 'dynamic-tool',
				state: 'input-available',
				toolName: event.toolName,
				toolCallId: event.toolCallId,
				input,
			},
		];
	}

	const part = next[index];
	if (part?.type !== 'dynamic-tool') return next;
	next[index] = { ...part, toolName: event.toolName, input };
	return next;
}

function upsertToolResult(
	parts: UIMessagePart[],
	event: Extract<AttachedAgentEvent, { type: 'tool' }>,
): UIMessagePart[] {
	const next = parts.slice();
	const index = next.findIndex((part) => part.type === 'dynamic-tool' && part.toolCallId === event.toolCallId);
	const existing = index === -1 ? undefined : next[index];
	const input = existing?.type === 'dynamic-tool' ? existing.input : {};
	const part: UIMessagePart = event.isError
		? {
				type: 'dynamic-tool',
				state: 'output-error',
				toolName: event.toolName,
				toolCallId: event.toolCallId,
				input,
				errorText: String(event.result ?? 'Tool call failed'),
			}
		: {
				type: 'dynamic-tool',
				state: 'output-available',
				toolName: event.toolName,
				toolCallId: event.toolCallId,
				input,
				output: event.result,
			};

	if (index === -1) return [...next, part];
	next[index] = part;
	return next;
}

function mergeAuthoritativeParts(existingParts: UIMessagePart[], authoritativeParts: UIMessagePart[]): UIMessagePart[] {
	return authoritativeParts.map((part, index) => {
		if (part.type === 'file' && part.url === IMAGE_DATA_OMITTED) {
			const existing = existingParts[index];
			if (existing?.type === 'file' && existing.mediaType === part.mediaType) return existing;
		}

		if (part.type !== 'dynamic-tool') return part;

		const existing = existingParts.find(
			(existingPart) =>
				existingPart.type === 'dynamic-tool' && existingPart.toolCallId === part.toolCallId,
		);
		if (!existing || existing.type !== 'dynamic-tool') return part;
		if (existing.state === 'output-available') {
			return {
				...existing,
				toolName: part.toolName,
				input: part.input,
			};
		}
		if (existing.state === 'output-error') {
			return {
				...existing,
				toolName: part.toolName,
				input: part.input,
			};
		}
		return part;
	});
}

function metadataFromTurn(
	event: Extract<AttachedAgentEvent, { type: 'turn' }>,
	existing: UIMessage['metadata'],
): UIMessage['metadata'] {
	return {
		...existing,
		usage: event.response.usage ?? existing?.usage,
		model: {
			provider: event.request.providerId,
			id: event.response.responseModel ?? event.request.requestedModel,
		},
	};
}

function upsertAssistantMessage(
	messages: UIMessage[],
	event: AttachedAgentEvent,
	update: (message: UIMessage) => UIMessage,
): UIMessage[] {
	const id = messageId(event, 'assistant');
	const existing = messages.find((message) => message.id === id);
	const message = update(existing ?? { id, role: 'assistant', parts: [] });
	return upsertMessage(messages, message);
}

function removeAssistantAlias(messages: UIMessage[], event: AttachedAgentEvent, id: string): UIMessage[] {
	const alias = fallbackAssistantMessageId(event);
	if (alias === id) return messages;
	return messages.filter((message) => message.id !== alias);
}

function findLastPartIndex<TPart extends UIMessagePart>(
	parts: UIMessagePart[],
	predicate: (part: UIMessagePart) => part is TPart,
): number {
	for (let index = parts.length - 1; index >= 0; index--) {
		const part = parts[index];
		if (part && predicate(part)) return index;
	}
	return -1;
}

function findReasoningPartIndex(parts: UIMessagePart[], contentIndex: number): number {
	if (parts[contentIndex]?.type === 'reasoning') return contentIndex;

	let seen = 0;
	for (let index = 0; index < parts.length; index++) {
		if (parts[index]?.type !== 'reasoning') continue;
		if (seen === contentIndex) return index;
		seen++;
	}
	return -1;
}

function upsertMessage(messages: UIMessage[], message: UIMessage): UIMessage[] {
	const existingIndex = messages.findIndex((item) => item.id === message.id);
	if (existingIndex === -1) return [...messages, message];
	const next = messages.slice();
	next[existingIndex] = message;
	return next;
}

function messageId(event: AttachedAgentEvent, role: UIMessage['role']): string {
	if (role === 'assistant' && event.turnId) return `turn:${event.turnId}`;
	if (role === 'user' && event.submissionId) return userMessageId(event.submissionId);
	if (role === 'assistant' && (event.dispatchId || event.submissionId)) return fallbackAssistantMessageId(event);
	return `event:${event.timestamp}:${event.eventIndex}:${role}`;
}

function fallbackAssistantMessageId(event: AttachedAgentEvent): string {
	if (event.dispatchId || event.submissionId) {
		return [
			event.instanceId,
			event.dispatchId ?? '',
			event.submissionId ?? '',
			'assistant',
		].join(':');
	}
	return `event:${event.timestamp}:${event.eventIndex}:assistant`;
}

function userMessageId(submissionId: string): string {
	return `submission:${submissionId}:user:0`;
}

function imageUrl(data: string, mimeType: string): string {
	if (data === IMAGE_DATA_OMITTED || data.startsWith('data:')) return data;
	return `data:${mimeType};base64,${data}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
