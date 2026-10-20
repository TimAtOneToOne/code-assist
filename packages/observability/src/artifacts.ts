import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureStorageDirectory } from "./storage.ts";

export function artifactPath(directory: string, id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      id,
    )
  )
    throw new Error("Invalid artifact ID");
  return join(directory, `${id}.json`);
}

export function writeArtifact(directory: string, content: string) {
  ensureStorageDirectory(directory);
  const id = randomUUID();
  writeFileSync(artifactPath(directory, id), content, {
    flag: "wx",
    mode: 0o600,
  });
  return {
    artifact_id: id,
    artifact_bytes: Buffer.byteLength(content),
    artifact_sha256: createHash("sha256").update(content).digest("hex"),
  };
}
