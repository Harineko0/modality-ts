import type { WriteChannel } from "modality-ts/extract/engine/spi";
import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { semanticSourceFileFor } from "../../../lang/ts/driver/semantic-source-file.js";
import {
  keyFromExpression,
  swrInstanceId,
  swrInstanceNamingContext,
  useSwrImportNames,
} from "./discover.js";
import { swrVarId } from "./template.js";

export function discoverSwrReadChannels(
  sourceText: string,
  fileName = "App.tsx",
  types?: SemanticTypeContext,
): WriteChannel[] {
  const source = semanticSourceFileFor(
    sourceText,
    fileName,
    types,
    ts.ScriptKind.TSX,
  );
  const useSwrNames = useSwrImportNames(source, types);
  const swrNamingContext = swrInstanceNamingContext(source, useSwrNames);
  const channels: WriteChannel[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      (useSwrNames.has(node.initializer.expression.text) ||
        isCustomSwrHookName(node.initializer.expression.text))
    ) {
      const key = keyFromExpression(node.initializer.arguments[0]);
      const id = useSwrNames.has(node.initializer.expression.text)
        ? key
          ? swrInstanceId(node.initializer, swrNamingContext, key.id)
          : undefined
        : node.initializer.expression.text;
      if (id) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const property =
            element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : element.name.text;
          if (
            property === "data" ||
            property === "isValidating" ||
            property === "error"
          ) {
            channels.push({
              id: `swr:${id}.${property}.read`,
              varId: swrVarId(id, property === "data" ? "data" : property),
              symbolName: element.name.text,
              source: { file: fileName, ...lineAndColumn(source, node) },
            });
          }
          if (property === "mutate") {
            channels.push({
              id: `swr:${id}.mutate`,
              varId: swrVarId(id, "data"),
              symbolName: element.name.text,
              source: { file: fileName, ...lineAndColumn(source, node) },
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return channels;
}

function isCustomSwrHookName(name: string): boolean {
  return /^use[A-Z0-9]/u.test(name);
}

function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}
