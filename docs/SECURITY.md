# Security and dependencies

Many libraries in this space are small and maintained by individuals. Therefore:

## npm packages
- **Exact versions**, no `^`/`~` (`save-exact=true` in `.npmrc`).
- **Lockfile** (`pnpm-lock.yaml`) is committed; CI installs with `--frozen-lockfile`.
- **No install scripts**: `ignore-scripts=true` and `onlyBuiltDependencies: []` with `strictDepBuilds`. A package that needs scripts must be allowed explicitly.
- **Cool-down**: `minimumReleaseAge` = 7 days. Freshly published (possibly compromised) versions are not installed.
- **Updates only by hand**, after looking at the package diff. No automatic merges.
- As few dependencies as possible. At runtime currently only `nucleation`.

| Package | Version | Reason |
|---|---|---|
| nucleation | 0.12.3 | schematic export (0.12.4 was younger than 7 days at setup) |
| typescript | 6.0.3 | build (dev) |
| @types/node | 22.20.5 | types (dev) |

## Git submodules
- `vendor/nucleation` is pinned to the commit of tag `v0.12.3` (`81a57e3`), matching the npm version.
- `update = none`: not checked out on a normal clone. Only when needed (simulation build):
  `git -c submodule.vendor/nucleation.update=checkout submodule update --init vendor/nucleation`
- Take new commits only after reviewing the diff.

## GitHub Actions
- Pinned to commit SHAs, the tag is in a comment.
- Minimal permissions (`contents: read`), no credentials persisted on checkout.

## Test server
- Never in the repository. `packages/backend-fabric/scripts/server.mjs` downloads the files listed in `server-manifest.json` and refuses any file whose SHA-256 does not match.
- Upstream checksums: Java (Adoptium), server.jar (Mojang SHA-1), Carpet (Modrinth SHA-512). The Fabric launcher has no published checksum; its hash was recorded on first download (trust on first use). On first start it fetches Fabric Loader libraries from maven.fabricmc.net over HTTPS – not pinned by us.
- The server listens on 127.0.0.1 only, with a random RCON password. Mods are arbitrary Java code; running the server in a container without network access is planned (phase 3).
- Unreviewed mods (e.g. FarmBench) only in such a container.

## Secrets
- API keys and RCON passwords only in `.env` (in `.gitignore`). Template: `.env.example`.
