import { modelInfoSchema, modelRoleInfoSchema } from "../components.js";
import {
  badRequest,
  bearerOrCookie,
  jsonResponse,
  jsonSchema,
  unauthorized,
} from "../helpers.js";

const ROLE_ENUM = [
  "chat",
  "memoryCompaction",
  "profileSummary",
  "siteBuilder",
  "visionHelper",
  "scheduledChat",
];

const roleAssignmentBody = {
  type: "object",
  additionalProperties: false,
  required: ["role", "modelId"],
  properties: {
    role: {
      type: "string",
      enum: ROLE_ENUM,
      description: "The background role to assign.",
    },
    modelId: {
      type: ["string", "null"],
      maxLength: 256,
      description:
        "A merged catalog model id — a global catalog model or one of your connection models — or null to clear the assignment and use the role's default.",
    },
  },
};

const roleAssignmentExample = {
  role: "siteBuilder",
  modelId: "my-openrouter/openai-gpt-5.6-luna",
};

const roleInfoExample = {
  role: "siteBuilder",
  modelId: "my-openrouter/openai-gpt-5.6-luna",
  defaultModelId: "meta/muse-spark-1.3-contributor",
};

const rolesExample = {
  roles: [
    { role: "chat", modelId: null, defaultModelId: null },
    { role: "memoryCompaction", modelId: null, defaultModelId: null },
    {
      role: "profileSummary",
      modelId: "openai/gpt-5.6-luna",
      defaultModelId: "openai/gpt-6-luna",
    },
    {
      role: "siteBuilder",
      modelId: null,
      defaultModelId: "meta/muse-spark-1.3-contributor",
    },
    { role: "visionHelper", modelId: null, defaultModelId: null },
    {
      role: "scheduledChat",
      modelId: null,
      defaultModelId: "openai/gpt-6-luna",
    },
  ],
};

export const modelsPaths = {
  "/api/models": {
    get: {
      operationId: "listModels",
      tags: ["Models"],
      summary: "List the model catalog",
      description:
        "Active chat and image models from the `chat_model` registry, plus the reasoning-effort catalog. Filter with `outputType=text` or `outputType=image`.",
      security: bearerOrCookie,
      parameters: [
        {
          name: "outputType",
          in: "query",
          schema: { type: "string", enum: ["text", "image"] },
          example: "text",
        },
      ],
      responses: {
        "200": jsonResponse(
          "Catalog.",
          {
            type: "object",
            required: ["models", "reasoningEfforts"],
            properties: {
              models: { type: "array", items: modelInfoSchema },
              reasoningEfforts: {
                type: "array",
                items: {
                  type: "object",
                  required: ["key", "label", "sortOrder"],
                  properties: {
                    key: { type: "string" },
                    label: { type: "string" },
                    description: { type: ["string", "null"] },
                    sortOrder: { type: "integer" },
                  },
                },
              },
            },
          },
          {
            default: {
              summary: "One chat model",
              value: {
                models: [
                  {
                    modelId: "openai/gpt-5.6-luna",
                    label: "Luna",
                    name: "GPT 5.6 Luna",
                    hint: "Default chat model",
                    description: "Balanced reasoning and speed.",
                    iconSvg: "<svg />",
                    provider: { slug: "openai", name: "OpenAI" },
                    contextWindowTokens: 200000,
                    maxInputTokens: null,
                    maxOutputTokens: null,
                    prices: {
                      input: 1.25,
                      cachedInput: 0.125,
                      output: 10,
                      cacheWriteMultiplier: null,
                      longPromptThresholdTokens: null,
                      longPromptInputMultiplier: null,
                      longPromptOutputMultiplier: null,
                    },
                    reasoningEfforts: ["low", "medium", "high"],
                    outputType: "text",
                    imageCapabilities: null,
                    inputModalities: ["text", "image"],
                    sortOrder: 10,
                  },
                ],
                reasoningEfforts: [
                  {
                    key: "low",
                    label: "Low",
                    description: "Faster, cheaper",
                    sortOrder: 1,
                  },
                  {
                    key: "medium",
                    label: "Medium",
                    description: null,
                    sortOrder: 2,
                  },
                  {
                    key: "high",
                    label: "High",
                    description: "Deeper reasoning",
                    sortOrder: 3,
                  },
                ],
              },
            },
          },
        ),
        "400": badRequest({ error: "outputType must be 'text' or 'image'" }),
        "401": unauthorized,
      },
    },
  },
  "/api/models/roles": {
    get: {
      operationId: "listModelRoleAssignments",
      tags: ["Models"],
      summary: "List per-role model assignments",
      description:
        "One entry per background role, in the order the settings UI presents them. `modelId` is the assignment you saved (a global catalog id or one of your connection model ids), or null when the role runs on its default; `defaultModelId` is the model it falls back to. Assignments are scoped to the signed-in user.",
      security: bearerOrCookie,
      responses: {
        "200": jsonResponse(
          "Role assignments.",
          {
            type: "object",
            required: ["roles"],
            properties: {
              roles: { type: "array", items: modelRoleInfoSchema },
            },
          },
          { default: { summary: "All six roles", value: rolesExample } },
        ),
        "401": unauthorized,
      },
    },
    put: {
      operationId: "setModelRoleAssignment",
      tags: ["Models"],
      summary: "Assign a model to a role",
      description:
        "Saves the model a background role should run on. `modelId` must resolve to a model you can use — a global catalog model or one of your connection models; anything else is rejected with a 400 and a field-level `issues` array. Send `modelId: null` to clear the assignment and fall back to the role's default. The `visionHelper` role only accepts models that take image input.",
      security: bearerOrCookie,
      requestBody: {
        required: true,
        content: jsonSchema(roleAssignmentBody, {
          assign: {
            summary: "Assign a connection model",
            value: roleAssignmentExample,
          },
          clear: {
            summary: "Clear the assignment",
            value: { role: "siteBuilder", modelId: null },
          },
        }),
      },
      responses: {
        "200": jsonResponse("The saved assignment.", modelRoleInfoSchema, {
          default: { summary: "Assigned", value: roleInfoExample },
        }),
        "400": jsonResponse(
          "The request is malformed, or the model is not assignable to the role.",
          {
            type: "object",
            required: ["error"],
            properties: {
              error: { type: "string" },
              issues: {
                type: "array",
                items: {
                  type: "object",
                  required: ["path", "message"],
                  properties: {
                    path: { type: "string" },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
          {
            roleError: {
              summary: "Unknown or non-assignable model",
              value: {
                error: "Unknown model: nobody/else",
                issues: [
                  { path: "modelId", message: "Unknown model: nobody/else" },
                ],
              },
            },
            malformedBody: {
              summary: "Malformed body",
              value: { error: "Invalid role assignment" },
            },
          },
        ),
        "401": unauthorized,
      },
    },
  },
};
