import * as ts from "typescript";
import type { AbstractDomain, SourceAnchor } from "modality-ts/core";
import type {
  FrameworkCtx,
  RenderBoundary,
} from "modality-ts/extract/engine/spi";
import { resolveImportedName } from "modality-ts/extract/engine/spi";

function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}

export const SUSPENSE_DOMAIN: AbstractDomain = {
  kind: "enum",
  values: ["ready", "suspended"],
};

function sourceAnchorFor(
  node: ts.Node,
  ctx: FrameworkCtx,
): SourceAnchor {
  const source = ctx.sourceFile;
  const fileName = ctx.fileName ?? source?.fileName ?? "unknown";
  if (source) {
    return { file: fileName, ...lineAndColumn(source, node) };
  }
  return { file: fileName };
}

export function isReactSuspenseElement(
  node: ts.Node,
  _ctx: FrameworkCtx,
): node is ts.JsxElement | ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  if (ts.isJsxElement(node)) {
    const tag = node.openingElement.tagName;
    return ts.isIdentifier(tag) && tag.text === "Suspense";
  }
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
    return false;
  const tag = node.tagName;
  return ts.isIdentifier(tag) && tag.text === "Suspense";
}

export function isReactLazyCall(
  node: ts.Expression,
  _ctx: FrameworkCtx,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "React" &&
    node.expression.name.text === "lazy"
  );
}

export function isReactUseCall(
  node: ts.Expression,
  ctx: FrameworkCtx,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    resolveImportedName(node.expression, ctx) === "use"
  );
}

export function recognizeReactRenderBoundary(
  node: ts.Node,
  ctx: FrameworkCtx,
): RenderBoundary | undefined {
  if (isReactSuspenseElement(node, ctx)) {
    return {
      kind: "suspense",
      domain: SUSPENSE_DOMAIN,
      origin: sourceAnchorFor(node, ctx),
    };
  }
  if (ts.isCallExpression(node) && isReactLazyCall(node, ctx)) {
    return {
      kind: "lazy",
      origin: sourceAnchorFor(node, ctx),
    };
  }
  if (ts.isCallExpression(node) && isReactUseCall(node, ctx)) {
    return {
      kind: "use",
      origin: sourceAnchorFor(node, ctx),
    };
  }
  return undefined;
}
