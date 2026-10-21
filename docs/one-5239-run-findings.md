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

## 5. Test Deferral Was Incorrectly Expanded Into Removing Fork Delivery

Tim clarified after PR publication that he cannot merge an app without a testable Windmill fork. The operator's v5 feedback incorrectly treated his waiver of the hosted 25 MB capacity test as permission to remove native fork delivery altogether. This was an interpretation error, not an absent user requirement. The repository's Complete Fork Delivery instructions already require publishing and testing on the ticket fork before human merge.

Read-only verification found production Windmill EE v1.816.0 accessible from Mia using the existing production person token. Native Git Sync has fork synchronization and automatic fork PR creation enabled. No ONE-5239 fork exists. Local requests receive the load balancer's 403 source restriction; Mia succeeds. No infrastructure or network policy change is needed.

The published uploader explicitly rejects every workspace except `production`, and its membership lookup hardcodes that workspace. Correction requires the exact ticket-fork binding and a membership lookup against the validated execution workspace, plus a real native fork deployment. Preserve the original v4/v5 plans and the explicit deferral of the 25 MB test. Restore v4's bounded fork-testing/publication distinction rather than claiming a production-only artifact ran unchanged in a fork.

The native fork branch will be `wm-fork/main/one-5239`. Explicit Git Safety permission was requested to carry existing implementation commits to that branch while preserving PR #46 and `feature/one-5239`. PR #46 now includes a human merge of main at `31162b1ae35314d298abbdb3ead6140a827a3d09`; preserve that newer head. The infrastructure PR #54 remains open and unchanged. No fork, replacement PR, or deployed test success is claimed yet.

Reusable requirement: a waived individual acceptance test must not remove the deployment environment or other acceptance obligations. Planning and publication must distinguish a local preview, a deployed test fork, and parent production deployment. Record the fork URL, source commit, deployed version, and actual browser/backend evidence before presenting Windmill app work as ready for merge. This requirement is not yet implemented as an unattended controller capability.

### Authorized Fork Recovery and Hosted Evidence

Tim explicitly approved copying the implementation onto the native fork branch while preserving PR #46 and `feature/one-5239`. Created workspace `wm-fork-one-5239` through native Windmill fork operations; its branch is `wm-fork/main/one-5239`. Created only the fork's required `f/share` folder with controlled publisher ownership and `g/all` viewer access. Copied HTTP/SQS triggers are disabled; no enabled schedules or other triggers were found. Parent workspace content and infrastructure were not deployed.

The corrected app and source are in [Windmill Work PR #47](https://github.com/OnetoOneHealth/windmill-work/pull/47), currently draft. Native Git Sync deployed source commit `d66a052bad27ff2d59283d70c1283acf21aa986f` as app version **273**. Native outbound sync subsequently reordered the same two lockfile keys (no code change), producing `51de9c32ebf92e99b41040cf752f841831f5063c` (see live PR for authoritative current head). Exact deployed frontend file hashes and backend source match the maintained build. [Open the test fork](https://wm.onetoone.health/apps_raw/get/f/share/upload?workspace=wm-fork-one-5239).

Validation: repository lint and full `make share-check` pass, including 62 backend tests, both Vite/generated-bundle browser suites, generated-backend execution and artifact parity. The first local browser run failed because the temporary checkout was inside `.tmp`, which the app intentionally excludes from Vite serving; moving the checkout outside that path resolved it without changing that exclusion. Standalone browser validation passed with no console/page errors. The editor initially failed while Svelte dependencies loaded, then built successfully in 0.24 seconds; its preview rendered and rejected an unsupported file. The startup failure is historical, not a current broken preview.

A real 67-byte synthetic upload reached the backend and S3, but returned **AccessDenied (HTTP 403)**. The original catch-all error lacked diagnostics, so the app now records only the S3 error type, status and request ID, never raw error text, uploaded bytes, or credentials. Regression coverage verifies that redaction boundary. [Hosted failure evidence](https://wm.onetoone.health/run/01a15c98-2799-4ee3-988f-b0300a7a92a8?workspace=wm-fork-one-5239). [Infrastructure PR #54](https://github.com/OnetoOneHealth/windmill/pull/54) is still open; successful upload/public retrieval is not verified. The 25 MB hosted test remains deferred. After fork acceptance, the temporary exact fork binding must be removed and the production-only artifact checked, with the bounded difference recorded as v4 originally specified.

This recovery is manual. The original coding run, approval and published PR references were not rewritten to imply the controller performed it. A `coding.operator_repair` event records the fork URL, source/version, replacement PR, validation and S3 failure in central logs. Future controller work still needs native fork lifecycle, operator capability handling and hosted acceptance evidence before unattended Windmill delivery can be claimed.

### Production IAM Promotion and Successful Fork Upload

Tim merged infrastructure promotion [PR #55](https://github.com/OnetoOneHealth/windmill/pull/55). [Production run 39542765166](https://github.com/OnetoOneHealth/windmill/actions/runs/39542765166), source `7e6122da338b19bac47b4cec004ddf446eba3f88`, completed successfully through checks, staged-image promotion, plan, apply, and all four ECS service jobs. Apply reported zero additions, four changes, and zero deletions. Besides the worker/native IAM policies, it reset temporary October 14 ALB access/connection logging and the corresponding temporary bucket-policy permission; that was surfaced while watching the existing workflow, without modifying or dispatching infrastructure actions.

After deployment, the actual fork browser uploaded a 67-byte synthetic text file successfully. [Upload job 01a15cb1-ed85-f0c5-5a4b-2147bd904c8e](https://wm.onetoone.health/run/01a15cb1-ed85-f0c5-5a4b-2147bd904c8e?workspace=wm-fork-one-5239) returned `ok: true`. Public retrieval returned HTTP 200, `text/plain`, and exactly matching bytes; there were no browser console/page errors. Synthetic object key: `code-assist-tests/one-5239/one-5239-fork-1792556526867.txt`. It remains as recorded test evidence. This resolves the observed small-file upload blocker, not the deferred 25 MB capacity test or full non-admin acceptance. App PR #47 remains draft for Tim's fork review and subsequent production-binding cleanup.
