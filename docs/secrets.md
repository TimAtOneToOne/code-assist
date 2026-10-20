# Secrets and repository environments

Open [Configuration → Secrets & environment](http://100.91.0.83:3000/configuration/secrets) on Mia.

- **Search:** filter saved secrets and mappings by name, alias, notes, repository name or environment-variable name. Search uses metadata only; it does not reveal or load secret values.
- **Feedback:** save, consolidation and error messages appear as dismissible toasts. The consolidation button is in the page header.
- **Saved secrets:** add a name, notes and value. Existing values start masked and are fetched only when you click **Reveal**. **Hide** masks the field again. Save a new value to rotate a key; leave it blank to preserve the current value.
- **Repository mappings:** choose a clone from the configured Mac mini repository root, enter its environment-variable name and select a saved secret. Save the same repository/variable pair to change its source. Remove a mapping from the table.
- A secret can supply multiple variables and repositories. Rotation retains its ID, so all mappings resolve the new value on their next read. Remove its mappings before deleting a secret.

The initial import uses only `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` from Code Assist's local `.env`. No repository mappings are inferred. That file has no `OLLAMA_API_KEY`; add it in the UI if needed. Per Tim's provider guidance, the OpenAI and Anthropic accounts are BAA covered. An Ollama Cloud token does not authorize PHI processing; locally hosted Ollama instances are a separate case. Notes record context, not automated provider-policy enforcement.

## Storage and access

Production data is in `~/Library/Application Support/CodeAssist/data/secrets/store.json`, outside releases and Git. The containing `secrets` directory is mode `0700`; the file is mode `0600`. Values are plaintext on disk, protected by the operating user's file permissions, not application-level encryption. Include this directory in a protected backup/restore procedure when that is established.

Only the existing verified Tailscale owner can load settings, mutate configuration or reveal values. Page data and mutation results contain metadata only. The reveal endpoint returns one requested value with `Cache-Control: no-store`; all secret routes are marked non-cacheable. HTTP logging records route and status, not submitted form bodies or returned values. Error messages from corrupt JSON omit the source text.

The web process is the sole writer. It performs synchronous read/modify/atomic rename operations; other processes may read. Do not write this file concurrently from another process. A multi-writer deployment would need transactional storage before adding writers.

Local development uses the existing gitignored `.tmp/local-web-data/secrets/` directory. Production always requires an explicit data directory.

## Runtime integration

`@code-assist/secrets` exports `resolveRepositoryEnvironment(dataDirectory, sourceRepositoryPath)`. It returns only that source clone's explicit variable mappings as an environment object, resolving current values on each call. It does not copy the Code Assist service's environment or write `.env` files. Mappings use absolute source-clone paths; changing the clone root does not silently remap them to different repositories.

An implementation-phase SDK runner must pass the returned values to the attempt's child-process environment, alongside its deliberate toolchain environment. Use the source repository path, not the temporary attempt directory. Never log the resolved object or pass the whole secret store to an agent. Running processes retain the environment they started with.

The UI and resolver are implemented. Repository mappings are not injected into discovery/planning runners, which use their explicit provider and AWS connections. Saving a mapping does not start an agent or rewrite a managed repository.

## Verification

`make verify` includes secret-store tests covering metadata omission, exact value preservation, permissions, rotation, repository isolation, replacement/removal, referential integrity, invalid input and safe corruption errors. A synthetic subprocess verifies that resolved mappings reach an environment.

The October 20, 2026 browser probe on Mia exercised adding a secret, Reveal/Hide, mapping it to a repository variable, rotating it, preventing deletion while mapped, removing the mapping and deleting the secret. It also checked initial HTML omission, non-cacheable reveal responses, runtime resolution and cross-origin mutation rejection. Only synthetic keys were revealed in browser evidence.

Optional optimizations and controls: none. Owner authorization, non-cacheable secret responses, private file permissions and mapping validation implement credential confidentiality and data integrity.

## AWS staging planning connection

The AWS staging page selects saved source credentials by ID. The imported names are `STAGING_AGENT_AWS_ACCESS_KEY_ID` and `STAGING_AGENT_AWS_SECRET_ACCESS_KEY`. They are used by the worker to assume the configured read-only role, not injected as repository environment variables. Account, role, region and profile are non-secret connection settings. The original IAM user ARN and source-profile name describe the source installation and are not needed by the worker, which passes the selected keys explicitly to STS. See [planning](planning.md#aws-staging-evidence) for runtime behavior and verification.

## ICU Coding Environment

On October 20, 2026, Tim authorized importing ICU's local development configuration
from `internal-chat-ui/sveltekit/.env`. Fifteen variables are now mapped to
`/Users/miasocci/CODE/repos/OnetoOneHealth/internal-chat-ui` on Mia. Each saved entry
is named `ICU_<variable>`; the repository receives the original variable name.
Values are stored only in Mia's secret store, not in this document or Git.

| Integration | Mapped Variables |
| --- | --- |
| Microsoft OAuth | `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| Linear OAuth | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` |
| Model gateway | `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL` |
| Email | `SENDGRID_API_KEY`, `SENDGRID_FROM_ADDRESS` |
| Roles | `AZURE_AD_ROLE_MAP`, `DEV_ROLE_OVERRIDES` |
| Local Medusa | `MEDUSA_API_URL`, `MEDUSA_MCP_URL`, `MEDUSA_MCP_API_KEY` |

The active Medusa key matched the local variant. The URLs point to localhost
port 8000, so Medusa-dependent features require a service inside the attempt.
The staging/production Medusa variants and the spike-only
`LINEAR_DEVELOPER_TOKEN_USER` were not imported. ICU uses its configured model
gateway; Code Assist's agent provider keys are separate.

The runner still needs to supply `DATABASE_URL`, `TEST_DATABASE_URL`, `ORIGIN`,
a fresh `BETTER_AUTH_SECRET`, and the local storage configuration:
`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_ENDPOINT_URL_S3`, and `ICU_CHAT_ATTACHMENTS_BUCKET`. These must describe
the attempt's own database and LocalStack. The source file's AWS credentials
were the LocalStack `test` values, not cloud credentials.

Verification used the owner-authenticated web actions, then resolved all fifteen
mappings and compared values with the source without printing them. Existing
secrets and other repositories' mappings were preserved. The live settings page
shows the saved mappings, returns `no-store`, and omits credential values from
initial HTML. External credentials, OAuth callbacks, and email delivery were not
tested; these mappings include real gateway and SendGrid access. Saving them does
not launch an agent or provision services.

Optional optimizations and controls: none.

The [ICU workspace provisioner](workspaces.md) now supplies those attempt-local
settings and resolves these mappings during preparation. Automatic coding-worker
integration remains the next step.

## Consolidating Duplicate Secrets

The **Consolidate Duplicate Secrets** button at the top of the page combines saved
entries whose values match exactly, including whitespace and case. It keeps the
first saved entry in each group, combines its notes, and redirects repository
mappings to that entry. The result reports removed entries and updated mappings;
clicking again without new duplicates makes no changes.

Old names and IDs remain as metadata aliases, shown under **Also Known As**. They
contain no duplicate values. This preserves provider-name lookups, saved Linear,
Teams and AWS settings, and references already read by a worker. The value,
aliases and repository mappings are saved together in one atomic store update.
Settings pages show the surviving entry. Rotating that entry subsequently changes
all variables that share it. Matching uses values only: even differently named
variables with identical values consolidate, as Tim requested. Values are neither
returned by the action nor exposed in page data.

## Assigned Repository Import — October 20, 2026

All nonempty variables in the following local files were mapped to their matching
Mia source clones under `/Users/miasocci/CODE/repos/OnetoOneHealth`. Local paths
below are relative to `/Users/tim/Desktop/CODE`. This supersedes the earlier
partial ICU import above, including its exclusion of explicitly named staging
and production variants.

| Repository | Local Source | Mapped Variables |
| --- | --- | ---: |
| internal-chat-ui | `internal-chat-ui/sveltekit/.env` | 27 |
| workplace-agents | `workplace-agents/.env`, plus additional keys from `workplace-agents/apps/portal/.env` | 70 |
| medusa-api | `medusa/medusa-api/.env` | 77 |
| windmill | `windmill/.env` | 7 |
| windmill-work | `windmill-work/.env` | 14 |
| elation_companion | Checkout at `elation_companion/elation_companion`; no `.env` found | 0 |

The primary checkouts were used rather than older copies under `repos/`,
`medusa/another/`, or temporary worktrees. Workplace Agents keeps root values
where its portal file repeats a variable, matching its existing mappings;
workspace preparation overrides database, origin and auth-secret values for the
isolated attempt. Existing matching secret values were reused during import.
All 195 resolved variables were compared with their source values without
printing credentials. Existing secret values and unrelated mappings were retained.

Mappings take effect when a workspace is prepared; existing processes are not
reconfigured. Importing configuration does not provision external services or
establish a signed-in browser session. No external provider calls were made to
validate these imported credentials.

Optional optimizations and controls: exact-value consolidation is user-requested
and runs only when clicked. It shares future rotations across all consolidated
mappings. No automatic background consolidation was added.
