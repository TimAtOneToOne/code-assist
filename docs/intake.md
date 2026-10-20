# Linear intake and repository selection

Home shows real Linear tickets and links to their repository-selection pages. This slice ends at Tim's repository choice. It does not run agents, start planning, write to Linear, change managed clones or publish GitHub branches.

## Configuration

At `/configuration/secrets`, save the Linear credential, Power Automate flow URL and Teams conversation ID. At `/configuration/intake`, select those three saved entries, select personal API key or OAuth access token, and choose the polling interval. The initial installation uses `LINEAR_API_KEY`, `CODE_ASSIST_TEAMS_WEBHOOK_URL` and `CODE_ASSIST_TEAMS_CONVERSATION_ID`. The working personal key was verified as Tim Ritzema's account.

The initial cadence is five minutes, using the brief's proposed interval. The settings also offer one minute or manual checks; Home has **Check Linear now**. Home's **Refresh results** reloads saved results without calling Linear. No open browser is needed for scheduled checks.

`data/intake.json` contains secret IDs, token type and interval, never credential values. It survives deployments beside `data/mac-mini.json`. Rotating a saved secret takes effect on the next use. Referenced secrets cannot be deleted until intake settings stop referring to them. Settings saves update pg-boss's native schedule; worker startup reconciles it again.

Home, ticket routes and settings require the configured owner's Tailscale identity and return `Cache-Control: no-store`.

## Discovery and suggestions

The native Linear SDK reads every page of issues carrying exact label `Plan` without exact label `Code`, plus every previously tracked issue still accessible to that credential. It includes archived issues and adds no assignee, team or workflow-status restriction. All label and comment pages are read; descriptions and comments are stored without clipping. Missing issues in a response are not treated as deleted or as having lost their labels.

The stable Linear issue UUID identifies one work record. Repeated checks update the stored ticket and candidate evidence while preserving Tim's selected repository. A known newer ticket version cannot be replaced by an older response. Tickets that later stop matching the labels remain visible; this slice does not cancel work or start another stage.

Candidate repositories are immediate child Git repositories of the configured Mac mini repository root. Discovery reads each clone's name and origin URL. Suggestions identify explicit repository names and matching GitHub repository links in the title, description and comments. Each suggestion identifies its supporting source; linked repositories may describe related work. This is literal reference matching, not model inference or repository-code analysis. Tim can select any discovered repository when suggestions are absent or incorrect.

Confirming saves one repository and a history event. It does not select automatically or approve implementation. If the saved ticket changed after the page was loaded, confirmation asks Tim to refresh and review it.

## Durability and attention delivery

The existing native worker consumes `linear-intake` and `attention-notification` queues. Linear reads and notification HTTP calls occur outside database transactions. A completed scan atomically saves ticket state, initial history events, notification intents and notification jobs. Repository changes and their history events also commit together.

Application tables are `code_assist.intake_issue`, `intake_event`, `intake_scan` and `attention_outbox`. They are separate from pg-boss queue retention and have no cleanup policy yet. The scan history and structured `intake.started`, `intake.completed`, `intake.failed` events identify the job. Home displays the latest check and safe failure details.

Each newly tracked ticket generates an attention message with a direct page link. Repeated discovery of that ticket does not create another initial attention event. The outbox keeps attempt count, safe errors and `sent_at`. Pending failed notifications are queued again on the next scan, worker startup or Home's **Retry pending notifications** action. HTTP success means the flow accepted the message, not proven Teams receipt. If a process stops after HTTP acceptance but before saving `sent_at`, delivery may repeat; this is the brief's accepted at-least-once behavior.

Both queues use explicit `retryLimit: 0`, consistent with the existing worker's visible failure handling. Notification retry is driven by the persistent outbox as described above. Remaining pg-boss queue and worker defaults apply, including active-job expiration; see [worker operation](worker.md). The worker drains these handlers on deployment. Agent process interruption and GitHub-write reconciliation remain future work.

Credentials are read at execution time from the existing private [secret store](secrets.md). Linear SDK errors can retain request headers and fetch errors can contain a signed URL, so these boundaries persist credential-safe errors and HTTP status rather than raw errors.

## Verification

`make verify` runs lint, formatting, types, unit tests and the production build. Intake unit tests exercise literal matching, trigger semantics, native SDK pagination and credential-safe errors.

```sh
TEST_DATABASE_URL=postgresql://<local-admin>@localhost:5432/postgres make test-intake
TEST_DATABASE_URL=postgresql://<local-admin>@localhost:5432/postgres make test-worker
```

The intake integration test creates and removes a disposable database. It checks restart persistence, repeated scans, selection history, changed labels, stale confirmation, transactional rollback, notification failure and subsequent acceptance without replaying a saved success. The worker regression retains the original process-restart and deployment-drain proof.

On October 20, 2026, the official Playwright MCP exercised the production web build against a disposable local database: saving intake settings, following Home to a ticket, reading suggestion evidence and comments, confirming a repository, and retaining the selection after reload. It also verified that Home stays first in navigation, ticket responses are not cached, stale confirmation is rejected, and cross-origin form submissions fail. No real ticket selection or notification was used for this test.

Optional optimizations and controls: none. Stable identity, atomic events/outbox, owner authorization and stale-input validation implement the stated durability and human-selection requirements.
