import * as ts from "typescript";

export function parseTsxSource(
  sourceText: string,
  fileName = "App.tsx",
): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
