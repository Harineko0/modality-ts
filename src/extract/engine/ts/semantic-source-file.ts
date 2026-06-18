import * as ts from "typescript";
import type { SemanticTypeContext } from "../spi/index.js";

export function semanticSourceFileFor(
  sourceText: string,
  fileName: string,
  types?: SemanticTypeContext,
  scriptKind: ts.ScriptKind = ts.ScriptKind.TSX,
): ts.SourceFile {
  const programSource = types?.getSourceFile?.(fileName);
  if (programSource) return programSource;
  if (types?.sourceFile && types.sourceFile.fileName === fileName) {
    return types.sourceFile;
  }
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}
