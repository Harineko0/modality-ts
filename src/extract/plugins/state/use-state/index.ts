import type { SourceAnchor, StateVarDecl } from "modality-ts/core";
import type {
  SourceDecl,
  StateSourcePlugin,
  TypePlugin,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import { createStateSourcePlugin } from "modality-ts/extract/plugins";
import * as ts from "typescript";
import {
  compilerBackedTypeAliases,
  inferUseStateDomainSemanticDetailed,
  initialValueForUseState,
  useStateCallForSemanticInference,
} from "../../../lang/ts/driver/domains.js";
import type {
  ChannelCtxWithTypes,
  DiscoverCtxWithTypes,
} from "../../../lang/ts/driver/plugin-context.js";
import { routeMountScope } from "../../../lang/ts/driver/routes.js";
import { decodeUseStateBinding } from "./decode-binding.js";
import * as harness from "./harness.js";

export function useStateSource(): StateSourcePlugin {
  return createStateSourcePlugin({
    id: "use-state",
    version: "0.1.0",
    packageNames: ["react"],
    discover: (ctx) => {
      const typed = ctx as DiscoverCtxWithTypes;
      return discoverUseState(
        ctx.sourceText,
        ctx.fileName,
        ctx.route,
        typed.types,
        ctx.typePlugins,
      );
    },
    writeChannels: (ctx) => {
      const typed = ctx as ChannelCtxWithTypes;
      return discoverUseStateWriteChannels(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
      );
    },
    decodeBinding: decodeUseStateBinding,
    isLocalStateSource: true,
    isComponentScopedVarId: (varId, component) =>
      varId.startsWith(`local:${component}.`),
    harness,
    conformance: {
      testedVersions: "react>=18",
    },
  });
}

export default useStateSource;

function sourceFileForDiscovery(
  sourceText: string,
  fileName: string,
  types?: SemanticTypeContext,
): ts.SourceFile {
  if (
    types?.sourceFile &&
    types.sourceFile.fileName === fileName &&
    types.sourceFile.text === sourceText
  ) {
    return types.sourceFile;
  }
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function discoverUseState(
  sourceText: string,
  fileName = "App.tsx",
  route = "/",
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): SourceDecl[] {
  const source = sourceFileForDiscovery(sourceText, fileName, types);
  const typeAliases = compilerBackedTypeAliases(source, types);
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
        const varId = `local:${componentId}.${stateName.name.text}`;
        const callForInference = useStateCallForSemanticInference(
          node.initializer,
          source,
          types,
          varId,
        );
        const domain = inferUseStateDomainSemanticDetailed(
          callForInference,
          typeAliases,
          source,
          varId,
          types,
          typePlugins ?? [],
        ).domain;
        const origin = { file: fileName, ...lineAndColumn(source, node) };
        const variable: StateVarDecl = {
          id: varId,
          domain,
          origin,
          scope: providerComponents.has(componentId)
            ? { kind: "global" }
            : routeMountScope(route),
          initial: initialValueForUseState(
            callForInference,
            domain,
            source,
            varId,
          ),
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
              ? {
                  setterName: setterName.name.text,
                  ...(types?.localSymbolKey?.(setterName.name)
                    ? { setterSymbolKey: types.localSymbolKey(setterName.name) }
                    : {}),
                }
              : {}),
            ...(isNumericSeedUseState(node.initializer)
              ? { numericSeed: true }
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
  types?: SemanticTypeContext,
): WriteChannel[] {
  return discoverUseState(sourceText, fileName, "/", types).flatMap((decl) => {
    const setterName = decl.metadata?.setterName;
    if (typeof setterName !== "string" || !decl.var) return [];
    return [
      {
        id: `${decl.id}.setter`,
        varId: decl.var.id,
        symbolName: setterName,
        ...(typeof decl.metadata?.setterSymbolKey === "string"
          ? { symbolKey: decl.metadata.setterSymbolKey }
          : {}),
        source: decl.origin as SourceAnchor,
      },
    ];
  });
}

function isNumericSeedUseState(call: ts.CallExpression): boolean {
  return (
    !call.typeArguments?.[0] &&
    call.arguments[0] !== undefined &&
    ts.isNumericLiteral(call.arguments[0])
  );
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
