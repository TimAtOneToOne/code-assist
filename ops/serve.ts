import { existsSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { host, port, root } from "./settings.ts";

const release = realpathSync(join(root, "current"));
const app = join(release, "apps/web");
const runtimeEnv = join(root, "runtime.env");
if (existsSync(runtimeEnv)) process.loadEnvFile(runtimeEnv);
process.env.HOST = host;
process.env.PORT = String(port);
process.env.NODE_ENV = "production";
process.env.CODE_ASSIST_COMMIT = basename(release);
process.env.CODE_ASSIST_DATA_DIR = join(root, "data");
process.chdir(app);
await import(pathToFileURL(join(app, "build/index.js")).href);
