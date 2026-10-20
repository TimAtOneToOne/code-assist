import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { deploy } from "./deploy.ts";
import { domain, root, updaterLabel, webLabel } from "./settings.ts";

if (process.platform !== "darwin")
  throw new Error("This installer requires macOS.");
if (existsSync(join(root, "current"))) {
  throw new Error(
    "Code Assist is already installed; use the existing updater.",
  );
}

await deploy(false);
const agents = join(homedir(), "Library/LaunchAgents");
mkdirSync(agents, { recursive: true });

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

for (const [label, script, schedule] of [
  [webLabel, "serve.ts", "<key>KeepAlive</key><true/>"],
  [updaterLabel, "deploy.ts", "<key>StartInterval</key><integer>60</integer>"],
]) {
  const plist = join(agents, `${label}.plist`);
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>
<string>${xml(process.execPath)}</string>
<string>${xml(join(root, "current/ops", script))}</string>
</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>${xml(dirname(process.execPath))}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
<key>GIT_SSH_COMMAND</key><string>/usr/bin/ssh -o BatchMode=yes</string>
</dict>
<key>RunAtLoad</key><true/>${schedule}
<key>StandardOutPath</key><string>${xml(join(root, "logs", `${label}.log`))}</string>
<key>StandardErrorPath</key><string>${xml(join(root, "logs", `${label}.error.log`))}</string>
</dict></plist>
`,
  );
  execFileSync("/usr/bin/plutil", ["-lint", plist], { stdio: "inherit" });
  execFileSync("/bin/launchctl", ["bootstrap", domain, plist], {
    stdio: "inherit",
  });
}
console.log("Installed Code Assist web and updater login services.");
