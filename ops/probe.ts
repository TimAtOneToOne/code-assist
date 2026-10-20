import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./settings.ts";

const release = realpathSync(join(root, "current"));
process.loadEnvFile(join(root, "runtime.env"));
process.env.CODE_ASSIST_COMMIT = basename(release);
await import(pathToFileURL(join(release, "apps/worker/src/cli.ts")).href);
