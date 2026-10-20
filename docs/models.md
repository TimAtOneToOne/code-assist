# Agent Models

Open [Configuration → Agent Models](http://100.91.0.83:3000/configuration/models)
to change the model IDs used by Codex and Claude. Each field is a dropdown listing
models verified with the saved provider accounts on October 20, 2026. Choose
**Custom Model…** to enter another ID; saved custom IDs remain editable after reload.
Suggestions are not a live provider catalog. Saving validates the fields without
making a model request; an unavailable model fails its agent step normally.

The initial selections are `gpt-6.1-sol` and `claude-opus-5-5`, as requested by Tim.
Codex discovery and planning drafts/revisions read the Codex selection. Claude
adversarial reviews read the Claude selection. The future coding runner must use
this same configuration. Reasoning and effort retain provider defaults.

Each worker reads settings when an agent step starts, including retries. A running
step retains the model already passed to its SDK. The selected ID is recorded in
the step's input artifact and structured logs. Saving settings does not restart a
step, revise a plan, or require deployment.

The owner-authenticated web process writes `data/models.json` using an atomic
rename and mode `0600`, outside releases and Git. Missing settings use the explicit
initial selections in `packages/intake/src/agent-models.ts`. Invalid saved data
raises an error instead of silently changing models. Secrets remain in the
existing secret store.

Verification covers persistence, default selections, arbitrary model IDs,
rejected writes preserving previous settings, file permissions and invalid stored
data. The browser workflow checks Configuration navigation, editing both fields,
save/reload, custom IDs and invalid saves. Code Assist's `make verify` covers lint,
formatting, type checks, tests and build. This does not test inference for every
suggested or operator-entered model.

Optional optimizations and controls: operator-selected model IDs, requested by
Tim, prevent SDK default changes from silently selecting another model. They
apply to new discovery/planning steps; changing the selection is an explicit UI
action. Provider revisions behind those model IDs can still change. No additional
optional controls were introduced.
