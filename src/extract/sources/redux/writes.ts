import type { EffectIR } from "modality-ts/core";
import type {
  CallSite,
  ExtractionWarning,
  M0Ctx,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { modelSlackCaveat } from "../../engine/ts/caveats.js";
import { semanticSourceFileFor } from "../../engine/ts/semantic-source-file.js";
import {
  discoverDispatchBindings,
  discoverMapDispatchChannels,
  summarizeReduxDispatch,
} from "./dispatch.js";
import { storeVarId } from "./ids.js";
import { resolveReduxImports } from "./imports.js";
import {
  collectExportedSelectors,
  discoverConnectReadChannels,
  discoverGetStateReadChannels,
  discoverSelectorReadChannels,
} from "./selectors.js";
import { anchor, discoverReduxStoresDetailed } from "./store.js";
import {
  discoverStaticThunks,
  registerAsyncThunkLifecycle,
  thunkSafetyWarnings,
} from "./thunks.js";

export interface ReduxWriteDiscovery {
  channels: WriteChannel[];
  warnings: ExtractionWarning[];
  dispatchFixedEffects: Map<string, EffectIR>;
}

export function discoverReduxWriteChannels(
  sourceText: string,
  fileName = "App.tsx",
  types?: SemanticTypeContext,
): WriteChannel[] {
  return discoverReduxWritesDetailed(sourceText, fileName, types).channels;
}

export function discoverReduxWritesDetailed(
  sourceText: string,
  fileName = "App.tsx",
  types?: SemanticTypeContext,
): ReduxWriteDiscovery {
  const source = semanticSourceFileFor(
    sourceText,
    fileName,
    types,
    ts.ScriptKind.TSX,
  );
  const imports = resolveReduxImports(source, types);
  const discovery = discoverReduxStoresDetailed(sourceText, fileName, types);
  const channels: WriteChannel[] = [];
  const warnings: ExtractionWarning[] = discovery.warnings.map((warning) => ({
    message: warning.message,
    ...(warning.source ? { source: warning.source } : {}),
    ...(warning.caveat ? { caveat: warning.caveat } : {}),
  }));
  const dispatchFixedEffects = new Map<string, EffectIR>(
    discovery.actionEffects,
  );

  if (
    imports.reactRedux.size === 0 &&
    imports.rtk.size === 0 &&
    discovery.decls.length === 0
  ) {
    return { channels, warnings, dispatchFixedEffects };
  }

  registerAsyncThunkLifecycle(source, imports, discovery);
  const exportedSelectors = collectExportedSelectors(source);
  const defaultStore = [...discovery.storeNames][0] ?? "store";
  const sliceKeys =
    discovery.sliceKeysByStore.get(defaultStore) ?? new Map<string, string>();

  channels.push(
    ...discoverSelectorReadChannels(
      source,
      fileName,
      imports,
      defaultStore,
      sliceKeys,
      exportedSelectors,
    ),
  );
  channels.push(
    ...discoverGetStateReadChannels(source, fileName, discovery.storeHandles),
  );
  const connectReads = discoverConnectReadChannels(
    source,
    fileName,
    defaultStore,
    sliceKeys,
  );
  channels.push(...connectReads.channels);
  for (const message of connectReads.warnings) {
    warnings.push({
      message,
      producer: { kind: "state-source", id: "redux" },
    });
  }
  channels.push(...discoverMapDispatchChannels(source, fileName, discovery));

  const dispatchBindings = discoverDispatchBindings(
    source,
    fileName,
    imports,
    discovery,
  );
  for (const [symbol, effect] of dispatchBindings) {
    dispatchFixedEffects.set(symbol, effect);
    const primaryVar = primaryWrittenVar(effect);
    channels.push({
      id: `redux:${symbol}.dispatch`,
      varId: primaryVar ?? storeVarId(defaultStore, "unknown"),
      symbolName: symbol,
      source: anchor(source, fileName, source),
    });
  }

  const staticThunks = discoverStaticThunks(source, imports, discovery);
  for (const [name, effect] of staticThunks) {
    dispatchFixedEffects.set(name, effect);
  }
  for (const message of thunkSafetyWarnings(source, discovery)) {
    warnings.push({ message });
  }

  return { channels, warnings, dispatchFixedEffects };
}

export function discoverReduxSafetyWarnings(
  sourceText: string,
  fileName = "App.tsx",
  types?: SemanticTypeContext,
): ExtractionWarning[] {
  const _source = semanticSourceFileFor(
    sourceText,
    fileName,
    types,
    ts.ScriptKind.TSX,
  );
  const warnings: ExtractionWarning[] = [];
  const discovery = discoverReduxStoresDetailed(sourceText, fileName, types);
  warnings.push(
    ...discovery.warnings.map((warning) => ({
      message: warning.message,
      ...(warning.source ? { source: warning.source } : {}),
      ...(warning.caveat ? { caveat: warning.caveat } : {}),
      confidence: "over-approx" as const,
      producer: { kind: "state-source" as const, id: "redux" },
    })),
  );
  const writeDiscovery = discoverReduxWritesDetailed(
    sourceText,
    fileName,
    types,
  );
  warnings.push(...writeDiscovery.warnings);

  for (const [, storeInfo] of discovery.storeInfos) {
    if (
      storeInfo.middleware.some(
        (name) =>
          name.includes("listener") ||
          name.includes("saga") ||
          name === "custom",
      )
    ) {
      const caveat = modelSlackCaveat(
        `redux:${storeInfo.storeName}:middleware`,
        `Redux custom middleware not modeled for ${storeInfo.storeName}`,
        storeInfo.source,
      );
      warnings.push({
        message: caveat.reason,
        source: storeInfo.source,
        caveat,
        confidence: "over-approx",
        producer: { kind: "state-source", id: "redux" },
      });
    }
  }

  return dedupeWarnings(warnings);
}

let lastDiscovery: ReturnType<typeof discoverReduxStoresDetailed> | undefined;

export function summarizeReduxWrite(
  call: CallSite,
  ctx: M0Ctx,
): EffectIR | "unsupported" {
  return summarizeReduxDispatch(call, ctx, lastDiscovery);
}

export function primeReduxDiscovery(
  sourceText: string,
  fileName: string,
  types?: SemanticTypeContext,
): void {
  lastDiscovery = discoverReduxStoresDetailed(sourceText, fileName, types);
}

function primaryWrittenVar(effect: EffectIR): string | undefined {
  if (effect.kind === "assign") return effect.var;
  if (effect.kind === "seq") {
    for (const child of effect.effects) {
      const target = primaryWrittenVar(child);
      if (target) return target;
    }
  }
  if (effect.kind === "havoc") return effect.var;
  return undefined;
}

function dedupeWarnings(warnings: ExtractionWarning[]): ExtractionWarning[] {
  const seen = new Set<string>();
  const result: ExtractionWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.message}:${warning.source?.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(warning);
  }
  return result;
}
