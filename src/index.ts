/*
 * Portions derived from @flue/react in withastro/flue.
 * Licensed under Apache License 2.0.
 * Modifications Copyright 2026 Nuno Mendes.
 */

export { createFluePlugin, FlueProvider, flueClientKey, provideFlueClient, useFlueClient } from './provider.js';
export { useFlueAgent } from './use-agent.js';
export { useFlueWorkflow } from './use-workflow.js';
export type {
	AgentHistory,
	AgentSnapshot,
	AgentStatus,
	CreateFluePluginOptions,
	SendMessageOptions,
	UIMessage,
	UIMessagePart,
	UseFlueAgentOptions,
	UseFlueAgentReturn,
	UseFlueWorkflowOptions,
	UseFlueWorkflowReturn,
	WorkflowSnapshot,
	WorkflowStatus,
} from './types.js';
export type { AgentPromptImage, AttachedAgentEvent, FlueEvent, PromptUsage } from '@flue/sdk';
