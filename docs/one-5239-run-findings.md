# ONE-5239 Coding Run: Manual Intervention Record

Ticket: http://100.91.0.83:3000/tickets/6d7f3021-daa8-4259-82c1-d9f0afca8a46
Run: `4d54017a-ce30-475e-a0a9-29ff4a4ba997`
Workspace: `bedd58e8-5966-42fb-8661-787158394117`
Repositories: `windmill`, `windmill-work`

Record each intervention honestly. A run completed with operator repairs is not proof of unattended operation. Derive a reusable pattern after observing this run; do not silently introduce blanket retries or source-integrity exceptions.

## 1. Terraform Validation Mutated Tracked Lockfiles

- Failed step: `5e300f0c-0558-4de1-ab25-192e027f93f9` (validation).
- Candidate: `7e047eed6c6bbd93d53464d9956df76f31a19901`.
- All configured checks passed, but the controller rejected a dirty checkout.
- `terraform init` added Linux ARM `h1:` provider checksums in four tracked `.terraform.lock.hcl` files (bootstrap, staging, production, and Windmill module). No provider versions or feature code changed.
- Onboarding ran checks on an archive and did not assert a clean Git candidate afterward, so it missed this incompatibility.
- Durable configuration correction: Windmill validation is now `make lint`, `make test`, then `TF_CLI_ARGS_init=-lockfile=readonly make validate`. Native Terraform mode still verifies recorded checksums; scope is the validation command, not implementation/dependency upgrades.
- Manual recovery: verified the run was failed and all modifications were checksum additions; saved the complete diff at `/work/evidence/operator-lockfile-checksum.diff`; restored only those generated files to the saved candidate; preserved original host/guest profiles; updated current workspace and saved repository validation profiles; wrote a central `coding.operator_repair` event; invoked normal `retryCoding` once.
- Operator script initially used the configuration response wrapper instead of `.configuration` when saving the future profile. That write was rejected. Current guest/manifest changes had already succeeded; the follow-up completed the saved profile write, audit, and queue operation without repeating the source restoration.
- Retry: `0ba4aa16-193f-4cb1-b358-3163e91beb47`.
- Reusable pattern candidate: onboarding should exercise the same Git/source-integrity contract as coding validation, exposing command side effects before approval. Validation commands must have an explicit non-mutating contract. Dependency changes belong in implementation, followed by validation of that exact commit.
- Recovery gap: changing saved setup does not update existing frozen workspaces. A supported, auditable recovery path is needed; do not pretend a manual profile edit is already automated. Preserve original attempts/profile evidence and require fresh validation after any operator-approved configuration repair.
- Existing source-integrity rejection was retained, not bypassed. No infrastructure applied or deployed.

## Outcome

Monitoring continues. Record further interventions and final validation/review/PR results below.

## Autonomous Recovery Observed After Intervention 1

Read-only initialization alone was insufficient: `terraform validate` rejected the cached Linux ARM AWS package because its unpacked `h1:` checksum was absent from the committed lockfile. The retry returned a normal failed check (exit 2) with an unchanged checkout. Code Assist automatically sent this evidence back to Codex for revision (`6664ce6c-cc89-477e-8b16-0c2799505f92`). Codex used native `terraform providers lock -platform=linux_arm64` for all four roots, preserving versions while adding the platform checksums. No second manual intervention was needed to start this revision. This demonstrates the existing validation-to-implementation loop; the initial dirty-source exception currently does not use that loop. Final validation still pending.

## 2. Approved Hosted Acceptance Prerequisite Cannot Run in Current Coding Environment

- Windmill revised candidate `3a8d7160a58d59c41f2202701bd2fec1dd834a3f` passed independent validation in step `fc962705-8338-4552-9e91-c32373a1d397`.
- Windmill Work implementation step `347d85dc-c10d-49d3-afbe-ceba3dbbd033` returned `needs_direction`; it made no feature changes.
- Approved Plan v4 requires a real browser-bridge capacity probe of 25,000,000 bytes in the exact production-instance ticket fork before full uploader implementation. It requires a native Git Sync fork, disabled copied schedules/triggers, exact target binding, and retained capacity evidence. Local mocks or a direct API call alone do not satisfy it.
- The coding prompt in `packages/intake/src/coding-runtime.ts` prohibits production access and Git publication. The controller currently provides neither a ticket-fork lifecycle nor completed capacity-probe evidence.
- The agent correctly reported this conflict. We must not fabricate evidence, silently waive the gate, or expand production access just to finish.
- Requested Tim's direction: establish hosted fork testing first, or revise the plan to permit local implementation followed by hosted testing before release.
- Reusable pattern candidate: planning must distinguish locally available checks, controller-managed external capabilities, and human prerequisites. Required pre-implementation checks need verified capabilities/evidence before coding starts. Runtime permissions and the exact approved plan must agree; blanket production access is not the solution.
- No intervention to bypass this prerequisite. Current run is paused at `needs_direction`, not complete. Neither PR is published, and Claude's combined code review has not run.

### Tim's Direction and Current Recovery

Tim answered: “just ignore the test. we'll test once it's deployed in production.” The hosted capacity test is explicitly deferred until after production deployment. Local checks remain required, and no live capacity success may be claimed.

The existing supported action is plan feedback, so a narrowly scoped v5 revision was requested through `submitPlanFeedback` on planning run `bbfcc080-61ee-414b-bfe3-cb8939bdfc1f`. V4 remains intact. The revision removes the pre-implementation hosted test/fork prerequisite, retains the 25,000,000-byte target and other product behavior, and records unverified live behavior for post-deployment operator testing. No blanket production permission is added.

Additional recovery gap: coding has no first-class “answer this question and continue” action. The supported plan-change route creates a new coding run after approval rather than continuing completed repository checkpoints. Preserve these findings when designing the reusable pattern; do not silently mutate old approvals or overwrite saved plans.

V5 completed Codex drafting and Claude review with no critical/high/medium findings. Claude confirmed the correction was scoped to Tim's direction; its one low finding concerned naming the existing ticket-branch convention, which the coding controller already supplies. The new version was authorized through `approvePlan` using Tim's explicit test-deferral instruction as the recorded approval basis; no new medium concerns were accepted. Plan hash: `dbb3c5fb95f9054913ff41db2b0f17ad42c0c76daef452e12ec28d04910c8cbe`. New coding run: `3e869727-ddf8-41ee-bdf0-812959668391`. Original run and approval remain preserved. This manual mediation is another intervention, not unattended recovery.

### Fresh v5 Run: Validation Recovery Without Operator Edits

The fresh run initially removed generated ARM lockfile additions during implementation, then failed the native read-only validation with exit 2. The controller automatically queued Codex revision (`863d659b-648e-4a47-b372-78bd95ad7208`), which added the platform checksums with `terraform providers lock`. No manual workspace edit or retry was performed in this fresh run. This confirms that the corrected validation command produces an actionable agent-repair loop, though onboarding still needs to detect the underlying platform requirement earlier.

## 3. Browser MCP Could Not Launch Chromium

- Active v5 Windmill Work step: `266352c7-3527-4c22-9001-8f57be72f134`.
- Playwright MCP navigation/snapshot failed with `chrome_crashpad_handler: --database is required` and SIGTRAP.
- Inspection found `/home/workspace/.config` owned by root (0755), containing the root-installed uv receipt. The agent's HOME correctly pointed to `/home/workspace`, but Chromium could not create its config/crash-report directory there. Repository browser tests and the agent MCP browser use different browser launch paths, so passing one did not prove the other.
- Manual repair: changed ownership of the `.config` directory itself to `workspace:workspace`; left root-owned uv receipt files intact. A fresh full-Chromium launch and `about:blank` navigation succeeded immediately afterward.
- Durable correction prepared in Code Assist bootstrap: create the workspace-owned `.config` directory before root-run system/package installers. No browser flags, sandbox behavior, dependency wrapper, or checksum check was weakened.
- Await the running agent's MCP navigation and full checks before claiming its workflow passed. Code Assist changes will be deployed after the active run, avoiding worker interruption.
- Reusable pattern candidate: onboarding must exercise the actual agent MCP browser launch under the actual agent identity, not only the repository's Playwright test runner. User-owned runtime/config directories must be prepared before privileged installers run.

### Browser Repair Required a Second Manual Resume

The agent completed 58 backend tests, two browser suites (Vite and generated bundle), generated-artifact checks, root lint, 115 flow tests, and 21 paired Terraform tests. It returned real screenshot/evidence paths but did not retry MCP after the earlier launch failure. The controller requires both evidence files and a successful MCP `browser_navigate`/`browser_run_code` call, so it rejected the result as “did not supply browser evidence.” That message obscures the difference between missing evidence files and failed MCP execution.

Manual recovery preserved candidate `1d8372fcb73302cd50f84b58c3922bb99e4b8fd0` with the normal checkpoint exporter before retry, preventing the retry's hard reset from discarding tracked implementation changes. The failed attempt remains failed; its actual agent output and an explicitly labeled operator recovery note were retained. The run's candidate references were advanced to the preserved commit and the normal retry API queued a fresh implementation attempt. The operator note directs the agent to use the repaired MCP browser and preserve completed work. No successful browser call was fabricated and the existing check was not bypassed.

Reusable gaps: distinguish post-agent verification failures from coding failures; preserve candidate code and actual agent output before reporting failure; include actionable failure context in retries; provide a supported recovery action instead of direct operator repair of candidate metadata. Reconsider whether a specific MCP call is the right evidence contract separately—do not silently weaken it during this run.

## 4. Published PR Descriptions Omitted Material Evidence Limits

The controller published both PRs with the same generic summary and a link to Code Assist. The descriptions did not identify the actual repository changes, the deferred live checks, or Claude's requested note about ARM checksum additions. I updated both descriptions to name the changes, link the companion PR, describe local validation, and explicitly state that hosted capacity/effective IAM/public delivery/non-admin use remain unverified until post-deployment testing. The Windmill description now explains that checksum additions do not change provider versions.

Reusable pattern candidate: publication should build a repository-specific summary from the approved scope, implementation result, review findings, and explicit verification limitations. A generic “checks passed” sentence is insufficient when local and live acceptance differ.

## Published Result

The v5 coding run reached `pr_open` at 2026-10-20 9:10 PM EDT:

- [Windmill PR #54](https://github.com/OnetoOneHealth/windmill/pull/54): `e63367ec8ec84405a38f4adb40515a0bf1092c56`.
- [Windmill Work PR #46](https://github.com/OnetoOneHealth/windmill-work/pull/46): `a1a23211f80c7d4cb9212dfb02ba696c2542409b`.

Both repositories passed controller validation. Claude reviewed the combined candidates and independently reran the uploader's checks, returning ready with only two low findings (platform lockfile hashes and a cosmetic blank line). The successful retry included real MCP navigation. Local uploader evidence includes 58 backend tests, Vite and generated-bundle browser suites including the maximum-size request, artifact/parity checks, repository lint, and 115 flow tests. Windmill passed 24 Python tests and 21 Terraform tests. Production verification remains deferred per Tim. PRs remain for Tim to merge; `pr_open` is not deployed/Done.

The browser ownership fix passes Code Assist `make verify`, and a real full-Chromium launch/navigation succeeded after the equivalent ownership correction in the guest. This does not make the whole run unattended: the interventions above remain work for the reusable recovery design.

Optional optimizations and controls: none. The validation-mode and directory-ownership corrections repair demonstrated failures while retaining existing checks.
