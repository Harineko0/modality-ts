import type * as ts from "typescript";
import type { NodeRef } from "../node-ref.js";
import type { OriginReader } from "../origin-reader.js";
import { findNodeAt } from "./node-ref.js";

export type { OriginReader } from "../origin-reader.js";

export interface TsOriginReader extends OriginReader {
  nodeAt(ref: NodeRef): ts.Node | undefined;
}

export interface TsOriginReaderContext {
  sourceFile?: ts.SourceFile;
  getSourceFile?(fileName: string): ts.SourceFile | undefined;
}

function sameSourceFile(left: string, right: string): boolean {
  return (
    left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
  );
}

export function createTsOriginReader(
  ctx: TsOriginReaderContext,
): TsOriginReader {
  return {
    nodeAt(ref: NodeRef): ts.Node | undefined {
      const source =
        ctx.sourceFile && sameSourceFile(ctx.sourceFile.fileName, ref.file)
          ? ctx.sourceFile
          : ctx.getSourceFile?.(ref.file);
      if (!source) return undefined;
      return findNodeAt(source, ref);
    },
  };
}
