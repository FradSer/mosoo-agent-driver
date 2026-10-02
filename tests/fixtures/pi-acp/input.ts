import type { DriverStartInput } from "../../../src/protocol/start";
import { driverStartInput } from "../../driver-boot-payload-fixture";

export function piInput(
  options: {
    model?: string;
    resourceId?: string;
    baseUrl?: string;
    expiresAt?: number;
    session?: Partial<DriverStartInput["execution"]["session"]>;
  } = {},
): DriverStartInput {
  const model = options.model ?? "vendor/model-fixture";
  const resourceId = options.resourceId ?? "credential-fixture";
  // Unsigned fixture claims: these are accepted only by test-owned proxies.
  const claims = {
    action: "llm_proxy",
    projectId: "project-fixture",
    driverInstanceId: driverStartInput.driverInstanceId,
    driverGeneration: driverStartInput.driverGeneration,
    resourceId,
    expiresAt: options.expiresAt ?? Date.now() + 60_000,
    modelId: model,
    modelProtocol: "openai-chat-completions",
  };
  return {
    ...driverStartInput,
    runtime: "pi-acp",
    runtimeTransport: "pi-acp",
    execution: {
      ...driverStartInput.execution,
      provider: "openai-compatible",
      model: `openai-compatible/${model}`,
      session: { ...driverStartInput.execution.session, ...options.session },
      environment: {
        variables: {
          OPENAI_COMPATIBLE_API_KEY: `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${Buffer.alloc(32).toString("base64url")}`,
          OPENAI_COMPATIBLE_BASE_URL:
            options.baseUrl ??
            `https://proxy.example.invalid/api/driver/llm/proxy/${encodeURIComponent(resourceId)}`,
        },
      },
    },
  };
}
