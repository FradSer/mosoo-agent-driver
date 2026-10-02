import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export async function closeFileHandles(
  handles: readonly (FileHandle | null | undefined)[],
): Promise<unknown[]> {
  const results = await Promise.allSettled(
    handles
      .filter((handle): handle is FileHandle => handle !== null && handle !== undefined)
      .map((handle) => handle.close()),
  );
  return results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
}

async function closeFileHandlesAndThrow(
  error: unknown,
  handles: readonly (FileHandle | null | undefined)[],
  message: string,
): Promise<never> {
  const closeFailures = await closeFileHandles(handles);
  throw closeFailures.length > 0 ? new AggregateError([error, ...closeFailures], message) : error;
}

export function directoryEntryPath(directory: FileHandle, name: string): string {
  if (name.length === 0 || name === "." || name === ".." || basename(name) !== name) {
    throw new Error(`Directory entry name is invalid: ${name}.`);
  }

  return join(openedDirectoryPath(directory), name);
}

export function openedDirectoryPath(directory: FileHandle): string {
  return join("/proc/self/fd", String(directory.fd));
}

export async function openRealDirectory(path: string, label: string): Promise<FileHandle> {
  if (process.platform !== "linux") {
    throw new Error(`${label} requires Linux /proc filesystem capabilities.`);
  }

  try {
    return await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasErrorCode(error, "ELOOP") || hasErrorCode(error, "ENOTDIR")) {
      throw new Error(`${label} must be a real directory: ${path}.`, { cause: error });
    }
    throw error;
  }
}

export async function ensureRealDirectoryAt(
  parent: FileHandle,
  name: string,
  label: string,
  signal?: AbortSignal,
): Promise<FileHandle> {
  signal?.throwIfAborted();
  const path = directoryEntryPath(parent, name);
  let created = false;

  try {
    await mkdir(path);
    created = true;
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw error;
    }
  }

  const directory = await openRealDirectory(path, label);
  try {
    if (created) {
      await parent.sync();
    }
    signal?.throwIfAborted();
    return directory;
  } catch (error) {
    const closeFailures = await closeFileHandles([directory]);
    if (closeFailures.length > 0) {
      throw new AggregateError([error, ...closeFailures], `Failed to create ${path}.`);
    }
    throw error;
  }
}

async function walkRealDirectory(
  startPath: string,
  segments: readonly string[],
  label: string,
  create: boolean,
  signal?: AbortSignal,
): Promise<FileHandle> {
  signal?.throwIfAborted();
  let directory = await openRealDirectory(startPath, label);

  for (const segment of segments) {
    let next: FileHandle;
    try {
      signal?.throwIfAborted();
      next = create
        ? await ensureRealDirectoryAt(directory, segment, label, signal)
        : await openRealDirectory(directoryEntryPath(directory, segment), label);
    } catch (error) {
      return closeFileHandlesAndThrow(error, [directory], `Failed to walk ${startPath}.`);
    }

    const closeFailures = await closeFileHandles([directory]);
    if (closeFailures.length > 0) {
      return closeFileHandlesAndThrow(
        new AggregateError(closeFailures, `Failed to close an ancestor of ${startPath}.`),
        [next],
        `Failed to walk ${startPath}.`,
      );
    }
    directory = next;
  }

  return directory;
}

export function ensureAbsoluteRealDirectory(
  path: string,
  label: string,
  signal?: AbortSignal,
): Promise<FileHandle> {
  const absolutePath = resolve(path);
  return walkRealDirectory("/", absolutePath.split("/").filter(Boolean), label, true, signal);
}

export async function writeFileAtomically(
  directory: FileHandle,
  name: string,
  contents: string,
  mode: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const path = directoryEntryPath(directory, name);
  const temporaryName = `.${name}.${randomUUID()}.tmp`;
  const temporaryPath = directoryEntryPath(directory, temporaryName);
  let temporaryFileCreated = false;

  try {
    await using temporaryFile = await open(temporaryPath, "wx", mode);
    temporaryFileCreated = true;
    await temporaryFile.writeFile(contents, { encoding: "utf8", signal });
    await temporaryFile.sync();

    signal.throwIfAborted();
    await rename(temporaryPath, path);
    await directory.sync();
  } catch (error) {
    if (temporaryFileCreated) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (!hasErrorCode(cleanupError, "ENOENT")) {
          throw new AggregateError([error, cleanupError], `Failed to clean ${temporaryPath}.`);
        }
      }
    }
    throw error;
  }
}
