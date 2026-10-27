# Initial Codex Discovery

This step reads a Plan ticket and its user-confirmed repositories, records initial findings and open questions, and saves Tim's answers as the planning baseline. Confirming the answers queues the [adversarial planning cycle](planning.md): Codex drafts and revises, Claude reviews, and Tim approves the exact plan.

The UI provides discovery status, a scope-and-questions checkpoint, saved answers, and earlier activity; `docs/initial/index.html` preserves the original visual reference. Home uses compact ticket cards. Repository selection is collapsed after confirmation; it remains editable. A changed scope creates a new discovery, preserving earlier findings and answers.

## Explanation and Questions

New discovery and setup scans start with **What I Understand**: a plain-language
description and a short fenced pseudocode explanation using everyday WHEN / IF /
THEN / OTHERWISE steps. It distinguishes current behavior from the requested
outcome, preserves important permissions and data-handling requirements, and
identifies unknowns without inventing decisions. Setup scans receive the ticket
and label their understanding as preliminary; they do not claim a completed
feature investigation.

Questions ask only for unresolved decisions or facts that change the work. Each
asks one concrete thing, explains why the answer matters, and offers understandable
choices where useful. The agent must use source evidence and prior answers before
asking, avoid repeating decisions already in the ticket, and explain any technical
name needed for an action. Missing access must have a specific, actionable next
step; selecting an answer does not itself supply credentials or perform setup.

These presentation requirements are included in both runtime prompts, including
when saved prompt overrides exist. The existing result format and saved answers
are unchanged. Technical evidence remains available under **Supporting Findings**
after the questions; setup status and logs are under **Repository Setup Details**.
Existing saved results retain their original wording until a new attempt runs.
This changes presentation, not the setup/approval sequence or agent permissions.

Optional optimizations and controls: none.

## Trigger and State

Confirming repository selection atomically queues `initial-discovery`. Worker startup also picks up previously selected, eligible tickets. Subsequent Linear checks reconcile changed inputs. `Plan` without `Code` is required. Removed tickets stay hidden and cannot accept answers or publish a current discovery result.

Before ticket investigation, the worker reuses configured repositories and gathers/tests missing repository setups with Codex. See [Automatic Setup During Intake](repository-setup.md#automatic-setup-during-intake). Setup progress and test links appear on the ticket. Setup questions use the existing questions/answers checkpoint with `setup_pending=true`; answering them queues another discovery attempt instead of planning. Normal scope confirmation occurs after setup completes. Recorded repository setup commands and hashes accompany discovery into planning, without environment values.

Private Git dependencies are resolved separately from the selected change repositories.
The controller reads the requested versions through its configured clones, fetches missing
versions with host Git access, and follows nested Git submodules. Setup, discovery and
planning receive immutable dependency archives inside their read-only workspace.
The test/coding guest receives local Git copies without download credentials. Dependency
repositories never become coding or PR targets through this process. New discoveries
resolve versions again from their own source; they reuse tested setup commands, not stale
dependency pins. An absent catalog repository or an actual retrieval failure remains an
explicit blocker. Discovery records `dependency_snapshots` separately from `snapshots`.

`queued → running → questions → ready`

- `questions` means findings are ready for human review. Codex may return zero questions when the evidence is sufficient; Tim still confirms scope.
- `ready` means the answers and scope are saved and planning is queued; it does not imply plan approval.
- Failures are visible with a Retry action. Retry creates a new attempt and retains the old one.
- Changed ticket data or repository choices supersede the prior attempt. Only the current attempt/job can save a result or accept answers. Older pages receive a conflict instead of silently saving stale input.

`code_assist.discovery_run` stores the immutable ticket input, selected repository paths, input hash, captured commits, job/thread IDs, state, findings, questions and answers. `intake_issue.current_discovery_id` identifies the current attempt. State transitions and history are committed in short transactions. Successful result acceptance completes the native pg-boss job and saves its questions/notification intent in the same transaction. Model calls and filesystem operations run outside transactions.

Existing notification delivery posts to the saved Teams flow when discovery is ready or fails. Superseded questions/failures and already-answered checkpoints do not send pending prompts. No new notification is created merely because the page is refreshed. Existing at-least-once delivery semantics remain.

## Repository inputs and runtime

Each attempt archives the HEAD commit of each selected synced clone into `data/discovery/<attempt>/workspace/<repository>`. It records the source path and commit before Codex starts. Background clone synchronization cannot change that snapshot. Git archives contain tracked exported files; untracked files, Git history, and submodule working trees are absent. The prompt identifies these limits and requires Codex to report missing evidence rather than pretend to have inspected it.

The current native `@openai/codex-sdk` and its CLI are pinned to 0.163.0. The model defaults to `gpt-6.1-sol` and is editable in [Agent Models](models.md). Each discovery step reads the saved selection at startup; native reasoning defaults still apply. The saved secret named `OPENAI_API_KEY` supplies the approved OpenAI credential. Repository environment mappings are not needed for read-only inspection. No provider key is copied to a repository or passed into shell-tool environments.

Each attempt has an isolated Codex home. A native permission profile grants read access to its snapshot and minimal OS runtime paths, with no command network access or write grants. Interactive approvals and web search are disabled for this unattended read-only step. Codex's API connection remains available. No operator Codex/MCP configuration, AWS credentials, GitHub authority, controller database URL or Teams webhook is inherited by agent tools.

The service process uses the SDK's native streaming API, structured-output schema and AbortSignal. Full SDK events and input/failure payloads go through the existing credential-redacting artifact logger, with stable ticket, attempt, job and thread IDs. The ticket page links to the existing Logs view filtered by attempt. Native session files remain in the attempt's isolated home. No new retention policy, output clipping or question limit was added.

## Recovery and subprocess ownership

Native pg-boss defaults apply, including active-job expiration; automatic retries remain disabled. A graceful worker shutdown aborts the investigation and queues a new attempt using the already captured snapshots. An unexpected worker death leaves a visible failed attempt on reconciliation, with an explicit Retry action. Committed findings and answers do not depend on a live worker or browser.

A real crash test on Mia showed SDK 0.163.0 terminates the Codex CLI on AbortSignal but leaves an active `/bin/sleep 60` shell subprocess orphaned. Tim approved cleanup of the run's owned subprocesses on October 20, 2026. Before SDK cancellation, the separate runner identifies its descendants by parent relationships, freezes them to stop further spawning, and terminates them. It checks PID/start-time identity before each signal and excludes its own inspection process. This covers commands in separate process sessions; it never kills by a global process name or signals the controller.

Worker IPC disconnect, explicit cancellation and runner SIGTERM invoke this cleanup. Interrupted discovery can restart from its recorded repository snapshots. Cleanup applies to the shared discovery/planning runner; a direct SIGKILL of the runner itself cannot execute a cleanup handler. The runner must stay alive long enough to handle its worker's disconnect or cancellation.

## Validation

October 26 presentation verification used native setup and feature-discovery
scans on ONE-5370's recorded Connect source with Mia's saved model and prompts.
Setup received the ticket and separated its preliminary feature explanation from
the missing library access. Feature discovery described the requested removal
and retained documents. These were read-only probes, not passing setup tests or
implementation approval. The local browser preview checked explanation ordering,
pseudocode rendering and wrapping at desktop/phone widths, expandable evidence,
free-text submission, and the existing zero-question scope confirmation. Evidence
is under `.tmp/2026-10-26-discovery-clarity/`. Existing saved discovery content is
not silently rewritten by a deployment.

`make verify` covers lint, formatting, types, unit tests and the production web build. `TEST_DATABASE_URL=... make test-intake` uses disposable databases and synthetic Git repositories to verify:

- Selection queues once, including concurrent start protection and restart persistence.
- Multiple repository snapshots remain unchanged after source files change; untracked `.env` files are absent.
- Successful job completion, questions, history and outbox roll back together on failure.
- Answers persist, duplicate submission is idempotent, and changed inputs reject stale answers/results.
- Removed tickets cannot publish results; expired jobs fail visibly and explicit retries create new attempts.
- Graceful shutdown checkpoints preserve captured repository commits.
- Zero-question discovery still supports scope confirmation.

The official Playwright MCP exercised the built application with a disposable database: repository selection queued discovery, answer choices populated editable fields, free-text answers and notes survived reload, stale submissions received a conflict, Retry queued a new attempt, and a zero-question result still required scope confirmation. Desktop screenshots were reviewed and the mobile layout had no horizontal overflow. The expected stale-submission HTTP 409 was the only browser error.

A full synthetic worker run on Mia used a disposable database and Git repository, the saved OpenAI key, and the real Codex SDK. It captured the source commit, read the fixture, saved a grounded finding and question, completed the native job, wrote correlated activity artifacts, and recorded one unsent notification intent. The source repository was unchanged; the disposable database and temporary secret entry were removed. No real ticket was investigated or notification sent by that test.

A native permission probe verified that snapshot reads succeed while writes and reads outside the supplied workspace fail. `make verify`, `make test-intake`, and `make test-worker` passed locally. The owned-process regression verifies detached descendants are terminated while an unrelated process stays alive. Real SDK crash and cancellation probes on Mia also passed: the worker, runner, Codex CLI, code-mode host and active shell command were gone, while the unrelated process remained alive.

References: [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [native permission profiles](https://learn.chatgpt.com/docs/permissions), [sandboxing](https://learn.chatgpt.com/docs/sandboxing).

Optional optimizations and controls:

- **Explicit model selection — requested by Tim October 20, 2026.** The initial defaults are `gpt-6.1-sol` for Codex and `claude-opus-5-5` for Claude. Each discovery/planning step uses the saved Agent Models selection. New runs no longer follow changes to the SDKs' default model selection; model upgrades require an explicit configuration change. These are provider model IDs, not immutable model-weight snapshots.
- **Owned subprocess cleanup — approved by Tim October 20, 2026.** SDK cancellation left an active shell command orphaned in the real Mia crash test. The shared discovery/planning runner freezes and terminates only its descendants before cancelling the SDK. Cancellation ends those commands immediately; it does not give them a graceful exit. Coding guests use separate systemd unit ownership described in [Coding](coding.md). No global process matching, workload limit or automatic retry was added by this cleanup behavior.

Snapshot isolation, read-only permissions, credential separation, stale-input checks and human scope confirmation implement the requested discovery boundary.
