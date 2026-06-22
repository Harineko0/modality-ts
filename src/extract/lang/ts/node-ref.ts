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
  const source = sourceFile ?? node.getSourceFile();
  return {
    file: fileName,
    start: node.getStart(source),
    end: node.getEnd(),
  };
}

export function findNodeAt(
  source: ts.SourceFile,
  ref: NodeRef,
): ts.Node | undefined {
  let found: ts.Node | undefined;
  let startMatch: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const start = node.getStart(source);
    const end = node.getEnd();
    if (start === ref.start && end === ref.end) {
      found = node;
      return;
    }
    if (
      start === ref.start &&
      (!startMatch ||
        end - start < startMatch.getEnd() - startMatch.getStart(source))
    )
      startMatch = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found ?? startMatch;
}
