# Concurrent Isolation Proof on Mia

Verified October 20, 2026. Two unchanged ICU copies ran concurrently in OrbStack
Linux machines without port or resource-name collisions. Both passed repository
validation and authenticated browser checks. **The network-isolation check
failed:** either machine could reach the other machine, including its database.
This is evidence for collision avoidance, not a completed agent security boundary.

The subsequent [local-only port binding proof](loopback-isolation-proof.md)
closed the demonstrated default database exposure without changing ICU. It also
confirmed that explicit bindings can override the default and that host web
access remains possible.

## Configuration

| Item               | Tested Value                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Host               | Mia Mac mini, Apple M4, 32 GiB RAM                                                                     |
| Runtime            | Existing OrbStack 2.2.4; Docker Desktop was not installed                                              |
| Machines           | `ca-proof-a` and `ca-proof-b`, independently provisioned Ubuntu 24.04 ARM64                            |
| Machine flags      | `--isolated --isolate-network`                                                                         |
| Repository         | `internal-chat-ui`, commit `a2a7b9bdcb847f98ffbd57c9764b272bf01ed36f`                                  |
| Source preparation | `git archive` of the recorded commit into each machine; no host repository mount or GitHub credentials |
| Toolchain          | Node 24.22.0, pnpm 10.28.0, repository's frozen lockfile                                               |
| Container engine   | Separate Docker Engine 29.9.1 / Compose 5.6.0 inside each OrbStack machine                             |
| Browsers           | Repository-locked Playwright 1.61.1 and Chromium revision 1228, installed inside each machine          |

Each attempt used the same paths and unchanged Compose configuration:

- Repository at `/work/icu`, application at `/work/icu/sveltekit`.
- Compose project `internal-chat-ui`.
- Containers `internal-chat-ui-db-1` and `internal-chat-ui-localstack-1`.
- Named volume `internal-chat-ui_pgdata`.
- App port 5173, PostgreSQL port 5435, LocalStack port 4566.
- Separate `local` and `icu_test` databases inside each machine.

The test used `.env.example` with an independently generated auth secret per
attempt. Tim authorized reading the local ICU `.env`; it was inspected, but no
external provider credentials were needed or copied. Synthetic accounts used the
normal password sign-in flow. No Microsoft, Linear, SendGrid, Medusa or model
requests were needed for the browser proof.

## Results

| Check                                | Result                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Repository source unchanged          | All 517 tracked files matched their original Git blob hashes in both copies                 |
| `pnpm lint`                          | Passed in both machines                                                                     |
| `pnpm check`                         | Zero errors and zero warnings in both                                                       |
| `pnpm test` with `TEST_DATABASE_URL` | 446 passed, 3 skipped; 78 passing files and 1 skipped file in each machine                  |
| `pnpm build`                         | Passed in both                                                                              |
| Same ports and Compose names         | Both stacks ran concurrently                                                                |
| PostgreSQL contents                  | Identical record IDs held distinct attempt-specific conversation titles                     |
| LocalStack S3                        | The same bucket/key held a different body in each attempt                                   |
| Working files                        | Same absolute file path held each attempt's own marker                                      |
| Authenticated Chromium               | Signed in, opened the seeded conversation and captured a screenshot in both; no page errors |
| Fresh browser context                | No inherited authentication or local storage                                                |
| Foreign session cookie               | Each app rejected the other attempt's session                                               |
| Compose teardown                     | Stopping/removing A's services left B's app and database working                            |
| Volume persistence                   | Recreating A's PostgreSQL container preserved A's record                                    |
| Mac integration                      | No `/mnt/mac` mount or forwarded SSH agent                                                  |
| Peer network blocking                | **Failed** in both directions despite `isolate_network=true`                                |
| Host network blocking                | **Failed** for Mia's Tailscale web address                                                  |

The PostgreSQL probe used deliberately identical local-development credentials,
database names and record IDs. It demonstrated separate storage, but it also
demonstrated that A could explicitly connect to B's IP on port 5435 and read B's
synthetic record. Distinct storage alone does not enforce access separation.

The three skipped tests were the repository's Linear OAuth/MCP smoke tests.
Live Linear OAuth was not configured for this local experiment; database-backed
integration tests did run.

## Compatibility Finding

Ubuntu's initial Docker package installed Engine 29.1.3. PostgreSQL started, but
LocalStack repeatedly failed while removing `/tmp/localstack`, reporting
`OSError: [Errno 5] Input/output error`.

Installing the current official Engine 29.9.1 and bundled container runtime,
restarting its socket/service and recreating the containers resolved that failure
in this test. LocalStack became healthy and passed S3 writes/reads. No managed
repository changes or compatibility patches were used. This does not establish
which component in that upgrade fixed the error.

Use the [official Ubuntu installation procedure](https://docs.docker.com/engine/install/ubuntu/)
when evaluating this layout again.

## Network Boundary Finding

[OrbStack documents](https://docs.orbstack.dev/machines/isolated) that
`--isolate-network` blocks peer machines and host IPs. Both machines reported the
setting enabled, yet direct HTTP requests to the peer machine succeeded with
HTTP 200. Requests used no HTTP proxy.

Restarting machine A did not change the result:

- A → B's machine IP, port 5173: HTTP 200.
- A → Mia's Tailscale address, port 3000: HTTP 200.
- A → B's PostgreSQL, port 5435: successfully read B's synthetic record.
- A → `host.orb.internal:3000`: connection refused.

OrbStack's [current release notes](https://docs.orbstack.dev/release-notes) listed
the installed 2.2.4 as the latest release at the time of the proof. An earlier
[maintainer discussion](https://github.com/orbstack/orbstack/issues/2413) also
distinguishes host integration from access through LAN IPs. That discussion does
not explain or resolve the peer-machine result observed here.

Do not treat this flag as a verified network boundary for Code Assist. In
particular, an agent with access to Mia's web application must not inherit the
operator's authority merely because its traffic originates on Mia. This proof
did not read the secrets endpoint or test its authorization.

## Storage and Cleanup

OrbStack reported approximately **6.3 GiB per fully prepared machine**. Host free
space fell from about 101.2 GiB to 88.6 GiB during the proof, an approximately
12.6 GiB reduction. This includes independent toolchains, package stores, container
images, browser downloads, databases and build output. It is a host-wide
measurement rather than an exclusive allocation measurement.

Both temporary machines were deleted after evidence collection. No global
OrbStack networking settings, concurrency caps, cache policies or firewall rules
were added. The existing Code Assist application and observability services were
not replaced.

After OrbStack reclaimed the deleted machines' storage, host free space returned
to approximately 101.2 GiB and OrbStack's allocated host directory returned to
approximately its pre-test size.

## Evidence and Next Decision

Local, gitignored evidence is under `.tmp/concurrent-isolation/`:

- `evidence/source-verification.json`: hashes checked against the recorded commit.
- `evidence/ca-proof-{a,b}/`: repository command logs, browser results, screenshots
  and runtime versions.
- `independence-results.json`: database, S3, session, teardown and failed network
  assertions.
- `network-after-restart.txt` and `cross-machine-db.json`: boundary reproduction.

The test scripts are temporary probes, not a production workspace manager. They
do not implement pg-boss lifecycle integration, SDK execution, interruption
recovery, secret injection, trusted PR publication or Tailscale preview routing.
No additional coding workflow was deployed by this proof.

Keep OrbStack's per-attempt machine model as a demonstrated option for avoiding
collisions. Before adopting it for unattended agents, agree on and verify the
network/access boundary using supported runtime capabilities. Do not silently add
a custom firewall, port-rewriting layer or repository changes to make the test
appear complete.

Optional optimizations and controls: none. Per-attempt machines, private container
engines and browser contexts implement Tim's requested isolation experiment. The
network-isolation setting was tested and failed; it is not claimed as protection.
