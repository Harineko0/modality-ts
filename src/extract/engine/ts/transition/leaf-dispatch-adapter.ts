
import type {
  CompileCtx,
  LeafDispatch,
  LeafEffect,
  LeafPrecedence,
  RankedLeafEffect,
} from "../../spi/leaf-dispatch.js";
import { mergeLeafEffects } from "../../spi/leaf-dispatch.js";
import type { SurfaceCall, SurfaceExpr, SurfaceNode } from "../../spi/surface-ir.js";
import type {
  EffectModelProvider,
  FrameworkPlugin,
  NavigationAdapter,
  StateSourcePlugin,
} from "../../spi/index.js";
import type { SetterBinding } from "../types.js";

export interface LeafDispatchAdapterOptions {
  framework?: FrameworkPlugin;
  sourcePlugins?: readonly StateSourcePlugin[];
  navigation?: NavigationAdapter;
  effectModels?: readonly EffectModelProvider[];
  setters: Map<string, SetterBinding>;
  resolveCallName: (call: SurfaceCall) => string | undefined;
  resolveSetterWrite: (
    call: SurfaceCall,
    ctx: CompileCtx,
  ) => LeafEffect | undefined;
  resolveFrameworkHook: (
    call: SurfaceCall,
    ctx: CompileCtx,
  ) => LeafEffect | undefined;
  resolveNavigation: (
    node: SurfaceNode,
    ctx: CompileCtx,
  ) => LeafEffect | undefined;
  resolveEffectModel: (
    call: SurfaceCall,
    ctx: CompileCtx,
  ) => LeafEffect | undefined;
}

function collectCallClaims(
  call: SurfaceCall,
  ctx: CompileCtx,
  options: LeafDispatchAdapterOptions,
): RankedLeafEffect[] {
  const claims: RankedLeafEffect[] = [];
  const push = (
    precedence: LeafPrecedence,
    pluginId: string,
    leaf: LeafEffect | undefined,
  ): void => {
    if (!leaf) return;
    claims.push({ precedence, pluginId, leaf });
  };

  push(
    "framework-hook",
    options.framework?.id ?? "framework",
    options.resolveFrameworkHook(call, ctx),
  );
  push(
    "state-write",
    options.sourcePlugins?.[0]?.id ?? "state",
    options.resolveSetterWrite(call, ctx),
  );
  push(
    "navigation",
    options.navigation?.id ?? "navigation",
    options.resolveNavigation(call, ctx),
  );
  push(
    "effect-model",
    options.effectModels?.[0]?.id ?? "effect-model",
    options.resolveEffectModel(call, ctx),
  );
  return claims;
}

function defaultLeafEffect(
  call: SurfaceCall,
  options: LeafDispatchAdapterOptions,
): LeafEffect {
  const callee = options.resolveCallName(call) ?? "unknown";
  const escaped = [...options.setters.values()].filter((setter) =>
    callee.includes(setter.stateName),
  );
  if (escaped.length === 0) {
    return {
      effect: { kind: "seq", effects: [] },
      caveats: [
        {
          kind: "model-slack",
          id: "unknown-call",
          reason: `Unknown call ${callee}`,
          severity: "over-approx",
        },
      ],
    };
  }
  return {
    effect: {
      kind: "seq",
      effects: escaped.map((setter) => ({
        kind: "havoc" as const,
        var: setter.varId,
      })),
    },
    caveats: [
      {
        kind: "model-slack",
        id: "unknown-call-taint",
        reason: `Unknown call ${callee} taints ${escaped.map((s) => s.varId).join(", ")}`,
        severity: "over-approx",
      },
    ],
  };
}

export function createLeafDispatchAdapter(
  options: LeafDispatchAdapterOptions,
): LeafDispatch {
  return {
    interpretCall(call, ctx) {
      const claims = collectCallClaims(call, ctx, options);
      const merged = mergeLeafEffects(claims);
      if (merged) return merged;
      return defaultLeafEffect(call, options);
    },

    interpretExpr(expr: SurfaceExpr, ctx: CompileCtx) {
      if (expr.kind !== "call") return undefined;
      const leaf = this.interpretCall?.(expr, ctx);
      if (leaf?.effect.kind !== "assign") return undefined;
      return {
        expr: leaf.effect.expr,
        reads: [],
        caveats: leaf.caveats,
      };
    },

    interpretBoundary(_node: SurfaceNode, _ctx: CompileCtx) {
      return undefined;
    },
  };
}

export function calleeNameFromSurfaceCall(
  call: SurfaceCall,
): string | undefined {
  if (call.callee.kind === "ref") return call.callee.symbol.name;
  if (call.callee.kind === "member") return call.callee.name;
  return undefined;
}
