import * as ts from "typescript";
import { isExtractableHandler } from "../../../engine/ts/ast.js";
import {
  componentName,
  handlerExpression,
  isForwardablePropName,
  isIntrinsicJsxAttribute,
} from "../../../engine/ts/components.js";
import type { Locator } from "modality-ts/core";
import type {
  ComponentDecl,
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "../types.js";
import { disabledGuardFor, type ParsedGuard } from "./guards.js";
import { isEventAttribute, locatorForEventAttribute } from "./ui.js";

export function componentPropTrigger(
  source: ts.SourceFile,
  component: ComponentDecl,
  propName: string,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
): { attr: string; locator?: Locator; guard?: ParsedGuard } | undefined {
  const localHandlers = componentLocalHandlers(component);
  let trigger:
    | { attr: string; locator?: Locator; guard?: ParsedGuard }
    | undefined;
  const visit = (node: ts.Node): void => {
    if (trigger) return;
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isEventAttribute(node.name.text) &&
      isIntrinsicJsxAttribute(node)
    ) {
      const expression = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : undefined;
      const handler = handlerExpression(expression, localHandlers);
      if (
        expression &&
        (expressionReferencesProp(expression, component, propName) ||
          (handler &&
            handlerCallsProp(handler, component, propName, localHandlers)))
      ) {
        trigger = {
          attr: node.name.text,
          locator: locatorForEventAttribute(node),
          guard: disabledGuardFor(
            node,
            setters,
            warnings,
            source,
            componentName(component) ?? "Anonymous",
          ),
        };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(component);
  return trigger;
}

export function transparentComponentPropTrigger(
  component: ComponentDecl,
  propName: string,
): { attr: string; locator?: Locator; guard?: ParsedGuard } | undefined {
  if (
    !isForwardablePropName(propName) ||
    !componentSpreadsPropsToElement(component)
  )
    return undefined;
  return { attr: propName };
}

export function componentSpreadsPropsToElement(
  component: ComponentDecl,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.attributes.properties.some(ts.isJsxSpreadAttribute)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(component);
  return found;
}

export function forwardsComponentProp(
  node: ts.JsxAttribute,
  handlers: Map<string, ExtractableHandler>,
  component: ComponentDecl | undefined,
): boolean {
  if (!component || !node.initializer) return false;
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
  if (expression && expressionReferencesForwardableProp(expression, component))
    return true;
  const localHandlers = componentLocalHandlers(component);
  const handler =
    handlerExpression(expression, handlers) ??
    handlerExpression(expression, localHandlers);
  return Boolean(
    handler && handlerCallsForwardableProp(handler, component, localHandlers),
  );
}

export function componentLocalHandlers(
  component: ComponentDecl,
): Map<string, ExtractableHandler> {
  const localHandlers = new Map<string, ExtractableHandler>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isExtractableHandler(node.initializer)
    ) {
      localHandlers.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(component);
  return localHandlers;
}

export function handlerCallsProp(
  handler: ExtractableHandler,
  component: ComponentDecl,
  propName: string,
  localHandlers: Map<string, ExtractableHandler>,
  seen = new Set<ExtractableHandler>(),
): boolean {
  if (seen.has(handler)) return false;
  seen.add(handler);
  const aliases = componentPropAliases(component, propName);
  const propObjects = componentPropObjectNames(component);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      if (callInvokesProp(node.expression, propName, aliases, propObjects)) {
        found = true;
        return;
      }
      if (ts.isIdentifier(node.expression)) {
        const local = localHandlers.get(node.expression.text);
        if (
          local &&
          handlerCallsProp(local, component, propName, localHandlers, seen)
        ) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(handler.body);
  return found;
}

export function handlerCallsForwardableProp(
  handler: ExtractableHandler,
  component: ComponentDecl,
  localHandlers: Map<string, ExtractableHandler>,
): boolean {
  return forwardableComponentPropNames(component).some((propName) =>
    handlerCallsProp(handler, component, propName, localHandlers),
  );
}

export function expressionReferencesForwardableProp(
  expression: ts.Expression,
  component: ComponentDecl,
): boolean {
  return forwardableComponentPropNames(component).some((propName) =>
    expressionReferencesProp(expression, component, propName),
  );
}

export function expressionReferencesProp(
  expression: ts.Expression,
  component: ComponentDecl,
  propName: string,
): boolean {
  const aliases = componentPropAliases(component, propName);
  const propObjects = componentPropObjectNames(component);
  if (ts.isIdentifier(expression)) return aliases.has(expression.text);
  if (
    !ts.isPropertyAccessExpression(expression) ||
    expression.name.text !== propName
  )
    return false;
  if (propObjects.size === 0) return true;
  return (
    ts.isIdentifier(expression.expression) &&
    propObjects.has(expression.expression.text)
  );
}

export function callInvokesProp(
  expression: ts.Expression,
  propName: string,
  aliases: Set<string>,
  propObjects: Set<string>,
): boolean {
  if (ts.isIdentifier(expression)) return aliases.has(expression.text);
  if (
    !ts.isPropertyAccessExpression(expression) ||
    expression.name.text !== propName
  )
    return false;
  if (propObjects.size === 0) return true;
  return (
    ts.isIdentifier(expression.expression) &&
    propObjects.has(expression.expression.text)
  );
}

export function componentPropAliases(
  component: ComponentDecl,
  propName: string,
): Set<string> {
  const aliases = new Set<string>();
  const firstParam = component.parameters[0];
  if (!firstParam || !ts.isObjectBindingPattern(firstParam.name))
    return aliases;
  for (const element of firstParam.name.elements) {
    const name = element.name;
    if (!ts.isIdentifier(name)) continue;
    const propertyName =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : name.text;
    if (propertyName === propName) aliases.add(name.text);
  }
  return aliases;
}

export function forwardableComponentPropNames(
  component: ComponentDecl,
): string[] {
  const names = new Set<string>();
  const firstParam = component.parameters[0];
  if (!firstParam) return [];
  if (ts.isObjectBindingPattern(firstParam.name)) {
    for (const element of firstParam.name.elements) {
      const name =
        element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : ts.isIdentifier(element.name)
            ? element.name.text
            : undefined;
      if (name && isForwardablePropName(name)) names.add(name);
    }
  }
  if (ts.isIdentifier(firstParam.name)) {
    if (!component.body) return [...names].sort();
    const objectName = firstParam.name.text;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === objectName &&
        isForwardablePropName(node.name.text)
      ) {
        names.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(component.body);
  }
  return [...names].sort();
}

export function componentPropObjectNames(
  component: ComponentDecl,
): Set<string> {
  const firstParam = component.parameters[0];
  return new Set(
    firstParam && ts.isIdentifier(firstParam.name)
      ? [firstParam.name.text]
      : [],
  );
}
