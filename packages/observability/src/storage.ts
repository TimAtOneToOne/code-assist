import { mkdirSync, statSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";

export function ensureStorageDirectory(path: string) {
  if (!isAbsolute(path) || normalize(path) !== path)
    throw new Error("Evidence storage requires an absolute normalized path");
  if (path.startsWith("/Volumes/")) {
    const volume = join("/Volumes", path.split("/")[2]);
    // A leftover mount-point directory is not a mounted external filesystem.
    if (statSync(volume).dev === statSync("/Volumes").dev)
      throw new Error(`Evidence volume is not mounted: ${volume}`);
  }
  mkdirSync(path, { recursive: true, mode: 0o700 });
}
