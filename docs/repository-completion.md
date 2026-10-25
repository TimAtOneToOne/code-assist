# Repository Completion Verification

On October 25, 2026, the ONE-5347 rehearsal exposed a repository without a main
workflow waiting indefinitely after merge. The follow-up adds a Completion Rule
field to Repository Setup: observed merge into main, or merge plus successful
GitHub Actions push-to-main workflows for the exact merge commit. The choice is
recorded in discovery and pinned per repository in the approved run. Existing
profiles and runs retain the workflow requirement unless a new discovery records
an explicit alternative. See [Repository Setup](repository-setup.md) and
[Coding](coding.md#github-pr-and-main-workflow-tracking).

## Verified Evidence

- `make verify` passed: lint, formatting, type checks, unit tests, and build.
- `make test-intake` against local PostgreSQL passed 11 integration tests; the two
  optional OrbStack tests were skipped. Coverage includes legacy behavior, explicit
  merge-only completion without Actions access, rejecting a merge into prod, mixed
  repository rules, successful and failed main workflows, restart preservation,
  and cleanup evidence requirements.
- A browser exercised the Repository Setup form against an isolated local
  database: the legacy default displayed correctly, both choices saved and
  survived reload, and the dropdown spacing and keyboard focus were checked.
- The disposable test repository's [CI PR #4](https://github.com/OnetoOneHealth/web-app-test-repo/pull/4)
  runs locked installation, 21 game-rule tests, lint, type checks, and build on PRs
  and pushes to main. Its PR check passed. Tim merged it as
  `5296cf5292b0e99f6fbf935dde30a988b92b395c`; the
  [push-to-main run](https://github.com/OnetoOneHealth/web-app-test-repo/actions/runs/40162216169)
  also passed for that exact merge commit. This is validation CI; it does not add
  a hosting deployment or claim to execute feature-specific browser acceptance.

## Delivery Status

The Code Assist source change passed local verification; deployment and live
configuration verification are pending. ONE-5347 was already marked Done by Tim
through the owner action, so this follow-up does not claim that old ticket
completed automatically. The next fresh exercise will verify the entire live
workflow through automatic Done. No new live merge-only ticket or induced failed
CI repair was manufactured for this change.

Temporary logs, browser evidence, and the CI checkout are under
`.tmp/2026-10-25-completion/`. The original rehearsal is documented separately in
[ONE-5347 Repeat Rehearsal](one-5347-rehearsal.md).

Optional optimizations and controls: none.
