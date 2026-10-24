# Open-PR CI Recovery Rehearsal

October 23, 2026. This record distinguishes fixture setup, actual unattended repair,
and observed deployment. The scope is automatic recovery of failing checks on an
owned open PR within an already approved plan. It does not include merges,
automatic reviewer-comment ingestion, or infrastructure/policy changes.

## Local and Database Verification

`make verify` passed lint/format, type checks, 81 unit tests and the web production
build. Nine PostgreSQL integration tests passed on Mia with isolated disposable
databases. The unrelated opt-in OrbStack provisioning suite was skipped; fresh
browser provisioning is exercised by the live repair workspace below.

Tests cover current-head checks and statuses, pagination, complete annotations and
attempt-specific logs, changed/inaccessible evidence, no-check/pending/green/skipped
states, ownership/head/branch mismatch, missing workspace, stale and concurrent
observations, durable restart, a merged companion repository, fresh commit-bound
validation/review, unchanged failure identity, and notification resolution.
Paused CI repair also retains its repository scope when the owner requests
Bring In Main.

## Live Fixture

The fixture uses an isolated PostgreSQL database and a new OrbStack workspace on
Mia, with the real repository runtime profile and native agent SDKs. It preserves
the original Done ONE-5321 ticket/run and merged `feature/one-5321` branch. The new
branch is `feature/one-5321-pr-ci-recovery`, based on main
`ac94e3dc5c4f0a282ea2a3508db96420dc8a99ee`.

Fixture setup records an explicitly synthetic approval under Tim's disposable
end-to-end testing authorization. It is not evidence of a fresh UI approval or
agent planning. The operator seeds a CI command referencing a missing npm script;
local test/lint/check/build must pass before publishing that deliberate failure.
The first fixture attempt lost the workflow's trailing newline when reading command
output, so its local formatter rejected it. Formatting was corrected before any
PR was published. This was fixture preparation, not repair of a published failure.

The monitor uses its production reader and queues its production revision workflow.
The fixture calls observation every 15 seconds to shorten the test; production
keeps the existing five-minute schedule. No Request Code Changes action or operator
repair diagnosis is supplied after the failure is published.

Mia's SSH session could push via Git but returned HTTP 401 from `gh pr create`,
consistent with the documented login-keychain boundary. The fixture was started
as a temporary launchd job in the same GUI login domain as the real worker; PR
creation and monitor reads then succeeded without credential or system changes.

The fixture opened [PR #2](https://github.com/OnetoOneHealth/web-app-test-repo/pull/2)
at failing head `0edb9b28ae37e276360b71e18a636bca275af24a`.
[The initial CI run](https://github.com/OnetoOneHealth/web-app-test-repo/actions/runs/40056132902)
failed. Observation automatically saved the diagnostics and queued one CI revision.
The native coding agent diagnosed the missing npm script from that evidence,
corrected the workflow, ran local checks and Playwright acceptance, and advanced to
independent review without an operator diagnosis or Request Code Changes action.

The candidate UI showed the failed commit, both check/job and workflow links,
the evidence link, automatic request and running implementation. The artifact
endpoint returned HTTP 200 on click; Chrome automation displayed
`ERR_BLOCKED_BY_CLIENT` for the attachment download, so browser download completion
is not claimed. The saved artifact was available to the real coding agent.

## Observed Outcome

At 10:58 PM EDT, the same PR was open at repaired commit
`426c82f41764cbf2a84c33b54db65822ea226965` and
[CI run 40056368171](https://github.com/OnetoOneHealth/web-app-test-repo/actions/runs/40056368171)
succeeded. The controller recorded one automatic CI request, fresh implementation
and evidence collection, successful validation, independent review with no
findings, and publication to the same PR. It remained **PR Open**, not Done.

The implementation used native Playwright MCP and saved assertions covering all
X/O winning lines, occupied and post-win move rejection, a draw, ninth-move win,
reset, keyboard controls and mobile rendering, with no browser errors. The
reviewer independently reran tests/lint/types and browser win/reset/draw checks.
The repaired tree matches main; only the deliberately broken workflow invocation
was restored. No application feature or test was removed. No operator diagnosis,
code edit, direction reply, retry, or code-change request occurred during repair.

The final browser check showed green current-head results and **Automatic CI
Repair** in the saved request. Screenshots and the exported run/browser results
are retained in `.tmp/2026-10-23-pr-ci-recovery/` on Tim's Mac. Run
`705613b3-144a-406c-9a6f-ed05fcf3b1fd`, its isolated database, and host evidence are
retained on Mia. After the proof worker stopped and all coding steps completed,
fixture guest `77af0a76-8866-4727-b5ab-2513d7c65aa6` was destroyed and the temporary
launchd job and test web server were removed. This is explicit test cleanup,
not evidence of automatic Done cleanup for an open PR.

The operator then updated the test PR description with the verified result.
PR #2 remains open and unmerged. Production deployment verification is recorded
separately after the normal idle check.

Optional optimizations and controls: none.
