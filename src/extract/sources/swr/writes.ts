import type { WriteChannel } from "modality-ts/extract/engine/spi";
import * as ts from "typescript";
import { keyFromExpression, swrIdFromKey, useSwrImportNames } from "./discover.js";
import { swrVarId } from "./template.js";

export function discoverSwrReadChannels(
  sourceText: string,
  fileName = "App.tsx",
): WriteChannel[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const useSwrNames = useSwrImportNames(source);
  const channels: WriteChannel[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      useSwrNames.has(node.initializer.expression.text)
    ) {
      const key = keyFromExpression(node.initializer.arguments[0]);
      if (key) {
        const id = swrIdFromKey(key.id);
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

function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}
