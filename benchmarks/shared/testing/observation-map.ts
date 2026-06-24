import {
  type ObservationSource,
  observationSource,
} from "modality-ts/cli/harness";
import type { Model, Value } from "modality-ts/core";

export type BenchmarkObservedValue = Value | "unobservable";

export interface BenchmarkObservationHandles {
  route?: () => BenchmarkObservedValue;
  pending?: () => BenchmarkObservedValue;
  history?: () => BenchmarkObservedValue;
  jotai?: (name: string) => BenchmarkObservedValue;
  swr?: (hook: string, field: string) => BenchmarkObservedValue;
  zustand?: (store: string, field: string) => BenchmarkObservedValue;
  useState?: (component: string, field: string) => BenchmarkObservedValue;
  system?: (varId: string) => BenchmarkObservedValue;
}

export function createBenchmarkObservationSource(
  handles: BenchmarkObservationHandles,
): ObservationSource {
  return observationSource("ledgerops-observation-map", (varId) => {
    const value = observeBenchmarkVar(varId, handles);
    return value === "unobservable" ? value : { value };
  });
}

export function observeBenchmarkVar(
  varId: string,
  handles: BenchmarkObservationHandles,
): BenchmarkObservedValue {
  const parsed = parseBenchmarkVarId(varId);
  if (!parsed) return "unobservable";
  switch (parsed.kind) {
    case "atom":
      return handles.jotai ? handles.jotai(parsed.name) : "unobservable";
    case "swr":
      return handles.swr
        ? handles.swr(parsed.hook, parsed.field)
        : "unobservable";
    case "zustand":
      return handles.zustand
        ? handles.zustand(parsed.store, parsed.field)
        : "unobservable";
    case "useState":
      return handles.useState
        ? handles.useState(parsed.component, parsed.field)
        : "unobservable";
    case "system":
      switch (parsed.varId) {
        case "sys:route":
          return handles.route ? handles.route() : "unobservable";
        case "sys:pending":
          return handles.pending ? handles.pending() : "unobservable";
        case "sys:history":
          return handles.history ? handles.history() : "unobservable";
      }
      return handles.system ? handles.system(parsed.varId) : "unobservable";
  }
}

export function assertObservationMapCoversModel(model: Model): void {
  const uncovered = model.vars
    .filter((decl) => isPropertyRelevantVar(decl.id))
    .filter((decl) => !parseBenchmarkVarId(decl.id))
    .map((decl) => decl.id)
    .sort();
  if (uncovered.length > 0) {
    throw new Error(
      `missing observation resolver support for property vars: ${uncovered.join(", ")}`,
    );
  }
}

type ParsedBenchmarkVarId =
  | { kind: "atom"; name: string }
  | { kind: "swr"; hook: string; field: string }
  | { kind: "zustand"; store: string; field: string }
  | { kind: "useState"; component: string; field: string }
  | { kind: "system"; varId: string };

function parseBenchmarkVarId(varId: string): ParsedBenchmarkVarId | undefined {
  if (varId.startsWith("atom:")) {
    const name = varId.slice("atom:".length).split("@store:", 1)[0];
    return name ? { kind: "atom", name } : undefined;
  }

  const swrMatch = /^swr:([^:]+):([^:]+)$/.exec(varId);
  if (swrMatch?.[1] && swrMatch[2]) {
    return { kind: "swr", hook: swrMatch[1], field: swrMatch[2] };
  }

  const zustandMatch = /^zustand:([^.]+)\.(.+)$/.exec(varId);
  if (zustandMatch?.[1] && zustandMatch[2]) {
    return {
      kind: "zustand",
      store: zustandMatch[1],
      field: zustandMatch[2],
    };
  }

  const localMatch = /^local:([^.]+)\.(.+)$/.exec(varId);
  if (localMatch?.[1] && localMatch[2]) {
    return {
      kind: "useState",
      component: localMatch[1],
      field: localMatch[2],
    };
  }

  if (
    varId === "sys:route" ||
    varId === "sys:pending" ||
    varId === "sys:history" ||
    varId.startsWith("sys:next:")
  ) {
    return { kind: "system", varId };
  }

  return undefined;
}

function isPropertyRelevantVar(varId: string): boolean {
  return (
    varId === "sys:route" ||
    varId === "sys:pending" ||
    varId === "sys:history" ||
    varId.startsWith("atom:") ||
    varId.startsWith("swr:") ||
    varId.startsWith("zustand:") ||
    varId.startsWith("local:")
  );
}
