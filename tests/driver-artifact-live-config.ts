const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";

export function createOpenCodeConfig(model: string, baseURL: string): string {
  const slug = model.slice("openrouter/".length);
  const usesCustomEndpoint = baseURL.replace(/\/+$/, "") !== DEFAULT_OPENROUTER_BASE_URL;

  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    enabled_providers: ["openrouter"],
    model,
    permission: {
      "*": "ask",
    },
    provider: {
      openrouter: {
        ...(usesCustomEndpoint ? { npm: OPENAI_COMPATIBLE_NPM } : {}),
        models: {
          [slug]: {},
        },
        options: {
          baseURL,
        },
      },
    },
    small_model: model,
  });
}
