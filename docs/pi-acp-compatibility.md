# Fixed-version Pi ACP compatibility findings

The standalone pair can launch, stream, execute a real file-write tool, cancel,
and reload a session. It is **not ready to advertise as a supported Mosoo runtime**:
ordinary-tool approval, MCP forwarding, structured usage, and accurate terminal
outcomes remain blockers. This change does not enable Pi in the runtime catalog
or install it in the production image.

The scope follows the [maintainer's requested initial Driver contribution](https://github.com/langgenius/mosoo/issues/486#issuecomment-5569380406).
The probe runs the published adapter and Pi binaries, with a deterministic model
server listening only on `127.0.0.1`. It does not use Driver's ACP backend or the
Mosoo application, and is not a live-provider or cold-restore E2E test.

## Exact versions and provenance

| Component                         | Version  | Source revision                                                                                                                    |
| --------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pi-acp`                          | `0.0.33` | [`1bfcb394088ed879db8fd936b570bb626017f878`](https://github.com/svkozak/pi-acp/commit/1bfcb394088ed879db8fd936b570bb626017f878)    |
| `@earendil-works/pi-coding-agent` | `0.85.1` | [`d981de1229ef899957bbe968bc8dcda02a21f477`](https://github.com/earendil-works/pi/commit/d981de1229ef899957bbe968bc8dcda02a21f477) |
| Adapter's resolved ACP SDK        | `0.26.0` | Recorded in the isolated npm lockfile                                                                                              |

These are exact release pins, not a claim that every newer Pi version is
compatible. The adapter's release source is identical to the maintainer-linked
`d1cffc047ab37a096ee70ca39cfc1de463db8d12` apart from a README edit. The Driver uses
a separate ACP SDK version; shared-backend integration still needs its own test.

Registry integrity values, also enforced by the isolated `package-lock.json`:

```text
pi-acp@0.0.33
sha512-vX9kY1tK14E72G4dBAx+RGCk/k7XPjTHls6dLUxA8WSkBav6B6JHuSBv3eusp50LCR/GTRsR2kIKsG0Z5jANzw==

@earendil-works/pi-coding-agent@0.85.1
sha512-FGRN+OHbWaefBPGaTggAdLjrIHW+s2PzLyglz/5dfLzb9of7uuXMXYC0fJIeZTw+shS32o2cuQ9jF7YSDuL/oQ==
```

Pi requires Node `>=22.19.0`. The recorded run used Node `v24.19.0` on Linux x64.
The probe's process-group cleanup check targets Linux.

## Reproduce

From the repository root:

```sh
cd scripts/pi-acp-compatibility
npm ci --ignore-scripts --no-audit --no-fund
node probe.mjs
node probe.mjs --strict
```

The installation downloads the pinned npm packages. During the probe, the only
configured provider is a local fixture using a dummy token. The adapter child
receives a minimal environment and an isolated temporary home; existing provider
credentials and user configuration are not inherited. A fixture `npm` executable
suppresses the adapter's update lookup. The model's only requested tool action
writes `artifact.txt` inside the temporary workspace.

The default command exits `0` when the recorded baseline, including known
limitations, is reproduced. It exits `1` for an unexpected result or probe error.
`--strict` exits `2` when the baseline is reproduced but known failed or
unsupported capabilities remain. **An exit code of 0 does not certify production
compatibility.**

[`observed-results.json`](../scripts/pi-acp-compatibility/observed-results.json)
contains the normalized baseline. Each run writes an ignored `probe-results.json`
with the complete synthetic ACP/provider transcript and temporary fixture path.
The fixture files remain available for inspection; the probe terminates its
isolated process groups. The tool's npm package and lockfile are separate from
Driver's dependencies, Bun tests, TypeScript inputs, and production image.

## Executed results

| Check                                    | Result                     | Evidence                                                                                                                                                   |
| ---------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch and initialize                    | Passed                     | Published adapter reports version `0.0.33`, protocol `1`.                                                                                                  |
| New session                              | Passed                     | Creates a session without an HTTP model request; exposes two local models.                                                                                 |
| Explicit model selection                 | Passed                     | `session/set_config_option` changes `fixture/alpha` to `fixture/beta`; subsequent requests use `beta`.                                                     |
| Tool execution and file mutation         | Passed                     | Real Pi `write` produces the expected bytes; ACP emits tool start and completion.                                                                          |
| Text and thinking streams                | Passed                     | Both `agent_message_chunk` and `agent_thought_chunk` observed.                                                                                             |
| Normal completion and cancellation       | Passed                     | A normal prompt returns `end_turn`; cancellation interrupts an open stream and returns `cancelled`.                                                        |
| Process restart and session load         | Passed, limited            | New adapter process loads the prior session ID and model; continuation contains prior tool output. This reuses the same local disk.                        |
| Instructions and global Skill after load | Passed, limited            | Outgoing request contains the `AGENTS.md` sentinel and platform-provisioned global Skill description. Model obedience and Skill execution are not tested.  |
| Project Skills                           | Trust-gated                | An untrusted `.pi/skills` description is absent. The probe does not grant project trust.                                                                   |
| EOF cleanup                              | Passed, limited            | After completion and cancellation, adapter exits `0` and its isolated process group no longer exists. Abrupt crashes and container cleanup are not tested. |
| Ordinary-tool approval                   | Unsupported in tested path | Pi writes a file with zero ACP permission requests.                                                                                                        |
| HTTP MCP forwarding                      | Unsupported                | Adapter advertises HTTP/SSE `false`; an HTTP endpoint intentionally supplied to `session/new` receives zero requests.                                      |
| Structured usage                         | Unsupported                | Fixture supplies token counts; no ACP `usage_update` or prompt-result usage is emitted.                                                                    |
| Maximum-token outcome                    | Failed                     | Provider `finish_reason: "length"` becomes ACP `end_turn`, not `max_tokens`.                                                                               |
| Provider error outcome                   | Failed                     | A model HTTP `400` error also becomes ACP `end_turn`.                                                                                                      |

The last two failures mean that receiving `end_turn` alone cannot establish a
successful Pi execution. They are compatibility findings, not changes made to
the upstream adapter in this contribution.

## Source findings and integration boundaries

- **Launch ownership:** the adapter launches `PI_ACP_PI_COMMAND` or `pi` with
  `--mode rpc --no-themes`, adding `--session <path>` for restore. Arguments and
  executable selection must remain platform-owned.
  [Pinned subprocess implementation](https://github.com/svkozak/pi-acp/blob/1bfcb394088ed879db8fd936b570bb626017f878/src/pi-rpc/process.ts).
- **MCP:** `session/new` stores `mcpServers` without connecting them to Pi. This
  limitation includes more than HTTP; installing an extension is not evidence
  that Mosoo endpoints, authorization, and lifecycle are wired. MCP-dependent
  configurations need a readiness block until a bridge is verified.
  [Pinned adapter agent](https://github.com/svkozak/pi-acp/blob/1bfcb394088ed879db8fd936b570bb626017f878/src/acp/agent.ts).
- **Permissions, events, and usage:** extension `confirm`/`select` requests map
  to ACP permissions, while ordinary tool execution events only generate
  notifications. `thinking_delta` is forwarded despite the README's older
  no-thought-stream statement. Structured provider usage is not forwarded.
  [Pinned session translation](https://github.com/svkozak/pi-acp/blob/1bfcb394088ed879db8fd936b570bb626017f878/src/acp/session.ts).
- **Outcomes:** the adapter resolves `agent_settled` as `end_turn` unless
  cancelled, and its agent maps a session's generic error result to `end_turn`.
  The probe confirms the resulting length/error ambiguity.
  [Session handling](https://github.com/svkozak/pi-acp/blob/1bfcb394088ed879db8fd936b570bb626017f878/src/acp/session.ts),
  [prompt response mapping](https://github.com/svkozak/pi-acp/blob/1bfcb394088ed879db8fd936b570bb626017f878/src/acp/agent.ts).
- **State isolation:** Pi's session/config tree can use `PI_CODING_AGENT_DIR`,
  but the adapter map uses `os.homedir()/.pi/pi-acp/session-map.json` independently.
  The probe isolates both through the child environment. A production restore
  must preserve both state trees and isolate them from OpenCode and other
  executions; `loadSession: true` alone proves none of those guarantees.
  [Adapter paths](https://github.com/svkozak/pi-acp/blob/1bfcb394088ed879db8fd936b570bb626017f878/src/acp/paths.ts),
  [mapping store](https://github.com/svkozak/pi-acp/blob/1bfcb394088ed879db8fd936b570bb626017f878/src/acp/session-store.ts).
- **Configuration and trust:** Pi supports a custom `models.json` with a proxy
  URL and environment-referenced token, but project Skills require project
  trust. Future integration must render frozen configuration using Mosoo's
  expiring model-bound grant, verify the requested model before prompting,
  and define how platform-provisioned Skills remain available after load.
  The fixture's dummy token is not a production credential strategy.
  [Pinned model configuration](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/models.md),
  [pinned Skill discovery](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/skills.md).

The remaining evidence gates are Driver transport/event conformance, real Mosoo
proxy grants, container image installation, cold workspace restoration, and
ordinary-tool denial enforcement. They are outside this initial launch-boundary
change; Pi stays unadvertised until those gates and the observed blockers are
resolved.
