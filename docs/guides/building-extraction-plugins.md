---
id: building-extraction-plugins
title: Building extraction plugins
sidebar_label: Building plugins
---

`modality-ts` grows through extraction plugins under `src/extract/plugins/`. If your
app uses a state, routing, framework, effect, cache, or schema library that is not built
in, you can model it by adding a focused adapter instead of changing the checker.

Plugins are trusted model producers: they may discover state variables, finite domains,
write APIs, template transitions, route/cache resources, or replay observation hooks,
but they must not invent new IR semantics. The checker only understands the existing
[IR](../architecture/ir.md).

## Pick the plugin kind

| Need | Plugin kind | Config field | Where to look |
| --- | --- | --- | --- |
| Model a state library | `StateSourcePlugin` | `plugins` / built-in registry | `src/extract/plugins/state/<library>/` |
| Refine finite domains from schemas | `TypePlugin` | `typePlugins` / built-in registry | `src/extract/plugins/type/<library>/` |
| Model navigation | `RoutePlugin` | `routePlugin` | `src/extract/plugins/route/<router>/` |
| Classify framework modules or unwrap handlers | `FrameworkPlugin` | `framework` | `src/extract/plugins/framework/<framework>/` |
| Recognize effect APIs | `EffectPlugin` or `EffectApiProvider` | `effectPlugins` / registry | `src/extract/plugins/effect/<api>/` |
| Contribute cache/storage templates | `CacheStorageProvider` | registry bundle | `src/extract/plugins/route/<framework>/` |

Most user-authored plugins start as either a state-source plugin or a type plugin.
State-source plugins add variables and writes; type plugins make inferred domains
smaller and more precise.

## State-source plugin shape

A state-source plugin is a vertical slice with a Node extraction entry and a jsdom
harness entry:

```text
src/extract/plugins/state/my-store/
|-- discover.ts       # find declarations and produce SourceDecls
|-- writes.ts         # find write channels and summarize writes
|-- domains.ts        # optional library-specific domain hints
|-- harness.ts        # replay setup, observe, and optional witnesses
`-- index.ts          # export myStoreSource()
```

Use the public helper and SPI types:

```ts
import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import { createStateSourcePlugin } from "modality-ts/extract/plugins";

export function myStoreSource(): StateSourcePlugin {
  return createStateSourcePlugin({
    id: "my-store",
    version: "0.1.0",
    packageNames: ["my-store"],
    discover(ctx) {
      return [];
    },
    writeChannels(ctx) {
      return [];
    },
    harness: {
      setup() {
        return {};
      },
      observe() {
        return "unobservable";
      },
    },
    conformance: {
      testedVersions: "my-store>=1",
    },
  });
}
```

Implement the phases in this order:

1. `discover` returns `SourceDecl` records with stable variable IDs, `StateVarDecl`
   domains, source anchors, and metadata needed later.
2. `writeChannels` declares every write API the library exposes. Missing channels become
   loud taints through escape analysis.
3. `summarizeWrite`, when needed, lowers a recognized write call into existing
   `EffectIR`. Return `"unsupported"` rather than guessing.
4. `template`, when the library has runtime behavior independent of app handlers,
   contributes vars/transitions for cache lifecycle or background work.
5. `harness` lets replay observe model variables against the real library and create
   witnesses for refined domains.

For details, see [State sources & the plugin SPI](../architecture/state-sources.md).

## Type plugin shape

Type plugins are lighter-weight adapters for schema libraries such as Zod or ArkType.
They refine a finite `AbstractDomain` from static initializer syntax:

```ts
import type { TypePlugin } from "modality-ts/extract/engine/spi";
import { createTypePlugin } from "modality-ts/extract/plugins";

export function mySchemaTypePlugin(): TypePlugin {
  return createTypePlugin({
    id: "my-schema",
    version: "0.1.0",
    packageNames: ["my-schema"],
    refineDomain(ctx) {
      return undefined;
    },
  });
}
```

Only refine what is statically provable. If bounds depend on runtime values, abstain or
return caveats so the report explains the approximation. See
[Type-library adapters](../architecture/type-library-adapters.md).

## Wire a custom plugin

Export the plugin factory from your package, then list the plugin in
`modality.config.ts`:

```ts
import { myStoreSource } from "@acme/modality-my-store";
import { mySchemaTypePlugin } from "@acme/modality-my-schema";

export default {
  plugins: [myStoreSource()],
  typePlugins: [mySchemaTypePlugin()],
};
```

Built-in plugins auto-register from `packageNames`; custom plugins are explicit config
entries. Active plugin IDs and versions are stamped into the
[trust ledger](../soundness/trust-ledger.md).

## Keep plugins honest

- Keep extraction code out of harness modules, and keep app-facing peer dependencies out
  of Node-only extraction modules.
- Prefer stable IDs that encode the library concept, not incidental syntax.
- Return existing `EffectIR` and `ExprIR` constructs; unsupported library behavior should
  become a caveat, taint, or overlay target.
- Add focused tests beside the subsystem under `test/extract/plugins/`.
- Add conformance probes when a plugin claims replay-observable behavior.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm architecture` before publishing a plugin
  or opening a PR.

Package exports and built-in entry points are listed in
[Package entry points](../reference/package-entry-points.md).
