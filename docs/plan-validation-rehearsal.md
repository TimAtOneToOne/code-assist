# Additional Plan Validation Rehearsal

## Behavior

Plans now contain repository-scoped `additionalValidation` scripts. The displayed
plan, comparison and Markdown export include those exact scripts; the approval
hash and coding run bind them. Validation runs them after the workspace's pinned
checks with the same working directory and environment. Failures use the existing
repair flow. Missing results fail the step, and source mutation still invalidates
validation. Existing profiles and historical plans are preserved.

The validation service uses systemd's native `--expand-environment=no` so shell
variables are evaluated after loading the repository environment. See the
[systemd-run documentation](https://www.freedesktop.org/software/systemd/man/255/systemd-run.html).
The Linux regression covers dollar expansion and literal percent text.

## October 24, 2026 Evidence

The candidate passed `make verify`: lint/format, type checks, 90 unit tests and the
production build. Ten PostgreSQL integration tests passed, including immutable
approval hashes, rejected unknown repositories and transfer into the coding run.

The opt-in `packages/intake/tests/plan-validation.integration.ts` ran on a fresh
OrbStack guest on Mia. It proved:

- A new test fails despite the pinned check passing.
- Correcting implementation produces a passing result on a different exact commit.
- A failing pinned check still fails validation when the added test passes.
- Scripts use the configured nested directory and repository environment without
  premature variable expansion.
- A source-changing script is rejected; the pinned profile remains unchanged.

Run this regression on Mia with `TEST_ORBSTACK=1 node --test
packages/intake/tests/plan-validation.integration.ts`. It creates an isolated
synthetic source repository and guest and removes both afterward. It does not
require provider credentials, a live ticket or GitHub publication.

A separate deterministic rehearsal used an isolated copy of
`OnetoOneHealth/web-app-test-repo` at `ac94e3dc5c4f0a282ea2a3508db96420dc8a99ee`.
Its saved profile ran the existing game tests, lint, type checks and build; its
plan v2 added `npm run test:added`. The browser verified v1/v2 selection,
command-change highlighting, exact-version approval and both validation results.

| Candidate | Pinned Checks | New Test | Controller Outcome |
| --- | --- | --- | --- |
| `9ea02edff95823ea8725d87c752083b0e7ad9ccf` | Passed | Failed | Returned to implementation |
| `78f7612242688b81b054629d6c672f139535be7f` | Passed | Passed | Queued independent review |

Both saved configuration and workspace profile were unchanged. Publication
remained unavailable without independent review. The fixture stopped before
review/publication, and its guest was removed. The original repository, real
ONE-5321 run and production profile were not modified.

This was deterministic controller regression coverage: discovery, plan and
review responses were explicit fixtures, approval was performed in the isolated
browser exercise, and the test harness introduced/corrected the defective code.
It does not claim a new native-agent feature run, real owner approval, PR,
merge, or production deployment of the test app.

The browser automation did not return a Markdown download artifact. The rendered
link uses the native download attribute; export content is covered by the shared
rendering test. This remains a browser-download verification limit, separate
from the observed approval and validation results.

Local evidence: `.tmp/2026-10-24-plan-validation/`, including `verify-final.log`,
`integration.log`, `orb.log`, `exercise.log`, `plan-commands.jpg`,
`validation-results.jpg` and the deployment report after publication.
The isolated ticket ID is `0ae383f2-a049-4398-82f3-94ce6bd2431b`; its data lives in
the candidate's task directory on Mia, separate from production.

Optional optimizations and controls: none.
