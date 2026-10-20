import { icuEnvironment } from "./workspace-environment.ts";
import { randomBytes } from "node:crypto";

export function repositoryProfile(name: string) {
  switch (name) {
    case "internal-chat-ui":
      return {
        cwd: "/work/internal-chat-ui/sveltekit",
        setup: [
          [
            "docker",
            "compose",
            "--profile",
            "localstack",
            "up",
            "-d",
            "--wait",
          ],
          [
            "docker",
            "compose",
            "exec",
            "-T",
            "db",
            "createdb",
            "-U",
            "root",
            "icu_test",
          ],
          ["pnpm", "install", "--frozen-lockfile"],
          ["pnpm", "db:migrate"],
        ],
        browserDirectory: "/work/internal-chat-ui/sveltekit",
        browserInstall: ["pnpm", "exec", "playwright", "install", "chromium"],
        validation: ["lint", "check", "test", "build"].map((task) => [
          "pnpm",
          task,
        ]),
        instructions:
          "PostgreSQL is on localhost:5435 and LocalStack on localhost:4566. Launch with pnpm dev --host 127.0.0.1 --port 5173 --strictPort through the environment launcher. Use a synthetic user and the real local sign-in flow.",
      };
    case "elation_companion":
      return {
        cwd: "/work/elation_companion",
        setup: [],
        browserDirectory: null,
        browserInstall: [],
        validation: [["bash", "./build.sh"]],
        instructions:
          "This is the unpacked browser extension. Its existing build command is bash ./build.sh. Follow the approved plan for package inspection and browser tests; paired tests can read the sibling candidate checkout.",
      };
    case "workplace-agents":
      return {
        cwd: "/work/workplace-agents",
        setup: [
          ["make", "install"],
          ["make", "db-up"],
          [
            "docker",
            "compose",
            "-f",
            "apps/portal/compose.yaml",
            "exec",
            "-T",
            "db",
            "sh",
            "-c",
            "until pg_isready -U root -d local; do sleep 1; done",
          ],
          ["make", "db-migrate-runtime"],
        ],
        browserDirectory: "/work/workplace-agents/apps/portal",
        browserInstall: ["make", "browser-install"],
        validation: [["make", "validate"]],
        instructions:
          "Run project commands through the root Makefile. PostgreSQL is private to this ticket on localhost:65432. The portal uses localhost:6001 (make dev). Use synthetic local fixtures for clipboard tests. When the approved plan requires paired Companion acceptance, run make test-companion-clipboard ELATION_COMPANION_SOURCE_DIR=/work/elation_companion against both candidate checkouts and save the full results. Do not call live Elation/Olive for synthetic tests.",
      };
    default:
      throw new Error(
        `Repository setup is not configured for ${name}. Add its established install, service and validation commands before coding.`,
      );
  }
}
export function repositoryEnvironment(
  name: string,
  mapped: Record<string, string>,
): Record<string, string> {
  repositoryProfile(name);
  if (name === "internal-chat-ui") return icuEnvironment(mapped);
  if (name === "workplace-agents")
    return {
      ...mapped,
      DATABASE_URL: "postgres://root:mysecretpassword@127.0.0.1:65432/local",
      TEST_DATABASE_URL:
        "postgres://root:mysecretpassword@127.0.0.1:65432/local",
      ORIGIN: "http://localhost:6001",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    };
  return mapped;
}
