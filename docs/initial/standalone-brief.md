# Standalone Development Assistant Brief

Originally written October 19, 2026; reconciled with implementation October 22, 2026. Code Assist is a standalone TypeScript application deployed to a Mac mini. Its UI, controller, agents, database and artifacts run locally. External integrations include Linear, GitHub, OpenAI, Anthropic, the configured Teams notification endpoint, Windmill test-fork publication, and the configured read-only AWS staging role for planning evidence. This brief records product requirements. Read [Current Status](../current-status.md) for delivered behavior and remaining verification gaps.

## Product Goal

Help Tim move a Linear ticket through requirements, reviewed planning, implementation, validation and a human-reviewed PR. Run both the native Codex SDK and Claude Agent SDK. Prefer simplicity and resilience over promptness. Do not require managed repositories to upgrade their frameworks or change their normal validation just to fit the assistant's execution host.

The interface answers three questions quickly: what needs Tim, what the agents are doing, and what happened while he was away. The current Home shows a Tickets list with a Needs Your Attention badge, plus Paused Work and Completed sections. Ticket pages show workflow status, agent activity, review rounds, history and human actions. The original prototype used Needs You / Agents Working / Waiting on GitHub groups and Now/Next summaries; those are historical design labels, not current UI labels. Implementation details belong in settings or diagnostics, not the main workflow.

Build the observability application in SvelteKit and serve it from the Mia Mac mini at its Tailscale address, reachable from Tim's other computers. Code lives in the Code Assist repository. Changes published to `main` must be picked up and deployed automatically on the mini, preserving durable work across application updates. Tim authorized direct pushes to `main` in Code Assist during the initial build; this does not change approval and branch requirements for repositories managed by the assistant.

## First-Release Workflow

1. Poll all pages of Linear issues with `Plan` and without `Code`. Use the stable issue UUID to maintain one tracked work record. Keep observing tracked work when its labels change; a partial poll cannot establish removal. On October 20, Tim requested marking tickets Removed and hiding them from Home when a returned ticket no longer has `Plan`. Preserve history and choices, pause pending attention prompts, and restore the record if `Plan` returns. The configured initial cadence is five minutes.
2. Tim confirms all applicable repositories through a searchable multi-select, prefilled with suggestions and without explanatory suggestion cards. Saved choices take precedence. Discovery and planning inspect all selected snapshots; coding implements repositories sequentially, validates candidates, and reviews them together before publishing separate PRs. Selecting repositories does not approve implementation or GitOps changes; exact-version plan approval does.
3. Read the ticket and repository, ask needed questions in the application and persist the answers. `Plan` authorizes planning, not implementation. Do not automatically comment on Linear, change its labels or move tickets between states.
4. Codex drafts a versioned plan; Claude reviews; Codex revises; Claude reviews again. Preserve every version and review. Before presentation, address all critical/high and most medium concerns; show remaining medium findings for Tim's decision. Do not invent a numeric meaning for “most.”
5. Present the plan and receive feedback. Revise and review again until critical/high concerns are addressed. Tim approves the exact current plan version, bound to requirements and repository; stale approval must fail. Scope changes require new approval.
6. Restore the recorded source commit into a separate working directory and implement the approved plan. Run the repository's own validation, including Docker-backed integration tests where required, plus browser checks for relevant user workflows. Do not upgrade Drizzle as part of this initiative.
7. Alternate code review until critical/high/medium concerns are addressed. Evidence and review findings belong to the actual tested commit; further code changes require renewed validation and review.
8. Publish the ticket branch and open a PR. Track feedback, checks, conflicts and the actual PR head. Tim reviews and merges; the agent never merges or enables auto-merge. Tim updated completion on October 20, 2026: Done requires an observed merge into main and successful GitHub Actions push-to-main workflows for that exact merge commit. Separate production promotions are not tracked. Failed main workflows feed a scoped corrective coding run and a new PR; Tim merges it.

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

## Mac Mini Requirements and Implementation

The original decision areas below now have implementations. Remaining operational proof is distinguished from the selected approach; see [Current Status](../current-status.md) and the linked guides for evidence boundaries.

| Area | Current Implementation and Remaining Verification |
| --- | --- |
| Execution | Native Codex and Claude SDKs run repository tooling in isolated coding guests; validation and acceptance evidence are tied to candidate commits. |
| Docker | OrbStack hosts ticket-local Ubuntu guests with private Docker engines; full unattended machine-reboot recovery remains unverified. |
| Workspace isolation | Separate ticket runs have separate guests, services, ports and browser profiles; selected repositories share one guest for paired acceptance. See [isolation proof](../concurrent-isolation-proof.md). |
| Process supervision | launchd supervises host services; guest systemd units own coding processes. Step recovery is implemented; FileVault/pre-login recovery remains unverified. |
| Storage | PostgreSQL, host Git checkpoints, logs and artifacts live outside releases. Completed guest cleanup preserves evidence. Backup/restore remains unproven. |
| Credentials | Private host secret store, repository mappings and per-workspace environments are implemented. Publication credentials stay in the controller. |
| Access | Direct Tailscale binding plus actual-peer owner checks; tailnet membership alone does not grant access. |
| Publishing | Controller-owned GitHub writes require current approval, exact-commit evidence, publication intent and expected-head checks. |
| UI stack | SvelteKit with shadcn-svelte components; TypeScript is the default language. |
| Deployment | Main updater validates separate releases and preserves durable state. Agent operators must verify Mia is idle immediately before pushes or restarts; recovery does not waive that requirement. |

## Browsers and Repository Services

Give both SDKs native access to the official Playwright MCP server and test against the running application. Keep each repository's locked test tooling and compatible browser available; avoid downloading browsers on every attempt. Do not assume different repositories all use the same Playwright version.

For UI work, exercise approved acceptance scenarios, inspect rendering and relevant console/network failures, and save commit-linked outcomes and screenshots. Use traces for diagnosis when needed. Existing component tests do not substitute for authenticated end-to-end workflows. An unavailable approved test identity/session is a Needs You item, not permission to bypass authentication.

Use repository-owned setup and validation commands. Record them in the repository manifest rather than assuming universal commands or ports. Give each workspace a deliberate test environment separate from the assistant service environment; do not inherit deployment settings accidentally.

For migration conflicts, preserve the updated base history and intended schema change. Regenerate only this ticket's unmerged generated migration additions using that repository's installed tooling. Do not discard handwritten SQL, data migrations or already-applied history. Revalidate and rereview the resulting candidate commit. The implemented Bring In Main action merges a pinned main commit into the feature branch; it does not rebase or rewrite published history.

## Original Delivery Sequence

1. Prove one real repository on the Mac: restore a known commit, set up its environment/services, run unchanged full validation, and exercise browsers through both SDKs. Verify resource use, isolation and interruption behavior.
2. Deliver intake, durable questions/answers, plan/review versions, exact-version approval and notifications together.
3. Deliver implementation, code review, browser evidence, guarded PR publication, feedback/rebase handling and merge observation.

The core workflow in these phases is implemented. The original feedback/rebase goal is only partially delivered: Tim can request code changes and explicitly Bring In Main through a merge, while automatic GitHub review-comment ingestion and automatic rebase/revalidation remain unimplemented. Label/input changes supersede obsolete attempts; pending results cannot advance them. Tim explicitly accepts each remaining medium plan finding before approval. Reviews can request human direction, without a review-round quota. Access, secret storage and process ownership are implemented as described above. Remaining work and operational proof are tracked in [Current Status](../current-status.md).

Do not add a broker, cache, automatic provider fallback, global concurrency cap, review-round budget or arbitrary shorter timeout to v1. New controls require a demonstrated need and Tim's approval. Optional optimizations and controls introduced by this document: none.
