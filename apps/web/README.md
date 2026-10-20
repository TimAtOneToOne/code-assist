# Code Assist web

SvelteKit application, generated with the official Svelte CLI:

```sh
npx sv@1.1.1 create apps/web --template minimal --types ts \
  --add prettier eslint sveltekit-adapter="adapter:node" --no-install
```

Dependencies are managed by the repository's pnpm workspace and root lockfile.
Tailwind was added with `sv add`; Button, Card and Badge were installed through
the official `shadcn-svelte` CLI using the Vega preset. See `components.json`.
From the repository root, run `make install`, then `make dev`. Run `make verify`
for formatting, lint, type checks and the production build.

The app provides Home, Configuration, Mac mini settings and `/health`. It does not yet
connect to Linear, PostgreSQL or agent SDKs. Mac mini settings save the repository
root on the host outside deployment releases and require the configured owner's
Tailscale identity. The UI does not read or edit credentials.

See [Mac mini deployment](../../docs/deployment.md) for production operation.
