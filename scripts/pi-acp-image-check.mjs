// Build-time wire check: initialize does not create a session or call a model.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export function verifyPiInitialize(response) {
  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.equal(response.error, undefined, "Pi ACP initialize must succeed");
  assert.equal(response.result?.protocolVersion, 1);
  assert.equal(response.result?.agentInfo?.name, "pi-acp");
  assert.equal(response.result?.agentInfo?.version, "0.0.34");
  assert.deepEqual(response.result?.agentCapabilities, {
    loadSession: true,
    mcpCapabilities: { http: false, sse: false },
    promptCapabilities: { image: true, audio: false, embeddedContext: false },
    sessionCapabilities: { list: {}, delete: {} },
  });
}

export async function checkPiAcpImage(command = "/usr/local/bin/pi-acp") {
  const cwd = await mkdtemp(join(tmpdir(), "mosoo-pi-initialize-"));
  try {
    // Do not inherit credentials, user extensions, npm config, or Node preloads.
    const child = spawn(command, [], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: cwd,
        XDG_CONFIG_HOME: cwd,
        XDG_CACHE_HOME: cwd,
        XDG_DATA_HOME: cwd,
        PI_CODING_AGENT_DIR: join(cwd, "agent"),
        PI_ACP_PI_COMMAND: "/usr/local/bin/mosoo-pi",
        PI_OFFLINE: "1",
        PI_TELEMETRY: "0",
        npm_config_offline: "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const closed = new Promise((resolve) => child.once("close", resolve));
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    const lines = createInterface({ input: child.stdout });
    let timer;
    try {
      const response = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.stdin.on("error", reject);
        child.once("exit", (status) => reject(new Error(`Pi ACP exited ${status}: ${stderr}`)));
        lines.on("line", (line) => {
          try {
            const message = JSON.parse(line);
            if (message.id === 1) resolve(message);
          } catch (error) {
            reject(error);
          }
        });
        timer = setTimeout(
          () => reject(new Error(`Pi ACP initialize timed out: ${stderr}`)),
          15_000,
        );
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: 1,
              clientCapabilities: {},
              clientInfo: { name: "mosoo-image-check", version: "1" },
            },
          })}\n`,
        );
      });
      verifyPiInitialize(response);
    } finally {
      clearTimeout(timer);
      lines.close();
      child.kill("SIGKILL");
      await closed;
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  console.log(
    "Pi ACP 0.0.34: actual initialize and capability contract verified (no session/model).",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkPiAcpImage();
}
