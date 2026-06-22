import * as ts from "typescript";

export interface NodeRef {
  readonly file: string;
  readonly start: number;
  readonly end: number;
}

export function nodeRefFor(
  node: ts.Node,
  fileName: string,
  sourceFile?: ts.SourceFile,
): NodeRef {
  return {
    file: fileName,
    start: sourceFile ? node.getStart(sourceFile) : node.getStart(),
    end: node.getEnd(),
  };
}

export function findNodeAt(
  source: ts.SourceFile,
  ref: NodeRef,
): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const start = node.getStart(source);
    if (start === ref.start && node.getEnd() === ref.end) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
