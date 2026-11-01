# Prompt Management

Open **Configuration → Prompt Management** on Mia at
<http://100.91.0.83:3000/configuration/prompts>.

The editor exposes shared instructions and the actual task instructions used by
Codex discovery, Codex plan drafting/revision, and Claude adversarial plan review,
plus shared coding-phase instructions used by implementation and code review.
The default global prompt requests Title Case for document titles, section
headings, and proposed UI titles, including “Adversarial Planning” and “Status and
Evidence.” Ordinary prose remains sentence case.

The default **Global** prompt also keeps Tim's private tooling out of managed
GitHub and Linear content: no Code Assist links, names, host addresses, agent
attribution, or internal workflow details in PRs, commits, tickets, comments or
committed documentation. External writing should describe the actual change and
verified checks. Tim requested this on October 22, 2026; the instruction was also
appended to Mia's saved Global override while preserving its existing text and
all other scopes. Existing running steps retain their assembled prompts.

The default **Plan Drafting** prompt starts every new or revised plan with
**A Simple Explanation**, immediately after its title: a plain-language outcome
and short WHEN / IF / THEN-style pseudocode describing behavior, decisions and
results. Technical implementation and evidence follow. **Adversarial Review**
checks that this explanation stays accurate as the plan changes. Both instructions
are editable in Prompt Management. Existing saved versions and approvals remain
unchanged; the preference applies when the next draft or revision starts.

The default **Adversarial Review** prompt also asks Claude to avoid over-engineering:
prefer the simplest adequate solution, justify added complexity with a concrete
failure scenario and evidence, and recommend the smallest correction. Speculative
future needs and optional improvements must not become blockers. Necessary
correctness, authorization, security, and data-integrity requirements still apply.

On October 27, Tim requested PR opening before operator-managed secret creation. The default Global prompt and Mia's saved Global override now distinguish PR-opening checks from prerequisites for merge, deployment, and live use. Required validation and honest evidence remain mandatory. PR-description checks inspect proposed publication text; agents must not require an already-open PR or ask Tim for artifacts the workflow should prepare. New planning prompts enforce the same phase distinction. Existing approved plans remain unchanged.

## One Planned PR Per Repository

On October 27, Tim requested one planned implementation PR per selected repository
per ticket after a plan proposed retirement and cleanup PRs in the same repository
and blocked the first candidate on the second candidate's acceptance checks. The
default Global prompt and Mia's saved Global override now carry this rule, preserving
existing prompt text and all other scopes. Discovery and planning must recommend a
complete single-PR scope; if separate releases are demonstrably necessary, they must
explain the exact ticket split and resolve scope with Tim before approval. They cannot
create Linear tickets without authorization. Reviewers must reject plans that require
multiple planned PRs in one repository or acceptance evidence from a later PR.

The controller's drafting/review instructions also state the workflow boundary so
custom task prompts retain it. Multi-repository tickets can still have one PR per
repository. Open-PR revisions and corrective recovery remain supported. Existing
approved plans are not rewritten or exempted from checks; they need a revised plan
and approval. This is prompt guidance, not a structural multi-PR plan validator.

**Optional optimizations and controls:** Tim requested this planning restriction to
match the supported workflow. It applies to new discovery, planning and review steps;
work requiring separate releases must be scoped into separate tickets before approval.

## Runtime and Behavioral Validation

On November 1, Tim requested stronger system guidance after AGENTS-4's plan repeated
a browser-helper invocation incompatible with the supplied runtime and replaced a
real-time expiry check with only submission/visibility-driven completion checks.
The default Global prompt now requires runtime-supported acceptance procedures,
honest reporting of invocation changes, and coverage of the actual trigger and
execution path. Timer tests must cover scheduled updates and automatic completion
as well as suspension/boundary cases. Planning remains read-only; execution claims
require observed results. Mia's saved Global override receives the same guidance
without changing other scopes. Existing plans require an explicit revision; saving
the prompt does not rewrite them or restart running steps.

**Optional optimizations and controls:** Tim requested this validation guidance.
It applies across planning, implementation, acceptance and review; it may require
correcting unsupported test procedures before readiness can be claimed. It adds
no runtime restriction or automated gate.

AGENTS-4's first owner-requested v3 draft addressed the corrections but failed
checkpoint validation because it emitted owner-feedback labels as Claude finding
IDs, although the preceding review had no findings. The Plan Drafting prompt now
explicitly reserves `responses` for the preceding review's findings and places
owner-feedback explanations in `changeSummary`; an empty prior review requires
`responses: []`. The live custom drafting prompt was preserved and appended with
this clarification before retrying through the normal UI. This clarifies the
existing output contract without changing validation. Execution evidence is in
`.tmp/2026-11-01-agents-4-revision/`.

## Scopes

| Scope | Applies To |
| --- | --- |
| Global | Every implemented agent step |
| Planning | Initial discovery, plan drafting/revision, and adversarial review |
| Coding | Codex implementation/revision and Claude code review |
| Agent Task | Discovery, drafting, or review, depending on the step |
| Repository Global | The named repository in every phase |
| Repository Planning / Coding | The named repository in the corresponding phase |

Agents receive global, phase, and task instructions, then global and phase
instructions for **each selected repository**. Repository instructions are labeled
with the repository name and original clone path and apply only to that repository.
They match the snapshot's source path, not its temporary archive directory.
More specific guidance refines general guidance. Runtime permissions and Tim's
explicit ticket decisions remain authoritative.

Search the repository list to edit one repository's guidance. Workspace guidance
still applies when repository text is empty. Removing a repository from a ticket
also removes its prompt instructions from subsequent agent inputs.

## Saving and Execution

Settings are stored in `prompts.json` in Code Assist's durable data directory,
outside Git and release directories. Only overrides are persisted. **Restore
Default** removes an override; **Clear Repository Prompt** removes that repository
scope. An intentionally empty workspace prompt overrides its default with no
additional text.

The worker loads settings when each agent step starts, including retries. Saving
does not restart agents, revise existing plans, or invalidate recorded approvals.
A running step retains its assembled prompt. Each execution's full assembled
prompt is saved in the `discovery.input`, `planning.input`, or `coding.input` log artifact.
This is execution evidence, not an editable prompt-history interface.

Prompt editing uses the existing owner-only settings access check and SvelteKit
form actions. Runtime permissions, source snapshots, ticket/answer/review context,
structured output schemas, and exact-version approval checks remain in code.
Prompt editing cannot grant tool access or authorize implementation.

The assembled prompt also carries Code Assist's workflow authorization: Tim's
exact-version plan approval covers the described GitOps work and PR publication
without a separate GitOps checkpoint. Agents should plan necessary GitOps changes
directly, while preserving read-only planning and human-only merges and applies.
This workflow-specific exception takes precedence over generic separate-approval
instructions in repository evidence.

Skills and agent-definition management are not included. Coding uses global,
coding-phase and repository instructions together with controller-owned task,
approval, checkpoint, acceptance and reply context. The discovery/drafting/plan-review
task overrides do not replace the controller's coding task instructions.

Optional optimizations and controls: Tim requested the external-publication
privacy guidance. It applies to all agent phases; internal discussion and evidence
stay in the application rather than being copied to GitHub or Linear.
