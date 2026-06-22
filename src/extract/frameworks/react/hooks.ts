import * as ts from "typescript";
import type { SourceAnchor } from "modality-ts/core";
import type {
  FrameworkCtx,
  HookCall,
} from "modality-ts/extract/engine/spi";
import { resolveImportedName } from "modality-ts/extract/engine/spi";

function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}

export type ReactEffectHookName =
  | "useEffect"
  | "useLayoutEffect"
  | "useInsertionEffect";

const EFFECT_HOOK_NAMES = new Set<string>([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

export function reactEffectPhase(hookName: ReactEffectHookName): number {
  return hookName === "useEffect" ? 1 : 0;
}

function calleeIdentifier(
  call: ts.CallExpression,
): ts.Identifier | undefined {
  return ts.isIdentifier(call.expression) ? call.expression : undefined;
}

function calleeName(call: ts.CallExpression, ctx: FrameworkCtx): string | undefined {
  const identifier = calleeIdentifier(call);
  return identifier ? resolveImportedName(identifier, ctx) : undefined;
}

function sourceAnchorFor(
  call: ts.CallExpression,
  ctx: FrameworkCtx,
): SourceAnchor {
  const source = ctx.sourceFile;
  const fileName = ctx.fileName ?? source?.fileName ?? "unknown";
  if (source) {
    return { file: fileName, ...lineAndColumn(source, call) };
  }
  return { file: fileName };
}

export function recognizeReactHook(
  call: ts.CallExpression,
  ctx: FrameworkCtx,
): HookCall | undefined {
  const name = calleeName(call, ctx);
  if (!name) return undefined;
  const origin = sourceAnchorFor(call, ctx);

  if (name === "useState" || name === "useReducer" || name === "useRef") {
    return { hook: { kind: "state" }, origin };
  }
  if (EFFECT_HOOK_NAMES.has(name)) {
    return {
      hook: {
        kind: "effect",
        phase: reactEffectPhase(name as ReactEffectHookName),
      },
      origin,
    };
  }
  if (name === "useTransition" || name === "startTransition") {
    return { hook: { kind: "transition" }, origin };
  }
  if (name === "useDeferredValue") {
    return { hook: { kind: "deferred" }, origin };
  }
  if (name === "useContext") {
    return { hook: { kind: "context" }, origin };
  }
  if (name === "useCallback") {
    const callback = call.arguments[0];
    if (callback && isExtractableHandler(callback)) {
      return { hook: { kind: "callback", handler: callback }, origin };
    }
    return undefined;
  }
  return undefined;
}

export function isReactEffectHookName(
  call: ts.CallExpression,
  ctx: FrameworkCtx,
): ReactEffectHookName | undefined {
  const name = calleeName(call, ctx);
  if (!name || !EFFECT_HOOK_NAMES.has(name)) return undefined;
  return name as ReactEffectHookName;
}

export function isReactHookNamed(
  call: ts.CallExpression,
  ctx: FrameworkCtx,
  expected: string,
): boolean {
  return calleeName(call, ctx) === expected;
}

export function isReactStartTransitionCall(
  node: ts.Node,
  ctx: FrameworkCtx,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) && isReactHookNamed(node, ctx, "startTransition")
  );
}

export function isReactFlushSyncCall(
  node: ts.Node,
  ctx: FrameworkCtx,
): node is ts.CallExpression {
  return ts.isCallExpression(node) && isReactHookNamed(node, ctx, "flushSync");
}

export function isReactUseTransitionCall(
  node: ts.Expression,
  ctx: FrameworkCtx,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) && isReactHookNamed(node, ctx, "useTransition")
  );
}

function isExtractableHandler(
  node: ts.Node,
): node is
  | ts.ArrowFunction
  | ts.FunctionExpression
  | (ts.FunctionDeclaration & { body: ts.Block }) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    (ts.isFunctionDeclaration(node) && Boolean(node.body))
  );
}
