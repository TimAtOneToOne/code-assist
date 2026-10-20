# Local-Only Port Binding Proof

Verified October 20, 2026, after the [initial concurrent isolation proof](concurrent-isolation-proof.md).
Tim authorized testing native container-engine defaults that bind published ports
to the attempt's loopback interface.

**The proposed setting closed the demonstrated cross-attempt database path.**
Both machines could still use their own services, and both unchanged ICU copies
passed authenticated browser checks after restart. This is a safer publishing
default, not enforced network isolation: explicit bind addresses override it, and
Mia's management web server remained reachable.

## Tested Configuration

Two fresh OrbStack 2.2.4 machines, `ca-loopback-a` and `ca-loopback-b`, ran Ubuntu
24.04 ARM64 with `--isolated --isolate-network`. Each contained its own Docker
Engine 29.9.1 and Compose 5.6.0. Docker Desktop was not installed.

Both used the original ICU Compose file from commit
`a2a7b9bdcb847f98ffbd57c9764b272bf01ed36f`, including mappings `5435:5432` and
`4566:4566`. All 517 tracked files matched their original Git blob hashes after
the test. No changes were made to the maintained ICU checkout.

After reproducing cross-access on both machines, the test wrote this native
configuration to `/etc/docker/daemon.json` **inside each temporary machine**:

```json
{
  "ip": "127.0.0.1",
  "default-network-opts": {
    "bridge": {
      "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"
    }
  }
}
```

The `ip` setting covers the default bridge; `default-network-opts` covers newly
created user-defined bridges, including Compose networks. The test validated the
configuration with `dockerd --validate`, restarted each private engine, and
recreated the Compose networks/containers while retaining the named database
volumes. Existing networks must be recreated to receive the new default.

These are [documented native engine settings](https://docs.docker.com/engine/network/port-publishing/#setting-the-default-bind-address-for-containers),
not a Compose rewrite or custom firewall. The settings do not change an explicit
host address in a repository's port mapping.

## Results

Each database contained a unique marker and returned its PostgreSQL
`system_identifier`. A's identifier was `7698791133163569194`; B's was
`7698791140072091691`. Both identifiers and markers persisted through container
recreation and machine restart.

| Probe, in Both Directions                                      | Before the Setting                            | After the Setting          | After Machine Restart      |
| -------------------------------------------------------------- | --------------------------------------------- | -------------------------- | -------------------------- |
| Own PostgreSQL at `127.0.0.1:5435`                             | Own marker and identifier                     | Same marker and identifier | Same marker and identifier |
| Peer PostgreSQL through machine IPv4, with correct credentials | Peer marker and identifier                    | Connection refused         | Connection refused         |
| Peer PostgreSQL through machine IPv6, with correct credentials | Peer marker and identifier                    | Connection refused         | Connection refused         |
| PostgreSQL through Mia's Tailscale address on port 5435        | Reached A's database via automatic forwarding | Connection refused         | Connection refused         |
| Own LocalStack on port 4566                                    | Reachable                                     | Reachable                  | Reachable                  |
| Peer LocalStack through machine IPv4                           | Reachable                                     | Connection refused         | Connection refused         |
| Mia's management web server on port 3000                       | HTTP 200                                      | HTTP 200                   | HTTP 200                   |

Container inspection confirmed that both services changed from all-interface
publishing to `127.0.0.1` only. Both services restarted automatically when the
machines restarted.

After restart, both ICU copies ran their normal development servers on port 5173.
Repository migrations ran against each local database. Each Chromium session
signed in with a synthetic account, opened its own seeded conversation, retained
its own local-storage marker and produced a screenshot with no page errors. A
fresh browser context inherited neither authentication nor local storage.

The prior full lint/type/test/build validation was not repeated for this
configuration-only experiment. No provider credentials or live external
integrations were needed.

## Confirmed Limits

A separate temporary PostgreSQL container tested the default bridge:

- `-p 15435:5432` bound only to `127.0.0.1`; the peer could not connect.
- `-p 0.0.0.0:15435:5432` explicitly overrode the default; the peer connected
  successfully and returned that container's exact PostgreSQL system identifier.

Therefore an agent controlling its private engine can expose a service despite
the default. Native processes listening on all interfaces are also outside the
scope of these container-publishing settings.

The HTTP 200 from Mia demonstrates reachability, not authorization to secrets or
other protected data. This test did not query the secrets endpoint or verify its
authorization boundary. Network/access separation for unattended agents remains
an open decision.

## Cleanup and Evidence

The explicit-binding probe container and both temporary machines were removed.
The host's shared OrbStack engine and networking settings were not changed.
No coding runtime or permanent sandbox configuration was deployed.

Local gitignored evidence is in `.tmp/loopback-isolation/`:

- `baseline-results.json`, `loopback-results.json`, `restart-results.json`:
  exact addresses, SQL results, connection errors and engine network inspection.
- `explicit-binding-results.json`: default versus explicit publishing.
- `browser-results.json` and `evidence/ca-loopback-{a,b}/`: browser results,
  screenshots and runtime versions.
- `evidence/source-verification.json`: tracked-file hash verification.

Optional optimizations and controls:

- **Local-only published-port defaults:** explicitly requested for this test.
  Applied only to the two temporary machines, preventing peer access to
  unspecified-address mappings while preserving local access. Browser previews
  outside a future attempt would need deliberate routing. Explicit addresses
  override the default. The configuration was removed with the test machines.
- No additional controls or optimizations were introduced.
