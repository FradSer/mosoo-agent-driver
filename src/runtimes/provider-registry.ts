import type { DriverRuntime, DriverRuntimeTransport } from "../protocol/runtime";
import type { DriverStartInput } from "../protocol/start";
import type { DriverCapability } from "../runtime-command";
import { AcpDriverBackend } from "./acp/acp-driver-backend";
import type { AcpLaunchConfiguration } from "./acp/acp-configuration";
import type { AgentDriverBackend } from "../core/agent-driver-backend";
import { ClaudeAgentSdkDriverBackend } from "./claude/agent-sdk-driver-backend";
import { OpenAiAppServerDriverBackend } from "./openai/app-server-driver-backend";

export interface AgentDriverProviderDescriptor {
  readonly capabilities: readonly DriverCapability[];
  createBackend(input: DriverStartInput, options?: AgentDriverBackendOptions): AgentDriverBackend;
  readonly id: DriverRuntimeTransport;
  readonly runtime: DriverRuntime;
}

export interface AgentDriverBackendOptions {
  /** Host-owned process selection for ACP only; not part of DriverStartInput. */
  readonly acpLaunch?: AcpLaunchConfiguration;
}

const PROVIDER_CAPABILITIES = [
  { id: "custom_tool_execute", status: "unsupported", version: 1 },
  { id: "file_change", status: "supported", version: 1 },
  { id: "input_start", status: "supported", version: 1 },
  { id: "mcp_execute", status: "supported", version: 1 },
  { id: "permission_request", status: "supported", version: 1 },
  { id: "session_stop", status: "supported", version: 1 },
  { id: "text_stream", status: "supported", version: 1 },
  { id: "tool_stream", status: "supported", version: 1 },
  { id: "turn_cancel", status: "supported", version: 1 },
  { id: "usage", status: "supported", version: 1 },
  { id: "visible_activity", status: "supported", version: 1 },
  { id: "native_resume", status: "supported", version: 1 },
  { id: "thinking_stream", status: "supported", version: 1 },
] as const satisfies readonly DriverCapability[];

const PROVIDERS = [
  {
    capabilities: PROVIDER_CAPABILITIES,
    createBackend: (payload, options) => {
      assertNoAcpLaunch("openai-app-server", options);
      return new OpenAiAppServerDriverBackend(payload);
    },
    id: "openai-app-server",
    runtime: "openai-runtime",
  },
  {
    capabilities: PROVIDER_CAPABILITIES,
    createBackend: (payload, options) => {
      assertNoAcpLaunch("claude-agent-sdk", options);
      return new ClaudeAgentSdkDriverBackend(payload);
    },
    id: "claude-agent-sdk",
    runtime: "claude-agent-sdk",
  },
  {
    capabilities: PROVIDER_CAPABILITIES,
    createBackend: (payload, options) => new AcpDriverBackend(payload, options?.acpLaunch),
    id: "acp-fallback",
    runtime: "acp-fallback",
  },
] as const satisfies readonly AgentDriverProviderDescriptor[];

export const AGENT_DRIVER_PROVIDER_REGISTRY = {
  createBackend(input: DriverStartInput, options?: AgentDriverBackendOptions): AgentDriverBackend {
    const provider = resolveProviderForStartInput(input);
    return provider.createBackend(input, options);
  },
  getByStartInput: resolveProviderForStartInput,
  list: () => PROVIDERS,
};

function assertNoAcpLaunch(
  transport: DriverRuntimeTransport,
  options?: AgentDriverBackendOptions,
): void {
  if (options?.acpLaunch !== undefined) {
    throw new Error(`ACP launch configuration is not supported by ${transport}.`);
  }
}

export function createAgentDriverProviderCapabilities(input: {
  permissionRequestStatus: DriverCapability["status"];
  provider: AgentDriverProviderDescriptor;
}): readonly DriverCapability[] {
  return input.provider.capabilities.map((capability) =>
    capability.id === "permission_request"
      ? { ...capability, status: input.permissionRequestStatus }
      : capability,
  );
}

function resolveProviderForStartInput(input: DriverStartInput): AgentDriverProviderDescriptor {
  const provider = PROVIDERS.find((candidate) => candidate.id === input.runtimeTransport);

  if (!provider) {
    throw new Error(`Unsupported runtime transport: ${input.runtimeTransport}.`);
  }

  if (input.runtime !== provider.runtime) {
    throw new Error(`Runtime ${input.runtime} does not match transport ${input.runtimeTransport}.`);
  }

  if (
    provider.runtime !== "claude-agent-sdk" &&
    input.execution.builtInTools.some((tool) => !tool.enabled)
  ) {
    throw new Error(`Runtime ${provider.runtime} does not support built-in tool restrictions.`);
  }

  return provider;
}
