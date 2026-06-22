import type * as ts from "typescript";

export interface ResolvedModuleName {
  fileName: string;
  sourceFile?: ts.SourceFile;
  isExternal: boolean;
}

/** TypeScript-only semantic typing service for L4 plugins and the TS language frontend. */
export interface SemanticTypeContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFile?: ts.SourceFile;
  getSourceFile(fileName: string): ts.SourceFile | undefined;
  canonicalFileName?(fileName: string): string;
  resolveModuleName?(
    specifier: string,
    containingFile: string,
  ): ResolvedModuleName | undefined;
  symbolAt?(node: ts.Node): ts.Symbol | undefined;
  aliasedSymbolAt?(node: ts.Node): ts.Symbol | undefined;
  symbolKey?(symbol: ts.Symbol): string;
  localSymbolKey?(node: ts.Node): string | undefined;
}
