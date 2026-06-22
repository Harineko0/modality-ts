import * as ts from "typescript";
import type { LeafEffect } from "../../spi/leaf-dispatch.js";
import type { SurfaceCall } from "../../spi/surface-ir.js";
import type { NodeRef } from "../../spi/surface-ir.js";
import {
  calleeNameFromSurfaceCall,
  createLeafDispatchAdapter,
} from "./leaf-dispatch-adapter.js";
import {
  currentEngineFramework,
} from "../ast.js";
import { dispatchEffectRecognition } from "./effect-model-dispatch.js";
import type { StatementSummaryState } from "./statement-summary-state.js";
import type { SetterBinding } from "../types.js";
import { summarizeSetterCall, setterCallFrom, summarizeSetterWrite } from "./setter-write.js";

export interface EngineLeafDispatchOptions {
  setters: Map<string, SetterBinding>;
  state: StatementSummaryState;
  originNode: (ref: NodeRef) => ts.Node | undefined;
}

export function createEngineLeafDispatch(
  options: EngineLeafDispatchOptions,
): ReturnType<typeof createLeafDispatchAdapter> {
  const { setters, state, originNode } = options;
  return createLeafDispatchAdapter({
    framework: currentEngineFramework().framework,
    sourcePlugins: [],
    effectModels: state.effectModelProviders,
    setters,
    resolveCallName: calleeNameFromSurfaceCall,
    resolveFrameworkHook(call, _ctx) {
      const node = originNode(call.origin);
      if (!node || !ts.isCallExpression(node)) return undefined;
      const hook = currentEngineFramework().framework.recognizeHook(
        node,
        currentEngineFramework().ctx,
      );
      if (!hook) return undefined;
      if (hook.hook.kind === "flush-sync" || hook.hook.kind === "start-transition") {
        return { effect: { kind: "seq", effects: [] } };
      }
      return undefined;
    },
    resolveSetterWrite(call, ctx) {
      const node = originNode(call.origin);
      if (!node || !ts.isCallExpression(node)) return undefined;
      const locals = new Map(
        [...ctx.locals.entries()].map(([name, binding]) => [
          name,
          { expr: binding.expr, reads: binding.reads },
        ]),
      );
      const summary = summarizeSetterCall(node, setters, locals, {
        resetSymbols: state.resetSymbols,
        snapshotReads: state.snapshotReads,
        snapshottedReads: state.snapshottedReads,
        types: state.types,
      });
      if (!summary) return undefined;
      return { effect: summary.effect, caveats: [] };
    },
    resolveNavigation() {
      return undefined;
    },
    resolveEffectModel(call) {
      const node = originNode(call.origin);
      if (!node) return undefined;
      const callNode = ts.isCallExpression(node) || ts.isNewExpression(node) ? node : undefined;
      if (!callNode) return undefined;
      const summary = dispatchEffectRecognition(callNode, setters, state);
      if (!summary) return undefined;
      return { effect: summary.effect };
    },
  });
}

export function setterLeafFromCall(
  call: SurfaceCall,
  setters: Map<string, SetterBinding>,
  originNode: (ref: NodeRef) => ts.Node | undefined,
  types?: import("../../spi/index.js").SemanticTypeContext,
): LeafEffect | undefined {
  const node = originNode(call.origin);
  if (!node || !ts.isCallExpression(node)) return undefined;
  const setterCall = setterCallFrom(node, setters, types);
  if (!setterCall) return undefined;
  const summary = summarizeSetterWrite(setterCall, setters);
  return { effect: summary.effect };
}

export function resolveImportedNameViaPort(
  node: ts.Identifier,
  symbols: import("../../spi/symbol-port.js").SymbolPort,
  fileName: string,
): string {
  const binding = symbols.importBinding({
    name: node.text,
    origin: { file: fileName, start: node.getStart(), end: node.getEnd() },
  });
  if (binding) return binding.exportedName;
  return node.text;
}
