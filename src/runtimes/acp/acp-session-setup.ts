import { methods as acpMethods, RequestError } from "@agentclientprotocol/sdk";
import type {
  AgentCapabilities,
  ClientContext,
  LoadSessionRequest,
  NewSessionRequest,
  ResumeSessionRequest,
} from "@agentclientprotocol/sdk";

import type { DriverStartInput } from "../../protocol/start";
import {
  buildMcpServers,
  assertMcpSupport,
  supportsAdditionalDirs,
  supportsSessionClose,
  supportsSessionLoad,
  supportsSessionResume,
  toRequestMeta,
} from "./acp-configuration";
import { readPiModelId, readPiThinkingLevel } from "./pi-acp-bootstrap";
import { isRecord } from "./acp-types";
import type { JsonObject } from "./acp-types";

export type AcpSessionSetupMode = "created" | "loaded" | "resumed";

export interface AcpSessionSetup {
  readonly mode: AcpSessionSetupMode;
  readonly raw: JsonObject;
  readonly sessionId: string;
}

interface AcpSessionSetupInput {
  readonly agentCapabilities: AgentCapabilities | null;
  readonly connection: ClientContext;
  readonly currentSessionId: string | null;
  readonly payload: DriverStartInput;
  replaySession<T>(operation: () => Promise<T>): Promise<T>;
}

type AcpSessionRestoreOperation = "close" | "load" | "resume";

function restoreFailureCategory(error: unknown): string {
  if (!(error instanceof RequestError)) {
    return "native_session_restore_failed";
  }

  switch (error.code) {
    case -32_002:
    case -32_602: {
      return "native_session_unavailable";
    }
    case -32_800: {
      return "native_session_restore_cancelled";
    }
    default: {
      return "native_session_restore_failed";
    }
  }
}

async function restoreAcpSession<T>(
  operation: AcpSessionRestoreOperation,
  sessionId: string,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : "ACP agent rejected session restore.";
    throw new Error(
      `ACP native session pointer ${JSON.stringify(sessionId)} ${operation} failed [category=${restoreFailureCategory(error)}]: ${message}`,
      { cause: error },
    );
  }
}

async function configurePiSession(
  input: AcpSessionSetupInput,
  setup: AcpSessionSetup,
): Promise<AcpSessionSetup> {
  if (input.payload.runtime !== "pi-acp") return setup;

  let options = setup.raw["configOptions"];
  const findOption = (id: string) =>
    Array.isArray(options)
      ? options.find((candidate) => isRecord(candidate) && candidate["id"] === id)
      : undefined;
  const select = async (configId: string, value: string, optional = false) => {
    const option = findOption(configId);
    if (option === undefined && optional) return;
    if (!isRecord(option) || option["type"] !== "select" || !Array.isArray(option["options"])) {
      throw new Error(`Pi ACP session is missing the ${configId} select option.`);
    }
    if (!option["options"].some((entry) => isRecord(entry) && entry["value"] === value)) {
      throw new Error(`Pi ACP ${configId} option does not offer the configured value: ${value}.`);
    }
    const result = await input.connection.request(acpMethods.agent.session.setConfigOption, {
      configId,
      sessionId: setup.sessionId,
      value,
    });
    const selected = result.configOptions.find((candidate) => candidate.id === configId);
    if (selected?.currentValue !== value) {
      throw new Error(
        `Pi ACP ${configId} selection did not confirm the configured value: ${value}.`,
      );
    }
    options = result.configOptions;
  };

  const model = `mosoo/${readPiModelId(input.payload)}`;
  await select("model", model);
  const thinking = readPiThinkingLevel(input.payload);
  await select("thought_level", thinking, thinking === "off");
  // A thinking update returns the entire configuration; don't admit a session
  // whose adapter silently changed the model while applying the frozen effort.
  const finalModel = findOption("model");
  if (!isRecord(finalModel) || finalModel["currentValue"] !== model) {
    throw new Error("Pi ACP model changed while selecting the thinking level.");
  }
  return { ...setup, raw: { ...setup.raw, configOptions: options } };
}

export async function setupAcpSession(input: AcpSessionSetupInput): Promise<AcpSessionSetup> {
  const mcpServers = buildMcpServers(input.payload);
  assertMcpSupport(input.agentCapabilities, mcpServers);
  const existingSessionId = input.currentSessionId;
  const additionalDirectories = input.payload.execution.session.additionalDirectories;

  if (additionalDirectories.length > 0 && !supportsAdditionalDirs(input.agentCapabilities)) {
    throw new Error("ACP agent does not advertise additionalDirectories support.");
  }

  const baseParams = {
    _meta: toRequestMeta({
      sessionContext: input.payload.execution.session.context,
    }),
    ...(additionalDirectories.length === 0 ? {} : { additionalDirectories }),
    cwd: input.payload.execution.session.cwd,
    mcpServers,
  } satisfies NewSessionRequest;

  if (existingSessionId !== null && supportsSessionResume(input.agentCapabilities)) {
    const params = { ...baseParams, sessionId: existingSessionId } satisfies ResumeSessionRequest;
    const resume = () =>
      restoreAcpSession("resume", existingSessionId, () =>
        input.connection.request(acpMethods.agent.session.resume, params),
      );
    let result = await resume();

    if (supportsSessionClose(input.agentCapabilities)) {
      // A crashed client can leave provider work orphaned. Close waits for its
      // cancellation before the second resume hands the session to this driver.
      await restoreAcpSession("close", existingSessionId, () =>
        input.connection.request(acpMethods.agent.session.close, {
          sessionId: existingSessionId,
        }),
      );
      result = await resume();
    }

    return configurePiSession(input, {
      mode: "resumed",
      raw: isRecord(result) ? result : {},
      sessionId: existingSessionId,
    });
  }

  if (existingSessionId !== null && supportsSessionLoad(input.agentCapabilities)) {
    return input.replaySession(async () => {
      const params = { ...baseParams, sessionId: existingSessionId } satisfies LoadSessionRequest;
      const result = await restoreAcpSession("load", existingSessionId, () =>
        input.connection.request(acpMethods.agent.session.load, params),
      );
      return configurePiSession(input, {
        mode: "loaded",
        raw: isRecord(result) ? result : {},
        sessionId: existingSessionId,
      });
    });
  }

  if (existingSessionId !== null) {
    throw new Error("ACP agent cannot restore the requested native session.");
  }

  const result = await input.connection.request(acpMethods.agent.session.new, baseParams);

  if (result.sessionId.trim().length === 0) {
    throw new Error("ACP driver backend agent returned an empty session id.");
  }

  return configurePiSession(input, {
    mode: "created",
    raw: isRecord(result) ? result : {},
    sessionId: result.sessionId,
  });
}
