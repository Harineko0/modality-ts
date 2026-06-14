import * as ts from "typescript";
import type { WriteChannel } from "modality-ts/extract/engine/spi";
import type { SourceAnchor } from "modality-ts/core";

export function discoverJotaiSafetyWarnings(
  sourceText: string,
  fileName = "state.ts",
): { message: string; source?: SourceAnchor }[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const warnings: { message: string; source?: SourceAnchor }[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !isJotaiModule(statement.moduleSpecifier)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported !== "getDefaultStore") continue;
      warnings.push({
        message: "Global taint jotai:getDefaultStore",
        source: { file: fileName, ...lineAndColumn(source, specifier) },
      });
    }
  }
  return warnings;
}

export function discoverJotaiWriteChannels(
  sourceText: string,
  fileName = "state.ts",
): WriteChannel[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const setters = setAtomImportNames(source);
  const defaultStoreGetters = getDefaultStoreImportNames(source);
  if (
    setters.useAtom.size === 0 &&
    setters.useSetAtom.size === 0 &&
    defaultStoreGetters.size === 0
  )
    return [];

  const channels: WriteChannel[] = [];
  const defaultStoreNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isGetDefaultStoreCall(node.initializer, defaultStoreGetters)
    ) {
      defaultStoreNames.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      isUseAtomLikeCall(node.initializer, setters.useAtom)
    ) {
      const atomArg = node.initializer.arguments[0];
      const reader = node.name.elements[0];
      const setter = node.name.elements.at(-1);
      if (
        atomArg &&
        ts.isIdentifier(atomArg) &&
        reader &&
        ts.isBindingElement(reader) &&
        ts.isIdentifier(reader.name)
      ) {
        channels.push({
          id: `atom:${atomArg.text}.read`,
          varId: `atom:${atomArg.text}`,
          symbolName: reader.name.text,
          source: {
            file: fileName,
            ...lineAndColumn(source, node),
          } satisfies SourceAnchor,
        });
      }
      if (
        atomArg &&
        ts.isIdentifier(atomArg) &&
        setter &&
        ts.isBindingElement(setter) &&
        ts.isIdentifier(setter.name)
      ) {
        channels.push({
          id: `atom:${atomArg.text}.setter`,
          varId: `atom:${atomArg.text}`,
          symbolName: setter.name.text,
          source: {
            file: fileName,
            ...lineAndColumn(source, node),
          } satisfies SourceAnchor,
        });
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isUseAtomLikeCall(node.initializer, setters.useSetAtom)
    ) {
      const atomArg = node.initializer.arguments[0];
      if (atomArg && ts.isIdentifier(atomArg)) {
        channels.push({
          id: `atom:${atomArg.text}.setter`,
          varId: `atom:${atomArg.text}`,
          symbolName: node.name.text,
          source: {
            file: fileName,
            ...lineAndColumn(source, node),
          } satisfies SourceAnchor,
        });
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "set" &&
      ts.isIdentifier(node.expression.expression) &&
      defaultStoreNames.has(node.expression.expression.text)
    ) {
      const atomArg = node.arguments[0];
      if (atomArg && ts.isIdentifier(atomArg)) {
        channels.push({
          id: `atom:${atomArg.text}.store-set`,
          varId: `atom:${atomArg.text}`,
          symbolName: `${node.expression.expression.text}.set:${atomArg.text}`,
          source: {
            file: fileName,
            ...lineAndColumn(source, node),
          } satisfies SourceAnchor,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return channels;
}

function getDefaultStoreImportNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !isJotaiModule(statement.moduleSpecifier)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === "getDefaultStore") names.add(specifier.name.text);
    }
  }
  return names;
}

function setAtomImportNames(source: ts.SourceFile): {
  useAtom: Set<string>;
  useSetAtom: Set<string>;
} {
  const useAtom = new Set<string>();
  const useSetAtom = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !isJotaiModule(statement.moduleSpecifier)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === "useAtom") useAtom.add(specifier.name.text);
      if (imported === "useSetAtom") useSetAtom.add(specifier.name.text);
    }
  }
  return { useAtom, useSetAtom };
}

function isJotaiModule(moduleSpecifier: ts.Expression): boolean {
  return (
    ts.isStringLiteral(moduleSpecifier) && moduleSpecifier.text === "jotai"
  );
}

function isUseAtomLikeCall(
  node: ts.Expression,
  names: Set<string>,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    names.has(node.expression.text)
  );
}

function isGetDefaultStoreCall(
  node: ts.Expression,
  names: Set<string>,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    names.has(node.expression.text)
  );
}

function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}
