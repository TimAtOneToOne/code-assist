import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const root = join(homedir(), "Library/Application Support/CodeAssist");
export const host = "100.91.0.83";
export const port = 3000;
export const origin = `http://${host}:${port}`;
export const repository = "git@github.com:TimAtOneToOne/code-assist.git";
export const webLabel = "com.code-assist.web";
export const updaterLabel = "com.code-assist.updater";
export const workerLabel = "com.code-assist.worker";
export const domain = `gui/${process.getuid!()}`;
export const pnpm = join(dirname(process.execPath), "pnpm");
