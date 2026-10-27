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
