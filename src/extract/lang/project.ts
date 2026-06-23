import type { SemanticTypeContext } from "./type-context.js";

export interface LanguageSourceFile {
  readonly text: string;
}

export interface LanguageProject {
  readonly sourceFiles: ReadonlyMap<string, LanguageSourceFile>;
  getSourceFile?(fileName: string): LanguageSourceFile | undefined;
  typeContextForFile?(fileName: string): SemanticTypeContext | undefined;
}
