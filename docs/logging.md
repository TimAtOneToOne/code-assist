# Central logging

Open **http://100.91.0.83:3000/logs**. Search by attempt ID or service, expand an event, and download its full payload. The page and JSON/artifact endpoints use the existing Tailscale owner check.

Code Assist keeps structured JSON events and full payload files on Mia, then indexes events in local OpenObserve. PostgreSQL remains the workflow source of truth. OpenObserve and an OpenTelemetry Collector run in OrbStack.

## Evidence

- Web: dynamic requests, status, duration, request IDs, errors and configuration saves. Static assets bypass SvelteKit hooks. Request headers, bodies and query strings are not recorded.
- Worker: lifecycle, pg-boss errors/warnings and probe start/result-prepared/failure. `job.result_prepared` is not proof that the enclosing SQL transaction committed; PostgreSQL records the actual workflow state.
- Processes: launchd web, worker and updater stdout/stderr, including deployment output.
- Payloads: complete JSON files referenced by UUID, byte count and SHA-256. Large evidence goes in artifacts rather than inline event fields.

Structured events have stable fields for UUID, timestamp, service, host, PID and release. Child loggers attach attempt/job/ticket/session/parent-session/request/repository-commit/trace IDs where available. IDs are values, never dynamic column names.

The shared TypeScript package is ready for future native SDK hosts:

```ts
import { createLogger } from "@code-assist/observability";
const log = createLogger("agent").child({
  attempt_id: attemptId, ticket_id: ticketId, session_id: sessionId,
});
for await (const event of events) {
  log.payload("agent.event", "Native agent SDK event", event);
}
```

Record every exposed native event, including tool arguments/results, usage, identifiers and errors. This foundation does not launch Codex/Claude SDK sessions or automatically instrument them. The failure probe is a synthetic child process, not a real repository test or model invocation.

Known credential fields and values from the logger's environment are redacted before storage. Artifacts report redaction; hashes describe stored bytes. Unknown credentials in arbitrary prose are not reliably detected. Never record environment dumps, secret files or browser authentication state. Existing stdout/stderr and independently submitted OTLP data bypass this logger's redaction.

## Agent retrieval

From Tim's Tailscale device:

```sh
curl --fail 'http://100.91.0.83:3000/api/logs?attempt=<attempt-id>'
curl --fail 'http://100.91.0.83:3000/api/artifacts/<artifact-id>'
```

Search returns `filters`, `rows`, `nextOffset` and `partial`. Follow every `nextOffset`, retaining `start`, `end`, `attempt` and `service`. Pages contain 100 events with no total application evidence limit. Times are epoch milliseconds; defaults include all retained history through request time, newest first.

`partial: true` means incomplete results. Refresh for events indexed later. Download referenced artifacts and check byte counts/hashes before diagnosing. Missing evidence never proves success. Artifact 404 means missing data; search 503 means unavailable configuration/index rather than empty results.

OpenObserve's UI and `/api/default/mcp` are on **127.0.0.1:5080 on Mia**, accessible locally or through an SSH tunnel. Its credential is administrative, not read-only: this open-source version rejected `viewer`. No custom role emulation was added. Routine external agents should use the app's read endpoints. Native MCP and diagnosis by a separate AI agent remain unverified.

## Storage

Root: `~/Library/Application Support/CodeAssist`.

| Path / setting | Purpose |
| --- | --- |
| `logs/structured/*.jsonl` / `CODE_ASSIST_LOG_DIR` | Append-only events under `structured/` |
| `logs/*.log` | Existing launchd stdout/stderr |
| `data/artifacts/` / `CODE_ASSIST_ARTIFACT_DIR` | Full JSON payload files |
| `data/observability/openobserve/` | Index, metadata, WAL and streams |
| `data/observability/collector/` | File checkpoints and persistent export queue |
| `observability.env` | Container credentials/storage paths; mode 600, outside Git |
| `runtime.env` | App paths and server-only search URL/credential; mode 600 |
| `observability/` | Deployed container configuration |

Data stays outside release folders. No automatic deletion, rotation, sampling, disk quota or artifact clipping is configured. Raw and indexed copies both use disk. No disk alert or backup schedule exists. Disk exhaustion can fail evidence writes and work; extra capacity is not a backup.

For an external-drive move, stop the updater, writers and containers before copying data. Preserve permissions and verify copies. Set `CODE_ASSIST_OBSERVABILITY_DIR` in `observability.env`, `CODE_ASSIST_LOG_DIR` in both env files, and `CODE_ASSIST_ARTIFACT_DIR` in `runtime.env`; run the installer and restart services. Existing launchd output remains in `logs/` unless its definitions change.

Use canonical absolute paths. Installation and application writes reject an absent/unmounted `/Volumes/<name>` filesystem before creating directories. Container bind mounts do not create missing host paths. No external drive is configured yet: an actual migration needs unplug/remount and OrbStack login-start tests, including a startup mount check appropriate to that drive. Symlink aliases and replacement drives with the same name are not validated storage identities.

## Configuration review — October 20, 2026

Images are pinned by version and digest: OpenObserve **1.1.1**, Collector Contrib **0.163.1**. Settings were checked against the [environment reference](https://openobserve.ai/docs/administration/configuration/environment-variables/) and [pinned source](https://github.com/openobserve/openobserve/blob/v1.1.1/src/config/src/config.rs).

- Kept the working OrbStack installation; no external drive or split-volume layout was invented.
- Host ports 5080 and 4318 are loopback-only; 5081 is not published. Container HTTP must remain reachable by the collector and Docker forwarding, so container-localhost binding would be wrong here.
- `ZO_DATA_DIR`, `ZO_DATA_WAL_DIR`, `ZO_DATA_DB_DIR`, `ZO_DATA_STREAM_DIR` use explicit absolute container paths under the persistent mount.
- `ZO_TELEMETRY=false`; root credentials stay in the external env file.
- `ZO_COMPACT_DATA_RETENTION_DAYS=0` disables deletion in the pinned [retention code](https://github.com/openobserve/openobserve/blob/v1.1.1/src/compaction/src/retention.rs). Thirty-day deletion was not enabled.
- `ZO_INGEST_ALLOWED_UPTO=87600` accepts up to ten years of delayed records. This supports restart/backfill beyond the five-hour default; it is not retention.
- File memory caching defaults to **false in the pinned source**, although the docs table says true. `ZO_MEMORY_CACHE_MAX_SIZE` exists in that source but is absent from the docs table. No arbitrary memory limit was added. Memtables and queries still consume memory.
- Native schema/payload limits remain unchanged. Keep indexed fields stable and store full SDK/tool output in artifacts.

Back up metadata and stream data together while stopped, plus evidence and PostgreSQL separately. A metadata-only backup cannot restore missing stream files. Backup/restore is not yet proven.

## Operations and limits

Deployment applies container configuration before activating a release. Collector config changes restart that container. Both containers use `restart: unless-stopped`; OrbStack starts at login. Full logout/reboot recovery remains unverified.

On Mia with Node 24 on PATH:

```sh
node "$HOME/Library/Application Support/CodeAssist/current/ops/install-observability.ts"
node "$HOME/Library/Application Support/CodeAssist/current/ops/log-probe.ts"
```

The probe intentionally exits 7 and prints an attempt ID/Logs URL with full stdout/stderr. Readiness uses `/healthz`. OTLP HTTP accepts logs and traces on local port 4318; application trace instrumentation is not implemented.

The collector retains offsets and an export queue using shipped retry/queue limits. Long outages, rejection, queue exhaustion or full disks can leave index gaps while original files remain. Delivery is not exactly-once; duplicates retain event IDs. The native 1 MiB record limit splits oversized inline records; payload files avoid that parser limit.

For gaps, inspect source files and collector errors. Re-ingest relevant original records through the native API, retaining IDs/timestamps and respecting the ingestion age window. Do not delete evidence or reset checkpoints as routine repair. There is no replication or power-loss guarantee.

`make verify` covers multi-megabyte payload/hash preservation, redaction, path validation, escaping, pagination and partial-result reporting. Worker integration tests remain `make test-worker`.

References: [search API](https://openobserve.ai/docs/reference/api/search/search/), [MCP](https://openobserve.ai/docs/integration/ai/mcp/), [file receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/v0.163.0/receiver/filelogreceiver), [SvelteKit hooks](https://svelte.dev/docs/kit/hooks).

Optional optimizations and controls:

- **Localhost-only backend:** adopted from Tim's review; remote native UI/MCP requires a tunnel. SvelteKit remains accessible over Tailscale.
- **Ten-year ingestion window:** adopted from Tim's backfill recommendation; accepts delayed records across this instance that the five-hour default rejects. No retained data is deleted.
- **Mounted-volume validation:** adopted from Tim's missing-drive concern; configured external writes fail if the filesystem is absent. Actual external-drive startup remains unverified.

No cleanup, memory cap, custom retries, sampling or automatic refresh was introduced.
