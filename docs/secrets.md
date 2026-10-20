# Secrets and repository environments

Open [Configuration → Secrets & environment](http://100.91.0.83:3000/configuration/secrets) on Mia.

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

The future SDK runner must pass the returned values to the attempt's child-process environment, alongside its deliberate toolchain environment. Use the source repository path, not the temporary attempt directory. Never log the resolved object or pass the whole secret store to an agent. Running processes retain the environment they started with.

The UI and resolver are implemented; the agent runner is still pending. Saving a mapping does not currently start an agent or rewrite a managed repository.

## Verification

`make verify` includes secret-store tests covering metadata omission, exact value preservation, permissions, rotation, repository isolation, replacement/removal, referential integrity, invalid input and safe corruption errors. A synthetic subprocess verifies that resolved mappings reach an environment.

The October 20, 2026 browser probe on Mia exercised adding a secret, Reveal/Hide, mapping it to a repository variable, rotating it, preventing deletion while mapped, removing the mapping and deleting the secret. It also checked initial HTML omission, non-cacheable reveal responses, runtime resolution and cross-origin mutation rejection. Only synthetic keys were revealed in browser evidence.

Optional optimizations and controls: none. Owner authorization, non-cacheable secret responses, private file permissions and mapping validation implement credential confidentiality and data integrity.
