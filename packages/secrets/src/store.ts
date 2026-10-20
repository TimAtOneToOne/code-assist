import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, normalize } from "node:path";

export type SecretMetadata = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
};
type Secret = SecretMetadata & { value: string };
export type Mapping = {
  repository: string;
  variable: string;
  secretId: string;
};
type Store = { version: 1; secrets: Secret[]; mappings: Mapping[] };
export class SecretInputError extends Error {}

function read(directory: string): Store {
  let text: string;
  try {
    text = readFileSync(join(directory, "secrets/store.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, secrets: [], mappings: [] };
    throw new Error("Unable to read the secret store.", { cause: error });
  }
  try {
    const data: Store = JSON.parse(text);
    if (
      data.version !== 1 ||
      !Array.isArray(data.secrets) ||
      !Array.isArray(data.mappings)
    )
      throw new Error();
    for (const secret of data.secrets) {
      if (
        ![
          secret.id,
          secret.name,
          secret.description,
          secret.updatedAt,
          secret.value,
        ].every((v) => typeof v === "string")
      )
        throw new Error();
      if (
        !secret.id ||
        !secret.name.trim() ||
        !secret.value ||
        secret.value.includes("\0")
      )
        throw new Error();
    }
    if (
      new Set(data.secrets.map((s) => s.id)).size !== data.secrets.length ||
      new Set(data.secrets.map((s) => s.name)).size !== data.secrets.length
    )
      throw new Error();
    const pairs = new Set<string>();
    for (const mapping of data.mappings) {
      if (
        typeof mapping.repository !== "string" ||
        !isAbsolute(mapping.repository) ||
        typeof mapping.variable !== "string" ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(mapping.variable) ||
        !data.secrets.some((s) => s.id === mapping.secretId)
      )
        throw new Error();
      const pair = JSON.stringify([mapping.repository, mapping.variable]);
      if (pairs.has(pair)) throw new Error();
      pairs.add(pair);
    }
    return data;
  } catch {
    // JSON parser errors can contain source text, including a credential.
    throw new Error(
      "The secret store is invalid. Restore it before making changes.",
    );
  }
}

function write(directory: string, store: Store) {
  const folder = join(directory, "secrets");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  const temporary = join(folder, `${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(store) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, join(folder, "store.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function listConfiguration(directory: string): {
  secrets: SecretMetadata[];
  mappings: Mapping[];
} {
  const store = read(directory);
  return {
    secrets: store.secrets.map(({ id, name, description, updatedAt }) => ({
      id,
      name,
      description,
      updatedAt,
    })),
    mappings: store.mappings,
  };
}

export function revealSecret(directory: string, id: string): string {
  const secret = read(directory).secrets.find((s) => s.id === id);
  if (!secret) throw new SecretInputError("Secret not found.");
  return secret.value;
}

// One web process owns writes. Synchronous read/modify/rename prevents interleaved
// mutations in that process; worker processes only resolve values.
export function saveSecret(
  directory: string,
  input: { id?: string; name: string; description: string; value: string },
): SecretMetadata {
  const store = read(directory);
  const existing = input.id
    ? store.secrets.find((s) => s.id === input.id)
    : undefined;
  if (input.id && !existing) throw new SecretInputError("Secret not found.");
  const name = input.name.trim();
  if (!name) throw new SecretInputError("Enter a secret name.");
  if (store.secrets.some((s) => s.name === name && s.id !== existing?.id))
    throw new SecretInputError("That secret name already exists.");
  const value = input.value || existing?.value;
  if (!value) throw new SecretInputError("Enter a secret value.");
  if (value.includes("\0"))
    throw new SecretInputError("Secret values cannot contain null characters.");
  const secret: Secret = {
    id: existing?.id ?? randomUUID(),
    name,
    description: input.description,
    value,
    updatedAt: new Date().toISOString(),
  };
  if (existing) store.secrets[store.secrets.indexOf(existing)] = secret;
  else store.secrets.push(secret);
  write(directory, store);
  return {
    id: secret.id,
    name,
    description: secret.description,
    updatedAt: secret.updatedAt,
  };
}

export function deleteSecret(directory: string, id: string) {
  const store = read(directory);
  if (!store.secrets.some((s) => s.id === id))
    throw new SecretInputError("Secret not found.");
  if (store.mappings.some((m) => m.secretId === id))
    throw new SecretInputError(
      "Remove this secret's repository mappings before deleting it.",
    );
  store.secrets = store.secrets.filter((s) => s.id !== id);
  write(directory, store);
}

export function saveMapping(directory: string, input: Mapping) {
  const store = read(directory);
  if (!isAbsolute(input.repository))
    throw new SecretInputError("Choose a repository.");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.variable))
    throw new SecretInputError(
      "Use a valid environment-variable name: letters, numbers and underscores, not starting with a number.",
    );
  if (!store.secrets.some((s) => s.id === input.secretId))
    throw new SecretInputError("Choose a saved secret.");
  const mapping = { ...input, repository: normalize(input.repository) };
  const index = store.mappings.findIndex(
    (m) =>
      m.repository === mapping.repository && m.variable === mapping.variable,
  );
  if (index === -1) store.mappings.push(mapping);
  else store.mappings[index] = mapping;
  write(directory, store);
}

export function deleteMapping(
  directory: string,
  repository: string,
  variable: string,
) {
  const store = read(directory);
  store.mappings = store.mappings.filter(
    (m) => m.repository !== repository || m.variable !== variable,
  );
  write(directory, store);
}

export function resolveRepositoryEnvironment(
  directory: string,
  repository: string,
): Record<string, string> {
  if (!isAbsolute(repository))
    throw new SecretInputError("Use the source repository's absolute path.");
  const store = read(directory);
  return Object.fromEntries(
    store.mappings
      .filter((m) => m.repository === normalize(repository))
      .map((m) => [
        m.variable,
        store.secrets.find((s) => s.id === m.secretId)!.value,
      ]),
  );
}
