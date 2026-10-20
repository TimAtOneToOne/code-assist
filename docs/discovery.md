# Initial Codex discovery

This step reads a Plan ticket and its user-confirmed repositories, records initial findings and open questions, and saves Tim's answers as the planning baseline. It stops before the full plan/review cycle. Codex is the discovery agent; Claude review comes later.

The UI follows `docs/initial/index.html`: a Now/Next summary, a scope-and-questions checkpoint, saved answers, and earlier activity. Home retains the compact ticket cards. Repository selection is collapsed after confirmation; it remains editable. A changed scope creates a new discovery, preserving earlier findings and answers.

## Trigger and state

Confirming repository selection atomically queues `initial-discovery`. Worker startup also picks up previously selected, eligible tickets. Subsequent Linear checks reconcile changed inputs. `Plan` without `Code` is required. Removed tickets stay hidden and cannot accept answers or publish a current discovery result.

`queued → running → questions → ready`

- `questions` means findings are ready for human review. Codex may return zero questions when the evidence is sufficient; Tim still confirms scope.
- `ready` means the answers and scope are saved, not that a plan was generated or approved.
- Failures are visible with a Retry action. Retry creates a new attempt and retains the old one.
- Changed ticket data or repository choices supersede the prior attempt. Only the current attempt/job can save a result or accept answers. Older pages receive a conflict instead of silently saving stale input.

`code_assist.discovery_run` stores the immutable ticket input, selected repository paths, input hash, captured commits, job/thread IDs, state, findings, questions and answers. `intake_issue.current_discovery_id` identifies the current attempt. State transitions and history are committed in short transactions. Successful result acceptance completes the native pg-boss job and saves its questions/notification intent in the same transaction. Model calls and filesystem operations run outside transactions.

Existing notification delivery posts to the saved Teams flow when discovery is ready or fails. Superseded questions/failures and already-answered checkpoints do not send pending prompts. No new notification is created merely because the page is refreshed. Existing at-least-once delivery semantics remain.

## Repository inputs and runtime

Each attempt archives the HEAD commit of each selected synced clone into `data/discovery/<attempt>/workspace/<repository>`. It records the source path and commit before Codex starts. Background clone synchronization cannot change that snapshot. Git archives contain tracked exported files; untracked files, Git history, and submodule working trees are absent. The prompt identifies these limits and requires Codex to report missing evidence rather than pretend to have inspected it.

The current native `@openai/codex-sdk` and its CLI are pinned to 0.163.0. The SDK's model and reasoning defaults apply. The saved secret named `OPENAI_API_KEY` supplies the approved OpenAI credential. Repository environment mappings are not needed for read-only inspection. No provider key is copied to a repository or passed into shell-tool environments.

Each attempt has an isolated Codex home. A native permission profile grants read access to its snapshot and minimal OS runtime paths, with no command network access or write grants. Interactive approvals and web search are disabled for this unattended read-only step. Codex's API connection remains available. No operator Codex/MCP configuration, AWS credentials, GitHub authority, controller database URL or Teams webhook is inherited by agent tools.

The service process uses the SDK's native streaming API, structured-output schema and AbortSignal. Full SDK events and input/failure payloads go through the existing credential-redacting artifact logger, with stable ticket, attempt, job and thread IDs. The ticket page links to the existing Logs view filtered by attempt. Native session files remain in the attempt's isolated home. No new retention policy, output clipping or question limit was added.

## Recovery and current deployment blocker

Native pg-boss defaults apply, including active-job expiration; automatic retries remain disabled. A graceful worker shutdown aborts the investigation and queues a new attempt using the already captured snapshots. An unexpected worker death leaves a visible failed attempt on reconciliation, with an explicit Retry action. Committed findings and answers do not depend on a live worker or browser.

**Pending approval:** a real crash test on Mia showed SDK 0.163.0 terminates the Codex CLI on AbortSignal but leaves an active `/bin/sleep 60` shell subprocess orphaned. The SDK runner's IPC disconnect correctly detects worker death; native subprocess cleanup is incomplete. No custom cleanup workaround has been implemented. Tim's SDK-workaround rule requires approval for cleanup limited to the subprocesses owned by the discovery attempt. Production deployment is pending this decision and a passing cleanup regression.

## Validation

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

A native permission probe verified that snapshot reads succeed while writes and reads outside the supplied workspace fail. `make verify`, `make test-intake`, and `make test-worker` passed locally. The crash probe described above is a known failure, not a completed durability claim.

References: [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [native permission profiles](https://learn.chatgpt.com/docs/permissions), [sandboxing](https://learn.chatgpt.com/docs/sandboxing).

Optional optimizations and controls: none. Snapshot isolation, read-only permissions, credential separation, stale-input checks and human scope confirmation implement the requested discovery boundary. Any approved subprocess workaround must be listed here before deployment.
