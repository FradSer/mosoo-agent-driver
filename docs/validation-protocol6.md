# Pi v1.0.0 protocol-6 upgrade — verified 2026-10-02

## Source and result

The isolated Driver contribution is fully upgraded to the published Pi **1.0.0**, gitHead `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`. The latest published pi-acp remains **0.0.34**, gitHead `b0581c9c1d675e634234674484247008b03d69b4`. Package-manager installation updated `package.json` and `bun.lock`; container, runtime manifest, actual-package fixtures, assertions and documentation use the same pair. Pi's transitive packages are on the v1 line. Runtime dependencies and the existing other-runtime pins remain unchanged.

Latest Mosoo main was rechecked at `b0bf041d955e71b24ff19fd72cf015429308d25b`, which fixes Driver `6be35bad888462d6998c06aac7f215b4cf3406f2` and protocol 6. Source is `host/apps/driver`; `reviewable-driver` is a Git review copy on that baseline. `pi-v1-protocol6.patch` contains the cumulative contribution, including the prior protocol-6 port and its verified MCP cancellation fix. No commits or publication were made.

The original protocol-3 user workspace and prior 0.99.2 evidence are preserved. `cleanup-v1.json` confirms zero differing snapshot files. This upgrade lives in the authorized isolated protocol-6 contribution; it has not been overlaid onto the original branch.

## Acceptance and verification

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

E2E uses actual latest host proxy modules with temporary SQLite/D1 bindings and the packed Driver controller. It does not certify production Durable Object control, product UI/catalog selection or provisioning. These require a separate host contribution with Pi entries, image bindings, capability gating, managed environment mapping and complete Pi-home persistence. No cloud resource, production database, external publication or original working-tree file was changed.

The authoritative evidence is `linux-check-final.log`; earlier intermediate logs include corrected test-harness/dependency-path failures and are retained for traceability. Earlier 0.99.2 results do not certify this v1 artifact.
