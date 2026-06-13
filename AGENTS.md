# Repository Guidelines

## Project Structure & Module Organization

`modality-ts` is a single npm package with TypeScript modules for model-checking-based React testing. Core modules live under `src/`: `kernel` defines IR and shared types; `checker` implements search, encoding, monitors, traces, and slicing; `extraction`, `harness`, `runtime`, and `modality` provide extraction, replay, runtime helpers, and CLI features. Source adapters live in `src/sources/*` such as `swr`, `jotai`, `router`, and `use-state`. Tests live under root `test/`, with a small number of feature-slice tests beside implementation files. Example apps and property files are in `examples/*`. Specs are in `docs/`; read `docs/implement.md` and keep `docs/specs/05-architecture.md` aligned with code changes.

## Build, Test, and Development Commands

Always prefix shell commands with `rtk`.

- `rtk pnpm install`: install dependencies.
- `rtk pnpm typecheck`: run TypeScript project-reference checks.
- `rtk pnpm test`: run Vitest tests matching `test/**/*.test.ts` and colocated feature tests.
- `rtk pnpm architecture`: validate package boundaries with dependency-cruiser.
- `rtk pnpm build`: build all TypeScript project references.
- `rtk pnpm demo`: run the demo acceptance test.
- `rtk pnpm ci:examples`: verify example apps.
- `rtk pnpm phase7`: run the TLA+ differential gate for checker/model changes.
- `rtk pnpm clean`: remove generated build outputs.

## Coding Style & Naming Conventions

Use TypeScript ES modules and follow the existing style: two-space indentation, double quotes, explicit exports through `src/index.ts`, and small feature modules. Prefer package aliases such as `modality-ts/kernel` over deep cross-package imports. Name tests `*.test.ts`; use fixture names such as `todo-hand-model.ts` and command modules under `src/features/<command>/`.

## Testing Guidelines

Vitest is the primary test runner. Add or update tests for changes to IR validation, checker semantics, extraction, replay, reporting, CLI commands, or source adapters. Preserve deterministic behavior: checker outputs and traces should be stable across runs. For extraction or model changes, update golden expectations and walkthrough conformance together.

## Commit & Pull Request Guidelines

Recent commits use short imperative summaries, for example `Prepare npm publishing`, `fix architecture`, and `Complete modality phase 7 differential gate`. Keep commits focused and mention the affected phase, package, or behavior when useful. Pull requests should describe user-visible behavior, include relevant command output, link issues when applicable, and update tests/docs for semantic changes. Do not commit generated artifacts, `.env` files, tokens, or credentials.

## Security & Configuration Tips

Publishing is handled by GitHub Actions using repository secrets; do not publish packages manually. Keep verification artifacts in ignored directories such as `.modality/`, and avoid exposing application data in traces or reports.
