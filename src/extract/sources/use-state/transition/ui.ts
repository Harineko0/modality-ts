import * as ts from "typescript";
import { isPropertyAccessLike } from "../../../engine/ts/ast.js";
import type { Locator, Transition } from "modality-ts/core";

export function isEventAttribute(name: string): boolean {
  return (
    name === "onClick" ||
    name === "onSubmit" ||
    name === "onChange" ||
    name === "onInput"
  );
}

export function labelForEvent(
  name: string,
  locator?: Locator,
): Transition["label"] {
  if (name === "onSubmit")
    return { kind: "submit", ...(locator ? { locator } : {}) };
  if (name === "onChange" || name === "onInput")
    return {
      kind: "input",
      valueClass: "literal",
      ...(locator ? { locator } : {}),
    };
  return { kind: "click", ...(locator ? { locator } : {}) };
}

export function locatorForEventAttribute(
  attribute: ts.JsxAttribute,
): Locator | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const testId = stringAttribute(attrs, "data-testid");
  if (testId) return { kind: "testId", value: testId };
  const element = attrs.parent;
  const role = stringAttribute(attrs, "role") ?? inferredRole(element);
  if (!role) return undefined;
  const name =
    stringAttribute(attrs, "aria-label") ?? simpleElementText(element);
  return name ? { kind: "role", role, name } : { kind: "role", role };
}

export function stringAttribute(
  attrs: ts.JsxAttributes,
  name: string,
): string | undefined {
  const attr = attrs.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name,
  );
  if (!attr?.initializer || !ts.isStringLiteral(attr.initializer))
    return undefined;
  return attr.initializer.text;
}

export function inferredRole(node: ts.Node): string | undefined {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
    return undefined;
  const tag = node.tagName.getText();
  if (tag === "button") return "button";
  if (tag === "form") return "form";
  if (
    tag === "input" &&
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
  ) {
    const type = stringAttribute(node.attributes, "type");
    if (type === "radio") return "radio";
    if (type === "checkbox") return "checkbox";
    return "textbox";
  }
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  return undefined;
}

export function simpleElementText(node: ts.Node): string | undefined {
  if (!ts.isJsxOpeningElement(node) || !ts.isJsxElement(node.parent))
    return undefined;
  const text = node.parent.children
    .filter(ts.isJsxText)
    .map((child) => child.getText().replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return text || undefined;
}

export function isEventTargetValue(
  node: ts.Expression,
  parameter: ts.ParameterDeclaration | undefined,
): boolean {
  if (!parameter || !ts.isIdentifier(parameter.name)) return false;
  const path = propertyAccessPath(node);
  if (!path) return false;
  return (
    path.length === 3 &&
    path[0] === parameter.name.text &&
    (path[1] === "target" || path[1] === "currentTarget") &&
    path[2] === "value"
  );
}

export function isInputValueExpression(
  node: ts.Expression,
  parameter: ts.ParameterDeclaration | undefined,
): boolean {
  if (isEventTargetValue(node, parameter)) return true;
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === "Number" || node.expression.text === "String")
  ) {
    return (
      node.arguments.length === 1 &&
      isInputValueExpression(node.arguments[0], parameter)
    );
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    (node.expression.name.text === "trim" ||
      node.expression.name.text === "toLowerCase")
  ) {
    return (
      node.arguments.length === 0 &&
      isInputValueExpression(node.expression.expression, parameter)
    );
  }
  return false;
}

export function propertyAccessPath(node: ts.Expression): string[] | undefined {
  if (ts.isIdentifier(node)) return [node.text];
  if (isPropertyAccessLike(node)) {
    const base = propertyAccessPath(node.expression);
    return base ? [...base, node.name.text] : undefined;
  }
  return undefined;
}
