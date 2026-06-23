import type { Model, Value } from "modality-ts/core";
import {
  observationSource,
  type ObservationSource,
} from "modality-ts/cli/harness";
import {
  ledgerOpsJotaiStateNames,
  ledgerOpsSwrHooks,
} from "../app-spec/property-catalog.js";

export type ObservationMechanism =
  | "jotai-store"
  | "swr-cache"
  | "router"
  | "pending-msw"
  | "dom-projection";

export interface ObservationMapEntry {
  varId: string;
  mechanism: ObservationMechanism;
}

export const ledgerOpsObservationMap: readonly ObservationMapEntry[] = [
  { varId: "sys:route", mechanism: "router" },
  { varId: "sys:pending", mechanism: "pending-msw" },
  ...ledgerOpsJotaiStateNames.map((name) => ({
    varId: name,
    mechanism: "jotai-store" as const,
  })),
  ...ledgerOpsSwrHooks.map((hook) => ({
    varId: swrVarIdHint(hook),
    mechanism: "swr-cache" as const,
  })),
  { varId: "zustand:", mechanism: "dom-projection" },
  { varId: "useState:", mechanism: "dom-projection" },
];

export interface BenchmarkObservationHandles {
  route?: () => Value;
  pending?: () => Value;
  jotai?: (stateName: string) => Value | "unobservable";
  swr?: (varId: string) => Value | "unobservable";
  dom?: (varId: string) => Value | "unobservable";
}

export function createBenchmarkObservationSource(
  handles: BenchmarkObservationHandles,
): ObservationSource {
  return observationSource("ledgerops-observation-map", (varId) => {
    const entry = observationEntryForVar(varId);
    if (!entry) return "unobservable";
    switch (entry.mechanism) {
      case "router":
        return handles.route ? { value: handles.route() } : "unobservable";
      case "pending-msw":
        return handles.pending ? { value: handles.pending() } : "unobservable";
      case "jotai-store": {
        const stateName = ledgerOpsJotaiStateNames.find((name) =>
          varId.includes(name),
        );
        if (!stateName || !handles.jotai) return "unobservable";
        const value = handles.jotai(stateName);
        return value === "unobservable" ? value : { value };
      }
      case "swr-cache": {
        if (!handles.swr) return "unobservable";
        const value = handles.swr(varId);
        return value === "unobservable" ? value : { value };
      }
      case "dom-projection": {
        if (!handles.dom) return "unobservable";
        const value = handles.dom(varId);
        return value === "unobservable" ? value : { value };
      }
    }
  });
}

export function assertObservationMapCoversModel(model: Model): void {
  const uncovered = model.vars
    .filter((decl) => isPropertyRelevantVar(decl.id))
    .filter((decl) => !observationEntryForVar(decl.id))
    .map((decl) => decl.id)
    .sort();
  if (uncovered.length > 0) {
    throw new Error(
      `missing observation-map entries for property vars: ${uncovered.join(", ")}`,
    );
  }
}

function observationEntryForVar(
  varId: string,
): ObservationMapEntry | undefined {
  return ledgerOpsObservationMap.find((entry) =>
    entry.varId.endsWith(":")
      ? varId.startsWith(entry.varId)
      : varId === entry.varId || varId.includes(entry.varId),
  );
}

function isPropertyRelevantVar(varId: string): boolean {
  return (
    varId.startsWith("sys:") ||
    varId.startsWith("atom:") ||
    varId.startsWith("swr:") ||
    varId.startsWith("zustand:") ||
    varId.startsWith("useState:") ||
    ledgerOpsJotaiStateNames.some((name) => varId.includes(name))
  );
}

function swrVarIdHint(hook: string): string {
  return `swr:${hook
    .replace(/^use/, "")
    .replace(
      /[A-Z]/g,
      (letter, index) => `${index === 0 ? "" : "-"}${letter.toLowerCase()}`,
    )}`;
}
