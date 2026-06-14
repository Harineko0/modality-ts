import * as ts from "typescript";
import type { SourceDecl } from "modality-ts/extract/engine/spi";
import type { StateVarDecl } from "modality-ts/core";
import {
  inferAtomDomain,
  initialValueForAtom,
  typeAliasDeclarations,
} from "./domains.js";

export function discoverJotaiAtoms(
  sourceText: string,
  fileName = "state.ts",
): SourceDecl[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const importedAtomNames = atomImportNames(source);
  if (importedAtomNames.size === 0) return [];
  const typeAliases = typeAliasDeclarations(source);

  const decls: SourceDecl[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isAtomCall(node.initializer, importedAtomNames)
    ) {
      const origin = { file: fileName, ...lineAndColumn(source, node) };
      const domain = inferAtomDomain(node.initializer, typeAliases);
      const variable: StateVarDecl = {
        id: `atom:${node.name.text}`,
        domain,
        origin,
        scope: { kind: "global" },
        initial: initialValueForAtom(node.initializer, domain),
      };
      decls.push({
        id: variable.id,
        kind: "jotai/atom",
        var: variable,
        origin,
        metadata: { atomName: node.name.text },
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return decls;
}

function atomImportNames(source: ts.SourceFile): Set<string> {
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
      if ((specifier.propertyName?.text ?? specifier.name.text) === "atom")
        names.add(specifier.name.text);
    }
  }
  return names;
}

function isJotaiModule(moduleSpecifier: ts.Expression): boolean {
  return (
    ts.isStringLiteral(moduleSpecifier) && moduleSpecifier.text === "jotai"
  );
}

function isAtomCall(
  node: ts.Expression,
  atomNames: Set<string>,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    atomNames.has(node.expression.text)
  );
}

function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}
