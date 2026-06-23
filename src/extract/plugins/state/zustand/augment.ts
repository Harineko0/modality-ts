import * as ts from "typescript";
import { discoverZustandStoresDetailed } from "./discover.js";
import { isStoreCreatorCall, resolveZustandImports } from "./imports.js";

export function augmentZustandActionSelectorSource(
  sourceText: string,
  fileName = "App.tsx",
): string {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const discovery = discoverZustandStoresDetailed(sourceText, fileName);
  const storeHandles = new Set(discovery.storeNames);
  const actionsByStore = discovery.storeActions;
  const edits: { pos: number; end: number; text: string }[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      storeHandles.has(node.initializer.expression.text)
    ) {
      const selector = node.initializer.arguments[0];
      const field = selectorFieldName(selector);
      const storeName = node.initializer.expression.text;
      const actions = actionsByStore.get(storeName);
      if (field && actions?.has(field)) {
        const symbol = node.name.text;
        const refName = `__zustand_bind_${symbol}`;
        const statement = findVariableStatement(node);
        if (statement) {
          const replacement = `${refName} = ${node.initializer.getText(source)};\nconst ${symbol} = () => ${refName}()`;
          edits.push({
            pos: node.getStart(source),
            end: node.getEnd(),
            text: replacement,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (edits.length === 0) return sourceText;
  edits.sort((left, right) => right.pos - left.pos);
  let result = sourceText;
  for (const edit of edits) {
    result = result.slice(0, edit.pos) + edit.text + result.slice(edit.end);
  }
  return result;
}

function findVariableStatement(
  node: ts.VariableDeclaration,
): ts.VariableStatement | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isVariableStatement(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function selectorFieldName(
  selector: ts.Expression | undefined,
): string | undefined {
  if (
    !selector ||
    !(ts.isArrowFunction(selector) || ts.isFunctionExpression(selector)) ||
    !ts.isIdentifier(selector.parameters[0]?.name)
  ) {
    return undefined;
  }
  const param = selector.parameters[0].name.text;
  const body = selector.body;
  if (
    ts.isPropertyAccessExpression(body) &&
    ts.isIdentifier(body.expression) &&
    body.expression.text === param
  ) {
    return body.name.text;
  }
  return undefined;
}

export function registerStoreHandlesFromSource(
  source: ts.SourceFile,
  storeHandles: Set<string>,
): void {
  const imports = resolveZustandImports(source);
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isStoreCreatorCall(node.initializer, imports.storeCreators)
    ) {
      storeHandles.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
