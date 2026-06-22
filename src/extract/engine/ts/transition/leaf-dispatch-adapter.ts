import type {
  SurfaceCall,
  SurfaceExpr,
  SurfaceNode,
} from "../../../lang/ts/surface-ir.js";
import type {
  EffectPlugin,
  FrameworkPlugin,
  RoutePlugin,
  StateSourcePlugin,
} from "../../spi/index.js";
import type {
  CompileCtx,
  LeafDispatch,
  LeafEffect,
  LeafPrecedence,
  RankedLeafEffect,
} from "../../spi/leaf-dispatch.js";
import { mergeLeafEffects } from "../../spi/leaf-dispatch.js";
import type { SetterBinding } from "../types.js";

export interface LeafDispatchAdapterOptions {
  framework?: FrameworkPlugin;
  statePlugins?: readonly StateSourcePlugin[];
  navigation?: RoutePlugin;
  effectModels?: readonly EffectPlugin[];
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
  interpretAssignment?: LeafDispatch["interpretAssignment"];
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
    options.statePlugins?.[0]?.id ?? "state",
    options.resolveSetterWrite(call, ctx),
  );
  push(
    "route",
    options.navigation?.id ?? "route",
    options.resolveNavigation(call, ctx),
  );
  push(
    "effect",
    options.effectModels?.[0]?.id ?? "effect",
    options.resolveEffectModel(call, ctx),
  );
  return claims;
}

function defaultLeafEffect(
  call: SurfaceCall,
  ctx: CompileCtx,
  options: LeafDispatchAdapterOptions,
): LeafEffect {
  const callee = options.resolveCallName(call) ?? "unknown";
  const escaped = [...options.setters.entries()]
    .filter(
      ([setterName, setter]) =>
        callee.includes(setter.stateName) ||
        call.args.some(
          (arg) =>
            arg.kind === "ref" &&
            (arg.symbol.name === setterName ||
              ctx.locals.get(arg.symbol.name)?.setter === setter),
        ),
    )
    .map(([, setter]) => setter);
  if (escaped.length === 0) {
    return {
      effect: { kind: "seq", effects: [] },
      caveats: [],
    };
  }
  return {
    effect:
      escaped.length === 1
        ? { kind: "havoc", var: escaped[0]!.varId }
        : {
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
      return defaultLeafEffect(call, ctx, options);
    },

    ...(options.interpretAssignment
      ? { interpretAssignment: options.interpretAssignment }
      : {}),

    interpretExpr(expr: SurfaceExpr, ctx: CompileCtx) {
      if (expr.kind === "ref") {
        const setter =
          options.setters.get(expr.symbol.name) ??
          ctx.locals.get(expr.symbol.name)?.setter;
        if (setter) {
          return {
            expr: { kind: "lit", value: null },
            reads: [],
            setter,
          };
        }
      }
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
