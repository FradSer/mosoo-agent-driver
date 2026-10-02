import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { assertPiPromptText } from "../src/runtimes/acp/pi-acp-bootstrap";
import { BOOTSTRAP_MODEL, createBootstrapFixture } from "./fixtures/pi-acp/bootstrap";
import {
  ADAPTER_VERSION,
  createFixture,
  MODEL,
  pi,
  waitFor,
  type AcpProcess,
  type Update,
} from "./fixtures/pi-acp/contract";

// Opt in explicitly: this launches the real published pair, not mocked Pi RPC.
// Missing/wrong binaries fail when enabled; ordinary unit runs need no installed Pi.
const contractTest = process.env["PI_ACP_PINNED_CONTRACT"] === "1" ? test : test.skip;
const upgradeTest = process.env["PI_ACP_UPGRADE_CONTRACT"] === "1" ? test : test.skip;

contractTest(
  "Given generated bootstrap and hostile project resources, When first prompting then cold loading, Then fixed routing and refreshed explicit instructions/skills survive without executing project code",
  async () => {
    const fixture = await createBootstrapFixture();
    try {
      expect(fixture.wrapperSource).toContain("--no-extensions --no-approve --no-prompt-templates");
      const files = await fixture.materialize("FIRST");
      expect(files["APPEND_SYSTEM.md"]).not.toContain("Reply with exactly READY");
      expect(files["APPEND_SYSTEM.md"]).not.toContain("do not call tools");
      expect(JSON.parse(files["settings.json"]!)).toMatchObject({
        defaultProjectTrust: "never",
        skills: [fixture.materializedSkill.skillMarkdownPath],
      });
      expect(JSON.stringify(files)).not.toContain(fixture.env["MOSOO_PI_PROXY_GRANT"]!);
      expect(files["auth.json"]).toBe("{}");
      expect(files["trust.json"]).toBe("{}");
      expect(files["SYSTEM.md"]).toBe("");
      let client = fixture.start();
      await initialize(client);
      const session = await client.request("session/new", { cwd: fixture.cwd, mcpServers: [] });
      expect(session.models.currentModelId).toBe(`mosoo/${BOOTSTRAP_MODEL}`);
      expect(session.models.availableModels.map((model) => model.modelId)).toEqual([
        `mosoo/${BOOTSTRAP_MODEL}`,
      ]);
      expect(fixture.requests).toHaveLength(0);
      fixture.steps.push(
        {
          tools: [
            { name: "read", arguments: { path: fixture.materializedSkill.skillMarkdownPath } },
            { name: "bash", arguments: { command: "printf PI_GENERATED_REAL_BASH" } },
          ],
        },
        { text: "PI_GENERATED_FIRST_DONE" },
      );
      expect(
        (await client.prompt(session.sessionId, "Use bootstrap-skill for the first task"))
          .stopReason,
      ).toBe("end_turn");
      expect(text(client.updates)).toContain("PI_GENERATED_FIRST_DONE");
      const first = JSON.stringify(fixture.requests[0]?.messages);
      expect(first).toContain("PI_GENERATED_INSTRUCTIONS_FIRST");
      expect(first).toContain("PI_EXPLICIT_SKILL_DESCRIPTION_FIRST");
      expect(JSON.stringify(fixture.requests[1]?.messages)).toContain(
        "PI_EXPLICIT_SKILL_BODY_FIRST",
      );
      expect(JSON.stringify(fixture.requests[1]?.messages)).toContain("PI_GENERATED_REAL_BASH");
      expect(existsSync(fixture.marker)).toBe(false);
      await client.stop();
      await writeFile(join(fixture.agentDir, "auth.json"), '{"stale-fixture":{}}');
      await writeFile(join(fixture.agentDir, "trust.json"), '{"stale-fixture":true}');
      await fixture.materialize("COLD");
      expect(await readFile(join(fixture.agentDir, "auth.json"), "utf8")).toBe("{}");
      expect(await readFile(join(fixture.agentDir, "trust.json"), "utf8")).toBe("{}");
      client = fixture.start();
      await initialize(client);
      const loaded = await client.request("session/load", {
        sessionId: session.sessionId,
        cwd: fixture.cwd,
        mcpServers: [],
      });
      expect(loaded.models.currentModelId).toBe(`mosoo/${BOOTSTRAP_MODEL}`);
      expect(text(client.updates)).toContain("PI_GENERATED_FIRST_DONE");
      fixture.steps.push(
        {
          tools: [
            { name: "read", arguments: { path: fixture.materializedSkill.skillMarkdownPath } },
          ],
        },
        { text: "PI_GENERATED_COLD_DONE" },
      );
      expect(
        (await client.prompt(session.sessionId, "Use bootstrap-skill again after cold load"))
          .stopReason,
      ).toBe("end_turn");
      const cold = JSON.stringify(fixture.requests.at(-1)?.messages);
      expect(cold).toContain("PI_GENERATED_FIRST_DONE");
      expect(cold).toContain("PI_GENERATED_INSTRUCTIONS_COLD");
      expect(cold).toContain("PI_EXPLICIT_SKILL_DESCRIPTION_COLD");
      expect(cold).toContain("PI_EXPLICIT_SKILL_BODY_COLD");
      const system = JSON.stringify(
        fixture.requests.at(-1)?.messages.filter((message) => message.role === "system"),
      );
      expect(system).not.toContain("PI_GENERATED_INSTRUCTIONS_FIRST");
      expect(system).not.toContain("PI_EXPLICIT_SKILL_DESCRIPTION_FIRST");
      // The adapter expands templates independently of Pi's flags. Driver must
      // reject slash-command input before handing it to this raw ACP transport.
      for (const input of [
        "/hostile",
        "  /model hostile/redirected-model",
        "\n/thinking high",
        "/skill:bootstrap-skill",
      ]) {
        expect(() => assertPiPromptText(input)).toThrow();
      }
      expect(() => assertPiPromptText("Explain /hostile without invoking it")).not.toThrow();
      expect(JSON.stringify(fixture.requests)).not.toContain("PI_HOSTILE_");
      fixture.steps.push({ text: "PI_GENERATED_ADAPTER_LIMITATION_DONE" });
      expect((await client.prompt(session.sessionId, "/hostile")).stopReason).toBe("end_turn");
      expect(JSON.stringify(fixture.requests.at(-1)?.messages)).toContain(
        "PI_HOSTILE_PROMPT_TEMPLATE",
      );
      expect(JSON.stringify(fixture.requests)).not.toContain("PI_HOSTILE_PROJECT_APPEND");
      expect(JSON.stringify(fixture.requests)).not.toContain("PI_HOSTILE_PROJECT_SYSTEM");
      // Implicit project discovery stays off, while the explicit global path works.
      expect(JSON.stringify(fixture.requests)).not.toContain("PI_CONTRACT_SKILL_DESCRIPTION");
      expect(fixture.requests).toHaveLength(5);
      expect(fixture.requests.every((request) => request.model === BOOTSTRAP_MODEL)).toBe(true);
      expect(existsSync(fixture.marker)).toBe(false);
      expect(fixture.errors).toEqual([]);
      expect(fixture.steps).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  },
  60_000,
);

function text(updates: Update[], type = "agent_message_chunk"): string {
  return updates
    .filter((update) => update.sessionUpdate === type)
    .map((update) => {
      const content = update.content;
      return content && !Array.isArray(content) ? (content.text ?? "") : "";
    })
    .join("");
}

async function initialize(client: AcpProcess) {
  const reply = await client.request("initialize", {
    protocolVersion: 1,
    clientInfo: { name: "pi-pinned-contract", version: "1.0.0" },
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
  });
  expect(reply.protocolVersion).toBe(1);
  expect(reply.agentInfo).toMatchObject({ name: "pi-acp", version: ADAPTER_VERSION });
  expect(reply.agentCapabilities.loadSession).toBe(true);
  expect(reply.agentCapabilities.mcpCapabilities).toEqual({ http: false, sse: false });
}

contractTest(
  "Given exact Pi/ACP and an isolated HOME, When selecting then prompting, Then real tools, thoughts, limitations, and cold load are observable",
  async () => {
    const fixture = await createFixture();
    try {
      let client = fixture.start();
      await initialize(client);
      const mcpMarker = join(fixture.cwd, "mcp-was-started");
      const mcpServers = [
        {
          name: "unused-contract-mcp",
          command: "/bin/sh",
          args: ["-c", `printf started > '${mcpMarker}'`],
          env: [],
        },
      ];
      const session = await client.request("session/new", { cwd: fixture.cwd, mcpServers });
      expect(session.models.currentModelId).toBe("contract/initial");
      expect(session.models.availableModels.map((model) => model.modelId).sort()).toEqual([
        "contract/initial",
        MODEL,
      ]);
      const selected = await client.request("session/set_config_option", {
        sessionId: session.sessionId,
        configId: "model",
        value: MODEL,
      });
      // Readback is completed before the first model request, not inferred from its answer.
      expect(selected.configOptions.find((option) => option.id === "model")?.currentValue).toBe(
        MODEL,
      );
      expect(fixture.requests).toHaveLength(0);
      fixture.steps.push(
        {
          thinking: "PI_CONTRACT_THINKING",
          tools: [{ name: "write", arguments: { path: "contract.txt", content: "before\n" } }],
        },
        {
          tools: [
            {
              name: "edit",
              arguments: { path: "contract.txt", edits: [{ oldText: "before", newText: "after" }] },
            },
          ],
        },
        {
          tools: [
            {
              name: "bash",
              arguments: {
                command:
                  "printf 'PI_CONTRACT_BASH:'; /bin/cat contract.txt; printf '%s' \"$PPID\" > pi.pid",
              },
            },
          ],
        },
        { text: "PI_CONTRACT_FIRST_DONE" },
      );
      const completed = await client.prompt(session.sessionId, "PI_CONTRACT_FIRST_PROMPT");
      expect(completed.stopReason).toBe("end_turn");
      expect(await readFile(join(fixture.cwd, "contract.txt"), "utf8")).toBe("after\n");
      expect(text(client.updates)).toContain("PI_CONTRACT_FIRST_DONE");
      expect(text(client.updates, "agent_thought_chunk")).toContain("PI_CONTRACT_THINKING");
      expect(client.updates.some((update) => update.kind === "execute")).toBe(true);
      const terminalOutput = client.updates
        .map((update) => {
          const output = update._meta?.["terminal_output"] as { data?: string } | undefined;
          return output?.data ?? "";
        })
        .join("");
      expect(terminalOutput).toContain("PI_CONTRACT_BASH:after");
      expect(JSON.stringify(client.updates)).toContain('"type":"diff"');
      expect(JSON.stringify(client.updates)).toContain('"terminal_exit"');
      // These are unsupported capabilities, not permission/MCP success claims.
      expect(client.requests).not.toContain("session/request_permission");
      expect(
        client.requests.some(
          (method) => method.startsWith("fs/") || method.startsWith("terminal/"),
        ),
      ).toBe(false);
      expect(existsSync(mcpMarker)).toBe(false);
      expect(
        fixture.requests.every(
          (request) =>
            !request.tools?.some((tool) => tool.function.name.includes("unused-contract-mcp")),
        ),
      ).toBe(true);
      expect(fixture.requests).toHaveLength(4);
      const firstContext = JSON.stringify(fixture.requests[0]?.messages);
      expect(firstContext).toContain("PI_CONTRACT_INSTRUCTIONS_BEFORE_LOAD");
      expect(firstContext).toContain("PI_CONTRACT_SKILL_DESCRIPTION");
      expect(JSON.stringify(fixture.requests[3]?.messages)).toContain("PI_CONTRACT_BASH:after");
      // Context occupancy is an ACP update; prompt results do not report billed usage.
      expect(completed).not.toHaveProperty("usage");
      expect(
        client.updates.filter((update) => update.sessionUpdate === "usage_update").at(-1),
      ).toMatchObject({ used: 18, size: 128_000 });
      const beforeStats = client.updates.length;
      const countBeforeStats = fixture.requests.length;
      expect((await client.prompt(session.sessionId, "/session")).stopReason).toBe("end_turn");
      expect(fixture.requests).toHaveLength(countBeforeStats);
      expect(text(client.updates.slice(beforeStats))).toMatch(/tokens/i);
      const mapPath = join(fixture.home, ".pi/pi-acp/session-map.json");
      const map = JSON.parse(await readFile(mapPath, "utf8")) as {
        version: number;
        sessions: Record<string, { sessionFile: string }>;
      };
      expect(map.version).toBe(1);
      const sessionFile = map.sessions[session.sessionId]?.sessionFile;
      expect(sessionFile?.startsWith(join(fixture.home, ".pi/agent/sessions/"))).toBe(true);
      if (!sessionFile) throw new Error("Missing native persisted session");
      const nativeHistory = await readFile(sessionFile, "utf8");
      expect(nativeHistory).toContain("PI_CONTRACT_FIRST_DONE");
      expect(nativeHistory).toContain('"input":11');
      await client.stop();
      // A different adapter process, same durable home and cwd; no in-memory shortcut.
      await writeFile(join(fixture.cwd, "AGENTS.md"), "PI_CONTRACT_INSTRUCTIONS_AFTER_LOAD\n");
      client = fixture.start();
      await initialize(client);
      const loaded = await client.request("session/load", {
        sessionId: session.sessionId,
        cwd: fixture.cwd,
        mcpServers,
      });
      expect(loaded.models.currentModelId).toBe(MODEL);
      expect(text(client.updates)).toContain("PI_CONTRACT_FIRST_DONE");
      expect(text(client.updates, "user_message_chunk")).toContain("PI_CONTRACT_FIRST_PROMPT");
      fixture.steps.push({ text: "PI_CONTRACT_RESUMED_DONE" });
      expect(
        (await client.prompt(session.sessionId, "/skill:contract-skill inspect after load"))
          .stopReason,
      ).toBe("end_turn");
      const resumedContext = JSON.stringify(fixture.requests.at(-1)?.messages);
      expect(resumedContext).toContain("PI_CONTRACT_FIRST_DONE");
      expect(resumedContext).toContain("PI_CONTRACT_INSTRUCTIONS_AFTER_LOAD");
      expect(resumedContext).toContain("PI_CONTRACT_SKILL_BODY");
      expect(existsSync(mapPath)).toBe(true);
      expect(existsSync(sessionFile)).toBe(true);
      expect(fixture.errors).toEqual([]);
      expect(fixture.steps).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  },
  60_000,
);

contractTest(
  "Given a real running bash tool, When ACP cancellation arrives, Then it settles cancelled and prevents a delayed side effect",
  async () => {
    const fixture = await createFixture();
    try {
      const client = fixture.start();
      await initialize(client);
      const session = await client.request("session/new", { cwd: fixture.cwd, mcpServers: [] });
      await client.request("session/set_config_option", {
        sessionId: session.sessionId,
        configId: "model",
        value: MODEL,
      });
      fixture.steps.push({
        tools: [
          {
            name: "bash",
            arguments: {
              command:
                "printf '%s' \"$$\" > running.pid; printf 'PI_CONTRACT_RUNNING'; sleep 3; printf leaked > delayed-marker",
            },
          },
        ],
      });
      const prompt = client.prompt(session.sessionId, "PI_CONTRACT_CANCEL_PROMPT");
      // Attach rejection handling before waiting for tool startup.
      const result = prompt.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await waitFor(() => existsSync(join(fixture.cwd, "running.pid")), "real bash startup");
      const pid = Number(await readFile(join(fixture.cwd, "running.pid"), "utf8"));
      expect(pid).toBeGreaterThan(1);
      client.cancel(session.sessionId);
      const settled = await result;
      if (!("value" in settled)) throw settled.error;
      expect(settled.value.stopReason).toBe("cancelled");
      await waitFor(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      }, "cancelled bash exit");
      await Bun.sleep(3_200);
      expect(existsSync(join(fixture.cwd, "delayed-marker"))).toBe(false);
      expect(
        client.updates.some(
          (update) => update.status === "failed" || update.status === "completed",
        ),
      ).toBe(true);
      expect(JSON.stringify(client.updates)).toContain("terminal_exit");
      fixture.steps.push({ text: "PI_CONTRACT_AFTER_CANCEL" });
      expect(
        (await client.prompt(session.sessionId, "Continue after cancellation")).stopReason,
      ).toBe("end_turn");
      expect(text(client.updates)).toContain("PI_CONTRACT_AFTER_CANCEL");
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  },
  45_000,
);

upgradeTest(
  "Given a Pi 0.99.2 native session, When upgrading to 1.0.0 and loading the same state, Then history and native tools survive with refreshed managed instructions",
  async () => {
    const previous = process.env["PI_ACP_PREVIOUS_PI_COMMAND"];
    if (previous === undefined)
      throw new Error("The upgrade contract requires the previous Pi binary.");
    expect(previous).toBe("/opt/pi-previous/node_modules/.bin/pi");
    const version = spawnSync(previous, ["--version"], { encoding: "utf8" });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe("0.99.2");
    const fixture = await createBootstrapFixture();
    try {
      const wrapper = join(fixture.bin, "mosoo-pi");
      const launcher = (command: string) =>
        fixture.wrapperSource.replace("exec /usr/local/bin/pi ", `exec '${command}' `);
      await writeFile(wrapper, launcher(previous));
      await fixture.materialize("FIRST");
      let client = fixture.start();
      await initialize(client);
      const session = await client.request("session/new", { cwd: fixture.cwd, mcpServers: [] });
      fixture.steps.push({ text: "PI_099_NATIVE_HISTORY_SURVIVES" });
      await client.prompt(
        session.sessionId,
        "Keep this pre-upgrade conversation in native history.",
      );
      expect(text(client.updates)).toContain("PI_099_NATIVE_HISTORY_SURVIVES");
      await client.stop();
      await writeFile(wrapper, launcher(pi));
      await fixture.materialize("COLD");
      client = fixture.start();
      await initialize(client);
      const loaded = await client.request("session/load", {
        sessionId: session.sessionId,
        cwd: fixture.cwd,
        mcpServers: [],
      });
      expect(loaded.models.currentModelId).toBe(`mosoo/${BOOTSTRAP_MODEL}`);
      expect(text(client.updates)).toContain("PI_099_NATIVE_HISTORY_SURVIVES");
      fixture.steps.push(
        { tools: [{ name: "bash", arguments: { command: "printf PI_V1_RESTORED_TOOL" } }] },
        { text: "PI_V1_UPGRADE_DONE" },
      );
      expect(
        (await client.prompt(session.sessionId, "Run a native shell tool after upgrading."))
          .stopReason,
      ).toBe("end_turn");
      const messages = JSON.stringify(fixture.requests.at(-1)?.messages);
      expect(messages).toContain("PI_099_NATIVE_HISTORY_SURVIVES");
      expect(messages).toContain("PI_V1_RESTORED_TOOL");
      expect(messages).toContain("PI_GENERATED_INSTRUCTIONS_COLD");
      expect(text(client.updates)).toContain("PI_V1_UPGRADE_DONE");
      expect(existsSync(fixture.marker)).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  },
  30_000,
);
