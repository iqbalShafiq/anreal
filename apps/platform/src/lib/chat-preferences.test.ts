import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "./api";
import {
  SELECTED_MODEL_KEY,
  readSelectedModel,
  readStoredSelectedModel,
  resolveInitialModel,
} from "./chat-preferences";
import { DEFAULT_COMPLETION_MODEL } from "./chat/models";

/** Map-backed storage so the preference reads can run in the node env. */
function createStorage(initial: Record<string, string> = {}) {
  const local = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => {
      local.set(key, value);
    },
    removeItem: (key: string) => {
      local.delete(key);
    },
    clear: () => local.clear(),
    key: (index: number) => [...local.keys()][index] ?? null,
    get length() {
      return local.size;
    },
  };
  vi.stubGlobal("localStorage", storage);
  return { store: local, storage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const catalog = [
  { modelId: "openai/gpt-6-luna" },
  { modelId: "deepseek/deepseek-v4-flash-0731" },
] as unknown as ModelInfo[];

describe("resolveInitialModel", () => {
  it("prefers a stored preference that the catalog still has", () => {
    expect(
      resolveInitialModel({
        storedModelId: "deepseek/deepseek-v4-flash-0731",
        models: catalog,
      }),
    ).toBe("deepseek/deepseek-v4-flash-0731");
  });

  it("ignores a stored id the catalog lacks and falls back to the first model", () => {
    expect(
      resolveInitialModel({
        storedModelId: "openai/pruned-model",
        models: catalog,
      }),
    ).toBe("openai/gpt-6-luna");
  });

  it("falls back to the first catalog model when nothing is stored", () => {
    expect(
      resolveInitialModel({
        storedModelId: null,
        models: catalog,
      }),
    ).toBe("openai/gpt-6-luna");
  });

  it("uses the app default when the catalog is empty", () => {
    expect(
      resolveInitialModel({
        storedModelId: "openai/gpt-6-luna",
        models: [],
      }),
    ).toBe(DEFAULT_COMPLETION_MODEL);
  });
});

describe("readSelectedModel", () => {
  it("returns what resolveInitialModel returns for the same inputs", () => {
    createStorage({ [SELECTED_MODEL_KEY]: "deepseek/deepseek-v4-flash-0731" });

    expect(readSelectedModel(catalog)).toBe(
      "deepseek/deepseek-v4-flash-0731",
    );
    expect(readSelectedModel(catalog)).toBe(
      resolveInitialModel({
        storedModelId: readStoredSelectedModel(),
        models: catalog,
      }),
    );
  });

  it("falls back to the first catalog model when nothing is stored", () => {
    createStorage();

    expect(readSelectedModel(catalog)).toBe("openai/gpt-6-luna");
  });

  it("ignores a stored id the catalog lacks", () => {
    createStorage({ [SELECTED_MODEL_KEY]: "openai/pruned-model" });

    expect(readSelectedModel(catalog)).toBe("openai/gpt-6-luna");
  });
});
