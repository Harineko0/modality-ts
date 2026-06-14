import * as ts from "typescript";
import type {
  StateSourcePlugin,
  SourceDecl,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import {
  firstValue,
  inferDomainFromTypeNode,
  typeAliasDeclarations,
} from "modality-ts/extract/engine/spi";
import {
  validateValue,
  type AbstractDomain,
  type SourceAnchor,
  type StateVarDecl,
  type Value,
} from "modality-ts/core";
import * as harness from "./harness.js";

export function useStateSource(): StateSourcePlugin {
  return {
    id: "use-state",
    version: "0.1.0",
    packageNames: ["react"],
    discover: (ctx) =>
      discoverUseState(ctx.sourceText, ctx.fileName, ctx.route),
    writeChannels: (ctx) =>
      discoverUseStateWriteChannels(ctx.sourceText, ctx.fileName),
    harness,
    conformance: {
      testedVersions: "react>=18",
    },
  };
}

export default useStateSource;

function discoverUseState(
  sourceText: string,
  fileName = "App.tsx",
  route = "/",
): SourceDecl[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const typeAliases = typeAliasDeclarations(source);
  const providerComponents = providerComponentNames(source);
  const decls: SourceDecl[] = [];
  const visit = (node: ts.Node, componentName: string | undefined): void => {
    const component = componentNameFor(node) ?? componentName;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      isUseStateCall(node.initializer)
    ) {
      const stateName = node.name.elements[0];
      const setterName = node.name.elements[1];
      if (ts.isBindingElement(stateName) && ts.isIdentifier(stateName.name)) {
        const componentId = component ?? "Anonymous";
        const domain = inferUseStateDomain(node.initializer, typeAliases);
        const varId = `local:${componentId}.${stateName.name.text}`;
        const origin = { file: fileName, ...lineAndColumn(source, node) };
        const variable: StateVarDecl = {
          id: varId,
          domain,
          origin,
          scope: providerComponents.has(componentId)
            ? { kind: "global" }
            : { kind: "route-local", route },
          initial: initialValueForUseState(node.initializer, domain),
        };
        decls.push({
          id: varId,
          kind: "useState",
          var: variable,
          origin,
          metadata: {
            component: componentId,
            stateName: stateName.name.text,
            ...(setterName &&
            ts.isBindingElement(setterName) &&
            ts.isIdentifier(setterName.name)
              ? { setterName: setterName.name.text }
              : {}),
          },
        });
      }
    }
    ts.forEachChild(node, (child) => visit(child, component));
  };
  visit(source, undefined);
  return decls;
}

function discoverUseStateWriteChannels(
  sourceText: string,
  fileName = "App.tsx",
): WriteChannel[] {
  return discoverUseState(sourceText, fileName, "/").flatMap((decl) => {
    const setterName = decl.metadata?.setterName;
    if (typeof setterName !== "string" || !decl.var) return [];
    return [
      {
        id: `${decl.id}.setter`,
        varId: decl.var.id,
        symbolName: setterName,
        source: decl.origin as SourceAnchor,
      },
    ];
  });
}

function inferUseStateDomain(
  call: ts.CallExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
): AbstractDomain {
  const typeArg = call.typeArguments?.[0];
  if (typeArg) return inferDomainFromTypeNode(typeArg, typeAliases);
  const initial = call.arguments[0];
  if (!initial) return { kind: "tokens", count: 1 };
  if (
    initial.kind === ts.SyntaxKind.TrueKeyword ||
    initial.kind === ts.SyntaxKind.FalseKeyword
  )
    return { kind: "bool" };
  if (ts.isStringLiteral(initial))
    return { kind: "enum", values: [initial.text] };
  if (ts.isNumericLiteral(initial))
    return {
      kind: "boundedInt",
      min: Number(initial.text),
      max: Number(initial.text),
    };
  if (initial.kind === ts.SyntaxKind.NullKeyword)
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  if (ts.isArrayLiteralExpression(initial)) return { kind: "lengthCat" };
  return { kind: "tokens", count: 1 };
}

function initialValueForUseState(
  call: ts.CallExpression,
  domain: AbstractDomain,
): Value {
  const initial = call.arguments[0];
  if (!initial) return firstValue(domain);
  if (initial.kind === ts.SyntaxKind.TrueKeyword)
    return validInitialOrFirst(domain, true);
  if (initial.kind === ts.SyntaxKind.FalseKeyword)
    return validInitialOrFirst(domain, false);
  if (ts.isStringLiteral(initial))
    return validInitialOrFirst(domain, initial.text);
  if (ts.isNumericLiteral(initial))
    return validInitialOrFirst(domain, Number(initial.text));
  if (initial.kind === ts.SyntaxKind.NullKeyword)
    return validInitialOrFirst(domain, null);
  if (ts.isArrayLiteralExpression(initial))
    return validInitialOrFirst(
      domain,
      initial.elements.length === 0
        ? "0"
        : initial.elements.length === 1
          ? "1"
          : "many",
    );
  return firstValue(domain);
}

function validInitialOrFirst(domain: AbstractDomain, value: Value): Value {
  return validateValue(domain, value) ? value : firstValue(domain);
}

function isUseStateCall(node: ts.Expression): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "useState"
  );
}

function componentNameFor(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    startsUppercase(node.name.text)
  )
    return node.name.text;
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    startsUppercase(node.name.text)
  )
    return node.name.text;
  return undefined;
}

function providerComponentNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const name = componentNameFor(node);
    if (name && node.getText(source).includes(".Provider")) names.add(name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function startsUppercase(value: string): boolean {
  return /^[A-Z]/.test(value);
}

function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}
