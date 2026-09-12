import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Runs the published adapter and Pi binaries against a deterministic loopback model.
// This is a standalone compatibility probe, not a Driver or live-provider E2E test.
assert.equal(process.platform, "linux", "This process-group cleanup probe targets Linux.");
assert.ok(
  process.argv.slice(2).every((argument) => argument === "--strict"),
  "Only --strict is supported.",
);
const strict = process.argv.includes("--strict");
const root = dirname(fileURLToPath(import.meta.url));
const fixture = await mkdtemp(join(tmpdir(), "mosoo-pi-compat-"));
const fixtureHome = join(fixture, "home");
const agentDir = join(fixtureHome, ".pi", "agent");
const cwd = join(fixture, "work");
const bin = join(fixture, "bin");
for (const path of [agentDir, cwd, bin]) await mkdir(path, { recursive: true });
const report = {
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  fixture,
  pair: { pi: "0.85.1", adapter: "0.0.33" },
  checks: [],
  requests: [],
  notifications: [],
  permissions: [],
};
const record = (name, status, details) => {
  report.checks.push({ name, status, details });
  console.log(JSON.stringify({ name, status, details }));
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let behavior = "tool";
let waitingResponse;
let mcpRequests = 0;
let sequence = 0;
const clients = [];
const server = createServer(async (req, res) => {
  if (req.url === "/mcp") {
    mcpRequests++;
    res.writeHead(500).end();
    return;
  }
  const chunks = [];
  for await (const part of req) chunks.push(part);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.writeHead(400).end();
    return;
  }
  report.requests.push({ path: req.url, authorization: req.headers.authorization, body });
  if (behavior === "provider-error") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: "fixture provider rejected request",
          type: "invalid_request_error",
          code: "fixture_failure",
        },
      }),
    );
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const send = (delta, finish_reason = null, usage) =>
    res.write(
      `data: ${JSON.stringify({ id: `chatcmpl-${++sequence}`, object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`,
    );
  if (behavior === "cancel") {
    send({ role: "assistant", content: "waiting" });
    waitingResponse = res;
    return;
  }
  send({ role: "assistant" });
  if (behavior === "tool" && body.messages.at(-1)?.role !== "tool") {
    send({ reasoning_content: "fixture thinking" });
    send({
      tool_calls: [
        {
          index: 0,
          id: "fixture-write",
          type: "function",
          function: {
            name: "write",
            arguments: JSON.stringify({ path: "artifact.txt", content: "pi-compat-artifact\n" }),
          },
        },
      ],
    });
    send({}, "tool_calls", { prompt_tokens: 21, completion_tokens: 7, total_tokens: 28 });
  } else {
    send({ reasoning_content: "fixture thinking" });
    send({
      content:
        behavior === "continuation"
          ? "fixture resumed successfully"
          : "fixture completed successfully",
    });
    send({}, behavior === "length" ? "length" : "stop", {
      prompt_tokens: 30,
      completion_tokens: 10,
      total_tokens: 40,
    });
  }
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
await writeFile(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      fixture: {
        baseUrl: `${baseUrl}/v1`,
        api: "openai-completions",
        apiKey: "fixture-token-only",
        models: ["alpha", "beta"].map((id) => ({
          id,
          name: id,
          reasoning: true,
          input: ["text"],
          contextWindow: 32000,
          maxTokens: 2000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        })),
      },
    },
  }),
);
await writeFile(
  join(agentDir, "settings.json"),
  JSON.stringify({
    quietStartup: true,
    defaultProvider: "fixture",
    defaultModel: "alpha",
    defaultThinkingLevel: "medium",
    retry: { enabled: false },
    compaction: { enabled: false },
  }),
);
await writeFile(
  join(cwd, "AGENTS.md"),
  "Compatibility fixture instruction: preserve PERSISTED_INSTRUCTION_SENTINEL.\n",
);
await mkdir(join(cwd, ".pi", "skills", "fixture-skill"), { recursive: true });
await writeFile(
  join(cwd, ".pi", "skills", "fixture-skill", "SKILL.md"),
  "---\nname: fixture-skill\ndescription: UNTRUSTED_PROJECT_SKILL_SENTINEL\n---\nFixture skill body.\n",
);
await mkdir(join(agentDir, "skills", "platform-skill"), { recursive: true });
await writeFile(
  join(agentDir, "skills", "platform-skill", "SKILL.md"),
  "---\nname: platform-skill\ndescription: PERSISTED_SKILL_SENTINEL\n---\nPlatform fixture skill body.\n",
);
// Suppress the adapter's npm update lookup. No remote provider or registry calls in the probe.
await writeFile(join(bin, "npm"), '#!/bin/sh\nprintf "0.85.1\\n"\n', { mode: 0o755 });

function start() {
  const child = spawn(
    process.execPath,
    [join(root, "node_modules", "pi-acp", "dist", "index.js")],
    {
      cwd,
      detached: true,
      env: {
        PATH: `${bin}:${join(root, "node_modules", ".bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: fixtureHome,
        PI_CODING_AGENT_DIR: agentDir,
        PI_ACP_PI_COMMAND: join(root, "node_modules", ".bin", "pi"),
        NO_COLOR: "1",
        TERM: "dumb",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let buffer = "";
  let stderr = "";
  let id = 0;
  const pending = new Map();
  const client = {
    child,
    notifications: [],
    permissions: [],
    get stderr() {
      return stderr;
    },
  };
  clients.push(client);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data) => {
    buffer += data;
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        record("valid ACP JSONL", "FAIL", line);
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const p = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(p.timer);
        if (message.error)
          p.reject(Object.assign(new Error(message.error.message), { rpcError: message.error }));
        else p.resolve(message.result);
      } else if (message.method === "session/request_permission") {
        client.permissions.push(message.params);
        report.permissions.push(message.params);
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { outcome: { outcome: "cancelled" } },
          }) + "\n",
        );
      } else {
        client.notifications.push(message);
        report.notifications.push(message);
      }
    }
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  child.on("exit", (code, signal) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(`adapter exited ${code}/${signal}: ${stderr}`));
    }
    pending.clear();
  });
  client.request = (method, params, timeout = 20000) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Timeout: ${method}; stderr=${stderr}`));
      }, timeout);
      pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
    });
  client.notify = (method, params) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  return client;
}
async function stop(client, name) {
  client.child.stdin.end();
  for (let i = 0; i < 20 && client.child.exitCode === null; i++) await delay(50);
  await delay(100);
  let groupPresent = null;
  let inspectionError;
  try {
    process.kill(-client.child.pid, 0);
    groupPresent = true;
  } catch (error) {
    if (error.code === "ESRCH") groupPresent = false;
    else inspectionError = String(error);
  }
  const clean = groupPresent === false && client.child.exitCode === 0;
  record(name, clean ? "PASS" : "UNVERIFIED", {
    adapterExit: client.child.exitCode,
    processGroupPresent: groupPresent,
    inspectionError,
    note: clean
      ? "Adapter exited and its isolated process group no longer exists."
      : "Cleanup could not be verified: a process group remains or process inspection failed.",
  });
  try {
    process.kill(-client.child.pid, "SIGKILL");
  } catch {}
}
const initialize = (client) =>
  client.request("initialize", {
    protocolVersion: 1,
    clientInfo: { name: "mosoo-compatibility-probe", version: "1" },
    clientCapabilities: {},
  });
const prompt = (client, sessionId, text) =>
  client.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });

try {
  const versions = await Promise.all(
    ["pi-acp", "@earendil-works/pi-coding-agent"].map(
      async (name) =>
        JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"))
          .version,
    ),
  );
  assert.deepEqual(versions, ["0.0.33", "0.85.1"]);
  record("exact installed package versions", "PASS", versions);
  let client = start();
  const init = await initialize(client);
  assert.equal(init.agentInfo.version, "0.0.33");
  assert.equal(init.protocolVersion, 1);
  record("initialize", "PASS", init);
  const created = await client.request("session/new", {
    cwd,
    mcpServers: [{ type: "http", name: "fixture-mcp", url: `${baseUrl}/mcp`, headers: [] }],
  });
  const sessionId = created.sessionId;
  assert.ok(sessionId);
  assert.equal(report.requests.length, 0);
  record("session/new without provider request", "PASS", created);
  const selected = await client.request("session/set_config_option", {
    sessionId,
    configId: "model",
    value: "fixture/beta",
  });
  assert.equal(selected.configOptions.find((x) => x.id === "model").currentValue, "fixture/beta");
  record("explicit model selection", "PASS", selected);
  const turn = await prompt(client, sessionId, "Execute fixture write then finish.");
  assert.equal(turn.stopReason, "end_turn");
  assert.equal(await readFile(join(cwd, "artifact.txt"), "utf8"), "pi-compat-artifact\n");
  const updates = client.notifications.map((x) => x.params?.update).filter(Boolean);
  assert.ok(updates.some((x) => x.sessionUpdate === "tool_call"));
  assert.ok(
    updates.some((x) => x.sessionUpdate === "tool_call_update" && x.status === "completed"),
  );
  assert.ok(updates.some((x) => x.sessionUpdate === "agent_thought_chunk"));
  assert.ok(
    updates.some(
      (x) =>
        x.sessionUpdate === "agent_message_chunk" && x.content?.text.includes("fixture completed"),
    ),
  );
  assert.ok(report.requests.every((x) => x.body.model === "beta"));
  assert.ok(report.requests.every((x) => x.authorization === "Bearer fixture-token-only"));
  record("real Pi write tool, text/thinking stream and end_turn", "PASS", {
    turn,
    updates: updates.map((x) => x.sessionUpdate),
    providerRequests: report.requests.length,
    model: "beta",
  });
  record(
    "ordinary write approval enforcement",
    client.permissions.length ? "OBSERVED_REQUEST" : "UNSUPPORTED",
    { permissionRequests: client.permissions.length, fileWritten: true },
  );
  record("HTTP MCP forwarding", mcpRequests ? "OBSERVED_REQUEST" : "UNSUPPORTED", {
    advertised: init.agentCapabilities.mcpCapabilities,
    mcpRequests,
  });
  record(
    "structured usage forwarding",
    updates.some((x) => x.sessionUpdate === "usage_update") || turn.usage
      ? "OBSERVED"
      : "UNSUPPORTED",
    { promptResult: turn, providerSentUsage: true },
  );
  const map = JSON.parse(
    await readFile(join(fixtureHome, ".pi", "pi-acp", "session-map.json"), "utf8"),
  );
  record("persistence paths", "OBSERVED", {
    mapPath: join(fixtureHome, ".pi", "pi-acp", "session-map.json"),
    stored: map.sessions[sessionId],
  });
  await stop(client, "adapter EOF child cleanup after completed prompt");

  client = start();
  await initialize(client);
  const restored = await client.request("session/load", { sessionId, cwd, mcpServers: [] });
  record("session/load after process restart", "PASS", restored);
  behavior = "continuation";
  const continued = await prompt(client, sessionId, "Continue from restored history.");
  const last = report.requests.at(-1).body;
  assert.equal(continued.stopReason, "end_turn");
  assert.equal(last.model, "beta");
  const serialized = JSON.stringify(last.messages);
  assert.ok(serialized.includes("pi-compat-artifact"));
  assert.ok(serialized.includes("PERSISTED_INSTRUCTION_SENTINEL"));
  assert.ok(serialized.includes("PERSISTED_SKILL_SENTINEL"));
  record("restored history, instruction and Skill availability", "PASS", {
    continued,
    model: last.model,
    priorToolResultPresent: true,
    instructionPresent: true,
    skillDescriptionPresent: true,
    note: "Global platform-provisioned Skill description and request contents verified; no claim of model obedience or Mosoo cold restore.",
  });
  record(
    "untrusted project Skill availability",
    serialized.includes("UNTRUSTED_PROJECT_SKILL_SENTINEL") ? "OBSERVED" : "TRUST_GATED",
    {
      note: "Pi 0.85.1 requires project trust before .pi/skills discovery. Trust has not been granted by this probe.",
    },
  );
  behavior = "length";
  const lengthResult = await prompt(client, sessionId, "Exercise max-token finish.");
  record("length finish reason", lengthResult.stopReason === "max_tokens" ? "PASS" : "FAIL", {
    providerFinishReason: "length",
    acp: lengthResult,
  });
  behavior = "provider-error";
  try {
    const errorResult = await prompt(client, sessionId, "Exercise provider error.");
    record("provider error outcome", "FAIL", { providerHttpStatus: 400, acp: errorResult });
  } catch (error) {
    record("provider error outcome", error.rpcError ? "PASS" : "FAIL", {
      providerHttpStatus: 400,
      error: String(error),
      rpcError: error.rpcError,
    });
  }
  behavior = "cancel";
  const cancelTurn = prompt(client, sessionId, "Wait for cancellation.");
  for (let i = 0; i < 100 && !waitingResponse; i++) await delay(20);
  assert.ok(waitingResponse);
  client.notify("session/cancel", { sessionId });
  const cancelled = await cancelTurn;
  assert.equal(cancelled.stopReason, "cancelled");
  record("in-flight cancellation", "PASS", cancelled);
  waitingResponse.end();
  await stop(client, "adapter EOF child cleanup after cancellation");

  // Lock the observed capabilities and limitations; a changed baseline requires review.
  const baseline = JSON.parse(await readFile(join(root, "observed-results.json"), "utf8"));
  assert.deepEqual(
    report.checks.map(({ name, status }) => ({ name, status })),
    baseline.checks.map(({ name, status }) => ({ name, status })),
  );
  report.baselineMatched = true;
  // Default success means this pinned baseline was reproduced, not production readiness.
  // Strict mode exposes known compatibility blockers as exit 2.
  if (strict && report.checks.some(({ status }) => status === "FAIL" || status === "UNSUPPORTED"))
    process.exitCode = 2;
} catch (error) {
  record("probe exception", "FAIL", {
    message: String(error),
    stack: error.stack,
    rpcError: error.rpcError,
  });
  process.exitCode = 1;
} finally {
  for (const client of clients) {
    if (client.child.exitCode === null) {
      try {
        process.kill(-client.child.pid, "SIGKILL");
      } catch {}
    }
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(join(root, "probe-results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Evidence: ${join(root, "probe-results.json")}`);
  console.log(
    `Exit ${process.exitCode ?? 0}: ${report.baselineMatched ? "pinned baseline reproduced; known compatibility blockers remain" : "probe or baseline verification failed"}`,
  );
}
