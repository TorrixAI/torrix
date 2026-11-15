import { expect, test } from "bun:test";
import {
  clearPlaygroundStorage,
  readPrefs,
  readProviderId,
  resolvePrefs,
  resolveProviderId,
  writePrefs,
  writeProviderId,
  type PlaygroundProvider,
  type PrefStore,
} from "../src/pages/playgroundUtil";

function memoryStore(seed: Record<string, string> = {}): PrefStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
  };
}

const openai: PlaygroundProvider = {
  id: "openai",
  label: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  endpoint: "/chat/completions",
  format: "openai",
  auth: "bearer",
  models: ["gpt-5", "gpt-4o"],
};

const anthropic: PlaygroundProvider = {
  id: "anthropic",
  label: "Anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  endpoint: "/messages",
  format: "anthropic",
  auth: "x-api-key",
  models: ["claude-opus-4"],
};

const custom: PlaygroundProvider = {
  id: "custom",
  label: "Custom",
  baseUrl: "",
  endpoint: "/v1/chat/completions",
  format: "openai",
  auth: "bearer",
  models: [],
};

test("a provider keeps the connection the user configured after switching away", () => {
  const store = memoryStore();

  // Configure OpenAI, then leave for Anthropic.
  const mine = { baseUrl: "https://gateway.internal/v1", apiKey: "sk-openai", model: "gpt-4o-mini" };
  writePrefs("openai", mine, store);
  writePrefs("anthropic", { ...resolvePrefs(anthropic, null), apiKey: "sk-ant" }, store);

  // Coming back restores the edit, not the catalog defaults.
  expect(resolvePrefs(openai, readPrefs("openai", store))).toEqual(mine);
  // And the other provider kept its own settings.
  expect(resolvePrefs(anthropic, readPrefs("anthropic", store)).apiKey).toBe("sk-ant");
});

test("a provider with nothing saved starts from its own defaults", () => {
  const store = memoryStore();
  expect(resolvePrefs(openai, readPrefs("openai", store))).toEqual({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-5",
  });
  expect(resolvePrefs(custom, readPrefs("custom", store))).toEqual({ baseUrl: "", apiKey: "", model: "" });
});

test("saved values win, but a blank field falls back to the provider default", () => {
  expect(resolvePrefs(openai, { baseUrl: "  ", apiKey: "sk-1", model: "  " })).toEqual({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-1",
    model: "gpt-5",
  });
  // A provider with no model list must not inherit a neighbour's model.
  expect(resolvePrefs(custom, { model: "" }).model).toBe("");
});

test("readPrefs ignores missing, corrupt and non-string records", () => {
  expect(readPrefs("openai", memoryStore())).toBeNull();
  expect(readPrefs("openai", memoryStore({ "pgprefs.openai": "{not json" }))).toBeNull();
  expect(readPrefs("openai", memoryStore({ "pgprefs.openai": JSON.stringify({ apiKey: 42, model: ["gpt-5"] }) }))).toBeNull();
});

test("readPrefs still finds a key written by the older pgkey scheme", () => {
  const store = memoryStore({ "pgkey.openai": "sk-legacy" });
  expect(readPrefs("openai", store)).toEqual({ apiKey: "sk-legacy" });
  expect(resolvePrefs(openai, readPrefs("openai", store))).toEqual({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-legacy",
    model: "gpt-5",
  });
});

test("writePrefs survives a storage that refuses writes", () => {
  const full: PrefStore = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  expect(() => writePrefs("openai", { baseUrl: "", apiKey: "", model: "" }, full)).not.toThrow();
  expect(readPrefs("openai", null)).toBeNull();
});

test("the provider used last time is reopened, and an unknown one falls back", () => {
  expect(resolveProviderId([openai, anthropic], "anthropic")).toBe("anthropic");
  expect(resolveProviderId([openai, anthropic], "retired")).toBe("openai");
  expect(resolveProviderId([openai, anthropic], "")).toBe("openai");
  expect(resolveProviderId([], "openai")).toBe("");
});

test("the selected provider survives a reload", () => {
  const store = memoryStore();
  expect(readProviderId(store)).toBe("");
  writeProviderId("groq", store);
  expect(readProviderId(store)).toBe("groq");
});

test("signing out drops provider keys and the transcript, and nothing else", () => {
  const store = memoryStore({
    "pgprefs.openai": JSON.stringify({ baseUrl: "", apiKey: "sk-openai", model: "gpt-5" }),
    "pgkey.anthropic": "sk-ant",
    "torrix_pg_provider": "openai",
    "torrix_pg_conv": JSON.stringify({ sessionId: "pg-1", history: [] }),
    "torrix_theme": "dark",
    "torrix_key": "trxk_session",
  });
  clearPlaygroundStorage(store);
  expect([...store.data.keys()].sort()).toEqual(["torrix_key", "torrix_theme"]);
});

test("clearing is a no-op when the store cannot remove or enumerate", () => {
  const minimal: PrefStore = { getItem: () => null, setItem: () => undefined };
  expect(() => clearPlaygroundStorage(minimal)).not.toThrow();
  expect(() => clearPlaygroundStorage(null)).not.toThrow();
});
