import { expect, test } from "bun:test";

import {
  client as createAcpClient,
  methods as acpMethods,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import type { ClientConnection } from "@agentclientprotocol/sdk";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";

import {
  ACP_PROTOCOL_VERSION,
  assertProtocolVersion,
  buildClientCapabilities,
} from "../src/runtimes/acp/acp-configuration";
import { limitAcpInput } from "../src/runtimes/acp/acp-input-limit";
import { setupAcpSession } from "../src/runtimes/acp/acp-session-setup";
import { createAgentDriverContext } from "../src/core/agent-driver-backend";
import { createDisabledLogger } from "../src/observability";
import { AGENT_DRIVER_PROVIDER_REGISTRY } from "../src/runtimes/provider-registry";
import { exposeNativeSkillAliases } from "../src/runtimes/skill-bootstrap";
import type { DriverStartInput } from "../src/protocol/start";
import { settlePromiseWithTimeout } from "../src/utils/async";
import { driverBootPayload, driverStartInput } from "./driver-boot-payload-fixture";
import { FakeDriverRuntimeIo } from "./driver-runtime-boundary-fixtures";

const OPENCODE_COMMAND = resolve(process.cwd(), "node_modules", ".bin", "opencode");
const REQUEST_TIMEOUT_MS = 10_000;

test("pinned OpenCode starts through the registry with explicit launch and native instructions", async () => {
  const version = spawnSync(OPENCODE_COMMAND, ["--version"], {
    encoding: "utf8",
    timeout: REQUEST_TIMEOUT_MS,
  });
  expect(version.error).toBeUndefined();
  expect(version.status).toBe(0);
  expect(version.stdout.trim()).toBe("1.18.25");

  const root = await mkdtemp(join(tmpdir(), "agent-driver-opencode-registry-contract-"));
  const cwd = join(root, "workspace");
  const homePath = join(root, "home");
  await Promise.all([cwd, homePath].map((path) => mkdir(path)));
  const profilePrompt = "Review each change against the user's requested scope.";
  const payload: DriverStartInput = {
    ...driverStartInput,
    execution: {
      ...driverStartInput.execution,
      environment: {
        variables: {
          OPENCODE_TEST_HOME: homePath,
          XDG_CACHE_HOME: join(homePath, ".cache"),
          XDG_CONFIG_HOME: join(homePath, ".config"),
          XDG_DATA_HOME: join(homePath, ".local", "share"),
          XDG_STATE_HOME: join(homePath, ".local", "state"),
        },
      },
      systemPrompt: profilePrompt,
      session: {
        ...driverStartInput.execution.session,
        context: {
          ...driverStartInput.execution.session.context,
          homePath,
          sessionOrganizationPath: cwd,
        },
        cwd,
        homePath,
        sharedRootPath: cwd,
      },
    },
    runtime: "acp-fallback",
    runtimeTransport: "acp-fallback",
  };
  const io = new FakeDriverRuntimeIo([]);
  const failures: Error[] = [];
  const context = createAgentDriverContext({
    eventSink: io,
    lifecycle: { fail: (error) => failures.push(error) },
    logger: createDisabledLogger(),
    payload,
    permission: { request: async () => "reject_once" },
    ports: { skill: { materialize: async () => [] } },
  });
  const backend = AGENT_DRIVER_PROVIDER_REGISTRY.createBackend(payload, {
    acpLaunch: { command: OPENCODE_COMMAND, args: ["acp", "--pure"] },
  });

  try {
    await backend.start(context, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    const events = io.pushedEvents.flatMap(({ events: batch }) => batch);
    expect(
      events.find(({ kind }) => kind === "runtime.capabilities.updated")?.payload,
    ).toMatchObject({
      protocolVersion: ACP_PROTOCOL_VERSION,
    });
    expect(events.some(({ kind }) => kind === "session.created")).toBe(true);
    expect(events.find(({ kind }) => kind === "runtime.resume.updated")?.payload).toMatchObject({
      resumePointer: expect.any(String),
    });
    expect(await readFile(join(homePath, "runtime-instructions.md"), "utf8")).toContain(
      profilePrompt,
    );
    expect(failures).toEqual([]);
  } finally {
    await backend.stop(
      context,
      "OpenCode registry contract test cleanup",
      new AbortController().signal,
    );
    await rm(root, { force: true, recursive: true });
  }
});

function discoverOpenCodeSkills(
  cwd: string,
  homePath: string,
): {
  location: string;
  name: string;
}[] {
  const result = spawnSync(OPENCODE_COMMAND, ["debug", "skill", "--pure"], {
    cwd,
    encoding: "utf8",
    env: {
      HOME: homePath,
      OPENCODE_TEST_HOME: homePath,
      PATH: process.env["PATH"] ?? "",
      XDG_CACHE_HOME: join(homePath, ".cache"),
      XDG_CONFIG_HOME: join(homePath, ".config"),
      XDG_DATA_HOME: join(homePath, ".local", "share"),
      XDG_STATE_HOME: join(homePath, ".local", "state"),
    },
    timeout: REQUEST_TIMEOUT_MS,
  });

  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as { location: string; name: string }[];
}

async function requestWithTimeout<T>(
  connection: ClientConnection,
  label: string,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const result = await settlePromiseWithTimeout(request(controller.signal), {
    label,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  if (result.status === "completed") {
    return result.value;
  }

  controller.abort(result.error);

  if (result.status === "timed_out") {
    connection.close(result.error);
  }

  throw result.error;
}

async function stopOpenCode(
  connection: ClientConnection,
  child: ChildProcessWithoutNullStreams,
  closed: Promise<void>,
): Promise<void> {
  connection.close(new Error("OpenCode ACP contract test stopped."));

  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  const stopped = await settlePromiseWithTimeout(closed, {
    label: "OpenCode ACP contract process exit",
    timeoutMs: 2_000,
  });

  if (stopped.status === "timed_out") {
    child.kill("SIGKILL");
    await settlePromiseWithTimeout(closed, {
      label: "OpenCode ACP contract process force exit",
      timeoutMs: 1_000,
    });
  }
}

test("OpenCode rejects unadvertised additional directories before session creation", async () => {
  expect(existsSync(OPENCODE_COMMAND)).toBe(true);

  const root = await mkdtemp(join(tmpdir(), "agent-driver-opencode-acp-contract-"));
  const additionalDirectory = join(root, "additional");
  const cwd = join(root, "workspace");
  const homePath = join(root, "home");
  await Promise.all(
    [additionalDirectory, cwd, homePath].map((path) => mkdir(path, { recursive: true })),
  );

  const child = spawn(OPENCODE_COMMAND, ["acp", "--pure"], {
    cwd,
    env: {
      HOME: homePath,
      PATH: process.env["PATH"] ?? "",
      XDG_CACHE_HOME: join(homePath, ".cache"),
      XDG_CONFIG_HOME: join(homePath, ".config"),
      XDG_DATA_HOME: join(homePath, ".local", "share"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  const closed = new Promise<void>((resolveClosed) => child.once("close", () => resolveClosed()));
  const output = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
  const input = limitAcpInput(
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
  );
  const connection = createAcpClient({ name: "mosoo-driver-contract-test" }).connect(
    ndJsonStream(output, input),
  );
  child.stderr.resume();

  try {
    const initialize = await requestWithTimeout(
      connection,
      "OpenCode ACP initialize",
      (cancellationSignal) =>
        connection.agent.request(
          acpMethods.agent.initialize,
          {
            clientCapabilities: buildClientCapabilities(),
            clientInfo: {
              name: "mosoo-driver-contract-test",
              title: "Mosoo Driver Contract Test",
              version: "0.1.0",
            },
            protocolVersion: ACP_PROTOCOL_VERSION,
          },
          { cancellationSignal },
        ),
    );
    assertProtocolVersion(initialize);
    expect(
      initialize.agentCapabilities?.sessionCapabilities?.additionalDirectories,
    ).toBeUndefined();

    const sessionContext = {
      ...driverBootPayload.execution.session.context,
      homePath,
      sessionOrganizationPath: cwd,
    };
    const payload: DriverStartInput = {
      ...driverStartInput,
      execution: {
        ...driverStartInput.execution,
        session: {
          ...driverStartInput.execution.session,
          additionalDirectories: [additionalDirectory],
          context: sessionContext,
          cwd,
          homePath,
          sharedRootPath: cwd,
        },
      },
      runtime: "acp-fallback",
      runtimeTransport: "acp-fallback",
    };
    await expect(
      setupAcpSession({
        agentCapabilities: initialize.agentCapabilities ?? null,
        connection: connection.agent,
        currentSessionId: null,
        payload,
        replaySession: async (operation) => operation(),
      }),
    ).rejects.toThrow("does not advertise additionalDirectories support");
  } finally {
    await stopOpenCode(connection, child, closed);
    await rm(root, { force: true, recursive: true });
  }
});

test("OpenCode discovers a materialized native skill before its first process starts", async () => {
  expect(existsSync(OPENCODE_COMMAND)).toBe(true);

  const root = await mkdtemp(join(tmpdir(), "agent-driver-opencode-skill-contract-"));
  const homePath = join(root, "home");
  const mountPath = join(root, ".mosoo", "skill", "skill-1");
  const skillMarkdownPath = join(mountPath, "SKILL.md");
  await Promise.all([homePath, mountPath].map((path) => mkdir(path, { recursive: true })));
  await writeFile(
    skillMarkdownPath,
    `---
name: review
description: Review code changes.
---

Check the diff.`,
    "utf8",
  );
  const execution = {
    ...driverStartInput.execution,
    session: {
      ...driverStartInput.execution.session,
      cwd: root,
      homePath,
      sharedRootPath: root,
    },
  };
  const logger = createDisabledLogger();

  try {
    await exposeNativeSkillAliases(
      execution,
      logger,
      [
        {
          mountPath,
          skillId: "skill-1",
          skillMarkdownPath,
          skillName: "review",
          snapshotId: "snapshot-1",
        },
      ],
      new AbortController().signal,
    );

    const expectedSkillPath = join(await realpath(root), ".agents", "skills", "review", "SKILL.md");
    expect(discoverOpenCodeSkills(root, homePath)).toContainEqual(
      expect.objectContaining({
        location: expectedSkillPath,
        name: "review",
      }),
    );

    await exposeNativeSkillAliases(execution, logger, [], new AbortController().signal);

    expect(discoverOpenCodeSkills(root, homePath).some((skill) => skill.name === "review")).toBe(
      false,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
