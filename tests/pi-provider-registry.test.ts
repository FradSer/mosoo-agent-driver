import { describe, expect, test } from "bun:test";

import { parseDriverBootPayload } from "../src/protocol/boot";
import { parseDriverNativeRuntimeRef } from "../src/protocol/runtime";
import { createDriverStartInputFromBootPayload } from "../src/protocol/start";
import {
  AGENT_DRIVER_PROVIDER_REGISTRY,
  createAgentDriverProviderCapabilities,
} from "../src/runtimes/provider-registry";
import { driverBootPayload } from "./driver-boot-payload-fixture";

function piBoot() {
  return {
    ...driverBootPayload,
    runtime: "pi-acp",
    runtimeTransport: "pi-acp",
  };
}

describe("Given the additive Pi-through-ACP runtime", () => {
  test("when parsing a Pi boot, then its transport and native reference remain distinct from OpenCode", () => {
    const payload = parseDriverBootPayload(piBoot());
    expect(payload.runtime).toBe("pi-acp");
    expect(
      parseDriverNativeRuntimeRef({
        runtimeId: "pi-acp",
        kind: "acp_session_id",
        value: "pi-session",
      }),
    ).toEqual({ runtimeId: "pi-acp", kind: "acp_session_id", value: "pi-session" });
    expect(() => parseDriverBootPayload({ ...piBoot(), runtimeTransport: "acp-fallback" })).toThrow(
      "does not match",
    );
    expect(() =>
      parseDriverBootPayload({
        ...piBoot(),
        execution: {
          ...driverBootPayload.execution,
          session: {
            ...driverBootPayload.execution.session,
            nativeResumeRef: {
              runtimeId: "acp-fallback",
              kind: "acp_session_id",
              value: "old-session",
            },
          },
        },
      }),
    ).toThrow("does not match");
  });

  test("when publishing Pi capabilities, then context usage is supported while ordinary approvals and MCP cannot be upgraded by the host", () => {
    const provider = AGENT_DRIVER_PROVIDER_REGISTRY.getByStartInput(
      createDriverStartInputFromBootPayload(parseDriverBootPayload(piBoot())),
    );
    expect(provider.id).toBe("pi-acp");
    const capabilities = createAgentDriverProviderCapabilities({
      provider,
      permissionRequestStatus: "supported",
    });
    for (const id of ["permission_request", "mcp_execute"]) {
      expect(capabilities.find((entry) => entry.id === id)?.status).toBe("unsupported");
    }
    expect(capabilities.find((entry) => entry.id === "usage")?.status).toBe("supported");
    expect(capabilities.find((entry) => entry.id === "text_stream")?.status).toBe("supported");
  });

  test("when resolving existing OpenCode, then its identity and capabilities are preserved", () => {
    const payload = parseDriverBootPayload({
      ...driverBootPayload,
      runtime: "acp-fallback",
      runtimeTransport: "acp-fallback",
    });
    const provider = AGENT_DRIVER_PROVIDER_REGISTRY.getByStartInput(
      createDriverStartInputFromBootPayload(payload),
    );
    expect(provider.runtime).toBe("acp-fallback");
    expect(provider.capabilities.find((entry) => entry.id === "mcp_execute")?.status).toBe(
      "supported",
    );
  });
});

test("Given a generation outside safe integer precision, when parsing boot, then admission rejects it", () => {
  expect(() =>
    parseDriverBootPayload({ ...driverBootPayload, driverGeneration: Number.MAX_SAFE_INTEGER + 1 }),
  ).toThrow("safe integer");
});
