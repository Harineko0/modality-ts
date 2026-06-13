# Contributing

Thanks for helping improve `modality-ts`.

## Setup

```bash
pnpm install
```

## Check Your Changes

Before opening a pull request, run:

```bash
pnpm typecheck
pnpm test
pnpm architecture
pnpm clean
pnpm build
pnpm demo
pnpm ci:examples
```

For changes that affect checker semantics, model generation, or TLA+ parity, also run:

```bash
pnpm phase7
```

## Pull Requests

- Keep changes focused and explain the user-visible behavior they affect.
- Add or update tests when changing extraction, checking, replay, reporting, or CLI behavior.
- Keep the documented architecture in `docs/specs/05-architecture.md` and the implementation aligned.
- Do not commit generated artifacts, local `.env` files, or npm tokens.

## Publishing

Publishing is handled by GitHub Actions from releases. The workflow uses the `NPM_ACCESS_TOKEN` repository secret, so contributors should not publish packages manually from local machines.
