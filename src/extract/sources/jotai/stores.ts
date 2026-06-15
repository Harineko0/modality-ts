import * as ts from "typescript";
import { resolveJotaiImports } from "./imports.js";
import { providerScopeFromJsx } from "./jsx.js";

export function discoverComponentStoreScopes(
  source: ts.SourceFile,
  imports = resolveJotaiImports(source),
): Map<string, string> {
  const scopes = new Map<string, string>();
  const visit = (node: ts.Node, inheritedScope?: string): void => {
    let scope = inheritedScope;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const providerScope = providerScopeFromJsx(node, imports, source);
      if (providerScope) scope = providerScope;
      const childTag = jsxChildComponentName(node);
      if (childTag && scope) scopes.set(childTag, scope);
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  };
  visit(source, undefined);
  return scopes;
}

function jsxChildComponentName(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): string | undefined {
  if (ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText();
    return tag[0] === tag[0]?.toUpperCase() ? tag : undefined;
  }
  for (const child of node.children) {
    if (ts.isJsxSelfClosingElement(child)) {
      const tag = child.tagName.getText();
      if (tag[0] === tag[0]?.toUpperCase()) return tag;
    }
    if (ts.isJsxElement(child)) {
      const tag = child.openingElement.tagName.getText();
      if (tag[0] === tag[0]?.toUpperCase()) return tag;
    }
  }
  return undefined;
}
