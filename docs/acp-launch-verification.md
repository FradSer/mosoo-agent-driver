# ACP launch configuration verification

Base: `langgenius/mosoo-agent-driver` main at
`ef16d02158081e7282e78650c551d103214b0c7f`.

## Change boundary

- The host may pass `acpLaunch: { command, args }` to
  `AGENT_DRIVER_PROVIDER_REGISTRY.createBackend` or its ACP descriptor.
- Each backend validates, copies, and freezes its launch at construction and
  reuses it for startup and cancellation reconnects. Explicit configuration
  never reads the legacy fallback command or args.
- Non-ACP registry and descriptor entry points reject ACP launch options.
- The default CLI path still uses the existing fallback environment variables;
  OpenCode's native instructions, `acp-fallback` identity, resume references,
  process supervision, and capability declarations are unchanged.
- There is no wire schema, new runtime admission, production image, host
  repository pin, or production dependency change. Pi is tested separately as a
  [fixed binary pair](./pi-acp-compatibility.md).

## Local checks

The recorded environment uses Linux x64, Bun `1.4.0` and Node `v24.19.0`.
The existing lockfile pins OpenCode `1.18.25`.

Type checking and the declaration/CLI build passed. Formatting and lint were
checked separately. No remote model calls or credentials were used.

The focused regression command was:

```sh
bun test \
  tests/acp-launch-configuration.test.ts \
  tests/acp-configuration.test.ts \
  tests/provider-registry.test.ts \
  tests/opencode-acp-contract.test.ts \
  tests/acp-session-setup.test.ts \
  tests/acp-event-translator-lifecycle.test.ts \
  tests/acp-event-translator-session-update.test.ts
```

Result: **110 passed, 2 failed**. The two failures are the new real backend
startup tests: independent registry launches and OpenCode native instruction
startup through the registry. Both stop in the unchanged path-scope code before
launch because this execution environment cannot resolve `/proc/<pid>/fd/<fd>`.
They remain ordinary tests with no skip or weakened filesystem protection.

The passing checks include launch parsing/validation, explicit configuration
isolation, immutable argv snapshots, non-ACP option rejection, existing session
and event behavior, and direct real OpenCode protocol negotiation and native
Skill discovery. The process tests are needed to verify actual independent
launches and the full native instruction path on a normal Linux test runner.

The pre-existing backend lifecycle suite was also attempted: combined with
configuration and registry tests, it produced 25 passes and 47 failures at the
same `/proc` boundary. In a separate untouched worktree at the base commit, this
focused command reproduced the same error:

```sh
bun test tests/acp-driver-backend.test.ts \
  -t 'uses OpenCode native instructions'
```

The failure is `ENOENT` from `realpath` in `acp-path-scope.ts` during root
acquisition. This comparison establishes a local environment blocker; it does
not establish that the changed lifecycle tests pass elsewhere.

## Remaining validation

Run `vp run check` and the process tests on a Linux runner with the required
`/proc` semantics before treating the branch as fully verified. Full repository
checks, image builds, live-provider E2E, and GitHub CI were not completed here.
No test result is substituted for those gates, and this report makes no release
or production-readiness claim.
