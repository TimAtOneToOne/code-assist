import { spawnSync } from "node:child_process";

type ProcessIdentity = { pid: number; parent: number; started: string };

function processes(): ProcessIdentity[] {
  const inspection = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,lstart="], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
  });
  if (inspection.error) throw inspection.error;
  if (inspection.status !== 0)
    throw new Error("Could not inspect discovery subprocesses.");
  return inspection.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) throw new Error("Could not identify discovery subprocesses.");
      return {
        pid: Number(match[1]),
        parent: Number(match[2]),
        started: match[3],
      };
    })
    .filter((row) => row.pid !== inspection.pid);
}

function signalOwned(identity: ProcessIdentity, signal: NodeJS.Signals) {
  const current = processes().find((row) => row.pid === identity.pid);
  if (!current || current.started !== identity.started) return;
  try {
    process.kill(identity.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

// Called before SDK abort: afterwards the CLI can exit and orphan its shell sessions.
export function terminateOwnedProcesses() {
  const owned = new Map<number, ProcessIdentity>();
  try {
    for (;;) {
      const rows = processes();
      const descendants = new Set([process.pid]);
      for (const identity of owned.values()) {
        if (
          rows.some(
            (row) =>
              row.pid === identity.pid && row.started === identity.started,
          )
        )
          descendants.add(identity.pid);
      }
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const row of rows) {
          if (descendants.has(row.parent) && !descendants.has(row.pid)) {
            descendants.add(row.pid);
            expanded = true;
          }
        }
      }
      const newlyOwned = rows.filter(
        (row) =>
          row.pid !== process.pid &&
          descendants.has(row.pid) &&
          owned.get(row.pid)?.started !== row.started,
      );
      if (!newlyOwned.length) break;
      // Freeze spawning before the next snapshot; process groups miss detached shells.
      for (const row of newlyOwned) {
        owned.set(row.pid, row);
        signalOwned(row, "SIGSTOP");
      }
    }
  } finally {
    // Recheck identity before every signal. Never signal the worker or a global process name.
    for (const row of [...owned.values()].reverse())
      signalOwned(row, "SIGKILL");
  }
}
