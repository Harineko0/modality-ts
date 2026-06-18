import type { ExtractionCaveat, SourceAnchor } from "modality-ts/core";

export function caveatMessage(caveat: ExtractionCaveat): string {
  switch (caveat.kind) {
    case "global-taint":
      return `global-taint:${caveat.id}`;
    case "stale-read":
      return `Stale-read risk ${caveat.id}`;
    case "unhandled-rejection":
      return `Unhandled rejection ${caveat.id}`;
    case "unextractable":
      return caveat.reason.startsWith("Unextractable")
        ? caveat.reason
        : `Unextractable ${caveat.id}`;
    case "model-slack":
      return caveat.reason;
  }
}

export function globalTaintCaveat(
  varId: string,
  source?: SourceAnchor,
): ExtractionCaveat {
  return {
    kind: "global-taint",
    id: varId,
    reason: `global-taint:${varId}`,
    source,
    severity: "unsound-risk",
  };
}

export function staleReadCaveat(
  id: string,
  source?: SourceAnchor,
): ExtractionCaveat {
  return {
    kind: "stale-read",
    id,
    reason: `Stale-read risk ${id}`,
    source,
    severity: "info",
  };
}

export function unhandledRejectionCaveat(
  id: string,
  source?: SourceAnchor,
): ExtractionCaveat {
  return {
    kind: "unhandled-rejection",
    id,
    reason: `Unhandled rejection ${id}`,
    source,
    severity: "over-approx",
  };
}

export function unextractableHandlerCaveat(
  id: string,
  category: string,
  source?: SourceAnchor,
): ExtractionCaveat {
  return {
    kind: "unextractable",
    id,
    reason: source ? `${category} at ${formatSource(source)}` : category,
    source,
    severity: "over-approx",
  };
}

export function unextractableEffectCaveat(
  id: string,
  hookName: string,
  source?: SourceAnchor,
): ExtractionCaveat {
  // An effect hook that writes modeled state but cannot be summarized yields no
  // transition: it is a genuine unextractable handler (needs an overlay), not
  // model slack. Categorizing it as "unextractable" keeps it in the trust
  // ledger's unextractableHandlers bucket, where CI drift detection reads it.
  return {
    kind: "unextractable",
    id: `${id}.${hookName}`,
    reason: `Unextractable effect ${id}.${hookName}`,
    source,
    severity: "over-approx",
  };
}

export function modelSlackCaveat(
  id: string,
  reason: string,
  source?: SourceAnchor,
  severity: ExtractionCaveat["severity"] = "over-approx",
): ExtractionCaveat {
  return {
    kind: "model-slack",
    id,
    reason,
    source,
    severity,
  };
}

export function unprovableNumericDomainCaveat(
  id: string,
  reason: string,
  source?: SourceAnchor,
): ExtractionCaveat {
  return modelSlackCaveat(
    id,
    `Unprovable numeric domain: ${reason}`,
    source,
    "over-approx",
  );
}

export function cacheDynamicRequestCaveat(
  routePattern: string,
  source?: SourceAnchor,
): ExtractionCaveat {
  return modelSlackCaveat(
    `next-cache:${routePattern}`,
    `Dynamic request marker (no-store/connection) on route ${routePattern} skips cache vars`,
    source,
    "over-approx",
  );
}

export function formatSource(source: SourceAnchor): string {
  const line = source.line ?? 0;
  const column = source.column ?? 0;
  return `${source.file}:${line}:${column}`;
}

export function partitionCaveats(entries: readonly ExtractionCaveat[]): {
  globalTaints: ExtractionCaveat[];
  staleReads: ExtractionCaveat[];
  unhandledRejections: ExtractionCaveat[];
  unextractableHandlers: ExtractionCaveat[];
} {
  const globalTaints: ExtractionCaveat[] = [];
  const staleReads: ExtractionCaveat[] = [];
  const unhandledRejections: ExtractionCaveat[] = [];
  const unextractableHandlers: ExtractionCaveat[] = [];
  for (const entry of entries) {
    switch (entry.kind) {
      case "global-taint":
        globalTaints.push(entry);
        break;
      case "stale-read":
        staleReads.push(entry);
        break;
      case "unhandled-rejection":
        unhandledRejections.push(entry);
        break;
      case "unextractable":
        unextractableHandlers.push(entry);
        break;
      case "model-slack":
        break;
    }
  }
  return {
    globalTaints,
    staleReads,
    unhandledRejections,
    unextractableHandlers,
  };
}

export function compareCaveats(
  left: ExtractionCaveat,
  right: ExtractionCaveat,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id) ||
    left.reason.localeCompare(right.reason)
  );
}
