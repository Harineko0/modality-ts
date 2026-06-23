import * as ts from "typescript";

export function walkTs(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walkTs(child, visit));
}
