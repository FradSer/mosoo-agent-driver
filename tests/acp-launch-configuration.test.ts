import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentDriverContext } from "../src/core/agent-driver-backend";
import { createDisabledLogger } from "../src/observability";
import type { DriverRuntimeTransport } from "../src/protocol/runtime";
import { createDriverStartInputFromBootPayload } from "../src/protocol/start";
import {
  type AcpLaunchConfiguration,
  resolveAcpLaunchConfiguration,
} from "../src/runtimes/acp/acp-configuration";
import { AGENT_DRIVER_PROVIDER_REGISTRY } from "../src/runtimes/provider-registry";
import { driverBootPayload } from "./driver-boot-payload-fixture";
import { FakeDriverRuntimeIo } from "./driver-runtime-boundary-fixtures";

const LAUNCH_PROBE = String.raw`
const { writeFileSync } = require("node:fs");
writeFileSync(process.env.TEST_LAUNCH_LOG_PATH, JSON.stringify(process.argv.slice(2)));
const lines = require("node:readline").createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  switch (message.method) {
    case "initialize":
      result = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
      break;
    case "session/new":
      result = { sessionId: "launch-probe-session" };
      break;
    case "session/prompt":
      result = { stopReason: "end_turn" };
      break;
    default:
      throw new Error("Unexpected method: " + message.method);
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
});
`;

describe("ACP launch configuration", () => {
  test("keeps the default and legacy OpenCode environment launch", () => {
    expect(resolveAcpLaunchConfiguration(undefined, {})).toEqual({
      args: [],
      command: "acp-agent",
    });
    expect(
      resolveAcpLaunchConfiguration(undefined, {
        MOSOO_ACP_FALLBACK_ARGS: "  ",
        MOSOO_ACP_FALLBACK_COMMAND: "  ",
      }),
    ).toEqual({ args: [], command: "acp-agent" });
    expect(
      resolveAcpLaunchConfiguration(undefined, {
        MOSOO_ACP_FALLBACK_ARGS: '["acp","--pure"]',
        MOSOO_ACP_FALLBACK_COMMAND: " /usr/local/bin/opencode ",
      }),
    ).toEqual({ args: ["acp", "--pure"], command: "/usr/local/bin/opencode" });
  });

  test.each(["acp --pure", "{}", '"acp"', "null", '["acp",1]', '["acp",null]'])(
    "rejects malformed legacy arguments: %s",
    (rawArgs) => {
      expect(() =>
        resolveAcpLaunchConfiguration(undefined, { MOSOO_ACP_FALLBACK_ARGS: rawArgs }),
      ).toThrow();
    },
  );

  test("an explicit launch never reads fallback environment values", () => {
    const unreadableEnv = new Proxy<NodeJS.ProcessEnv>(
      {},
      {
        get() {
          throw new Error("Fallback environment must not be consulted.");
        },
      },
    );
    expect(
      resolveAcpLaunchConfiguration({ command: "/opt/pi-acp", args: [] }, unreadableEnv),
    ).toEqual({ command: "/opt/pi-acp", args: [] });
  });

  const sparseArgs: string[] = [];
  sparseArgs.length = 1;

  test.each([
    { command: "", args: [] },
    { command: "   ", args: [] },
    { command: "agent\0suffix", args: [] },
    { command: 1, args: [] },
    { command: "agent" },
    { command: "agent", args: "--acp" },
    { command: "agent", args: [1] },
    { command: "agent", args: [null] },
    { command: "agent", args: ["arg\0suffix"] },
    { command: "agent", args: sparseArgs },
  ])("rejects malformed explicit launch %#", (launch) => {
    expect(() =>
      resolveAcpLaunchConfiguration(launch as unknown as AcpLaunchConfiguration, {
        MOSOO_ACP_FALLBACK_COMMAND: "opencode",
      }),
    ).toThrow();
  });

  test("snapshots caller-owned arguments without rewriting literal argv", () => {
    const args = ["", "two words", "$(not-a-command)", "; literal", "`literal`", '"quoted"'];
    const expected = [...args];
    const launch = { command: "/opt/runtime with spaces/agent", args };
    const resolved = resolveAcpLaunchConfiguration(launch, {});
    launch.command = "different-agent";
    args[0] = "changed";
    args.push("extra");

    expect(resolved).toEqual({ command: "/opt/runtime with spaces/agent", args: expected });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.args)).toBe(true);
  });

  test.each(["openai-app-server", "claude-agent-sdk"] as const)(
    "rejects ACP launch options on the %s transport",
    (runtimeTransport: DriverRuntimeTransport) => {
      const input = createDriverStartInputFromBootPayload({
        ...driverBootPayload,
        runtime: runtimeTransport === "openai-app-server" ? "openai-runtime" : "claude-agent-sdk",
        runtimeTransport,
      });
      expect(() =>
        AGENT_DRIVER_PROVIDER_REGISTRY.createBackend(input, {
          acpLaunch: { command: "opencode", args: ["acp"] },
        }),
      ).toThrow();
      expect(() =>
        AGENT_DRIVER_PROVIDER_REGISTRY.getByStartInput(input).createBackend(input, {
          acpLaunch: { command: "opencode", args: ["acp"] },
        }),
      ).toThrow();
    },
  );

  test("registry launches stay independent and snapshot argv before startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-driver-acp-launch-"));
    const script = join(root, "agent with spaces.cjs");
    await writeFile(script, LAUNCH_PROBE, "utf8");
    const launches = [
      ["first runtime", "", "$(not-a-command)", "; literal", "`literal`"],
      ["second runtime", "--literal=value with spaces"],
    ];
    const instances = await Promise.all(
      launches.map(async (literalArgs, index) => {
        const cwd = join(root, String(index));
        const logPath = join(cwd, "launch.json");
        await mkdir(cwd);
        const payload = createDriverStartInputFromBootPayload({
          ...driverBootPayload,
          execution: {
            ...driverBootPayload.execution,
            environment: { variables: { TEST_LAUNCH_LOG_PATH: logPath } },
            session: {
              ...driverBootPayload.execution.session,
              context: {
                ...driverBootPayload.execution.session.context,
                homePath: join(cwd, "home"),
                sessionOrganizationPath: cwd,
              },
              cwd,
            },
          },
          runtime: "acp-fallback",
          runtimeTransport: "acp-fallback",
        });
        const io = new FakeDriverRuntimeIo([]);
        const context = createAgentDriverContext({
          eventSink: io,
          logger: createDisabledLogger(),
          payload,
          permission: { request: async () => "reject_once" },
          ports: { skill: { materialize: async () => [] } },
        });
        const acpLaunch = { command: process.execPath, args: [script, ...literalArgs] };
        const backend = AGENT_DRIVER_PROVIDER_REGISTRY.createBackend(payload, { acpLaunch });
        acpLaunch.command = join(root, "must-not-launch");
        acpLaunch.args.splice(0, acpLaunch.args.length, "must-not-be-passed");
        return { backend, context, io, literalArgs, logPath };
      }),
    );

    try {
      await Promise.all(
        instances.map(({ backend, context }) => backend.start(context, AbortSignal.timeout(5_000))),
      );
      for (const { io, literalArgs, logPath } of instances) {
        expect(JSON.parse(await readFile(logPath, "utf8"))).toEqual(literalArgs);
        expect(io.pushedEvents.flatMap(({ events }) => events).map(({ kind }) => kind)).toContain(
          "session.created",
        );
      }
    } finally {
      await Promise.all(
        instances.map(({ backend, context }) =>
          backend.stop(context, "test cleanup", new AbortController().signal),
        ),
      );
      await rm(root, { force: true, recursive: true });
    }
  });
});
