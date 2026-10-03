# Pi integration on upstream main

PR #130 now merges upstream `main` at `fd87f89c649cb7b7f81432375b67aa5401388bcb` and ports Pi 1.0.0 / pi-acp 0.0.34 onto its protocol **3** and public SDK interfaces.

## Merge resolution

The previous PR retained Mosoo's pinned protocol-6 Driver. Merging main produced 97 conflicts: 73 content, five add/add, and 19 modify/delete. Main is now authoritative. The resolution retains upstream boot validation, Host ports, durable MCP effect observation/claim/settlement, event admission, OpenAI generated types, package exports, dependencies, and runtime image optimization. Pi is an additive runtime using the existing ACP backend. Removed legacy contract projectors are not restored.

The merge has the previous Pi PR head and current main as parents. The resulting contribution should be reviewed against current main. Pi packages remain exactly 1.0.0 and 0.0.34; Codex remains at main's 0.152.0, and Cloudflare Sandbox remains digest-pinned at 0.12.9.

## Host compatibility

Mosoo PR #654 currently consumes the older protocol-6 Host interfaces. It must be migrated to main's protocol-3 SDK before pinning this Driver. Updating the submodule pointer alone is insufficient: the boot payload, Host port boundaries, effect RPCs, and completion admission changed upstream. This Driver merge does not modify the Mosoo repository or its canonical submodule URL.

Prior protocol-6 package/image/Worker results belong to the previous Driver revision. They do not certify this merge, compatibility with the old Mosoo Host, or a deployed cloud service. Current verification uses this source and the installed Pi pair; see [Pi integration](pi-acp.md) for capabilities and test commands.
