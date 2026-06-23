import * as ts from "typescript";

function componentNameFor(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    /^[A-Z]/.test(node.name.text)
  ) {
    return node.name.text;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    /^[A-Z]/.test(node.name.text)
  ) {
    return node.name.text;
  }
  return undefined;
}

function isUseStateCall(node: ts.Expression): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "useState"
  );
}

export function collectNumericSeedVarIds(
  sourceText: string,
  fileName = "App.tsx",
): ReadonlySet<string> {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const ids = new Set<string>();
  const visit = (node: ts.Node, componentName: string | undefined): void => {
    const component = componentNameFor(node) ?? componentName;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      isUseStateCall(node.initializer)
    ) {
      const stateName = node.name.elements[0];
      if (ts.isBindingElement(stateName) && ts.isIdentifier(stateName.name)) {
        const call = node.initializer;
        if (
          !call.typeArguments?.[0] &&
          call.arguments[0] &&
          ts.isNumericLiteral(call.arguments[0])
        ) {
          const componentId = component ?? "Anonymous";
          ids.add(`local:${componentId}.${stateName.name.text}`);
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, component));
  };
  visit(source, undefined);
  return ids;
}
