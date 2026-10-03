# Pi v1.0.0 protocol-6 upgrade — verified 2026-10-02

## Source and result

The isolated Driver contribution is fully upgraded to the published Pi **1.0.0**, gitHead `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`. The latest published pi-acp remains **0.0.34**, gitHead `b0581c9c1d675e634234674484247008b03d69b4`. Package-manager installation updated `package.json` and `bun.lock`; container, runtime manifest, actual-package fixtures, assertions and documentation use the same pair. Pi's transitive packages are on the v1 line. Runtime dependencies and the existing other-runtime pins remain unchanged.

Latest Mosoo main was rechecked at `b0bf041d955e71b24ff19fd72cf015429308d25b`, which fixes Driver `6be35bad888462d6998c06aac7f215b4cf3406f2` and protocol 6. Source is `host/apps/driver`; `reviewable-driver` is a Git review copy on that baseline. `pi-v1-protocol6.patch` contains the cumulative contribution, including the prior protocol-6 port and its verified MCP cancellation fix. The contribution is published as [Driver draft PR #130](https://github.com/langgenius/mosoo-agent-driver/pull/130), paired with [Mosoo draft PR #654](https://github.com/langgenius/mosoo/pull/654).

The original protocol-3 user workspace and prior 0.99.2 evidence are preserved. `cleanup-v1.json` confirms zero differing snapshot files. This upgrade lives in the authorized isolated protocol-6 contribution; it has not been overlaid onto the original branch.

## Initial upgrade verification

Given old image pins, when asserting v1.0.0 admission, then the version contract fails: `pi-v1-red.log` has seven passes and one failure. After updating pins, `pi-v1-green.log` has eight passes and zero failures.

Given exact current packages, when ACP initializes, selects the frozen model and executes a real shell tool, then framing, resources, cancellation and cold restoration remain valid. Given a native session created by actual Pi 0.99.2, when the executable is switched to 1.0.0 and the persisted paths are restored, then old history, selected model, refreshed instructions and real bash execution survive; hostile extensions remain unexecuted.

Completed checks:

- `focused.log`: 71 config/registry/ACP setup/event tests passed; `typecheck.log` passed.
- `linux-check-final.log`: formatting, lint, typecheck, 1,352 tests passed, 45 expected skips, zero failures; build passed. Six actual current Pi/adapter contracts passed, with the opt-in old-version migration case skipped in that suite.
- The explicit `test:pi-upgrade` gate passed one test with 20 assertions; three unrelated opt-in cases skipped. It creates old native state using actual 0.99.2 and restores it using actual 1.0.0. The previous executable is retained only in the migration test image, never in production images. Invoking the gate without the previous executable fails explicitly.
- The packed stateful MCP regression passed one test and 24 assertions, including actual tool-call metadata and bounded asynchronous cancellation delivery.
- `host-contract-complete.log`: 49 tests passed against actual latest Mosoo proxy/auth and managed-environment modules, zero failures.
- `pi-image-build.log` and `all-image-build.log`: Linux/amd64 production images built and verified actual ACP initialization, installed and executable versions, runtime selection, Node 22.23.2, Bun 1.4.0, npm and Python/pip. Node meets Pi's >=22.19.0 requirement.
- `pi-tools-smoke.log`: production Pi completed an actual native shell round trip with networking disabled and deterministic loopback model responses. `all-tools-smoke.log`: Claude, Codex, OpenCode and Pi each completed the same actual native tool round trip.
- `real-e2e.log`: the installed packed Driver in the new Pi production image made four real provider requests via latest Mosoo HMAC, generation, credential-vault and proxy modules. All returned HTTP 200 using `cohere/north-mini-code:free`. Random file write/read matched; both tools emitted running/completed events; usage appeared. A fresh Driver restored the native session and returned the exact random conversation token without tools. The grant was absent from persisted Pi home.
- `proxy-live.log`: tampered/expired grants returned 401, stale generation/wrong model/wrong credential returned 403 without provider forwarding.
- `cleanup-v1.json`: proxy listener closed, temporary grant removed, host provider credential occurred zero times across 25 logs, original snapshot unchanged. Raw provider credential remained host-only.
- Fresh independent read-only review found no remaining P0–P2 issues in the upgrade, resource boundaries, version locks or native migration contract. Real model E2E was completed separately after the source review.

Both production images contain exactly the tested Driver artifact, SHA-256 `f8eb724f333369b23317674c07f82940a1aca3634e237e810eb2fd985369671c` (`pi-image-artifact.log`, `all-image-artifact.log`). Images: `mosoo-pi-v1-runtime:20261002` (ID `e51d1afd49c71e0886fb2ba31e944c45ecca8d0c43c01cfd7d844675e431db04`) and `mosoo-pi-v1-all:20261002` (ID `bd89592b50e9ed1d99cfb21a22fe153e560854a4dbd839a139f556262a05b58b`).

## Upstream compatibility and boundaries

The official 0.99.2→1.0.0 source diff changes fullscreen TUI defaults, codemode/image generation, Radius/OAuth, startup and deferred MCP restoration. RPC implementation and wire documentation are unchanged. The adapter uses RPC mode; the fixed wrapper disables extensions and project resources. Actual published package tests and production E2E confirm compatibility; no speculative compatibility layer or additional runtime abstraction was added.

The existing frozen Driver profile remains full-access, text-only, no Pi MCP and no additional directories. New native Pi features are not automatically exposed as Driver capabilities. Preserve both native session JSONL and the adapter session map for cold restoration. Downgrade to 0.99.2, corrupt-state migration and other providers/models are not certified.

The initial proxy E2E uses actual host proxy modules with temporary SQLite/D1 bindings and the packed Driver controller. The companion Mosoo contribution now implements product catalog admission, Cloudflare image bindings, capability gating and Session checkpoint persistence. A subsequent local Worker public-API E2E verifies actual provisioning and a real model turn; deployed cloud acceptance remains unverified. No production database or original working-tree file was changed.

The initial upgrade evidence is `linux-check-final.log`; earlier intermediate logs include corrected test-harness/dependency-path failures and are retained for traceability. Earlier 0.99.2 results do not certify this v1 artifact.

## Product admission follow-up — 2026-10-02

The companion host contribution makes Pi explicitly selectable with an OpenAI-compatible credential and a declared model. It adds `SandboxPi` using the existing Cloudflare Sandbox infrastructure, retains the canonical submodule URL and checkpointed Session home, and rejects unsupported MCP or supervised/tool restrictions. Custom model listings do not invent support beyond credential declarations. Driver fixes admit the fixed local Docker proxy hostname, normalize ACP command inputs and suppress Pi commands that could bypass frozen configuration. A Linux shutdown fixture now asserts descendant cleanup rather than a racy SIGTERM handler side effect.

Current-source checks:

- `fix-linux-check-final.log`: formatting, lint, typecheck, build, **1,354 passed / 45 expected skips / zero failures**; six actual pinned Pi contracts; explicit old-to-new migration with 20 assertions; packed MCP regression with 24 assertions.
- Mosoo: whole-workspace formatting/lint/typecheck passed; API **1,228 passed**, Web **242 passed**, runtime catalog **22 passed**, E2E harness **20 passed**; 65 documentation link checks passed. SQLite TEXT union additions produce no SQL migration; the existing migration chain applied in isolated local state.
- `fix-product-e2e-verified.log`: the local Cloudflare Worker public API creates and publishes an Agent, creates a Project API key and Thread, provisions `SandboxPi`, starts the packed Driver and completes a real provider turn through Mosoo. **One E2E passed in 25.5 seconds.** A successful workspace checkpoint follows the terminal event.
- `fix-live-cold-e2e-final.log`: the same Cloudflare Pi image independently passes real packed-Driver file write/read, usage and cold native conversation restoration; four provider responses are HTTP 200 and no grant is persisted in Pi home. Its proxy controller uses temporary SQLite/D1 fixtures; it is separate from the product admission E2E above.
- The tested Cloudflare Pi image is `cloudflare-dev/sandboxpi:470eb359`; its packed Driver SHA-256 is `9d7ad3a426255870973b775cee3e4f0e95257961f16f1c9d5831e0fba662bae2`. Earlier image hashes certify their earlier artifacts only.
- Fresh independent review found no remaining P0–P2 findings in product admission, credential/model presentation, local proxy boundaries, event conversion and Pi command restrictions.

Latest Driver main `fd87f89c649cb7b7f81432375b67aa5401388bcb` contains a protocol-3 refactor incompatible with the Mosoo-fixed protocol-6 line. The dry-run merge reports 94 conflicts. Resolving the protocol direction remains necessary before upstream merge; the draft is not merge-ready. Deployed Cloudflare acceptance, other providers/models and a green macOS full Driver process-lifecycle suite remain unverified.

## Compatible upstream image update — 2026-10-03

[Upstream compatibility and review scope](upstream-compatibility.md) records the selected changes from `fd87f89`, reviewed relative to Mosoo's fixed protocol-6 Driver. The protocol/runtime source files are unchanged in this update. Pi 1.0.0 / pi-acp 0.0.34 and Codex's aligned 0.144.5 contract are retained. Cloudflare image and API SDK advance together to 0.12.9; Claude Agent SDK to 0.3.257, Anthropic API SDK to 0.123.0 and OpenCode to 1.18.25. PR and release Action references use upstream exact SHAs; release triggers, permissions and publishing logic are unchanged.

Evidence under `/private/tmp/mosoo-pi-upstream-20261003`:

- `linux-verified.log`: formatting, lint, typecheck and build passed; **1,356 passed / 45 expected skips / zero failures**; six actual pinned Pi contracts; old-to-new native migration with 20 assertions; packed stateful MCP with 24 assertions. OpenCode package setup requires its platform-selecting postinstall; the initial verification's disabled installation scripts caused ENOEXEC and were corrected without weakening tests.
- The subsequent Action-pinning regression was RED before the release fix. `action-pins-green.log`: **21 focused tests passed / zero failures**; `action-linux-verified.log`: the new Action case independently passed on Linux; `driver-tc-final.log`: current test/source typecheck passed. The full Linux count above precedes that one new configuration test.
- Host whole-workspace formatting/lint/typecheck and **1,228 API tests** passed. The SDK 0.12.9 network contract has 15 passing assertions, retaining Containers 0.3.7 and credential proxy/start-time/persisted egress semantics. Existing D1 migrations applied only to isolated local state.
- `image-{claude,openai,opencode,pi,all}.log`: all five actual Cloudflare images passed selected-package/CLI admission, real isolated-prefix npm/pip installation and real native shell execution with external networking disabled. The all image executed all four runtimes. These are local Docker images, not hosted Cloudflare deployment acceptance.
- `product-e2e.log`: complete local Worker public-API Agent publication, Project API key, Thread, actual SandboxPi provisioning and real model completion passed in **25.8s**; the terminal path completed a workspace checkpoint.
- `real-cold-e2e.log`: current packed image passed real file write/read, usage and fresh-Driver native memory restoration without tools. Four HTTP 200 provider requests passed through actual Mosoo proxy/grant/generation/vault modules using temporary SQLite/D1 fixtures; the grant was absent from persisted Pi home.
- Current Pi image `cloudflare-dev/sandboxpi:ba1b5ee9` contains artifact SHA-256 `2e0475d7bdeab33c3202bc52dd89524e4d20e27442173bbc00f937f1d857fe06`. Earlier hashes/results certify their earlier artifacts only.
- Fresh independent review confirmed unchanged Pi/protocol-6/canonical-URL boundaries and closed the release Action pin finding; no new P0–P2 finding remained.

The main-target draft retains a protocol-lineage merge conflict. The fixed-baseline compare link isolates the actual Pi/image contribution; it does not claim main mergeability. Codex/generated-protocol and remaining protocol-3 dependency/toolchain changes are explicitly excluded. No cloud deployment, production database write or package release was performed.
