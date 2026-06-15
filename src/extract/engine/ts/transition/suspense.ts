import * as ts from "typescript";
import {
  componentNameFor,
  isReactLazyCall,
  isSuspenseElement,
  isUseCall,
  lineAndColumn,
} from "../ast.js";
import type { ExprIR, StateVarDecl, Transition } from "modality-ts/core";
import { pendingIs } from "./async.js";
import { andGuard } from "./guards.js";

const SUSPENSE_DOMAIN = {
  kind: "enum" as const,
  values: ["ready", "suspended"],
};

export function suspenseVarId(boundaryId: string): string {
  return `sys:suspense:${boundaryId}`;
}

export function suspenseStateVarDecl(
  boundaryId: string,
  initial: "ready" | "suspended" = "suspended",
): StateVarDecl {
  return {
    id: suspenseVarId(boundaryId),
    domain: SUSPENSE_DOMAIN,
    origin: "system",
    scope: { kind: "global" },
    initial,
  };
}

export function suspenseReadyGuard(boundaryId: string): ExprIR {
  return {
    kind: "eq",
    args: [
      { kind: "read", var: suspenseVarId(boundaryId) },
      { kind: "lit", value: "ready" },
    ],
  };
}

export function suspenseSuspendedGuard(boundaryId: string): ExprIR {
  return {
    kind: "eq",
    args: [
      { kind: "read", var: suspenseVarId(boundaryId) },
      { kind: "lit", value: "suspended" },
    ],
  };
}

export function boundaryIdForComponent(
  component: string,
  index: number,
): string {
  return `${component}#${index}`;
}

export function gateTransitionForBoundary(
  transition: Transition,
  boundaryId: string,
  suspendedFallback = false,
): Transition {
  const guard = suspendedFallback
    ? suspenseSuspendedGuard(boundaryId)
    : suspenseReadyGuard(boundaryId);
  return {
    ...transition,
    guard: andGuard(transition.guard, guard),
    reads: [...new Set([...transition.reads, suspenseVarId(boundaryId)])],
  };
}

export function transitionsFromSuspendingUse(
  source: ts.SourceFile,
  fileName: string,
  node: ts.CallExpression,
  component: string,
  boundaryId: string,
): Transition[] {
  if (!isUseCall(node)) return [];
  const op = `suspense:${boundaryId}`;
  const baseId = `${component}.use.${boundaryId}`;
  const varId = suspenseVarId(boundaryId);
  const sourceAnchor = [{ file: fileName, ...lineAndColumn(source, node) }];
  return [
    {
      id: `${baseId}.suspend`,
      cls: "internal",
      label: { kind: "internal", text: `${baseId}.suspend` },
      source: sourceAnchor,
      guard: { kind: "lit", value: true },
      effect: {
        kind: "seq",
        effects: [
          {
            kind: "assign",
            var: varId,
            expr: { kind: "lit", value: "suspended" },
          },
          {
            kind: "enqueue",
            op,
            continuation: `${baseId}.ready`,
            args: {},
          },
        ],
      },
      reads: [],
      writes: [varId, "sys:pending"],
      confidence: "exact",
    },
    {
      id: `${baseId}.success`,
      cls: "env",
      label: { kind: "resolve", op, outcome: "success" },
      source: sourceAnchor,
      guard: pendingIs(op),
      effect: {
        kind: "seq",
        effects: [
          { kind: "dequeue", index: 0 },
          { kind: "assign", var: varId, expr: { kind: "lit", value: "ready" } },
        ],
      },
      reads: ["sys:pending"],
      writes: [varId, "sys:pending"],
      confidence: "exact",
    },
  ];
}

export function discoverComponentRenderBoundaries(
  source: ts.SourceFile,
  components: ReadonlyMap<string, unknown>,
): Map<string, string> {
  const renderBoundaries = new Map<string, string>();
  let boundaryCounter = 0;
  const visit = (
    node: ts.Node,
    componentName: string | undefined,
    activeBoundary: string | undefined,
  ): void => {
    const nextComponent = componentNameFor(node) ?? componentName;
    if (isSuspenseElement(node)) {
      const boundaryId = boundaryIdForComponent(
        nextComponent ?? "Anonymous",
        boundaryCounter,
      );
      boundaryCounter += 1;
      ts.forEachChild(node, (child) => visit(child, nextComponent, boundaryId));
      return;
    }
    const tag = jsxElementTag(node);
    if (tag && activeBoundary && components.has(tag)) {
      renderBoundaries.set(tag, activeBoundary);
    }
    ts.forEachChild(node, (child) =>
      visit(child, nextComponent, activeBoundary),
    );
  };
  visit(source, undefined, undefined);
  return renderBoundaries;
}

function jsxElementTag(node: ts.Node): string | undefined {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    return ts.isIdentifier(node.tagName) ? node.tagName.text : undefined;
  }
  return undefined;
}

export function suspenseInitialForBoundary(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): "ready" | "suspended" {
  let suspended = false;
  const visit = (child: ts.Node): void => {
    if (suspended) return;
    if (ts.isCallExpression(child) && isUseCall(child)) {
      suspended = true;
      return;
    }
    if (isReactLazyCall(child as ts.Expression)) {
      suspended = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  if (ts.isJsxElement(node)) {
    for (const child of node.children) visit(child);
  }
  return suspended ? "suspended" : "ready";
}

export function gateUserTransitionForBoundary(
  transition: Transition,
  boundaryId: string | undefined,
): Transition {
  if (!boundaryId || transition.cls !== "user") return transition;
  return gateTransitionForBoundary(transition, boundaryId);
}

export function isInsideSuspenseBoundary(
  node: ts.Node,
  boundaries: readonly string[],
): string | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (isSuspenseElement(current)) {
      const index = boundaries.length;
      return boundaryIdForComponent("Suspense", index);
    }
    current = current.parent;
  }
  return boundaries.at(-1);
}
