import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, posix } from "node:path";
import {
  repositoryProfile,
  repositoryEnvironment,
} from "./repository-profiles.ts";

export type RepositorySetup = {
  workingDirectory: string;
  systemSetupScript: string;
  setupScript: string;
  validationScript: string;
  browserDirectory: string;
  browserInstallScript: string;
  startScript: string;
  readyScript: string;
  smokeScript: string;
  instructions: string;
  environment: Record<string, string>;
  generatedVariables: string[];
};
export type RuntimeProfile = {
  cwd: string;
  setup: string[][];
  validation: string[][];
  browserDirectory: string | null;
  browserInstall: string[];
  instructions: string;
  configuration: RepositorySetup;
  hash: string;
};
export class RepositorySettingsError extends Error {}
const script = (commands: string[][]) =>
  commands
    .map((args) =>
      args
        .map((arg) =>
          /^[A-Za-z0-9_./:@=+-]+$/.test(arg)
            ? arg
            : "'" + arg.replaceAll("'", "'\\''") + "'",
        )
        .join(" "),
    )
    .join("\n");
export function emptyRepositorySetup(): RepositorySetup {
  return {
    workingDirectory: ".",
    systemSetupScript: "",
    setupScript: "",
    validationScript: "",
    browserDirectory: "",
    browserInstallScript: "",
    startScript: "",
    readyScript: "",
    smokeScript: "",
    instructions: "",
    environment: {},
    generatedVariables: [],
  };
}
export function defaultRepositorySetup(name: string): RepositorySetup | null {
  let profile;
  try {
    profile = repositoryProfile(name);
  } catch {
    return null;
  }
  const environment = repositoryEnvironment(name, {});
  const generatedVariables = Object.hasOwn(environment, "BETTER_AUTH_SECRET")
    ? ["BETTER_AUTH_SECRET"]
    : [];
  delete environment.BETTER_AUTH_SECRET;
  return {
    ...emptyRepositorySetup(),
    workingDirectory: posix.relative(`/work/${name}`, profile.cwd) || ".",
    setupScript: script(profile.setup),
    validationScript: script(profile.validation),
    browserDirectory: profile.browserDirectory
      ? posix.relative(`/work/${name}`, profile.browserDirectory) || "."
      : "",
    browserInstallScript: profile.browserInstall.length
      ? script([profile.browserInstall])
      : "",
    instructions: profile.instructions,
    environment,
    generatedVariables,
  };
}
function relative(value: string, optional = false) {
  return (
    (optional && value === "") ||
    (!!value &&
      !posix.isAbsolute(value) &&
      !value.includes("\\") &&
      !value.split("/").includes(".."))
  );
}
export function validateRepositorySetup(value: unknown): RepositorySetup {
  const v = value as RepositorySetup;
  const template = emptyRepositorySetup();
  if (
    !v ||
    typeof v !== "object" ||
    Object.entries(template).some(
      ([k, field]) =>
        typeof field === "string" &&
        typeof v[k as keyof RepositorySetup] !== "string",
    )
  )
    throw new RepositorySettingsError("Complete the repository setup fields.");
  if (!relative(v.workingDirectory) || !relative(v.browserDirectory, true))
    throw new RepositorySettingsError(
      "Working and browser directories must stay inside the repository (use . for its root).",
    );
  if (!v.validationScript.trim())
    throw new RepositorySettingsError(
      "Add the repository's validation commands.",
    );
  if (!!v.browserDirectory !== !!v.browserInstallScript.trim())
    throw new RepositorySettingsError(
      "Provide both a browser directory and browser install commands, or leave both empty.",
    );
  if (!!v.startScript.trim() !== !!v.readyScript.trim())
    throw new RepositorySettingsError(
      "Provide both app startup and readiness commands, or leave both empty.",
    );
  if (
    !v.environment ||
    typeof v.environment !== "object" ||
    Array.isArray(v.environment) ||
    Object.entries(v.environment).some(
      ([k, val]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof val !== "string",
    )
  )
    throw new RepositorySettingsError(
      "Local overrides must be a JSON object of environment variable names and string values.",
    );
  if (
    !Array.isArray(v.generatedVariables) ||
    v.generatedVariables.some(
      (k) =>
        typeof k !== "string" ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ||
        Object.hasOwn(v.environment, k),
    )
  )
    throw new RepositorySettingsError(
      "Generated variables must be valid names without a local override of the same name.",
    );
  return structuredClone(
    Object.fromEntries(
      Object.keys(template).map((k) => [k, v[k as keyof RepositorySetup]]),
    ),
  ) as RepositorySetup;
}
function readSettings(directory: string): Record<string, RepositorySetup> {
  try {
    const settings = JSON.parse(
      readFileSync(join(directory, "repository-setups.json"), "utf8"),
    );
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      throw new RepositorySettingsError("Invalid saved repository setups.");
    return Object.fromEntries(
      Object.entries(settings).map(([path, value]) => {
        if (!isAbsolute(path))
          throw new RepositorySettingsError("Invalid repository path.");
        return [path, validateRepositorySetup(value)];
      }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
export function readRepositorySetup(directory: string, repository: string) {
  const saved = readSettings(directory)[repository];
  return {
    configuration: saved ?? defaultRepositorySetup(basename(repository)),
    custom: !!saved,
  };
}
export function writeRepositorySetup(
  directory: string,
  repository: string,
  value: unknown,
) {
  if (!isAbsolute(repository))
    throw new RepositorySettingsError("Choose a repository.");
  const configuration = validateRepositorySetup(value);
  const settings = readSettings(directory);
  settings[repository] = configuration;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `repository-setups-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, join(directory, "repository-setups.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
  return configuration;
}
export function profileHash(configuration: RepositorySetup) {
  return createHash("sha256")
    .update(JSON.stringify(validateRepositorySetup(configuration)))
    .digest("hex");
}
export function compileRepositoryProfile(
  name: string,
  configuration: RepositorySetup,
): RuntimeProfile {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name))
    throw new RepositorySettingsError("Invalid repository name.");
  const c = validateRepositorySetup(configuration);
  const command = (value: string) =>
    value.trim() ? [["bash", "-euc", value]] : [];
  return {
    cwd: posix.join("/work", name, c.workingDirectory),
    setup: command(c.setupScript),
    validation: command(c.validationScript),
    browserDirectory: c.browserDirectory
      ? posix.join("/work", name, c.browserDirectory)
      : null,
    browserInstall: command(c.browserInstallScript)[0] ?? [],
    instructions: [
      c.instructions,
      c.startScript && `App startup commands:\n${c.startScript}`,
      c.readyScript && `App readiness commands:\n${c.readyScript}`,
      c.smokeScript &&
        `Browser/authentication smoke test commands:\n${c.smokeScript}`,
    ]
      .filter(Boolean)
      .join("\n"),
    configuration: c,
    hash: profileHash(c),
  };
}
export function loadRepositoryProfile(directory: string, repository: string) {
  const { configuration } = readRepositorySetup(directory, repository);
  if (!configuration)
    throw new RepositorySettingsError(
      `Repository setup is not configured for ${basename(repository)}. Open Configuration → Repository Setup.`,
    );
  return compileRepositoryProfile(basename(repository), configuration);
}
export function profileEnvironment(
  profile: RuntimeProfile,
  mapped: Record<string, string>,
) {
  return {
    ...mapped,
    ...profile.configuration.environment,
    ...Object.fromEntries(
      profile.configuration.generatedVariables.map((k) => [
        k,
        randomBytes(32).toString("hex"),
      ]),
    ),
  };
}
