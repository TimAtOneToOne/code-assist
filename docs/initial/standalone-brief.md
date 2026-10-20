# Standalone Development Assistant Brief

October 19, 2026. Code Assist is a standalone TypeScript application deployed to a Mac mini. Its UI, controller, agents, database and artifacts run locally. External integrations are Linear, GitHub, OpenAI, Anthropic and the configured Teams notification endpoint. This is the current product brief; detailed implementation choices remain to be made.

## Product Goal

Help Tim move a Linear ticket through requirements, reviewed planning, implementation, validation and a human-reviewed PR. Run both the native Codex SDK and Claude Agent SDK. Prefer simplicity and resilience over promptness. Do not require managed repositories to upgrade their frameworks or change their normal validation just to fit the assistant's execution host.

The accepted interface answers three questions quickly: what needs Tim, what the agents are doing, and what happened while he was away. Home groups work into Needs You, Agents Working, Waiting on GitHub and Completed. A ticket shows a timeline, Now/Next status, agent activity, review rounds and the current human checkpoint. Implementation details belong in settings or diagnostics, not the main workflow.

Build the observability application in SvelteKit and serve it from the Mia Mac mini at its Tailscale address, reachable from Tim's other computers. Code lives in the Code Assist repository. Changes published to `main` must be picked up and deployed automatically on the mini, preserving durable work across application updates. Tim authorized direct pushes to `main` in Code Assist during the initial build; this does not change approval and branch requirements for repositories managed by the assistant.

## First-Release Workflow

1. Poll all pages of Linear issues with `Plan` and without `Code`. Use the stable issue UUID to maintain one tracked work record. Keep observing tracked work when its labels change; a partial poll cannot establish removal. On October 20, Tim requested marking tickets Removed and hiding them from Home when a returned ticket no longer has `Plan`. Preserve history and choices, pause pending attention prompts, and restore the record if `Plan` returns. The configured initial cadence is five minutes.
2. Tim confirms all applicable repositories. On October 20, 2026, he expanded intake to a searchable multi-select, prefilled with suggestions and without explanatory suggestion cards. Saved choices take precedence. Cross-repository planning, execution dependencies and coordinated PRs remain to be implemented; selecting repositories does not approve GitOps changes.
3. Read the ticket and repository, ask needed questions in the application and persist the answers. `Plan` authorizes planning, not implementation. Do not automatically comment on Linear, change its labels or move tickets between states.
4. Codex drafts a versioned plan; Claude reviews; Codex revises; Claude reviews again. Preserve every version and review. Before presentation, address all critical/high and most medium concerns; show remaining medium findings for Tim's decision. Do not invent a numeric meaning for “most.”
5. Present the plan and receive feedback. Revise and review again until critical/high concerns are addressed. Tim approves the exact current plan version, bound to requirements and repository; stale approval must fail. Scope changes require new approval.
6. Restore the recorded source commit into a separate working directory and implement the approved plan. Run the repository's own validation, including Docker-backed integration tests where required, plus browser checks for relevant user workflows. Do not upgrade Drizzle as part of this initiative.
7. Alternate code review until critical/high/medium concerns are addressed. Evidence and review findings belong to the actual tested commit; further code changes require renewed validation and review.
8. Publish the ticket branch and open a PR. Track feedback, checks, conflicts and the actual PR head. Tim reviews and merges; the agent never merges or enables auto-merge. Observed merge means Done for v1, not proof of deployment or production acceptance.

Approval should clearly authorize implementation, branch creation and PR publication. Tim clarified on October 20, 2026 that within Code Assist this exact-version approval also satisfies prior approval for GitOps changes described in the plan, including commits, pushes and PR publication. Do not introduce a separate GitOps approval checkpoint or workarounds solely to avoid it. Scope changes require a revised plan and approval. Agents never merge PRs, enable auto-merge, run Terraform apply or initiate infrastructure deployment; humans perform those actions through the established workflow. Default branches use `feature/<lowercase-ticket-id>` and cannot be reused after merge or deployment. Tim has authorized rebasing bot-created branches, with ownership established and an explicit expected-head force-with-lease. Unexpected remote changes require attention. Other destructive Git operations retain their existing approval requirements.

## Durable State and Recovery

Use a small TypeScript state machine backed by local PostgreSQL, advanced by a supervised local worker. Tim selected pg-boss for durable job execution on October 19, 2026. Native PostgreSQL 18 and launchd host the initial worker; see [the diagnostic proof and current limitations](../worker.md). The browser records commands and displays state; long-running agent work runs outside HTTP requests.

Preserve these behavioral requirements:

- Save state transitions and append-only events atomically, using short transactions; perform network calls outside them. Models produce work and findings, but do not grant approvals or declare merges.
- Keep work, messages, immutable artifacts, attempts, PR observations and events. Approval fields belong on the work record: approved plan hash, approver and approval time.
- Persist work across browser closure and controller restart. Waiting for Tim consumes no agent process.
- Identify every execution by attempt ID and immutable inputs. Accept results only from the current attempt. Stop or replacement prevents an old attempt from advancing work or publishing.
- Checkpoint at completed step boundaries. Preserve the resulting commit and output artifacts before accepting completion. An interrupted step can rerun from its recorded input commit; mid-step edits need not survive.
- A failed or stalled step displays its cause and a Retry action. Define actual process-liveness and interruption behavior for the Mac before implementation.
- Before a GitHub write, inspect the branch and existing PR for that head/base, including closed and merged PRs. Reconcile an uncertain previous write by reading remote state; do not blindly repeat publication or overwrite unexpected work.

Tim accepted at-least-once state-change notifications: save the event and notification intent in the same transaction, then post through the configured Power Automate endpoint. Keep `sent_at`, attempt count and safe error details; resend pending notifications on subsequent controller passes. Duplicate messages are acceptable. Include ticket, old/new state, step, reason, time and relevant links. HTTP success establishes webhook acceptance, not proven Teams receipt. Store destination credentials outside Git and out of agent subprocesses. No signed webhook URL is included in this handoff.

## Mac Mini Requirements and Gaps

| Area | Required outcome / decision still needed |
| --- | --- |
| Execution | Both native SDKs must run the real repository toolchain. Prove an unchanged full validation before building the workflow UI. |
| Docker | Tim explicitly wants Docker-backed validation. Select and verify a Mac-compatible container engine, including availability after restart. |
| Workspace isolation | Separate attempts must not share working files, databases, Docker project/volume names, app ports or browser profiles. Verify the chosen arrangement with two stories; do not silently add a global concurrency cap. |
| Process supervision | Workers need to continue without an open browser or terminal and recover after restart. Decide machine sleep, login/startup and process ownership; test the selected setup. |
| Storage | Keep durable state, completed source commits and validation artifacts on persistent storage. Choose local locations and a backup/restore approach. |
| Credentials | Define a local secret location and repository-specific test environment. Keep provider keys, GitHub authority, webhook credentials and browser auth state out of source and evidence. A private GitHub repository is not a secret store. |
| Access | Tim only initially, from other computers over Tailscale at `100.91.0.83`. Verify and implement the identity/access boundary; tailnet membership alone does not establish that only Tim can access the application. |
| Publishing | Separate trusted GitHub publication from model subprocesses. Enforce approval and expected-head checks; choose the local credential/process boundary and GitHub identity deliberately. |
| UI stack | SvelteKit, using the accepted prototype design, served by the Mac mini. TypeScript is this repository's default language. |
| Deployment | Automatically pick up published Code Assist `main` changes. Build separate releases; preserve PostgreSQL state, artifacts and workspaces across updates. Verify recovery during an active job. |

## Browsers and Repository Services

Give both SDKs native access to the official Playwright MCP server and test against the running application. Keep each repository's locked test tooling and compatible browser available; avoid downloading browsers on every attempt. Do not assume different repositories all use the same Playwright version.

For UI work, exercise approved acceptance scenarios, inspect rendering and relevant console/network failures, and save commit-linked outcomes and screenshots. Use traces for diagnosis when needed. Existing component tests do not substitute for authenticated end-to-end workflows. An unavailable approved test identity/session is a Needs You item, not permission to bypass authentication.

Use repository-owned setup and validation commands. Record them in the repository manifest rather than assuming universal commands or ports. Give each workspace a deliberate test environment separate from the assistant service environment; do not inherit deployment settings accidentally.

For migration conflicts, preserve the updated base history and intended schema change. Regenerate only this ticket's unmerged generated migration additions using that repository's installed tooling. Do not discard handwritten SQL, data migrations or already-applied history. Revalidate and rereview the rebased commit.

## Delivery Sequence

1. Prove one real repository on the Mac: restore a known commit, set up its environment/services, run unchanged full validation, and exercise browsers through both SDKs. Verify resource use, isolation and interruption behavior.
2. Deliver intake, durable questions/answers, plan/review versions, exact-version approval and notifications together.
3. Deliver implementation, code review, browser evidence, guarded PR publication, feedback/rebase handling and merge observation.

Remaining product decisions: interruption of active agent work after label removal, how Tim accepts medium plan findings, how non-converging reviews request help, and remaining Mac access/secret/process arrangements. Keep these visible instead of inventing controls.

Do not add a broker, cache, automatic provider fallback, global concurrency cap, review-round budget or arbitrary shorter timeout to v1. New controls require a demonstrated need and Tim's approval. Optional optimizations and controls introduced by this document: none.
