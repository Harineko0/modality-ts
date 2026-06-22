import type {
  EffectIR,
  ExtractionCaveat,
  ExprIR,
} from "modality-ts/core";
import type {
  SurfaceCall,
  SurfaceExpr,
  SurfaceNode,
} from "./surface-ir.js";
import type { SymbolPort } from "./symbol-port.js";

export interface LeafEffect {
  effect: EffectIR;
  caveats?: ExtractionCaveat[];
}

export interface LeafValue {
  expr: ExprIR;
  reads: string[];
  caveats?: ExtractionCaveat[];
}

export interface LeafBoundary {
  kind: string;
  caveats?: ExtractionCaveat[];
}

export interface DataflowBinding {
  expr: ExprIR;
  reads: string[];
}

export interface CompileCtx {
  symbols: SymbolPort;
  /** Per-scope local symbol → current ExprIR binding. */
  locals: Map<string, DataflowBinding>;
  snapshotReads: boolean;
  caveats: ExtractionCaveat[];
}

export interface LeafDispatch {
  interpretCall(
    call: SurfaceCall,
    ctx: CompileCtx,
  ): LeafEffect | undefined;
  interpretExpr(
    expr: SurfaceExpr,
    ctx: CompileCtx,
  ): LeafValue | undefined;
  interpretBoundary(
    node: SurfaceNode,
    ctx: CompileCtx,
  ): LeafBoundary | undefined;
}

export const LEAF_PRECEDENCE = [
  "framework-hook",
  "state-write",
  "navigation",
  "effect-model",
  "default",
] as const;

export type LeafPrecedence = (typeof LEAF_PRECEDENCE)[number];

export interface RankedLeafEffect {
  precedence: LeafPrecedence;
  pluginId: string;
  leaf: LeafEffect;
}

export function mergeLeafEffects(
  claims: readonly RankedLeafEffect[],
): LeafEffect | undefined {
  if (claims.length === 0) return undefined;
  const sorted = [...claims].sort((left, right) => {
    const leftRank = LEAF_PRECEDENCE.indexOf(left.precedence);
    const rightRank = LEAF_PRECEDENCE.indexOf(right.precedence);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.pluginId.localeCompare(right.pluginId);
  });
  const winner = sorted[0]!;
  const conflicting = sorted.filter(
    (claim) =>
      claim !== winner &&
      JSON.stringify(claim.leaf.effect) !== JSON.stringify(winner.leaf.effect),
  );
  if (conflicting.length > 0) {
    return {
      effect: winner.leaf.effect,
      caveats: [
        ...(winner.leaf.caveats ?? []),
        {
          kind: "model-slack",
          id: "leaf-dispatch-conflict",
          reason: `Conflicting leaf interpretations from ${conflicting.map((c) => c.pluginId).join(", ")}; using ${winner.pluginId}`,
          severity: "over-approx",
        },
      ],
    };
  }
  return winner.leaf;
}
