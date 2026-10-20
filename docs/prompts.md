# Prompt Management

Open **Configuration → Prompt Management** on Mia at
<http://100.91.0.83:3000/configuration/prompts>.

The editor exposes shared instructions and the actual task instructions used by
Codex discovery, Codex plan drafting/revision, and Claude adversarial review.
The default global prompt requests Title Case for document titles, section
headings, and proposed UI titles, including “Adversarial Planning” and “Status and
Evidence.” Ordinary prose remains sentence case.

## Scopes

| Scope | Applies To |
| --- | --- |
| Global | Every implemented agent step |
| Planning | Initial discovery, plan drafting/revision, and adversarial review |
| Coding | Saved for the future coding runner; currently unused |
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
prompt is saved in the existing `discovery.input` or `planning.input` log artifact.
This is execution evidence, not an editable prompt-history interface.

Prompt editing uses the existing owner-only settings access check and SvelteKit
form actions. Runtime permissions, source snapshots, ticket/answer/review context,
structured output schemas, and exact-version approval checks remain in code.
Prompt editing cannot grant tool access or authorize implementation.

Skills and agent-definition management are not included. Coding prompts are
editable now, but need to be connected when the coding phase is implemented.

Optional optimizations and controls: none.
