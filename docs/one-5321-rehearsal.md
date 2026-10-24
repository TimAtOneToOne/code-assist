# ONE-5321 End-to-End Rehearsal

Verified October 23, 2026 using Code Assist release `441b28f` and the disposable
`OnetoOneHealth/web-app-test-repo`. Tim delegated the rehearsal end-to-end and
explicitly authorized managing and merging this test repository's PR. That
exception does not authorize merges in other repositories.

## Result

[PR #1](https://github.com/OnetoOneHealth/web-app-test-repo/pull/1) added a local
two-player Tic-Tac-Toe tab, keyboard-operable controls, win/draw/reset behavior,
responsive navigation, 19 Node test cases, and repository CI. The operator merged
reviewed candidate `5580def3aebd716c08c8e30c962318a6b3b507fe` into `main` as
`ac94e3dc5c4f0a282ea2a3508db96420dc8a99ee`.

[Push CI](https://github.com/OnetoOneHealth/web-app-test-repo/actions/runs/39999668247)
succeeded on that exact merge commit. Coding run
`0d7f44ee-4baf-4376-a49e-7687440a3a24` reached `done` through GitHub observation,
without the owner completion override. The normal GitHub refresh action requested
the final observation.

## Verified Path

- Confirmed discovery answers and repository scope produced plan v1 and review.
  Operator feedback added the CI needed to exercise merge completion. Plan v2
  passed independent review with no findings and was approved under Tim's
  delegation; prior versions remain intact.
- Isolated implementation produced the game and passed the 19 rule tests, lint,
  Svelte/TypeScript checks, build, and HTTP smoke checks.
- A missing Chromium system dependency paused implementation for direction.
  Installing native Playwright dependencies and replying resumed the saved work.
  Codex and Claude then exercised the game through Playwright and saved evidence.
- Controller validation and independent review passed before PR publication.
  GitHub rejected version-tag Action references under the organization's full-SHA
  policy. Request Code Changes preserved the PR, pinned the same official releases,
  and repeated validation and review. PR CI passed before merge.
- An independent operator browser probe of the merged commit passed game
  win/draw/reset, occupied and terminal move rejection, tab isolation, 320px layout,
  counter controls, About, Sverdle input/submission/help, and Notes
  create/reload/delete/validation. Screenshots were inspected. Successful flows had
  no console errors; the deliberate blank-note rejection returned HTTP 400.
- Fresh setup test `f6a571eb-6192-4ea5-98af-a0d14a0dc736` passed against the merge
  commit and cleaned up guest `b04de53a-eaeb-4494-a607-a5462aae9dac`. This setup test
  ran unit/lint/type/build, startup/readiness and HTTP smoke checks; its smoke field
  is not a browser interaction test.

## Setup Lessons

Installing the MCP browser binary does not install Linux browser system libraries.
The test repo's saved system setup now uses the native command:

```sh
npm_config_cache=/tmp/code-assist-playwright-deps-npm npx --yes --package=playwright-core@1.64.0-alpha-1790635538000 playwright-core install-deps chromium
```

This version matches the deployed MCP package. Its npm cache is outside the
workspace user's home because system setup runs as root. The normal coding runtime
still provides the MCP server and browser binary. Re-evaluate the installer version
when upgrading the runtime. Other repository profiles were not changed, and shared
runtime provisioning still needs this dependency supplied through repository setup.

The saved validation script now includes `npm test`. The workflow Action pins are
`actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) and
`actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0), resolved
against their official repositories. No organization policy was changed.

## Evidence and Limits

The [ticket](http://100.91.0.83:3000/tickets/41b847fe-736e-4819-aa65-161d67557246)
retains plans, direction, validation, reviews, publication and merge observations.
Controller evidence archives live under the coding run's durable data directory.
Operator scripts, MCP transcripts, screenshots and final status are retained locally
under `.tmp/2026-10-23-one-5321/`; temporary operator app/browser processes were
stopped. Normal completed-workspace retention still applies to the coding guest.

This proves one single-repository synthetic feature lifecycle, including recovery
and a PR revision. It does not establish every multi-repository, authenticated,
production-deployment, infrastructure, or failure-recovery path.

Optional optimizations and controls: none. Game legality checks enforce the game
rules; Action SHA pins satisfy the existing organization policy.

## Shared Runtime Follow-Up

On October 23, Tim authorized replacing the temporary installer above with shared
Linux runtime provisioning and native MCP readiness. The shared implementation
installs Chromium libraries as root, browser binaries as the workspace user, and
verifies navigation, a click, changed DOM and a screenshot through actual MCP.
Setup tests use this same path and also verify the repository's environment;
implementation/review steps repeat readiness. Readiness evidence does not count as
feature acceptance.

The pre-deployment candidate passed three fresh OrbStack regression cases on Mia:

- `ffbe7839-6729-4777-9537-bb4c3d4f2651`: native MCP readiness, validation, app
  startup/readiness and synthetic HTTP checks passed without a custom browser
  installer in the fixture profile.
- `1c5b6621-5704-46f6-88ba-c8485b1c4fdd`: native readiness passed; deliberate
  validation failure was recorded as failed.
- `e625253e-9a0b-4200-ae4e-a3c35742a594`: base readiness passed, but the repository's
  nonexistent `PLAYWRIGHT_BROWSERS_PATH` failed native browser readiness before
  validation could run.

All three guests were removed automatically. The suite took about 259 seconds.
Local lint/type/build and 79 unit tests passed, as did nine PostgreSQL integration
tests. Local operator evidence is under `.tmp/2026-10-23-guest-readiness/`.
These candidate results do not yet establish live deployment or removal of the
saved test-repository workaround.
