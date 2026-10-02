import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const ADAPTER_VERSION = "0.0.34";
export const PI_VERSION = "1.0.0";
export const MODEL = "contract/selected";
const root = resolve(import.meta.dir, "../../..");
const adapterPackage = join(root, "node_modules/pi-acp");
const piPackage = join(root, "node_modules/@earendil-works/pi-coding-agent");
export const adapter = join(adapterPackage, "dist/index.js");
export const pi = join(root, "node_modules/.bin/pi");
const node = process.env["PI_CONTRACT_NODE"] ?? "node";

export interface Update {
  sessionUpdate: string;
  toolCallId?: string;
  status?: string;
  kind?: string;
  content?: { type: string; text?: string } | Array<Record<string, unknown>>;
  _meta?: Record<string, unknown>;
  configOptions?: Array<{ id: string; currentValue: string }>;
}
export interface Reply {
  sessionId: string;
  protocolVersion: number;
  agentInfo: { name: string; version: string };
  agentCapabilities: { loadSession: boolean; mcpCapabilities: { http: boolean; sse: boolean } };
  models: { currentModelId: string; availableModels: Array<{ modelId: string }> };
  configOptions: Array<{ id: string; currentValue: string }>;
  stopReason: string;
}
interface Wire {
  id?: number;
  method?: string;
  params?: { update: Update };
  result?: Reply;
  error?: unknown;
}
export interface ModelRequest {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<{ function: { name: string } }>;
}
export interface Tool {
  name: string;
  arguments: Record<string, unknown>;
}
export interface ModelStep {
  tools?: Tool[];
  text?: string;
  thinking?: string;
}

export async function waitFor(
  check: () => boolean,
  label: string,
  timeout = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await Bun.sleep(20);
  }
}

function killOwnedGroup(pid: number | undefined): void {
  try {
    if (pid) process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

export class AcpProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly updates: Update[] = [];
  readonly requests: string[] = [];
  readonly closed: Promise<void>;
  stderr = "";
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (reply: Reply) => void; reject: (error: Error) => void }
  >();

  constructor(cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(node, [adapter], { cwd, env, stdio: "pipe", detached: true });
    this.closed = new Promise((resolveClosed) => this.child.once("close", resolveClosed));
    let buffer = "";
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line) as Wire;
        if (message.method) {
          this.requests.push(message.method);
          if (message.method === "session/update" && message.params)
            this.updates.push(message.params.update);
          if (message.id !== undefined) {
            // Intentionally deny all permission requests. Ordinary tools still execute.
            this.child.stdin.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "cancelled" } } })}\n`,
            );
          }
        } else if (message.id !== undefined) {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) pending?.reject(new Error(JSON.stringify(message.error)));
          else if (message.result) pending?.resolve(message.result);
        }
      }
    });
    const fail = (error: Error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    this.child.once("error", fail);
    this.child.once("exit", () => fail(new Error(`Adapter exited: ${this.stderr}`)));
    this.child.stdin.on("error", fail);
  }

  async request(method: string, params: Record<string, unknown>): Promise<Reply> {
    const id = ++this.sequence;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Reply>((resolveReply, reject) => {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`ACP timeout ${method}: ${this.stderr}`));
        }, 15_000);
        this.pending.set(id, { resolve: resolveReply, reject });
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    } finally {
      clearTimeout(timer);
    }
  }

  cancel(sessionId: string): void {
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } })}\n`,
    );
  }

  prompt(sessionId: string, text: string): Promise<Reply> {
    return this.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const children = spawnSync("/bin/ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
      .stdout.trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter(([, parent]) => parent === this.child.pid)
      .map(([pid]) => pid)
      .filter((pid): pid is number => pid !== undefined);
    this.child.stdin.end();
    try {
      await waitFor(
        () => this.child.exitCode !== null || this.child.signalCode !== null,
        "adapter graceful exit",
        2_000,
      );
      await waitFor(
        () =>
          children.every((pid) => {
            try {
              process.kill(pid, 0);
              return false;
            } catch {
              return true;
            }
          }),
        "native Pi child exit without test force-kill",
        2_000,
      );
    } finally {
      // The test owns this detached group only. Cleanup is not proof of native supervision.
      killOwnedGroup(this.child.pid);
      await this.closed;
    }
  }
}

export async function createFixture(
  options: {
    homeName?: string;
    model?: string;
    basePath?: string;
  } = {},
) {
  const model = options.model ?? "selected";
  const basePath = options.basePath ?? "/v1";
  let authorization: string | undefined;
  for (const [directory, expected] of [
    [adapterPackage, ADAPTER_VERSION],
    [piPackage, PI_VERSION],
  ]) {
    if (!directory) throw new Error("Missing package path");
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      version: string;
    };
    if (manifest.version !== expected)
      throw new Error(`Expected exact ${directory}@${expected}, got ${manifest.version}`);
  }
  if (!existsSync(pi)) throw new Error(`Install the pinned Pi executable: ${pi}`);
  const directory = await mkdtemp(join(tmpdir(), "pi-acp-pinned-contract-"));
  const home = join(directory, options.homeName ?? "home");
  const cwd = join(directory, "workspace");
  const bin = join(directory, "bin");
  const agentDir = join(home, ".pi/agent");
  const networkLog = join(directory, "network.log");
  await Promise.all([cwd, bin, agentDir].map((path) => mkdir(path, { recursive: true })));
  await writeFile(networkLog, "");
  // Adapter performs an unconditional npm view; never let that escape to a registry.
  await writeFile(join(bin, "npm"), "#!/bin/sh\nexit 1\n");
  await chmod(join(bin, "npm"), 0o755);
  await symlink(pi, join(bin, "pi"));
  const nodePath = spawnSync("/usr/bin/which", [node], { encoding: "utf8" }).stdout.trim();
  if (!nodePath) throw new Error(`Node executable unavailable: ${node}`);
  await symlink(nodePath, join(bin, "node"));
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
    TMPDIR: directory,
    SHELL: "/bin/bash",
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_DATA_HOME: join(home, ".local/share"),
    PI_CODING_AGENT_DIR: agentDir,
    PI_ACP_PI_COMMAND: pi,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    PI_CONTRACT_NETWORK_LOG: networkLog,
    NODE_OPTIONS: `--import=${join(import.meta.dir, "loopback-only.mjs")}`,
  };
  const version = spawnSync(pi, ["--version"], { env, cwd, encoding: "utf8", timeout: 10_000 });
  if (version.status !== 0 || version.stdout.trim() !== PI_VERSION)
    throw new Error(`Pi executable mismatch: ${version.stdout} ${version.stderr}`);
  const requests: ModelRequest[] = [];
  const errors: string[] = [];
  const steps: ModelStep[] = [];
  const server = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      if (request.url !== `${basePath}/chat/completions`)
        throw new Error(`Unexpected URL ${request.url}`);
      if (authorization !== undefined && request.headers.authorization !== authorization)
        throw new Error("Unexpected fixture authorization");
      const parsed = JSON.parse(body) as ModelRequest;
      requests.push(parsed);
      if (parsed.model !== model) throw new Error(`Unexpected model ${parsed.model}`);
      const step = steps.shift();
      if (!step) throw new Error("Unexpected model request (no scripted response)");
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) => {
        response.write(
          `data: ${JSON.stringify({ id: `response-${requests.length}`, object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      };
      chunk({ role: "assistant" });
      if (step.thinking) chunk({ reasoning_content: step.thinking });
      if (step.text) chunk({ content: step.text });
      for (const [index, tool] of (step.tools ?? []).entries()) {
        chunk({
          tool_calls: [
            {
              index,
              id: `tool-${requests.length}-${index}`,
              type: "function",
              function: { name: tool.name, arguments: JSON.stringify(tool.arguments) },
            },
          ],
        });
      }
      chunk({}, step.tools?.length ? "tool_calls" : "stop");
      response.write(
        `data: ${JSON.stringify({ id: `response-${requests.length}`, object: "chat.completion.chunk", created: 1, model, choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })}\n\ndata: [DONE]\n\n`,
      );
      response.end();
    } catch (error) {
      errors.push(String(error));
      response.writeHead(500).end("Contract fixture rejected request");
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        contract: {
          api: "openai-completions",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: "loopback-fixture-not-a-credential",
          models: ["initial", "selected"].map((id) => ({
            id,
            reasoning: true,
            contextWindow: 128000,
            maxTokens: 1024,
            cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
          })),
        },
      },
    }),
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "contract",
      defaultModel: "initial",
      defaultThinkingLevel: "medium",
      defaultProjectTrust: "always",
      enableSkillCommands: true,
      quietStartup: true,
      enableInstallTelemetry: false,
      cacheWarming: "off",
      retry: { enabled: false },
      compaction: { enabled: false },
    }),
  );
  await writeFile(join(cwd, "AGENTS.md"), "PI_CONTRACT_INSTRUCTIONS_BEFORE_LOAD\n");
  const skill = join(cwd, ".agents/skills/contract-skill/SKILL.md");
  await mkdir(dirname(skill), { recursive: true });
  await writeFile(
    skill,
    "---\nname: contract-skill\ndescription: PI_CONTRACT_SKILL_DESCRIPTION\n---\nPI_CONTRACT_SKILL_BODY\n",
  );
  const processes: AcpProcess[] = [];
  return {
    directory,
    home,
    cwd,
    skill,
    env,
    steps,
    requests,
    errors,
    networkLog,
    agentDir,
    bin,
    baseUrl: `http://127.0.0.1:${address.port}${basePath}`,
    expectAuthorization(value: string) {
      authorization = value;
    },
    start() {
      const process = new AcpProcess(cwd, env);
      processes.push(process);
      return process;
    },
    async cleanup() {
      const stopped = await Promise.allSettled(processes.map((process) => process.stop()));
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      const blocked = await readFile(networkLog, "utf8");
      await rm(directory, { recursive: true, force: true });
      if (blocked) throw new Error(`Non-loopback connections attempted: ${blocked}`);
      const failed = stopped.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    },
  };
}
