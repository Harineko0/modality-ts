import * as ts from "typescript";
import type {
  AbstractDomain,
  ExtractionCaveat,
  NumericReduction,
  SourceAnchor,
} from "modality-ts/core";
import { resolveArktypeNumericSchema } from "./adapters/arktype.js";
import { resolveZodNumericSchema } from "./adapters/zod.js";
import { resolveNativeNumericAlias } from "./native-aliases.js";

export type { NumericReduction };

export interface NumericDomainResolution {
  domain?: AbstractDomain;
  caveats: ExtractionCaveat[];
  reductions?: NumericReduction[];
}

export interface NumericDomainResolverContext {
  typeNode?: ts.TypeNode;
  initializer?: ts.Expression;
  declaration?: ts.VariableDeclaration;
  sourceFile?: ts.SourceFile;
  typeAliases: ReadonlyMap<string, ts.TypeNode>;
  visited: ReadonlySet<string>;
  varId?: string;
}

export type NumericDomainResolver = (
  ctx: NumericDomainResolverContext,
) => NumericDomainResolution | undefined;

const resolvers: readonly NumericDomainResolver[] = [
  resolveNativeNumericAlias,
  resolveZodNumericSchema,
  resolveArktypeNumericSchema,
];

export function resolveNumericDomain(
  ctx: NumericDomainResolverContext,
): NumericDomainResolution {
  for (const resolver of resolvers) {
    const result = resolver(ctx);
    if (result?.domain !== undefined || result?.caveats.length) return result;
  }
  return { caveats: [] };
}

export function emptyNumericResolution(): NumericDomainResolution {
  return { caveats: [] };
}

export function numericLiteralFromTypeNode(
  node: ts.TypeNode | undefined,
): number | undefined {
  if (!node) return undefined;
  if (ts.isLiteralTypeNode(node) && ts.isNumericLiteral(node.literal))
    return Number(node.literal.text);
  return undefined;
}

export function sourceAnchorFromNode(
  node: ts.Node,
  sourceFile?: ts.SourceFile,
): SourceAnchor | undefined {
  if (!sourceFile) return undefined;
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { file: sourceFile.fileName, line: line + 1, column: character + 1 };
}
