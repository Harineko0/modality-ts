import type * as ts from "typescript";
import type { SemanticTypeContext } from "../../lang/ts/semantic-type-context.js";
import type { FrameworkPlugin } from "../spi/framework.js";
import type { ExtractableHandler } from "./ast.js";

export interface TsUnwrapHandlerCtx {
  sourceFile: ts.SourceFile;
  fileName: string;
  types?: SemanticTypeContext;
}

export type TsExtractableHandler = ExtractableHandler;

/** Engine-local framework plugin facet for TypeScript handler unwrapping. */
export interface EngineFrameworkPlugin extends FrameworkPlugin {
  unwrapTsHandler?(
    node: ts.Expression,
    ctx: TsUnwrapHandlerCtx,
  ): TsExtractableHandler | undefined;
}

export function extendFrameworkWithTsUnwrap(
  plugin: FrameworkPlugin,
  unwrapTsHandler: NonNullable<EngineFrameworkPlugin["unwrapTsHandler"]>,
): EngineFrameworkPlugin {
  return { ...plugin, unwrapTsHandler };
}

export function engineFrameworkPlugin(
  plugin: FrameworkPlugin,
): EngineFrameworkPlugin {
  return plugin as EngineFrameworkPlugin;
}
