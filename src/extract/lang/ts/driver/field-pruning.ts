import type {
  ExtractionCaveat,
  FieldPruningMetadata,
  Model,
} from "modality-ts/core";
import { domainPathAt, type FieldPath } from "modality-ts/core";
import { modelSlackCaveat } from "./caveats.js";

export {
  buildFieldPruningMetadata,
  collectExprReadFieldPaths,
  collectUpdateFieldPaths,
  exprReadsWholeVar,
} from "modality-ts/core";

export function fieldPruningCollapseCaveats(
  model: Model,
  metadata: FieldPruningMetadata,
): ExtractionCaveat[] {
  const varsById = new Map(model.vars.map((decl) => [decl.id, decl]));
  const caveats: ExtractionCaveat[] = [];
  for (const entry of metadata.entries) {
    const decl = varsById.get(entry.varId);
    if (decl?.domain.kind !== "record") continue;
    for (const path of entry.prunedPaths) {
      const fieldDomain = domainPathAt(decl.domain, path);
      if (fieldDomain?.kind !== "tokens") continue;
      const pathLabel = path.join(".");
      caveats.push(
        modelSlackCaveat(
          `field:${entry.varId}:${pathLabel}`,
          `Record field ${entry.varId}.${pathLabel} collapsed to token identity; pruned paths may admit extra behavior`,
          entry.source,
        ),
      );
    }
  }
  return caveats;
}

export type { FieldPath };
