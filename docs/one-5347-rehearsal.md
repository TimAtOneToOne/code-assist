# ONE-5347 Repeat Rehearsal

On October 25, 2026, Tim requested a second Tic-Tac-Toe exercise through the
deployed application at release `3305c7ca995252292edeba0e5416acd12ad0bc46`.

The test repository was restored with additive commit `f1b5d21` to the exact
tracked tree of original baseline `4a4e65f`. Its existing saved setup was retained;
this exercised an already-configured repository, not fresh setup discovery.

After fixture preparation, the operator confirmed the repository, confirmed
discovery scope without additional direction, and approved reviewed plan v1 under
Tim's delegated test scope. No operator code fixes, profile changes, dependency
installation, repair requests, retries or replacement acceptance tests were needed.

The system prepared a fresh guest, implemented the feature, passed 21 rule tests,
lint, type checks and build, and executed five acceptance scenarios with native
Chromium evidence. Claude caught a guest-specific screenshot path in a committed
browser helper. The normal workflow repaired it, repeated validation and acceptance
against the revised commit, and obtained a clean second review with an independent
browser rerun. It opened [PR #3](https://github.com/OnetoOneHealth/web-app-test-repo/pull/3)
at head `04eba6b0d5d816bf23e180cf5432a9aa239b412e` in 8 minutes 45 seconds after
approval. The UI distinguished earlier evidence from current-candidate acceptance.

Tim merged the PR at 00:26:42 EDT. The GitHub monitor automatically recorded merge
commit `715ac5c972cdd10f2748f2287fad9f92da34a53d` and moved the run to
`awaiting_main`. The merged repository has no GitHub workflow and GitHub reported
zero push workflow runs for that commit. Automatic Done therefore did not succeed.
At the initial observation, the owner completion override had not been used. Tim
subsequently marked the ticket Done at 00:29:07 EDT. This was a completion-contract
gap for repositories without CI, not proof that every feature ticket needs a new
workflow.

The PR description remains generic. The committed browser helper requires a
caller-supplied Playwright page rather than a one-command repository suite. Fresh
setup discovery, supplemental validation generation, GitHub Action policy handling
and failed-CI repair were not exercised by this run. One small configured repository
does not establish production or multi-repository coverage.

Evidence is retained on the [ticket](http://100.91.0.83:3000/tickets/9b2e68c2-1cfa-429d-8eff-fd8d323d9ad0),
coding run `d538fd7d-f2eb-415d-807f-86f9327a5462`, and locally under
`.tmp/2026-10-25-tic-tac-toe-retest/`, including the detailed comparison, immutable
plan snapshots, step results, published diff, acceptance archive and screenshots.
Tim also requested a local preview after publication; this used the unchanged PR
head and was not a rescue of the automated run.

The [completion follow-up](repository-completion.md) records the explicit repository
rule and minimal CI added after this rehearsal; neither was a course correction
during the ticket-to-PR run.

Optional optimizations and controls: none introduced by the operator.
