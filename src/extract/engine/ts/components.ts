import * as ts from "typescript";
import type { AbstractDomain, StateVarDecl, Value } from "modality-ts/core";
import {
  componentNameFor,
  isExtractableHandler,
  isUseStateCall,
  lineAndColumn,
  literalValue,
  startsUppercase,
} from "./ast.js";
import { inferUseStateDomain, initialValueForUseState } from "./domains.js";
import type {
  ComponentDecl,
  CustomHookDecl,
  ExtractableHandler,
  HookStateReturn,
  SetterBinding,
} from "./types.js";

export function handlerExpression(
  expression: ts.Expression | undefined,
  handlers: Map<string, ExtractableHandler>,
): ExtractableHandler | undefined {
  if (!expression) return undefined;
  if (isExtractableHandler(expression)) return expression;
  if (ts.isIdentifier(expression)) return handlers.get(expression.text);
  return undefined;
}

export function componentDeclarations(
  source: ts.SourceFile,
): Map<string, ComponentDecl> {
  const components = new Map<string, ComponentDecl>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      startsUppercase(node.name.text)
    ) {
      components.set(node.name.text, node);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      startsUppercase(node.name.text) &&
      node.initializer &&
      isExtractableHandler(node.initializer)
    ) {
      components.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return components;
}

export function customHookDeclarations(
  source: ts.SourceFile,
): Map<string, CustomHookDecl> {
  const hooks = new Map<string, CustomHookDecl>();
  const visit = (node: ts.Node): void => {
    const name = customHookDeclarationName(node);
    if (name) {
      if (ts.isFunctionDeclaration(node)) hooks.set(name, node);
      else if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        isExtractableHandler(node.initializer)
      )
        hooks.set(name, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hooks;
}

export function isCustomHookDeclaration(node: ts.Node): boolean {
  return Boolean(customHookDeclarationName(node));
}

export function inlineCustomHookState(
  source: ts.SourceFile,
  fileName: string,
  node: ts.VariableDeclaration,
  customHooks: Map<string, CustomHookDecl>,
  vars: StateVarDecl[],
  setters: Map<string, SetterBinding>,
  component: string,
  route: string,
): boolean {
  if (
    !ts.isArrayBindingPattern(node.name) ||
    !node.initializer ||
    !ts.isCallExpression(node.initializer) ||
    !ts.isIdentifier(node.initializer.expression)
  )
    return false;
  const hook = customHooks.get(node.initializer.expression.text);
  if (!hook) return false;
  const stateName = node.name.elements[0];
  const setterName = node.name.elements[1];
  if (
    !ts.isBindingElement(stateName) ||
    !ts.isIdentifier(stateName.name) ||
    !ts.isBindingElement(setterName) ||
    !ts.isIdentifier(setterName.name)
  )
    return false;
  const summary = hookStateReturn(hook);
  if (!summary) return false;
  const varId = `local:${component}.${stateName.name.text}`;
  const decl: StateVarDecl = {
    id: varId,
    domain: summary.domain,
    origin: { file: fileName, ...lineAndColumn(source, node) },
    scope: { kind: "route-local", route },
    initial: summary.initial,
  };
  vars.push(decl);
  setters.set(setterName.name.text, {
    varId,
    component,
    stateName: stateName.name.text,
    domain: summary.domain,
  });
  return true;
}

export function calledCustomHook(
  node: ts.Node,
  customHooks: Set<string>,
): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression))
    return undefined;
  return customHooks.has(node.expression.text)
    ? node.expression.text
    : undefined;
}

export function detectStatefulListComponents(
  source: ts.SourceFile,
  components: Map<string, ComponentDecl>,
): Set<string> {
  const listComponents = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "map"
    ) {
      for (const rendered of jsxComponentTags(node)) {
        const component = components.get(rendered);
        if (component && componentHasUseState(component))
          listComponents.add(rendered);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return listComponents;
}

export function listRenderedHandlerInfo(
  attribute: ts.JsxAttribute,
  vars: readonly StateVarDecl[],
  component: string,
): { varId: string; domain: AbstractDomain; itemName: string } | undefined {
  let current: ts.Node = attribute;
  while (current.parent) {
    const parent = current.parent;
    if (
      ts.isCallExpression(parent) &&
      ts.isPropertyAccessExpression(parent.expression) &&
      parent.expression.name.text === "map"
    ) {
      const callback = parent.arguments[0];
      if (
        callback &&
        current.pos >= callback.pos &&
        current.end <= callback.end
      ) {
        const receiver = parent.expression.expression;
        const itemName = mapItemName(callback);
        if (ts.isIdentifier(receiver) && itemName) {
          const info = stateVarInfoForName(receiver.text, vars, component);
          return info ? { ...info, itemName } : undefined;
        }
      }
    }
    current = parent;
  }
  return undefined;
}

export function literalListRenderedHandlerInfo(
  attribute: ts.JsxAttribute,
): { itemName: string; values: Value[] } | undefined {
  let current: ts.Node = attribute;
  while (current.parent) {
    const parent = current.parent;
    if (
      ts.isCallExpression(parent) &&
      ts.isPropertyAccessExpression(parent.expression) &&
      parent.expression.name.text === "map"
    ) {
      const callback = parent.arguments[0];
      if (
        callback &&
        current.pos >= callback.pos &&
        current.end <= callback.end
      ) {
        const itemName = mapItemName(callback);
        const values = literalArrayValues(parent.expression.expression);
        return itemName && values.length > 0
          ? { itemName, values }
          : undefined;
      }
    }
    current = parent;
  }
  return undefined;
}

function literalArrayValues(expression: ts.Expression): Value[] {
  const unwrapped = unwrapArrayExpression(expression);
  if (!ts.isArrayLiteralExpression(unwrapped)) return [];
  const values: Value[] = [];
  for (const element of unwrapped.elements) {
    const value = literalValue(unwrapArrayExpression(element));
    if (value === undefined) return [];
    values.push(value);
  }
  return values;
}

function unwrapArrayExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function isForwardablePropName(name: string): boolean {
  return /^on[A-Z]/.test(name);
}

export function isIntrinsicJsxAttribute(attribute: ts.JsxAttribute): boolean {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return false;
  const parent = attrs.parent;
  if (!ts.isJsxOpeningElement(parent) && !ts.isJsxSelfClosingElement(parent))
    return false;
  const tag = parent.tagName;
  return ts.isIdentifier(tag) && !startsUppercase(tag.text);
}

export function jsxTagName(attribute: ts.JsxAttribute): string | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const parent = attrs.parent;
  if (!ts.isJsxOpeningElement(parent) && !ts.isJsxSelfClosingElement(parent))
    return undefined;
  return ts.isIdentifier(parent.tagName) ? parent.tagName.text : undefined;
}

export function componentName(component: ComponentDecl): string | undefined {
  if (ts.isFunctionDeclaration(component) && component.name)
    return component.name.text;
  return componentNameFor(component.parent);
}

function hookStateReturn(hook: CustomHookDecl): HookStateReturn | undefined {
  const body = hookBody(hook);
  if (!body) return undefined;
  let stateName: string | undefined;
  let setterName: string | undefined;
  let stateCall: ts.CallExpression | undefined;
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (
        !ts.isArrayBindingPattern(decl.name) ||
        !decl.initializer ||
        !isUseStateCall(decl.initializer)
      )
        continue;
      const state = decl.name.elements[0];
      const setter = decl.name.elements[1];
      if (
        !ts.isBindingElement(state) ||
        !ts.isIdentifier(state.name) ||
        !ts.isBindingElement(setter) ||
        !ts.isIdentifier(setter.name)
      )
        return undefined;
      if (stateCall) return undefined;
      stateName = state.name.text;
      setterName = setter.name.text;
      stateCall = decl.initializer;
    }
  }
  if (!stateName || !setterName || !stateCall) return undefined;
  const returned = body.statements.find(ts.isReturnStatement);
  if (!returned?.expression) return undefined;
  const elements = returnedArrayElements(returned.expression);
  if (!elements || elements.length < 2) return undefined;
  if (
    !ts.isIdentifier(elements[0]) ||
    elements[0].text !== stateName ||
    !ts.isIdentifier(elements[1]) ||
    elements[1].text !== setterName
  )
    return undefined;
  const domain = inferUseStateDomain(stateCall);
  return { domain, initial: initialValueForUseState(stateCall, domain) };
}

function hookBody(hook: CustomHookDecl): ts.Block | undefined {
  if (ts.isFunctionDeclaration(hook)) return hook.body;
  return ts.isBlock(hook.body) ? hook.body : undefined;
}

function returnedArrayElements(
  expression: ts.Expression,
): ts.NodeArray<ts.Expression> | undefined {
  if (ts.isArrayLiteralExpression(expression)) return expression.elements;
  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  )
    return returnedArrayElements(expression.expression);
  return undefined;
}

export function customHookDeclarationName(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    isCustomHookName(node.name.text)
  )
    return node.name.text;
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    isCustomHookName(node.name.text) &&
    node.initializer &&
    isExtractableHandler(node.initializer)
  ) {
    return node.name.text;
  }
  return undefined;
}

function isCustomHookName(name: string): boolean {
  return (
    /^use[A-Z0-9]/.test(name) &&
    name !== "useState" &&
    name !== "useEffect" &&
    name !== "useReducer" &&
    name !== "useRef"
  );
}

function mapItemName(callback: ts.Expression): string | undefined {
  if (
    (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
    callback.parameters.length > 0
  ) {
    const name = callback.parameters[0]?.name;
    return name && ts.isIdentifier(name) ? name.text : undefined;
  }
  return undefined;
}

function stateVarInfoForName(
  name: string,
  vars: readonly StateVarDecl[],
  component: string,
): { varId: string; domain: AbstractDomain } | undefined {
  const localId = `local:${component}.${name}`;
  const decl = vars.find((candidate) => candidate.id === localId);
  return decl ? { varId: decl.id, domain: decl.domain } : undefined;
}

function jsxComponentTags(node: ts.Node): string[] {
  const tags = new Set<string>();
  const visit = (candidate: ts.Node): void => {
    const tag = jsxElementTag(candidate);
    if (tag && startsUppercase(tag)) tags.add(tag);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return [...tags].sort();
}

function jsxElementTag(node: ts.Node): string | undefined {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    return ts.isIdentifier(node.tagName) ? node.tagName.text : undefined;
  }
  return undefined;
}

function componentHasUseState(component: ComponentDecl): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && isUseStateCall(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(component);
  return found;
}
