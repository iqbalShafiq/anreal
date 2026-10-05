/**
 * Stream normalization for OpenAI-shaped gateways that are not OpenAI-shaped
 * enough.
 *
 * The OpenCode Go gateway (`https://opencode.ai/zen/go/v1`) attaches a `usage`
 * object to **every** SSE chunk of a chat-completions stream, with and without
 * `stream_options.include_usage`. The OpenAI spec puts usage on a single final
 * chunk whose `choices` array is empty. `@anvia/openai` maps every
 * usage-bearing chunk to a `final` event and rejects a second one as
 * `CompletionProviderOutputError: Completion provider returned an invalid tool
 * call.` — tools are irrelevant, the name is misleading — so a run against
 * that gateway always fails after the answer has already streamed.
 *
 * This module rewrites the SSE lines before the adapter sees them:
 *
 * 1. `usage` is stripped from any chunk with a non-empty `choices` array; the
 *    last stripped usage is remembered.
 * 2. `usage` is kept on chunks whose `choices` array is empty — the
 *    spec-shaped final usage chunk.
 * 3. If the stream ends without having forwarded any usage, one synthetic
 *    `{"choices":[],"usage":<remembered>}` chunk is emitted before `[DONE]`
 *    so cost accounting never silently loses usage.
 * 4. Every other byte passes through unchanged, including `[DONE]` and
 *    non-`data:` lines.
 *
 * Do not delete this as redundant: it exists only because of the gateway
 * non-conformance above. A conformant provider (OpenRouter, OpenAI itself)
 * passes through byte-identical.
 */

type UsageNormalizationState = {
  /** Serialized `usage` of the last stripped non-empty-`choices` chunk. */
  pendingUsage: string | null;
  /** Whether a usage-bearing chunk with an empty `choices` array was seen. */
  usageForwarded: boolean;
};

type SseDataLine = {
  /** The original `data:` field name and separator, e.g. `"data: "`. */
  prefix: string;
  /** The field value with the SSE leading space removed. */
  payload: string;
  /** The line terminator carried over from the original line, `"\r"` or `""`. */
  terminator: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse one SSE line as a `data:` field, preserving the exact prefix and any
 * trailing `\r` so unmodified lines round-trip byte-for-byte. Returns null for
 * every other line (comments, `event:`, blank separators, the final unterminated
 * line of a body, ...).
 */
function parseSseDataLine(line: string): SseDataLine | null {
  const terminator = line.endsWith("\r") ? "\r" : "";
  const body = terminator === "" ? line : line.slice(0, -1);
  const colon = body.indexOf(":");
  if (colon === -1 || body.slice(0, colon) !== "data") {
    return null;
  }
  const afterColon = body.slice(colon + 1);
  const hasLeadingSpace = afterColon.startsWith(" ");
  return {
    prefix: `${body.slice(0, colon + 1)}${hasLeadingSpace ? " " : ""}`,
    payload: hasLeadingSpace ? afterColon.slice(1) : afterColon,
    terminator,
  };
}

function isDoneLine(line: string): boolean {
  const data = parseSseDataLine(line);
  return data !== null && data.payload.trim() === "[DONE]";
}

/**
 * Apply rules 1 and 2 to a single line. Non-`data:` lines, unparsable payloads
 * and payloads without a plain-object `usage` pass through untouched.
 */
function normalizeUsageLine(
  line: string,
  state: UsageNormalizationState,
): string {
  const data = parseSseDataLine(line);
  if (data === null) {
    return line;
  }
  const payload = data.payload.trim();
  if (payload === "" || payload === "[DONE]") {
    return line;
  }
  let chunk: unknown;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return line;
  }
  if (!isPlainObject(chunk) || !isPlainObject(chunk.usage)) {
    return line;
  }
  const choices = chunk.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    state.pendingUsage = JSON.stringify(chunk.usage);
    const withoutUsage = { ...chunk };
    delete withoutUsage.usage;
    return `${data.prefix}${JSON.stringify(withoutUsage)}${data.terminator}`;
  }
  state.usageForwarded = true;
  return line;
}

/** Rule 3: the synthetic final usage chunk, or null when none is needed. */
function syntheticUsageLine(state: UsageNormalizationState): string | null {
  if (state.pendingUsage === null || state.usageForwarded) {
    return null;
  }
  return `data: {"choices":[],"usage":${state.pendingUsage}}`;
}

/**
 * Pure rewrite over the lines of an SSE body. Each entry is one line without
 * its `\n` terminator (a trailing `\r` stays attached), so
 * `normalizeOpenAIUsageChunks(text.split("\n")).join("\n")` is byte-identical
 * for a conformant stream.
 */
export function normalizeOpenAIUsageChunks(lines: string[]): string[] {
  const state: UsageNormalizationState = {
    pendingUsage: null,
    usageForwarded: false,
  };
  const normalized = lines.map((line) => normalizeUsageLine(line, state));
  const synthetic = syntheticUsageLine(state);
  if (synthetic === null) {
    return normalized;
  }
  const doneIndex = normalized.findIndex(isDoneLine);
  if (doneIndex === -1) {
    // A blank line terminates the synthetic event even when the source stream
    // ended without a trailing blank line.
    const separator = normalized.at(-1) === "" ? [] : [""];
    return [...normalized, ...separator, synthetic, ""];
  }
  const before = normalized.slice(0, doneIndex);
  // A blank line terminates the preceding event and the synthetic event.
  const separator = before.at(-1) === "" ? [] : [""];
  return [
    ...before,
    ...separator,
    synthetic,
    "",
    ...normalized.slice(doneIndex),
  ];
}

/**
 * Streaming form of the same rewrite: lines are forwarded as they arrive
 * (never buffering the body). `[DONE]` passes straight through unless a
 * synthetic usage chunk is still pending, in which case the sentinel is held
 * just long enough for the synthetic chunk to precede it.
 */
function usageNormalizationTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state: UsageNormalizationState = {
    pendingUsage: null,
    usageForwarded: false,
  };
  let buffer = "";
  let doneLine: string | null = null;
  let doneLineTerminated = false;
  // Set when `[DONE]` passed straight through because no synthetic usage
  // chunk was pending. Flush must then not append one after the sentinel.
  let sentinelPassed = false;
  // The last line emitted and whether it carried its `\n`; needed to terminate
  // the final event before the synthetic one.
  let lastLine: string | null = null;
  let lastLineTerminated = false;

  const writeLine = (
    controller: TransformStreamDefaultController<Uint8Array>,
    line: string,
    terminated: boolean,
  ): void => {
    if (isDoneLine(line)) {
      // The SDK stops reading at `[DONE]`. Hold the sentinel only while a
      // synthetic usage chunk may still need to precede it; otherwise pass
      // it straight through so the run does not wait for the upstream body
      // to close.
      if (syntheticUsageLine(state) !== null) {
        doneLine = line;
        doneLineTerminated = terminated;
        return;
      }
      sentinelPassed = true;
      controller.enqueue(encoder.encode(terminated ? `${line}\n` : line));
      return;
    }
    const normalized = normalizeUsageLine(line, state);
    controller.enqueue(
      encoder.encode(terminated ? `${normalized}\n` : normalized),
    );
    lastLine = normalized;
    lastLineTerminated = terminated;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        writeLine(controller, buffer.slice(0, newline), true);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        writeLine(controller, buffer, false);
      }
      if (sentinelPassed) {
        return;
      }
      const synthetic = syntheticUsageLine(state);
      if (synthetic !== null) {
        // Terminate the preceding event with a blank line so the synthetic
        // chunk is parsed as its own SSE event.
        if (lastLine !== null) {
          if (!lastLineTerminated) {
            controller.enqueue(encoder.encode("\n"));
          }
          if (lastLine !== "") {
            controller.enqueue(encoder.encode("\n"));
          }
        }
        controller.enqueue(encoder.encode(`${synthetic}\n\n`));
      }
      if (doneLine !== null) {
        controller.enqueue(
          encoder.encode(doneLineTerminated ? `${doneLine}\n` : doneLine),
        );
      }
    },
  });
}

/**
 * Wrap a `fetch` so every streaming response body is normalized before the
 * OpenAI SDK parses it. The trigger is the request (`"stream":true`) or an SSE
 * content type: the SDK parses SSE bodies regardless of that header, so a
 * gateway that omits it must still be normalized. Non-streaming and body-less
 * responses pass through as the original `Response` object.
 * `content-length`/`content-encoding` are dropped from a rewritten response
 * because the body length and bytes changed.
 */
export function normalizeFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (
      response.body === null ||
      !(isEventStreamResponse(response) || isStreamingRequest(init))
    ) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    const body = response.body.pipeThrough(usageNormalizationTransform());
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function isEventStreamResponse(response: Response): boolean {
  return (response.headers.get("content-type") ?? "")
    .toLowerCase()
    .includes("text/event-stream");
}

function isStreamingRequest(init: RequestInit | undefined): boolean {
  return (
    typeof init?.body === "string" && /"stream"\s*:\s*true/.test(init.body)
  );
}
