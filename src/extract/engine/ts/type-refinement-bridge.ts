import * as ts from "typescript";
import { lowerExpr } from "../../lang/ts/lower.js";
import { type NodeRef, nodeRefFor } from "../../lang/ts/node-ref.js";
import {
  createTsOriginReader,
  type TsOriginReader,
} from "../../lang/ts/origin-reader.js";
import type { SurfaceExpr } from "../../lang/ts/surface-ir.js";
import type { TypeRefinementContext } from "../spi/type-plugin.js";

export function typeRefinementContextFromTs(params: {
  typeNode?: ts.TypeNode;
  initializer?: ts.Expression;
  declaration?: ts.VariableDeclaration;
  sourceFile?: ts.SourceFile;
  typeAliases: ReadonlyMap<string, ts.TypeNode>;
  visited: ReadonlySet<string>;
  varId?: string;
  fileName?: string;
}): TypeRefinementContext {
  const fileName = params.fileName ?? params.sourceFile?.fileName ?? "";
  const originReader = createTsOriginReader({
    sourceFile: params.sourceFile,
    getSourceFile: (name) =>
      params.sourceFile && sameFileName(params.sourceFile.fileName, name)
        ? params.sourceFile
        : undefined,
  });
  const typeAliases = new Map<string, NodeRef>();
  for (const [name, node] of params.typeAliases) {
    typeAliases.set(name, nodeRefFor(node, fileName));
  }
  return {
    ...(params.typeNode
      ? { typeAnnotation: nodeRefFor(params.typeNode, fileName) }
      : {}),
    ...(params.initializer
      ? { initializer: lowerExpr(params.initializer, fileName) }
      : {}),
    ...(params.declaration
      ? { declaration: nodeRefFor(params.declaration, fileName) }
      : {}),
    fileName,
    originReader,
    typeAliases,
    visited: params.visited,
    ...(params.varId ? { varId: params.varId } : {}),
  };
}

export function tsNodeAt(
  ctx: TypeRefinementContext,
  ref: NodeRef,
): ts.Node | undefined {
  const node = ctx.originReader.nodeAt(ref);
  if (!node || typeof node !== "object" || !("kind" in node)) return undefined;
  return node as ts.Node;
}

export function surfaceExprOrigin(expr: SurfaceExpr): NodeRef | undefined {
  if (expr.kind === "literal" || expr.kind === "ref") return undefined;
  return expr.origin;
}

export function tsExpressionFromRefinementContext(
  ctx: TypeRefinementContext,
  expr?: SurfaceExpr,
): ts.Expression | undefined {
  if (!expr) return undefined;
  const origin = surfaceExprOrigin(expr);
  if (!origin) return undefined;
  const node = tsNodeAt(ctx, origin);
  return node && ts.isExpression(node) ? node : undefined;
}

export function tsTypeNodeFromRefinementContext(
  ctx: TypeRefinementContext,
): ts.TypeNode | undefined {
  if (!ctx.typeAnnotation) return undefined;
  const node = tsNodeAt(ctx, ctx.typeAnnotation);
  return node && ts.isTypeNode(node) ? node : undefined;
}

export function sourceFileFromRefinementContext(
  ctx: TypeRefinementContext,
): ts.SourceFile | undefined {
  const refs: (NodeRef | undefined)[] = [
    ctx.typeAnnotation,
    ctx.declaration,
    ctx.initializer ? surfaceExprOrigin(ctx.initializer) : undefined,
  ];
  for (const ref of refs) {
    if (!ref) continue;
    const node = tsNodeAt(ctx, ref);
    if (node) return node.getSourceFile();
  }
  if (!ctx.fileName) return undefined;
  const reader = ctx.originReader as TsOriginReader;
  return reader
    .nodeAt({ file: ctx.fileName, start: 0, end: 0 })
    ?.getSourceFile();
}

function sameFileName(left: string, right: string): boolean {
  return (
    left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
  );
}
