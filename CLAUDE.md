# Notes for AI assistants

Read `docs/ARCHITECTURE.md` and `docs/PLAN.md` first.

## Workflow
- Build and unit tests: `pnpm test`. Example: `pnpm example`.
- New farm: connect components from `@redstack/stdlib` with `attach`/`connect`, then `redstack all <module> -o out/x.litematic`. A clean `check` means the design is geometrically consistent – not that it works.
- Whether it works is decided in-game: add a scenario (see `examples/src/scenarios.ts`) and run `pnpm test:game <name>` against the test server (`packages/backend-fabric/README.md`).
- When a test fails, find out why before changing the design: small isolated experiments, written up in `docs/experiments/`.
- Never mark a component `game-tested` without a passing in-game test.
- Always state where a rate comes from (`game-mechanic`, `measured`, `estimate`).
- Set block states only through the semantic helpers (`outputTo`, `signalTowards`, `watching`, `pushing`), not raw `facing` values – that is where the classic mistakes are.
- Third-party libraries only in adapter packages; new dependencies follow `docs/SECURITY.md`.

## Language
Everything in English: code, comments, messages, docs.

## Commits
Author: the repository owner's configured git identity. No co-author trailers, no links to AI sessions.
