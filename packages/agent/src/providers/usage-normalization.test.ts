import {
  CompletionProviderOutputError,
  type CompletionModelStreamEvent,
  type CompletionRequest,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import { OpenAIClient } from "@anvia/openai";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";

import {
  normalizeFetch,
  normalizeOpenAIUsageChunks,
} from "./usage-normalization.js";

const GATEWAY_USAGE = {
  prompt_tokens: 42,
  completion_tokens: 7,
  total_tokens: 49,
};

function dataLine(chunk: unknown): string {
  return `data: ${JSON.stringify(chunk)}`;
}

/**
 * The captured shape from the OpenCode Go gateway: usage on the content chunk
 * (finish_reason still null), usage on the stop chunk, then the spec-shaped
 * usage chunk with an empty choices array.
 */
const CONTENT_CHUNK = dataLine({
  id: "gen-gateway-1",
  object: "chat.completion.chunk",
  model: "deepseek-v4",
  choices: [
    {
      index: 0,
      delta: { role: "assistant", content: "The answer." },
      finish_reason: null,
    },
  ],
  usage: GATEWAY_USAGE,
});

const STOP_CHUNK = dataLine({
  id: "gen-gateway-1",
  object: "chat.completion.chunk",
  model: "deepseek-v4",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  usage: GATEWAY_USAGE,
});

const FINAL_USAGE_CHUNK = dataLine({
  id: "gen-gateway-1",
  object: "chat.completion.chunk",
  model: "deepseek-v4",
  choices: [],
  usage: GATEWAY_USAGE,
});

const GATEWAY_BODY = [
  CONTENT_CHUNK,
  "",
  STOP_CHUNK,
  "",
  FINAL_USAGE_CHUNK,
  "",
  "data: [DONE]",
  "",
].join("\n");

function parseChunks(body: string): Array<{ choices: unknown[]; usage?: unknown }> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((payload) => payload !== "[DONE]")
    .map((payload) => JSON.parse(payload) as { choices: unknown[]; usage?: unknown });
}

describe("normalizeOpenAIUsageChunks", () => {
  it("strips usage from a chunk with a non-empty choices array", () => {
    const output = normalizeOpenAIUsageChunks([
      CONTENT_CHUNK,
      "",
      FINAL_USAGE_CHUNK,
      "",
      "data: [DONE]",
    ]);

    const stripped = JSON.parse(output[0]!.slice("data: ".length)) as Record<
      string,
      unknown
    >;
    expect(stripped).not.toHaveProperty("usage");
    expect(stripped.choices).toHaveLength(1);
  });

  it("keeps usage on a chunk with an empty choices array", () => {
    const output = normalizeOpenAIUsageChunks([
      CONTENT_CHUNK,
      "",
      FINAL_USAGE_CHUNK,
      "",
      "data: [DONE]",
    ]);

    expect(output[2]).toBe(FINAL_USAGE_CHUNK);
  });

  it("emits one synthetic usage chunk before [DONE] when none was forwarded", () => {
    const output = normalizeOpenAIUsageChunks([
      CONTENT_CHUNK,
      "",
      STOP_CHUNK,
      "",
      "data: [DONE]",
    ]);

    expect(output).toEqual([
      expect.any(String),
      "",
      expect.any(String),
      "",
      'data: {"choices":[],"usage":{"prompt_tokens":42,"completion_tokens":7,"total_tokens":49}}',
      "",
      "data: [DONE]",
    ]);
    const synthetic = JSON.parse(
      output[4]!.slice("data: ".length),
    ) as { choices: unknown[]; usage: unknown };
    expect(synthetic.choices).toEqual([]);
    expect(synthetic.usage).toEqual(GATEWAY_USAGE);
  });

  it("remembers the last stripped usage for the synthetic chunk", () => {
    const first = dataLine({
      choices: [{ delta: { content: "a" }, finish_reason: null }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const second = dataLine({
      choices: [{ delta: { content: "b" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 },
    });

    const output = normalizeOpenAIUsageChunks([
      first,
      "",
      second,
      "",
      "data: [DONE]",
    ]);

    expect(output.find((line) => line.startsWith('data: {"choices":[]'))).toContain(
      '"total_tokens":6',
    );
  });

  it("passes a conformant stream through byte-identical", () => {
    const conformant = [
      dataLine({
        choices: [
          { delta: { content: "hello" }, finish_reason: null },
        ],
      }),
      "",
      FINAL_USAGE_CHUNK,
      "",
      "data: [DONE]",
      "",
    ];

    const output = normalizeOpenAIUsageChunks(conformant);

    expect(output).toEqual(conformant);
    expect(output.join("\n")).toBe(conformant.join("\n"));
  });

  it("survives non-data lines, comments, and [DONE]", () => {
    const input = [
      ": keep-alive",
      "event: message",
      "",
      CONTENT_CHUNK,
      "",
      "data: [DONE]",
    ];

    const output = normalizeOpenAIUsageChunks(input);

    expect(output.slice(0, 3)).toEqual([": keep-alive", "event: message", ""]);
    expect(output).toContain("data: [DONE]");
    const content = JSON.parse(output[3]!.slice("data: ".length)) as Record<
      string,
      unknown
    >;
    expect(content).not.toHaveProperty("usage");
  });

  it("leaves malformed and usage-free data lines untouched", () => {
    const malformed = "data: {not json";
    const usageFree = dataLine({
      choices: [{ delta: { content: "x" }, finish_reason: null }],
    });

    expect(normalizeOpenAIUsageChunks([malformed, usageFree])).toEqual([
      malformed,
      usageFree,
    ]);
  });

  it("preserves a CRLF terminator on a rewritten line", () => {
    const output = normalizeOpenAIUsageChunks([
      `${CONTENT_CHUNK}\r`,
      "",
      "data: [DONE]\r",
      "",
    ]);

    expect(output[0]!.endsWith("\r")).toBe(true);
    expect(output[0]).not.toContain('"usage"');
  });

  it("separates the synthetic chunk from a preceding event with no blank line", () => {
    const output = normalizeOpenAIUsageChunks([CONTENT_CHUNK, "data: [DONE]"]);

    expect(output).toEqual([
      expect.any(String),
      "",
      expect.stringContaining('"choices":[]'),
      "",
      "data: [DONE]",
    ]);
  });

  it("emits a self-terminating synthetic event when the stream has no [DONE]", () => {
    const output = normalizeOpenAIUsageChunks([CONTENT_CHUNK]);

    expect(output).toEqual([
      expect.any(String),
      "",
      expect.stringContaining('"choices":[]'),
      "",
    ]);
  });
});

function sseResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("normalizeFetch", () => {
  it("rewrites an SSE response body before the adapter sees it", async () => {
    const wrapped = normalizeFetch(async () => sseResponse(GATEWAY_BODY));

    const body = await (
      await wrapped("https://gw.example/v1/chat/completions")
    ).text();
    const chunks = parseChunks(body);

    expect(chunks.filter((chunk) => "usage" in chunk)).toHaveLength(1);
    expect(chunks.find((chunk) => "usage" in chunk)?.choices).toEqual([]);
    expect(chunks[0]).not.toHaveProperty("usage");
    expect(body).toContain("data: [DONE]");
  });

  it("returns a non-SSE response untouched", async () => {
    const original = new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
    });
    const wrapped = normalizeFetch(async () => original);

    await expect(wrapped("https://gw.example/v1/models")).resolves.toBe(
      original,
    );
  });

  it("returns a body-less response untouched", async () => {
    const original = new Response(null, { status: 204 });
    const wrapped = normalizeFetch(async () => original);

    await expect(wrapped("https://gw.example/v1/models")).resolves.toBe(
      original,
    );
  });

  it("normalizes a streaming request even when the gateway omits the SSE content type", async () => {
    const wrapped = normalizeFetch(
      async () =>
        new Response(GATEWAY_BODY, {
          headers: { "content-type": "application/json" },
        }),
    );

    const body = await (
      await wrapped("https://gw.example/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "deepseek-v4", stream: true }),
      })
    ).text();

    expect(parseChunks(body).filter((chunk) => "usage" in chunk)).toHaveLength(
      1,
    );
  });

  it("forwards lines as they arrive instead of buffering the body", async () => {
    const encoder = new TextEncoder();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${CONTENT_CHUNK}\n\n`));
      },
      async pull(controller) {
        await gate;
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const wrapped = normalizeFetch(
      async () =>
        new Response(upstream, {
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const response = await wrapped("https://gw.example/v1/chat/completions");
    const reader = response.body!.getReader();
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("response buffered")), 2_000),
      ),
    ]);
    expect(new TextDecoder().decode(first.value)).toContain(
      '"content":"The answer."',
    );

    release();
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toContain("data: [DONE]");
  });

  it("matches the pure rewrite byte-for-byte, including a missing blank line before [DONE]", async () => {
    const body = `${CONTENT_CHUNK}\ndata: [DONE]`;
    const wrapped = normalizeFetch(async () => sseResponse(body));

    const text = await (
      await wrapped("https://gw.example/v1/chat/completions")
    ).text();

    expect(text).toBe(
      normalizeOpenAIUsageChunks(body.split("\n")).join("\n"),
    );
    expect(text).toContain("data: [DONE]");
  });
});

const REQUEST: CompletionRequest = {
  chatHistory: [{ role: "user", content: "hello" }],
  documents: [],
  tools: [],
};

function gatewayModel(fetchImpl: typeof fetch): StreamingCompletionModel {
  const client = new OpenAI({
    apiKey: "sk-test",
    baseURL: "https://gateway.example/v1",
    fetch: fetchImpl,
  });
  return new OpenAIClient({ client }).completionModel({
    modelId: "deepseek-v4",
    api: "chat",
  });
}

async function collectUntilFailure(model: StreamingCompletionModel): Promise<{
  events: CompletionModelStreamEvent[];
  error: unknown;
}> {
  const events: CompletionModelStreamEvent[] = [];
  try {
    for await (const event of model.streamCompletion(REQUEST)) {
      events.push(event);
    }
    return { events, error: null };
  } catch (error) {
    return { events, error };
  }
}

describe("OpenAI chat-completions adapter against the gateway stream", () => {
  it("reproduces the failure without normalization: the second usage chunk is rejected", async () => {
    const { events, error } = await collectUntilFailure(
      gatewayModel(async () => sseResponse(GATEWAY_BODY)),
    );

    // The answer streams, then the adapter rejects the duplicate final event.
    expect(
      events
        .filter((event) => event.type === "text_delta")
        .map((event) => (event.type === "text_delta" ? event.delta : ""))
        .join(""),
    ).toBe("The answer.");
    expect(error).toBeInstanceOf(CompletionProviderOutputError);
    expect((error as Error).message).toMatch(/invalid tool call/i);
  });

  it("completes the same stream through the normalizing fetch", async () => {
    const { events, error } = await collectUntilFailure(
      gatewayModel(normalizeFetch(async () => sseResponse(GATEWAY_BODY))),
    );

    expect(error).toBeNull();
    expect(
      events
        .filter((event) => event.type === "text_delta")
        .map((event) => (event.type === "text_delta" ? event.delta : ""))
        .join(""),
    ).toBe("The answer.");
    const final = events.find((event) => event.type === "final");
    expect(final?.type).toBe("final");
    if (final?.type !== "final") throw new Error("expected a final event");
    expect(final.response.usage).toMatchObject({
      inputTokens: 42,
      outputTokens: 7,
      totalTokens: 49,
    });
    expect(final.response.finishReason).toBe("stop");
  });

  it("synthesizes usage when the gateway sends no empty-choices usage chunk", async () => {
    const bodyWithoutFinalUsage = [
      CONTENT_CHUNK,
      "",
      STOP_CHUNK,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const { events, error } = await collectUntilFailure(
      gatewayModel(
        normalizeFetch(async () => sseResponse(bodyWithoutFinalUsage)),
      ),
    );

    expect(error).toBeNull();
    const final = events.find((event) => event.type === "final");
    if (final?.type !== "final") throw new Error("expected a final event");
    expect(final.response.usage).toMatchObject({
      inputTokens: 42,
      outputTokens: 7,
      totalTokens: 49,
    });
  });
});
