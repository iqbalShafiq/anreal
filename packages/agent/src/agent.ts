import {
  Agent,
  type AnyTool,
  type CompletionModel,
  type GuardrailPolicyInput,
  type JsonObject,
  type MemoryOptions,
  type MemoryStore,
} from "@anvia/core";
import { REASONING_EFFORT_CONTROL_ID } from "@anvia/core/completion";
import type { AgentMiddleware } from "@anvia/core/tool";
import type { AgentObservabilityOptions } from "@anvia/core/observability";
import type { AgentContextInput as NativeAgentContextInput } from "@anvia/core/agent";
import type { McpServer } from "@anvia/core/mcp";
import type { SkillSet } from "@anvia/core/skills";
import {
  DEFAULT_REASONING_EFFORT,
  defaultModel,
  type ReasoningEffort,
} from "./providers/openai.js";
import { BASE_INSTRUCTIONS } from "./prompts/base-instructions.js";

export const DEFAULT_AGENT_MAX_TURNS = 20;

export type AgentContextBlock = {
  text: string;
  id?: string;
};
export type AgentContextInput = NativeAgentContextInput;

/**
 * Declarative memory policy passed to Anvia v1. The store and every native
 * compaction option stay process-local; only the policy values are resolved
 * by the caller and may be reconstructed from a durable run recipe.
 */
export type CreateAgentMemoryOptions = MemoryOptions & {
  store: MemoryStore;
};

export interface CreateAgentOptions {
  agentId: string;
  model?: CompletionModel;
  reasoningEffort?: ReasoningEffort;
  /** Provider-specific request fields without a normalized Anvia option. */
  providerOptions?: JsonObject;
  maxTurns?: number;
  additionalTools?: AnyTool[];
  additionalInstructions?: string[];
  additionalContext?: AgentContextBlock[];
  context?: readonly AgentContextInput[];
  observability?: AgentObservabilityOptions;
  guardrails?: GuardrailPolicyInput;
  memory?: MemoryStore | CreateAgentMemoryOptions;
  mcpServers?: McpServer[];
  skills?: SkillSet;
  middlewares?: readonly AgentMiddleware[];
}

export function createAgent(opts: CreateAgentOptions): Agent {
  const instructions = [
    BASE_INSTRUCTIONS,
    ...(opts.additionalInstructions ?? []),
  ]
    .map((instruction) => instruction.trim())
    .filter(Boolean)
    .join("\n\n");
  const convenienceContext = (opts.additionalContext ?? []).flatMap((block, index) => {
    const text = block.text.trim();
    if (!text) return [];
    return [
      {
        id: block.id?.trim() || `context-${index}`,
        text,
      },
    ];
  });

  const memory = opts.memory === undefined
    ? undefined
    : isMemoryOptions(opts.memory)
      ? opts.memory
      : { store: opts.memory, savePolicy: "turn" as const };

  const model = opts.model ?? defaultModel();
  // Anvia models declare the reasoning values they accept. Send an effort only
  // when the model actually exposes the control: the runtime rejects a control
  // the model does not declare (assertCompletionControlsSupported), so a model
  // registered without reasoning efforts must not be sent a default.
  const reasoningControl = model.controls?.[REASONING_EFFORT_CONTROL_ID];
  const requestedEffort = opts.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  const controls =
    reasoningControl && reasoningControl.options.length > 0
      ? {
          [REASONING_EFFORT_CONTROL_ID]: reasoningControl.options.includes(
            requestedEffort,
          )
            ? requestedEffort
            : (reasoningControl.defaultValue ??
              reasoningControl.options[0]),
        }
      : undefined;

  return new Agent({
    id: opts.agentId,
    model,
    instructions,
    context: [...(opts.context ?? []), ...convenienceContext],
    tools: [...(opts.additionalTools ?? [])],
    ...(controls ? { controls } : {}),
    ...(opts.providerOptions ? { providerOptions: opts.providerOptions } : {}),
    maxTurns: opts.maxTurns ?? DEFAULT_AGENT_MAX_TURNS,
    ...(memory ? { memory } : {}),
    ...(opts.mcpServers?.length ? { mcpServers: [...opts.mcpServers] } : {}),
    ...(opts.skills ? { skills: opts.skills } : {}),
    ...(opts.observability ? { observability: opts.observability } : {}),
    ...(opts.guardrails !== undefined ? { guardrails: opts.guardrails } : {}),
    ...(opts.middlewares?.length ? { middlewares: [...opts.middlewares] } : {}),
  });
}

function isMemoryOptions(
  value: MemoryStore | CreateAgentMemoryOptions,
): value is CreateAgentMemoryOptions {
  return typeof value === "object" && value !== null && "store" in value;
}
