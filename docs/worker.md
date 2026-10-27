# Durable Worker

Code Assist uses pg-boss 12.38.0 in `apps/worker`, running as a separate native Node process with PostgreSQL 18 on Mia. Tim selected pg-boss on October 19, 2026. SvelteKit records commands and displays state; the worker executes long-running agent work outside HTTP requests.

`apps/worker/src/main.ts` registers the following workflows:

| Queue | Purpose |
| --- | --- |
| `linear-intake`, `attention-notification` | [Ticket polling and durable attention delivery](intake.md) |
| `initial-discovery` | [Codex investigation and saved scope questions](discovery.md) |
| `adversarial-planning` | [Alternating Codex/Claude planning and exact-version approval](planning.md) |
| `approved-coding` | [Workspace preparation, implementation, checkpoints, validation, review, and publication](coding.md) |
| `github-pr-refresh` | PR/main-workflow observation and scoped corrective-work initiation |
| `repository-setup-test` | [Disposable runtime profile tests](repository-setup.md) |
| `completed-workspace-cleanup` | [Eligible completed guest cleanup with retained evidence](coding.md#completed-workspace-cleanup) |

The original diagnostic workflow also remains available:

`queued → waiting for confirmation → confirmed → completed`

The probe exercises job creation, execution, a human-style wait, explicit continuation and durable history. Probe confirmation is an operator CLI command, separate from ticket repository selection and plan approval. The probe does not run models, approve a plan or publish a PR.

## State and transaction boundaries

The `code_assist` database is owned by the local `code_assist` role, which is not a PostgreSQL superuser. The existing localhost-only PostgreSQL listener and local trust authentication remain in use. Discovery shell tools use Codex's native read-only filesystem profile with network access disabled. They do not inherit controller credentials or its environment; see the validated scope and remaining lifecycle limitation in [discovery](discovery.md).

- pg-boss owns its `pgboss` schema and native migrations.
- `code_assist.engine_probe` stores probe state and the current job ID.
- `code_assist.engine_probe_event` stores append-only checkpoint events and the release that produced each event. There is no application-history cleanup.
- Creating or confirming a probe commits its state, event and queued job in one short transaction.
- A probe handler uses pg-boss's native transactional worker so its state change, event and job completion commit together.
- Waiting leaves no active job. Confirmation creates a new job, using a locked state check so a repeated confirmation cannot enqueue a second continuation.

The bullets above describe the diagnostic probe. Production ticket workflows have their own intake, discovery, planning, coding, setup-test and outbox records; see their linked guides. Agent/network steps run outside transactions and commit results, events and continuations in short transactions after validating the current attempt. Probe handlers only execute SQL; do not extend their transactional callback to contain an agent call.

## Runtime and defaults

The worker loads `CODE_ASSIST_DATABASE_URL` from the operator-managed `~/Library/Application Support/CodeAssist/runtime.env`. It is never included in source or build output. `CODE_ASSIST_COMMIT` identifies the exact running release.

The diagnostic queue explicitly sets `retryLimit: 0`, matching the brief's visible failure/manual Retry behavior. Its remaining queue/worker settings use pg-boss defaults: one handler per process for this queue, one job per poll, a two-second poll, a 15-minute active-job expiration, 14-day queued-job retention and seven-day completed-job retention. Human waits and checkpoint history are in application tables and do not expire with queue records. A failed job can be retried explicitly with the CLI while its queue record remains available.

These are diagnostic-queue settings, not a global ticket concurrency policy or an agent execution budget. Discovery uses the configured parallelism below and otherwise native queue defaults with explicit failure/manual Retry. Its reconciliation detects missing worker PIDs and expired jobs; durable application history retains questions and answers after queue retention. Queue durability does not provide exactly-once external effects.

Coding jobs have Tim's approved 60-minute expiration per step. Checkpoint and evidence-collection jobs additionally allow two retries with a ten-second delay to recover saved output. Other stages do not inherit these retries: validation findings can return to implementation, while execution failures expose recovery actions. These settings are local to those jobs, not a global retry or concurrency policy. See [coding recovery](coding.md#recovery-and-publication) for receipts, checkpoint replay and process ownership.

`SIGTERM` and `SIGINT` signal active handlers. Discovery/planning runners clean up owned subprocesses and checkpoint replacement work; coding uses owned guest systemd units and saved stage results. Native `offWork()` unregisters setup-test, coding, cleanup, GitHub, planning, discovery, probe, intake and attention workers before pg-boss closes. The updater sends `SIGTERM` after activating a release; launchd starts the replacement when the old worker exits. Web and worker may briefly report different releases during draining. Machine shutdown or unloading a service can interrupt recovery. See [discovery recovery](discovery.md#recovery-and-subprocess-ownership) and [coding recovery](coding.md#recovery-and-publication) for limits.

Immediately before a push or restart that deploys Code Assist, operators must verify no active workflow or queued continuation remains. Recovery support does not waive this check. The worker process normally stays running; process existence alone does not establish active work or idleness.

## Operations

### Discovery Parallelism

**Configuration → Agent Execution → Maximum Parallel Discoveries** controls concurrent
discovery tickets on Mia, including automatic repository setup inside each discovery.
The default is **3**, as requested October 27, 2026. Values must be positive whole numbers.
Planning, coding and manually requested setup tests keep their separate worker settings;
this is not a host-wide process limit or a CPU/memory measurement.

The setting is atomically saved to `data/execution.json`. The worker watches that file
and uses pg-boss's native `localConcurrency` option. On a change, native `offWork()`
stops fetching more discoveries and waits for current handlers to finish, then registers
the workers at the latest saved maximum. This applies to increases and decreases:
queued tickets wait during the transition, active jobs are not cancelled, and no service
restart is required. Saved settings survive deployment and worker restart. Existing
per-ticket locks and stale-attempt checks remain in place. Independent tickets can test
the same repository in separate disposable guests; saved-profile publication retains its
existing lock and precedence rules.

The implementation uses the installed pg-boss 12.38 native worker lifecycle; official
[worker APIs](https://pgboss.io/api/workers) and [release notes](https://github.com/timgit/pg-boss/releases/tag/12.38.0)
were checked before implementation. No custom scheduler or library patch is needed.
`discovery-concurrency.integration.ts` exercises actual pg-boss workers at 3, then 2,
then 3, proving queued work waits, active jobs finish without cancellation, and shutdown
closes configuration watching. This fixture does not prove live agent throughput or
Mia's resource capacity.

**Optional optimizations and controls:**

- **Requested by Tim:** configurable maximum discovery concurrency, default 3. This
  replaces accidental one-at-a-time processing; excess tickets wait, and higher values
  consume more host resources. Changes wait for current discoveries to finish. Scope:
  discovery only, including its repository setup. No other optional controls added.

### Commands

Run on Mia with Node 24 on PATH:

```sh
node "$HOME/Library/Application Support/CodeAssist/current/ops/probe.ts" create
node "$HOME/Library/Application Support/CodeAssist/current/ops/probe.ts" status <probe-id>
node "$HOME/Library/Application Support/CodeAssist/current/ops/probe.ts" confirm <probe-id>
node "$HOME/Library/Application Support/CodeAssist/current/ops/probe.ts" retry <probe-id>
launchctl print "gui/$(id -u)/com.code-assist.worker"
tail -n 60 "$HOME/Library/Application Support/CodeAssist/logs/com.code-assist.worker.log"
```

`status` includes application history and the current pg-boss record, including failure details. After queue-record retention, history still exists but `job` may be null. No probes are automatically created or confirmed.

For an existing web installation, provision the database and runtime setting first, deploy the worker release, then run `node current/ops/install-worker.ts` from the installation root once. Fresh installations register the worker through `ops/install.ts`. Do not rerun the worker installer against a loaded service.

## Verification

`make verify` runs formatting/lint and type checks across the apps, packages and ops, unit tests for ops, web, observability, secrets and intake, then the production web build. PostgreSQL, live-browser and OrbStack integration suites are separate targets; worker and browser packages do not have unit-test suites in the root test command. Node runs the worker's TypeScript directly. `skipLibCheck` skips third-party declaration internals because pg-boss 12.38.0 publishes references to an omitted internal type; our application and its calls to the public API remain type-checked. No dependency patch or custom transaction adapter is used.

Run the PostgreSQL integration test separately:

```sh
TEST_DATABASE_URL=postgresql://<local-admin>@127.0.0.1:5432/postgres make test-worker
```

The test creates a uniquely named disposable database and removes only that database afterward. It proves queued work is consumed, waiting survives a killed worker, confirmation survives worker downtime, a new release completes the continuation, duplicate confirmation is rejected, state/event failure rolls back completion, explicit retry succeeds, enqueue rolls back with application state, and SIGTERM waits for an active SQL handler without claiming the next job.

Discovery, planning and coding implement attempt checks, exact-version approvals, saved human checkpoints and guarded GitHub-write reconciliation. `make test-intake` covers their PostgreSQL integration fixtures separately from the diagnostic suite. Database backup/restore and full machine reboot recovery remain unproven. Checkpoint recovery does not mean an active Codex/Claude process survives a deployment.

### Initial installation evidence — October 19, 2026

- `make verify` passed locally and in Mia's automatic release build.
- The PostgreSQL integration test passed against local PostgreSQL 17.11 and Mia's PostgreSQL 18.6, including an active-handler drain.
- Release `39d6590` started under `com.code-assist.worker`. A live probe reached its saved waiting state; killing that worker with `SIGKILL` caused launchd to start a new worker process.
- Worker startup logs identify both release and PID. Probe history records the release at each checkpoint, allowing a continuation after deployment to be distinguished from the original execution.

References: [pg-boss workers](https://pgboss.io/api/workers), [queue defaults](https://pgboss.io/api/queues), [transaction API](https://pgboss.io/api/constructor).

Optional optimizations and controls: discovery's owned-subprocess cleanup was approved by Tim after the SDK crash probe; [scope and tradeoff](discovery.md#validation). Explicit failure handling, transaction checks and deployment draining implement the requested durability requirements.
