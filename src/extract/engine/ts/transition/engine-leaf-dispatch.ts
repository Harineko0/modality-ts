import * as ts from "typescript";
import type { NodeRef } from "../../../lang/ts/node-ref.js";
import type { SurfaceCall } from "../../../lang/ts/surface-ir.js";
import type { LeafEffect } from "../../spi/leaf-dispatch.js";
import { currentEngineFramework, recognizeHookFromTs } from "../ast.js";
import type { SetterBinding } from "../types.js";
import {
  dispatchEffectAssignment,
  dispatchEffectRecognition,
} from "./effect-model-dispatch.js";
import {
  calleeNameFromSurfaceCall,
  createLeafDispatchAdapter,
} from "./leaf-dispatch-adapter.js";
import {
  setterCallFrom,
  summarizeSetterCall,
  summarizeSetterWrite,
} from "./setter-write.js";
import type { StatementSummaryState } from "./statement-summary-state.js";

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
    statePlugins: [],
    effectModels: state.effectPlugins,
    setters,
    resolveCallName: calleeNameFromSurfaceCall,
    resolveFrameworkHook(call, _ctx) {
      const node = originNode(call.origin);
      if (!node || !ts.isCallExpression(node)) return undefined;
      const hook = recognizeHookFromTs(
        node,
        currentEngineFramework(),
        state.fileName ?? node.getSourceFile().fileName,
      );
      if (!hook) return undefined;
      if (
        hook.hook.kind === "flush-sync" ||
        hook.hook.kind === "start-transition"
      ) {
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
          {
            expr: binding.expr,
            reads: binding.reads,
            ...(binding.setter
              ? { setter: binding.setter as SetterBinding }
              : {}),
          },
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
      const callNode =
        ts.isCallExpression(node) || ts.isNewExpression(node)
          ? node
          : undefined;
      if (!callNode) return undefined;
      const summary = dispatchEffectRecognition(callNode, setters, state);
      if (!summary) return undefined;
      return { effect: summary.effect };
    },
    interpretAssignment(assign, _ctx) {
      const handled = dispatchEffectAssignment(assign, setters, state);
      if (!handled) return undefined;
      return { effect: { kind: "seq", effects: [] } };
    },
  });
}

export function setterLeafFromCall(
  call: SurfaceCall,
  setters: Map<string, SetterBinding>,
  originNode: (ref: NodeRef) => ts.Node | undefined,
  types?: import("../../../lang/ts/semantic-type-context.js").SemanticTypeContext,
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
