import {
  providerConnectionSchema,
  providerKindSchema,
  providerModelSchema,
} from "../components.js";
import {
  badRequest,
  bearerOrCookie,
  jsonResponse,
  jsonSchema,
  notFound,
  unauthorized,
} from "../helpers.js";

const connectionExample = {
  id: "clx0providerconn",
  kind: "compatible",
  label: "My OpenRouter",
  slug: "my-openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  api: "chat",
  isActive: true,
  sortOrder: 0,
  hasCredentials: true,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};

const modelExample = {
  id: "clx0providermodel",
  slug: "my-openrouter/openai-gpt-5.6-luna",
  upstreamId: "openai/gpt-5.6-luna",
  name: "GPT 5.6 Luna",
  label: "GPT 5.6 Luna",
  hint: null,
  description: null,
  iconSvg: "",
  outputType: "text",
  contextWindowTokens: 1_000_000,
  maxInputTokens: null,
  maxOutputTokens: 128_000,
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
  capabilities: { streaming: true, tools: true, imageInput: true },
  imageCapabilities: null,
  isActive: true,
  sortOrder: 0,
  connectionId: "clx0providerconn",
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};

const okResponse = jsonResponse(
  "Deleted.",
  {
    type: "object",
    required: ["ok"],
    properties: { ok: { type: "boolean" } },
  },
  { deleted: { summary: "Deleted", value: { ok: true } } },
);

const invalidConnection = badRequest({
  error: "Base URL must use https, except for localhost",
  code: "PROVIDER_INVALID",
});

const connectionNotFound = notFound({
  error: "Connection not found",
  code: "PROVIDER_NOT_FOUND",
});

const connectionBodyExample = {
  kind: "compatible",
  label: "My OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "sk-or-v1-...",
};

const modelBodyExample = {
  upstreamId: "openai/gpt-5.6-luna",
  name: "GPT 5.6 Luna",
  reasoningEfforts: ["low", "medium", "high"],
};

const connectionBody = {
  type: "object",
  required: ["kind", "label"],
  properties: {
    kind: {
      type: "string",
      enum: ["openai", "anthropic", "gemini", "grok", "mistral", "compatible"],
    },
    label: { type: "string", maxLength: 80 },
    slug: {
      type: "string",
      description: "Optional. Derived from the label when omitted.",
    },
    baseUrl: {
      type: ["string", "null"],
      description:
        "Required for the `compatible` kind. Must use https unless it is localhost.",
    },
    api: {
      type: ["string", "null"],
      enum: ["chat", "responses", null],
      description: "Only accepted for kinds that expose both API shapes.",
    },
    apiKey: {
      type: "string",
      description:
        "Write-only. Never returned by any endpoint. Omit on update to keep the stored key.",
    },
    headers: {
      type: ["object", "null"],
      additionalProperties: { type: "string" },
      description:
        "Optional gateway headers. `authorization` is rejected: use apiKey.",
    },
  },
};

const modelBody = {
  type: "object",
  properties: {
    upstreamId: {
      type: "string",
      description:
        "The exact model id sent to the provider, e.g. `openai/gpt-5.6-luna`.",
    },
    name: { type: "string" },
    label: { type: "string" },
    hint: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    iconSvg: { type: "string" },
    outputType: { type: "string", enum: ["text", "image"] },
    contextWindowTokens: { type: ["integer", "null"] },
    maxInputTokens: { type: ["integer", "null"] },
    maxOutputTokens: { type: ["integer", "null"] },
    reasoningEfforts: {
      type: "array",
      items: { type: "string" },
      description:
        "Reasoning efforts this model accepts. Empty means the model has no reasoning control.",
    },
  },
};


export const providersPaths = {
  "/api/providers/kinds": {
    get: {
      operationId: "listProviderKinds",
      tags: ["Providers"],
      summary: "List supported provider kinds",
      description:
        "Server-owned descriptor for every provider kind: whether it takes a base URL, which API shapes it accepts, and which image endpoint it speaks. The reasoning-effort vocabulary is the union of every installed adapter's declared values.",
      security: bearerOrCookie,
      responses: {
        "200": jsonResponse(
          "Provider kinds and the effort vocabulary.",
          {
            type: "object",
            required: ["kinds", "effortVocabulary"],
            properties: {
              kinds: { type: "array", items: providerKindSchema },
              effortVocabulary: { type: "array", items: { type: "string" } },
            },
          },
          {
            default: {
              summary: "Two kinds",
              value: {
                kinds: [
                  {
                    kind: "compatible",
                    label: "OpenAI-compatible",
                    credentialPlaceholder: "sk-...",
                    supportsBaseUrl: true,
                    requiresBaseUrl: true,
                    apiVariants: ["chat", "responses"],
                    defaultApi: "chat",
                    imageStyle: "openrouter-images",
                  },
                  {
                    kind: "anthropic",
                    label: "Anthropic",
                    credentialPlaceholder: "sk-ant-...",
                    supportsBaseUrl: true,
                    requiresBaseUrl: false,
                    apiVariants: [],
                    defaultApi: null,
                    imageStyle: "none",
                  },
                ],
                effortVocabulary: [
                  "none",
                  "minimal",
                  "low",
                  "medium",
                  "high",
                  "xhigh",
                  "max",
                ],
              },
            },
          },
        ),
        "401": unauthorized,
      },
    },
  },
  "/api/providers": {
    get: {
      operationId: "listProviderConnections",
      tags: ["Providers"],
      summary: "List your provider connections",
      description:
        "Credentials are never returned. A connection reports `hasCredentials` instead.",
      security: bearerOrCookie,
      responses: {
        "200": jsonResponse(
          "Connections.",
          { type: "array", items: providerConnectionSchema },
          { default: { summary: "One connection", value: [connectionExample] } },
        ),
        "401": unauthorized,
      },
    },
    post: {
      operationId: "createProviderConnection",
      tags: ["Providers"],
      summary: "Add a provider connection",
      description:
        "The API key is validated against the provider's model list before it is stored, then encrypted at rest. At most 10 connections per user.",
      security: bearerOrCookie,
      requestBody: {
        required: true,
        content: jsonSchema(connectionBody, {
          default: { summary: "New connection", value: connectionBodyExample },
        }),
      },
      responses: {
        "201": jsonResponse(
          "Created.",
          providerConnectionSchema,
          { default: { summary: "Created connection", value: connectionExample } },
        ),
        "400": invalidConnection,
        "401": unauthorized,
      },
    },
  },
  "/api/providers/{id}": {
    get: {
      operationId: "getProviderConnection",
      tags: ["Providers"],
      summary: "Get one provider connection",
      description: "Returns the connection without any credential material.",
      security: bearerOrCookie,
      responses: {
        "200": jsonResponse(
          "Connection.",
          providerConnectionSchema,
          { default: { summary: "Connection", value: connectionExample } },
        ),
        "401": unauthorized,
        "404": connectionNotFound,
      },
    },
    patch: {
      operationId: "updateProviderConnection",
      tags: ["Providers"],
      summary: "Update a provider connection",
      description:
        "Omit `apiKey` (or send it blank) to keep the stored credential — the key is never returned, so the browser cannot resend it.",
      security: bearerOrCookie,
      requestBody: {
        required: true,
        content: jsonSchema(connectionBody, {
          default: { summary: "Edited connection", value: connectionBodyExample },
        }),
      },
      responses: {
        "200": jsonResponse(
          "Updated.",
          providerConnectionSchema,
          { default: { summary: "Updated connection", value: connectionExample } },
        ),
        "400": invalidConnection,
        "401": unauthorized,
        "404": connectionNotFound,
      },
    },
    delete: {
      operationId: "deleteProviderConnection",
      tags: ["Providers"],
      summary: "Delete a provider connection",
      description:
        "Cascades to its registered models. A queued run that referenced this connection fails with a readable error instead of silently changing models.",
      security: bearerOrCookie,
      responses: {
        "200": okResponse,
        "401": unauthorized,
        "404": connectionNotFound,
      },
    },
  },
  "/api/providers/{id}/models": {
    get: {
      operationId: "listProviderModels",
      tags: ["Providers"],
      summary: "List models registered on a connection",
      description: "Scoped to the caller; includes inactive models.",
      security: bearerOrCookie,
      responses: {
        "200": jsonResponse(
          "Models.",
          { type: "array", items: providerModelSchema },
          { default: { summary: "One model", value: [modelExample] } },
        ),
        "401": unauthorized,
        "404": connectionNotFound,
      },
    },
    post: {
      operationId: "createProviderModel",
      tags: ["Providers"],
      summary: "Register a model on a connection",
      description:
        "The model id is derived as `<connection-slug>/<sanitized upstream id>`, suffixed with `-2`, `-3`, … until it is unique for you and does not collide with the global catalog. At most 100 models per user.",
      security: bearerOrCookie,
      requestBody: {
        required: true,
        content: jsonSchema(
          { ...modelBody, required: ["upstreamId"] },
          { default: { summary: "New model", value: modelBodyExample } },
        ),
      },
      responses: {
        "201": jsonResponse(
          "Created.",
          providerModelSchema,
          { default: { summary: "Registered model", value: modelExample } },
        ),
        "400": invalidConnection,
        "401": unauthorized,
        "404": connectionNotFound,
      },
    },
  },
  "/api/providers/{id}/models/discover": {
    post: {
      operationId: "discoverProviderModels",
      tags: ["Providers"],
      summary: "List the provider's model inventory",
      description:
        "Calls the provider's model-listing endpoint with the stored credential. Inventory only: a listed id does not prove that it supports tools, media, reasoning, or a given context size.",
      security: bearerOrCookie,
      responses: {
        "200": jsonResponse(
          "Inventory.",
          {
            type: "object",
            required: ["data"],
            properties: {
              data: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id"],
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    description: { type: "string" },
                    type: { type: "string" },
                    createdAt: { type: "integer" },
                    ownedBy: { type: "string" },
                    contextLength: { type: "integer" },
                  },
                },
              },
            },
          },
          {
            default: {
              summary: "Two models",
              value: {
                data: [
                  {
                    id: "openai/gpt-5.6-luna",
                    name: "GPT 5.6 Luna",
                    contextLength: 1000000,
                  },
                  { id: "openai/gpt-5-nano", name: "GPT 5 Nano" },
                ],
              },
            },
          },
        ),
        "400": invalidConnection,
        "401": unauthorized,
        "404": connectionNotFound,
      },
    },
  },
  "/api/providers/{id}/models/prefill": {
    post: {
      operationId: "prefillProviderModel",
      tags: ["Providers"],
      summary: "Read a model's declared metadata before registering it",
      description:
        "Builds the model handle server-side and returns the adapter's own declaration: display name, context window, capabilities, and the reasoning efforts it accepts. `providerReported: false` means the adapter has no limits entry, so the context window must be supplied by the caller.",
      security: bearerOrCookie,
      requestBody: {
        required: true,
        content: jsonSchema(
          {
            type: "object",
            required: ["upstreamId"],
            properties: {
              upstreamId: { type: "string" },
              reasoningEfforts: {
                type: ["array", "null"],
                items: { type: "string" },
              },
            },
          },
          {
            default: {
              summary: "Prefill one model",
              value: { upstreamId: "openai/gpt-5.6-luna" },
            },
          },
        ),
      },
      responses: {
        "200": jsonResponse(
          "Prefill.",
          {
            type: "object",
            required: ["name", "reasoningEfforts", "providerReported"],
            properties: {
              name: { type: "string" },
              contextWindowTokens: { type: ["integer", "null"] },
              maxInputTokens: { type: ["integer", "null"] },
              maxOutputTokens: { type: ["integer", "null"] },
              reasoningEfforts: { type: "array", items: { type: "string" } },
              defaultReasoningEffort: { type: ["string", "null"] },
              capabilities: { type: ["object", "null"] },
              providerReported: { type: "boolean" },
            },
          },
          {
            default: {
              summary: "Known model",
              value: {
                name: "gpt-5.6-luna",
                contextWindowTokens: 1000000,
                maxInputTokens: null,
                maxOutputTokens: 128000,
                reasoningEfforts: [
                  "none",
                  "low",
                  "medium",
                  "high",
                  "xhigh",
                  "max",
                ],
                defaultReasoningEffort: "medium",
                capabilities: { streaming: true, tools: true },
                providerReported: true,
              },
            },
          },
        ),
        "400": invalidConnection,
        "401": unauthorized,
        "404": connectionNotFound,
      },
    },
  },
  "/api/providers/{id}/models/{modelId}": {
    patch: {
      operationId: "updateProviderModel",
      tags: ["Providers"],
      summary: "Update a registered model",
      description:
        "Changing `upstreamId` re-derives the model id; every other edit keeps it so existing references stay valid.",
      security: bearerOrCookie,
      requestBody: {
        required: true,
        content: jsonSchema(modelBody, {
          default: { summary: "Edited model", value: modelBodyExample },
        }),
      },
      responses: {
        "200": jsonResponse(
          "Updated.",
          providerModelSchema,
          { default: { summary: "Updated model", value: modelExample } },
        ),
        "400": invalidConnection,
        "401": unauthorized,
        "404": connectionNotFound,
      },
    },
    delete: {
      operationId: "deleteProviderModel",
      tags: ["Providers"],
      summary: "Delete a registered model",
      description: "Removes the model from the catalog for its owner.",
      security: bearerOrCookie,
      responses: {
        "200": okResponse,
        "401": unauthorized,
        "404": connectionNotFound,
      },
    },
  },
};
