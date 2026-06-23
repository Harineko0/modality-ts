import * as ts from "typescript";
import { componentNameFor } from "../../../engine/ts/ast.js";
import { providerStoreScope } from "./ids.js";
import type { resolveJotaiImports } from "./imports.js";

export function providerScopeFromJsx(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  imports: ReturnType<typeof resolveJotaiImports>,
  source: ts.SourceFile,
): string | undefined {
  const tag = jsxTagName(node);
  if (!tag) return undefined;
  const isProvider =
    tag === imports.providerTag ||
    tag === "Provider" ||
    tag.endsWith(".Provider");
  if (!isProvider) return undefined;
  const attrs = jsxAttributes(node);
  const storeAttr = attrs.get("store");
  if (!storeAttr) {
    const component = enclosingComponentName(node, source);
    return component ? providerStoreScope(component) : "provider:anonymous";
  }
  if (ts.isJsxExpression(storeAttr) && storeAttr.expression) {
    if (ts.isIdentifier(storeAttr.expression)) {
      return storeAttr.expression.text;
    }
    return undefined;
  }
  return undefined;
}

function jsxTagName(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): string | undefined {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return node.openingElement.tagName.getText();
}

function jsxAttributes(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): Map<string, ts.JsxAttributeValue | undefined> {
  const attrs = new Map<string, ts.JsxAttributeValue | undefined>();
  const opening = ts.isJsxSelfClosingElement(node) ? node : node.openingElement;
  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
    attrs.set(attr.name.text, attr.initializer);
  }
  return attrs;
}

function enclosingComponentName(
  node: ts.Node,
  _source: ts.SourceFile,
): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    const name = componentNameFor(current);
    if (name) return name;
    current = current.parent;
  }
  return undefined;
}
