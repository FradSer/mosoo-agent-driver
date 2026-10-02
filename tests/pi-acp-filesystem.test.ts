import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureAbsoluteRealDirectory, writeFileAtomically } from "../src/runtimes/atomic-file";

const linuxTest = process.platform === "linux" ? test : test.skip;
describe("Given Pi configuration files in an untrusted sandbox home", () => {
  linuxTest("when an ancestor is a symlink, then bootstrap refuses to follow it", async () => {
    const root = await mkdtemp("/tmp/pi-files-");
    try {
      await symlink(root, join(root, "linked"));
      await expect(
        ensureAbsoluteRealDirectory(join(root, "linked", "agent"), "Pi"),
      ).rejects.toThrow("real directory");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  linuxTest(
    "when replacing a symlink or aborting a write, then outside content and prior configuration survive",
    async () => {
      const root = await mkdtemp("/tmp/pi-files-");
      try {
        const outside = join(root, "outside");
        await writeFile(outside, "untouched");
        await symlink(outside, join(root, "models.json"));
        await using directory = await ensureAbsoluteRealDirectory(root, "Pi");
        await writeFileAtomically(
          directory,
          "models.json",
          "managed",
          0o600,
          new AbortController().signal,
        );
        expect(await readFile(outside, "utf8")).toBe("untouched");
        expect(await readFile(join(root, "models.json"), "utf8")).toBe("managed");
        await expect(
          writeFileAtomically(directory, "models.json", "aborted", 0o600, AbortSignal.abort()),
        ).rejects.toThrow();
        expect(await readFile(join(root, "models.json"), "utf8")).toBe("managed");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
