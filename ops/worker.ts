import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./settings.ts";

const release = realpathSync(join(root, "current"));
process.loadEnvFile(join(root, "runtime.env"));
process.env.CODE_ASSIST_COMMIT = basename(release);
process.env.CODE_ASSIST_DATA_DIR = join(root, "data");
// Preserve this worker's exact release identity when current changes.
process.chdir(release);
await import(pathToFileURL(join(release, "apps/worker/src/main.ts")).href);
