import { expect, test } from "bun:test";

import { createOpenCodeConfig } from "./driver-artifact-live-config";

interface OpenCodeConfig {
  readonly model?: string;
  readonly provider?: {
    readonly openrouter?: {
      readonly models?: Record<string, Record<string, unknown>>;
      readonly npm?: string;
      readonly options?: Record<string, unknown>;
    };
  };
}

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = "openrouter/deepseek-v4.1-flash";

test("serializes the configured OpenRouter endpoint for OpenCode", () => {
  const baseURL = "http://nas.example/v1";
  const config = JSON.parse(createOpenCodeConfig(OPENROUTER_MODEL, baseURL)) as OpenCodeConfig;

  expect(config.provider?.openrouter?.options).toEqual({ baseURL });
});

test("selects the OpenAI-compatible SDK for a custom endpoint", () => {
  const config = JSON.parse(
    createOpenCodeConfig(OPENROUTER_MODEL, "http://nas.example/v1"),
  ) as OpenCodeConfig;

  expect(config.provider?.openrouter?.npm).toBe("@ai-sdk/openai-compatible");
  expect(config.model).toBe(OPENROUTER_MODEL);
});

test("keeps the native OpenRouter SDK for the real endpoint", () => {
  const config = JSON.parse(
    createOpenCodeConfig(OPENROUTER_MODEL, DEFAULT_OPENROUTER_BASE_URL),
  ) as OpenCodeConfig;

  expect(config.provider?.openrouter?.npm).toBeUndefined();
});

test("registers the configured OpenRouter model under its upstream ID", () => {
  const config = JSON.parse(
    createOpenCodeConfig(OPENROUTER_MODEL, "http://nas.example/v1"),
  ) as OpenCodeConfig;

  expect(config.provider?.openrouter?.models).toEqual({
    "deepseek-v4.1-flash": {},
  });
  expect(config.provider?.openrouter?.models).not.toHaveProperty("~deepseek-v4.1-flash");
});
