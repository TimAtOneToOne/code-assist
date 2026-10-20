import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { domain, root, workerLabel } from "./settings.ts";

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

if (process.platform !== "darwin")
  throw new Error("Worker installation requires macOS");
const agents = join(homedir(), "Library/LaunchAgents");
mkdirSync(agents, { recursive: true });
const plist = join(agents, `${workerLabel}.plist`);
writeFileSync(
  plist,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${workerLabel}</string>
<key>ProgramArguments</key><array>
<string>${xml(process.execPath)}</string>
<string>${xml(join(root, "current/ops/worker.ts"))}</string>
</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>${xml(dirname(process.execPath))}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${xml(join(root, "logs", `${workerLabel}.log`))}</string>
<key>StandardErrorPath</key><string>${xml(join(root, "logs", `${workerLabel}.error.log`))}</string>
</dict></plist>
`,
);
execFileSync("/usr/bin/plutil", ["-lint", plist], { stdio: "inherit" });
execFileSync("/bin/launchctl", ["bootstrap", domain, plist], {
  stdio: "inherit",
});
console.log("Installed Code Assist worker login service.");
