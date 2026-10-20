import { appendFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeArtifact } from "./artifacts.ts";
import { ensureStorageDirectory } from "./storage.ts";

export type Context = {
  attempt_id?: string;
  job_id?: string;
  ticket_id?: string;
  session_id?: string;
  parent_session_id?: string;
  request_id?: string;
  repository_commit?: string;
  trace_id?: string;
};
type Level = "info" | "warn" | "error";
const processInstanceId = randomUUID();
let sequence = 0;
type Options = {
  logDirectory?: string;
  artifactDirectory?: string;
  release?: string;
  environment?: NodeJS.ProcessEnv;
};

const sensitiveKey =
  /^(?:.*[_-])?(?:password|passwd|pswd|secret|token|(?:secret[_-]?)?access[_-]?key(?:[_-]?id)?|api[_-]?key|authorization|cookie|connection[_-]?string)$/i;
const secretField =
  /^(password|passwd|pswd|secret|token|accessToken|refreshToken|sessionToken|SessionToken|accessKeyId|AccessKeyId|secretAccessKey|SecretAccessKey|apiKey|api_key|authorization|cookie|connectionString)$/i;

export function createLogger(
  service: string,
  options: Options = {},
  context: Context = {},
) {
  if (!/^[a-z][a-z0-9-]*$/.test(service))
    throw new Error("Invalid log service");
  const environment = options.environment ?? process.env;
  const directory = options.logDirectory ?? environment.CODE_ASSIST_LOG_DIR;
  const artifacts =
    options.artifactDirectory ?? environment.CODE_ASSIST_ARTIFACT_DIR;
  const release =
    options.release ?? environment.CODE_ASSIST_COMMIT ?? "development";
  const secrets = Object.entries(environment)
    .filter(
      ([key, value]) =>
        value && (sensitiveKey.test(key) || key.endsWith("_AUTH")),
    )
    .map(([, value]) => value!);
  for (const [key, value] of Object.entries(environment)) {
    if (!value || !key.endsWith("_URL")) continue;
    try {
      const url = new URL(value);
      if (url.password)
        secrets.push(value, url.password, decodeURIComponent(url.password));
    } catch {
      /* Not every URL-like setting is an absolute URL. */
    }
  }
  // Longest first prevents a shorter credential from leaving a suffix behind.
  secrets.sort((a, b) => b.length - a.length);
  function serialize(value: unknown) {
    let redacted = false;
    const json = JSON.stringify(value, (key, item) => {
      if (secretField.test(key)) {
        redacted = true;
        return "[REDACTED]";
      }
      if (item instanceof Error)
        return {
          name: item.name,
          message: item.message,
          stack: item.stack,
          cause: item.cause,
        };
      return item;
    });
    if (json === undefined)
      throw new Error("Log value must be JSON serializable");
    let content = json;
    for (const secret of secrets) {
      const escaped = JSON.stringify(secret).slice(1, -1);
      if (content.includes(escaped)) {
        redacted = true;
        content = content.replaceAll(escaped, "[REDACTED]");
      }
    }
    return { content, redacted };
  }
  function event(
    level: Level,
    name: string,
    message: string,
    fields: Record<string, unknown> = {},
  ) {
    const { content } = serialize({
      ...fields,
      ...context,
      attempt_id: context.attempt_id ?? "",
      process_instance_id: processInstanceId,
      sequence: ++sequence,
      event_id: randomUUID(),
      timestamp: new Date().toISOString(),
      service,
      release,
      host: hostname(),
      pid: process.pid,
      level,
      event: name,
      message,
    });
    if (directory) {
      const structured = join(directory, "structured");
      ensureStorageDirectory(structured);
      appendFileSync(join(structured, `${service}.jsonl`), content + "\n", {
        mode: 0o600,
      });
    } else {
      console.log(content);
    }
  }
  return {
    event,
    child(bindings: Context) {
      return createLogger(service, options, { ...context, ...bindings });
    },
    payload(
      name: string,
      message: string,
      value: unknown,
      level: Level = "info",
    ) {
      if (!artifacts)
        throw new Error(
          "CODE_ASSIST_ARTIFACT_DIR is required to retain payloads",
        );
      const serialized = serialize(value);
      const reference = writeArtifact(artifacts, serialized.content);
      event(level, name, message, {
        ...reference,
        artifact_redacted: serialized.redacted,
      });
      return reference;
    },
  };
}
