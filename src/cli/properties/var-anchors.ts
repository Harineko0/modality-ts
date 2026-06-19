import { resolve } from "node:path";
import type { Model, SourceAnchor, StateVarDecl } from "modality-ts/core";

export function buildVarAnchorsFromVars(
  vars: readonly StateVarDecl[],
): Record<string, SourceAnchor> | undefined {
  const varAnchors: Record<string, SourceAnchor> = {};
  for (const decl of vars) {
    if (typeof decl.origin !== "object" || !("file" in decl.origin)) continue;
    varAnchors[decl.id] = {
      file: resolve(decl.origin.file),
      ...(decl.origin.line !== undefined ? { line: decl.origin.line } : {}),
      ...(decl.origin.column !== undefined
        ? { column: decl.origin.column }
        : {}),
    };
  }
  return Object.keys(varAnchors).length > 0 ? varAnchors : undefined;
}

export function modelWithVarAnchors(model: Model): Model {
  if (model.metadata?.varAnchors) return model;
  const varAnchors = buildVarAnchorsFromVars(model.vars);
  if (!varAnchors) return model;
  return {
    ...model,
    metadata: {
      ...model.metadata,
      varAnchors,
    },
  };
}
