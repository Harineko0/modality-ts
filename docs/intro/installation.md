---
id: installation
title: Installation
sidebar_label: Installation
---

Install `modality-ts` as a **dev dependency** of the app you want to check. Property
files import helpers from `modality-ts/core`, so the package must resolve from that
app's dependency graph.

```bash
npm install -D modality-ts
# or
pnpm add -D modality-ts
# or
yarn add -D modality-ts
```

## What gets installed

`modality-ts` ships both TypeScript/JavaScript and a **prebuilt native checker
binary** (the [model checker](../architecture/checker.md) is implemented in Rust and
loaded in-process through a Node-API addon). The published package includes the
platform-specific `.node` artifact, so no Rust toolchain is required to *use* the tool
— only to build it from source.

The package exposes the `modality` CLI binary:

```bash
npx modality --help
```

## Requirements

| Requirement | Notes |
| --- | --- |
| Node.js ≥ 20 | The checker addon and CLI target current LTS Node. |
| TypeScript project | Extraction uses the TypeScript compiler API (full type checker), so a resolvable `tsconfig`/type environment improves domain inference. |
| A supported platform | A prebuilt native binary must exist for your OS/arch. Building from source needs a Rust toolchain (`cargo`) and `napi`. |

## Initialize the workspace

From the root of the app you are checking:

```bash
npx modality init
```

This creates the default local `.modality/` workspace and starter files. From here,
follow the [Quickstart](./quickstart.md).

## Building from source (contributors)

If you are working on `modality-ts` itself, the build compiles Rust before TypeScript:

```bash
pnpm install
pnpm build        # runs `build:rust` (napi) then `tsc -b`
pnpm test         # builds the native checker, then runs Vitest
```

See the [Architecture overview](../architecture/index.md) for the repository layout.
