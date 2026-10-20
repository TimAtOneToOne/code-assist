# Durable worker

Code Assist uses pg-boss 12.38.0 in `apps/worker`, running as a separate native Node process with PostgreSQL 18 on Mia. Tim selected pg-boss on October 19, 2026. SvelteKit remains the UI; HTTP requests will record commands, not execute agents.

The deployed worker runs [Linear intake and attention notifications](intake.md). The new [initial Codex discovery](discovery.md) implementation is awaiting a subprocess-cleanup decision before publication. The original diagnostic workflow remains available:

`queued → waiting for confirmation → confirmed → completed`

The probe exercises job creation, execution, a human-style wait, explicit continuation and durable history. Probe confirmation is an operator CLI command, separate from ticket repository selection and the future plan-approval API. The probe does not run models, approve a plan or publish a PR.

## State and transaction boundaries

The `code_assist` database is owned by the local `code_assist` role, which is not a PostgreSQL superuser. The existing localhost-only PostgreSQL listener and local trust authentication remain in use. Discovery shell tools use Codex's native read-only filesystem profile with network access disabled. They do not inherit controller credentials or its environment; see the validated scope and remaining lifecycle limitation in [discovery](discovery.md).

- pg-boss owns its `pgboss` schema and native migrations.
- `code_assist.engine_probe` stores probe state and the current job ID.
- `code_assist.engine_probe_event` stores append-only checkpoint events and the release that produced each event. There is no application-history cleanup.
- Creating or confirming a probe commits its state, event and queued job in one short transaction.
- A probe handler uses pg-boss's native transactional worker so its state change, event and job completion commit together.
- Waiting leaves no active job. Confirmation creates a new job, using a locked state check so a repeated confirmation cannot enqueue a second continuation.

The probe handlers only execute SQL. Future agent/network steps must run outside transactions and commit their result, event and next job in a short transaction after validating the current attempt. Do not extend the probe's transactional callback to contain an agent call.

## Runtime and defaults

The worker loads `CODE_ASSIST_DATABASE_URL` from the operator-managed `~/Library/Application Support/CodeAssist/runtime.env`. It is never included in source or build output. `CODE_ASSIST_COMMIT` identifies the exact running release.

The diagnostic queue explicitly sets `retryLimit: 0`, matching the brief's visible failure/manual Retry behavior. Its remaining queue/worker settings use pg-boss defaults: one handler per process for this queue, one job per poll, a two-second poll, a 15-minute active-job expiration, 14-day queued-job retention and seven-day completed-job retention. Human waits and checkpoint history are in application tables and do not expire with queue records. A failed job can be retried explicitly with the CLI while its queue record remains available.

These are diagnostic-queue settings, not a global ticket concurrency policy or an agent execution budget. Discovery also uses native queue defaults and explicit failure/manual Retry. Its reconciliation detects missing worker PIDs and expired jobs; durable application history retains questions and answers after queue retention. Queue durability does not provide exactly-once external effects.

`SIGTERM` and `SIGINT` abort discovery through the native SDK and checkpoint a replacement attempt with captured repository snapshots. Native `offWork()` waits for discovery, probe, intake and attention handlers before closing pg-boss. The updater sends `SIGTERM` after activating a release; launchd starts the replacement when the old worker exits. Web and worker may briefly report different releases during draining. The LaunchAgent retains macOS shutdown defaults: machine shutdown or unloading the service may terminate a handler before it finishes, leaving its uncommitted transaction rolled back. Complete agent descendant cleanup remains a deployment blocker.

## Operations

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

`make verify` checks formatting, lint, application types, web tests and the web build. Node runs the worker's TypeScript directly. `skipLibCheck` skips third-party declaration internals because pg-boss 12.38.0 publishes references to an omitted internal type; our application and its calls to the public API remain type-checked. No dependency patch or custom transaction adapter is used.

Run the PostgreSQL integration test separately:

```sh
TEST_DATABASE_URL=postgresql://<local-admin>@127.0.0.1:5432/postgres make test-worker
```

The test creates a uniquely named disposable database and removes only that database afterward. It proves queued work is consumed, waiting survives a killed worker, confirmation survives worker downtime, a new release completes the continuation, duplicate confirmation is rejected, state/event failure rolls back completion, explicit retry succeeds, enqueue rolls back with application state, and SIGTERM waits for an active SQL handler without claiming the next job.

Discovery implements attempt fencing, additive migrations and saved human checkpoints. Descendant cleanup remains pending. Full planning/implementation still needs exact-version plan approvals, GitHub-write reconciliation and database backup/restore. No claim is made that an active Codex/Claude process survives deployment or a full machine reboot.

### Initial installation evidence — October 19, 2026

- `make verify` passed locally and in Mia's automatic release build.
- The PostgreSQL integration test passed against local PostgreSQL 17.11 and Mia's PostgreSQL 18.6, including an active-handler drain.
- Release `39d6590` started under `com.code-assist.worker`. A live probe reached its saved waiting state; killing that worker with `SIGKILL` caused launchd to start a new worker process.
- Worker startup logs identify both release and PID. Probe history records the release at each checkpoint, allowing a continuation after deployment to be distinguished from the original execution.

References: [pg-boss workers](https://pgboss.io/api/workers), [queue defaults](https://pgboss.io/api/queues), [transaction API](https://pgboss.io/api/constructor).

Optional optimizations and controls: none. Explicit failure handling, transaction checks and deployment draining implement the requested durability requirements.
