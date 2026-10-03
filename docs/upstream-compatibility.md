# Protocol-6 Pi contribution and compatible upstream image updates

This contribution extends the Driver fixed by Mosoo, `6be35bad888462d6998c06aac7f215b4cf3406f2`, with Pi 1.0.0 / pi-acp 0.0.34. It retains protocol 6 and the host/native checkpoint contracts. It is not a merge of the protocol-3 SDK redesign.

## Review scope

[Compare against Mosoo's fixed Driver](https://github.com/langgenius/mosoo-agent-driver/compare/6be35bad888462d6998c06aac7f215b4cf3406f2...FradSer:mosoo-agent-driver:feat/runtime-pi-v1) to review the Pi contribution independently of the older common ancestor with main. [Draft #130](https://github.com/langgenius/mosoo-agent-driver/pull/130) targets main and therefore also exposes the incompatible protocol lineage. It remains a draft until upstream agrees the host/Driver protocol direction. The companion [Mosoo #654](https://github.com/langgenius/mosoo/pull/654) keeps the canonical submodule URL and pins the tested Driver commit.

## Selected upstream changes

The source is upstream `fd87f89c649cb7b7f81432375b67aa5401388bcb`, including image optimization [#125](https://github.com/langgenius/mosoo-agent-driver/pull/125).

| Surface            | Protocol-6 baseline                             | Selected update                                                                     |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Runtime images     | Single-runtime profiles plus compatibility all  | Retain profiles and Pi; require all manifest profiles in CI                         |
| Image admission    | Installed executable and package-manager checks | Add CI build, admission, npm/pip install smoke and offline native shell tool checks |
| Cloudflare Sandbox | Image and host SDK 0.12.6                       | Digest-pinned image and host SDK 0.12.9 together                                    |
| Claude Agent SDK   | 0.3.211                                         | 0.3.257 in package and image                                                        |
| Anthropic API SDK  | 0.111.0                                         | 0.123.0                                                                             |
| OpenCode           | 1.18.4                                          | 1.18.25 in package and image                                                        |
| GitHub actions     | Floating major tags                             | Upstream exact reviewed commit pins                                                 |
| Pi / adapter       | 1.0.0 / 0.0.34                                  | Retain exact versions, capability admission and resource-disabled launcher          |

The image matrix reads `runtime-images.json`, including Pi, rather than duplicating the admitted runtime list. Native tool smoke uses deterministic loopback model replies with external networking disabled. Each single-runtime image rejects unrelated CLI/package presence; all retains every admitted runtime. The common Bun/Python/package-manager layers remain shared and no runtime is installed on the task startup path.

## Deliberately excluded protocol-3 changes

Upstream [#112](https://github.com/langgenius/mosoo-agent-driver/pull/112) rewrites boot/control schema validation, durable SDK boundaries and runtime adapters. These interfaces are consumed by Mosoo's protocol-6 host and are not part of this compatible image update.

Codex remains 0.144.5 across its CLI, SDK and checked-in app-server type contract. Upstream's 0.152.0 update switches SDK dependency, generated protocol synchronization and public packaging together. Copying only its image pin would break the current version-alignment gate; adopting its full code generation would expand this change into the protocol redesign. ACP/MCP/ORPC, logging/schema and TypeScript/Vite+ toolchain upgrades associated with that branch are likewise retained at the existing protocol-6 pins. No protocol version is relabeled and no fake merge is created.

## Verification

See [protocol-6 validation](validation-protocol6.md) for source-specific checks. Required acceptance includes Linux package/typecheck/build and pinned Pi migration contracts, every actual runtime image, native shell tools with network disabled, and real Pi public-API control-plane completion through the local Cloudflare Worker. Deployed cloud acceptance and protocol-3 compatibility are separate gates.
