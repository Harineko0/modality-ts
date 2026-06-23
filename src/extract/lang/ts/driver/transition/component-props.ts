import type { Locator } from "modality-ts/core";
import * as ts from "typescript";
import type { SemanticTypeContext } from "../../semantic-type-context.js";
import { isExtractableHandler, startsUppercase } from "../ast.js";
import {
  type ComponentRegistry,
  componentName,
  emptyComponentRegistry,
  handlerExpression,
  isForwardablePropName,
  isIntrinsicJsxAttribute,
  jsxTagIdentifier,
  jsxTagName,
  resolveComponentEntry,
} from "../components.js";
import type {
  ComponentDecl,
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "../types.js";
import {
  combineParsedGuards,
  disabledGuardFor,
  type ParsedGuard,
} from "./guards.js";
import { isEventAttribute, locatorForEventAttribute } from "./ui.js";

export interface ComponentPropTrigger {
  attr: string;
  locator?: Locator;
  guard?: ParsedGuard;
  pathSuffix?: string;
}

const HOST_INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "form",
  "input",
  "select",
  "textarea",
]);

const DEFAULT_MAX_TRIGGER_DEPTH = 5;

export function isHostInteractiveTag(tag: string): boolean {
  return HOST_INTERACTIVE_TAGS.has(tag);
}

export function resolveComponentPropTriggers(
  source: ts.SourceFile,
  component: ComponentDecl,
  propName: string,
  components: ComponentRegistry,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  options: {
    visited?: Set<string>;
    depth?: number;
    maxDepth?: number;
  } = {},
  types?: SemanticTypeContext,
): ComponentPropTrigger[] {
  const visited = options.visited ?? new Set<string>();
  const depth = options.depth ?? 0;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_TRIGGER_DEPTH;
  const componentLabel = componentName(component) ?? "Anonymous";
  const visitKey = `${componentLabel}:${propName}`;
  if (visited.has(visitKey) || depth > maxDepth) return [];
  visited.add(visitKey);

  const triggers: ComponentPropTrigger[] = [];
  const localHandlers = componentLocalHandlers(component);
  const childOccurrence = new Map<string, number>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const attrName = node.name.text;
      const expression = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : undefined;

      if (isEventAttribute(attrName) && isIntrinsicJsxAttribute(node)) {
        const handler = handlerExpression(expression, localHandlers);
        if (
          expression &&
          (expressionReferencesProp(expression, component, propName) ||
            (handler &&
              handlerCallsProp(handler, component, propName, localHandlers)))
        ) {
          triggers.push({
            attr: attrName,
            locator: locatorForEventAttribute(node),
            guard: disabledGuardFor(
              node,
              setters,
              warnings,
              source,
              componentLabel,
            ),
          });
        }
      } else if (
        isForwardablePropName(attrName) &&
        !isIntrinsicJsxAttribute(node)
      ) {
        const childTag = jsxTagIdentifier(node) ?? jsxTagName(node);
        const childComponent = childTag
          ? resolveComponentEntry(components, childTag, types)?.decl
          : undefined;
        if (childTag && childComponent && expression) {
          const handler = handlerExpression(expression, localHandlers);
          if (
            expressionReferencesProp(expression, component, propName) ||
            (handler &&
              handlerCallsProp(handler, component, propName, localHandlers))
          ) {
            const callerGuard = disabledGuardFor(
              node,
              setters,
              warnings,
              source,
              componentLabel,
            );
            const childTagName =
              typeof childTag === "string" ? childTag : childTag.text;
            const occurrence = childOccurrence.get(childTagName) ?? 0;
            childOccurrence.set(childTagName, occurrence + 1);
            const childTriggers = resolveComponentPropTriggers(
              source,
              childComponent,
              attrName,
              components,
              setters,
              warnings,
              { visited: new Set(visited), depth: depth + 1, maxDepth },
              types,
            );
            for (const [index, childTrigger] of childTriggers.entries()) {
              const pathSuffix =
                childTriggers.length > 1
                  ? `${childTagName}.${occurrence}.${index}`
                  : occurrence > 0
                    ? `${childTagName}.${occurrence}`
                    : childTagName;
              triggers.push({
                attr: childTrigger.attr,
                locator: childTrigger.locator,
                guard: combineParsedGuards([childTrigger.guard, callerGuard]),
                pathSuffix,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(component);

  if (
    isForwardablePropName(propName) &&
    componentSpreadsPropsToHostElement(component)
  ) {
    let spreadFound = false;
    let spreadLocator: Locator | undefined;
    const findSpread = (node: ts.Node): void => {
      if (spreadFound) return;
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.attributes.properties.some(ts.isJsxSpreadAttribute)
      ) {
        const hostTag = jsxHostTagName(node, component);
        if (hostTag && isHostInteractiveTag(hostTag)) {
          spreadFound = true;
          spreadLocator = locatorForJsxHostElement(node);
        }
      }
      ts.forEachChild(node, findSpread);
    };
    findSpread(component);
    triggers.push({
      attr: propName,
      locator: spreadLocator,
      pathSuffix: "spread",
    });
  }

  if (triggers.length === 1) {
    triggers[0] = { ...triggers[0], pathSuffix: undefined };
  }
  return triggers;
}

export function componentPropTrigger(
  source: ts.SourceFile,
  component: ComponentDecl,
  propName: string,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
): { attr: string; locator?: Locator; guard?: ParsedGuard } | undefined {
  const label = componentName(component) ?? "Anonymous";
  const registry = emptyComponentRegistry();
  registry.byDisplayName.set(label, { displayName: label, decl: component });
  const triggers = resolveComponentPropTriggers(
    source,
    component,
    propName,
    registry,
    setters,
    warnings,
  );
  return triggers[0];
}

export function transparentComponentPropTrigger(
  component: ComponentDecl,
  propName: string,
): { attr: string; locator?: Locator; guard?: ParsedGuard } | undefined {
  if (
    !isForwardablePropName(propName) ||
    !componentSpreadsPropsToHostElement(component)
  )
    return undefined;
  return { attr: propName };
}

export function componentSpreadsPropsToElement(
  component: ComponentDecl,
): boolean {
  return componentSpreadsPropsToAnyElement(component);
}

export function componentSpreadsPropsToAnyElement(
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

export function componentSpreadsPropsToHostElement(
  component: ComponentDecl,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const hasSpread = node.attributes.properties.some(
        ts.isJsxSpreadAttribute,
      );
      if (hasSpread) {
        const hostTag = jsxHostTagName(node, component);
        if (hostTag && isHostInteractiveTag(hostTag)) found = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(component);
  return found;
}

function jsxHostTagName(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  component: ComponentDecl,
): string | undefined {
  const tag = element.tagName;
  if (ts.isIdentifier(tag) && !startsUppercase(tag.text)) return tag.text;
  if (ts.isIdentifier(tag)) return staticHostTagBinding(component, tag.text);
  return undefined;
}

function staticHostTagBinding(
  component: ComponentDecl,
  varName: string,
): string | undefined {
  let result: string | undefined;
  const visit = (node: ts.Node): void => {
    if (result) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === varName &&
      node.initializer
    ) {
      const hostTag = hostTagFromInitializer(node.initializer);
      if (hostTag) result = hostTag;
    }
    ts.forEachChild(node, visit);
  };
  visit(component);
  return result;
}

function hostTagFromInitializer(expr: ts.Expression): string | undefined {
  if (ts.isStringLiteral(expr) && isHostInteractiveTag(expr.text))
    return expr.text;
  if (ts.isConditionalExpression(expr)) {
    const whenFalse = hostTagFromInitializer(expr.whenFalse);
    if (whenFalse && isHostInteractiveTag(whenFalse)) return whenFalse;
    const whenTrue = hostTagFromInitializer(expr.whenTrue);
    if (whenTrue && isHostInteractiveTag(whenTrue)) return whenTrue;
  }
  return undefined;
}

function locatorForJsxHostElement(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): Locator | undefined {
  const attrs = element.attributes;
  const testId = attrs.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "data-testid" &&
      property.initializer !== undefined &&
      ts.isStringLiteral(property.initializer),
  );
  if (testId?.initializer && ts.isStringLiteral(testId.initializer)) {
    return { kind: "testId", value: testId.initializer.text };
  }
  return undefined;
}

export function componentPropDeferredToChildTrigger(
  source: ts.SourceFile,
  node: ts.JsxAttribute,
  components: ComponentRegistry,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  types?: SemanticTypeContext,
): boolean {
  if (!ts.isIdentifier(node.name)) return false;
  const tag = jsxTagIdentifier(node) ?? jsxTagName(node);
  const callee = tag
    ? resolveComponentEntry(components, tag, types)?.decl
    : undefined;
  if (!callee) return false;
  return (
    resolveComponentPropTriggers(
      source,
      callee,
      node.name.text,
      components,
      setters,
      warnings,
      {},
      types,
    ).length > 0
  );
}

export function propNamesReferencedByHandler(
  handler: ExtractableHandler,
  component: ComponentDecl,
): string[] {
  const localHandlers = componentLocalHandlers(component);
  return forwardableComponentPropNames(component).filter((propName) =>
    handlerCallsProp(handler, component, propName, localHandlers),
  );
}

export function forwardsComponentProp(
  node: ts.JsxAttribute,
  handlers: Map<string, ExtractableHandler>,
  component: ComponentDecl | undefined,
  components?: ComponentRegistry,
  setters?: Map<string, SetterBinding>,
  source?: ts.SourceFile,
  warnings?: ExtractionWarning[],
  types?: SemanticTypeContext,
): boolean {
  if (!component || !node.initializer) return false;
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : undefined;
  if (
    expression &&
    expressionReferencesForwardableProp(expression, component)
  ) {
    if (components && setters && source && warnings) {
      return forwardableComponentPropNames(component)
        .filter((propName) =>
          expressionReferencesProp(expression, component, propName),
        )
        .some(
          (propName) =>
            resolveComponentPropTriggers(
              source,
              component,
              propName,
              components,
              setters,
              warnings,
              {},
              types,
            ).length > 0,
        );
    }
    return false;
  }
  const localHandlers = componentLocalHandlers(component);
  const handler =
    handlerExpression(expression, handlers) ??
    handlerExpression(expression, localHandlers);
  if (!handler) return false;
  const referencedProps = propNamesReferencedByHandler(handler, component);
  if (referencedProps.length === 0) return false;
  if (components && setters && source && warnings) {
    return referencedProps.some(
      (propName) =>
        resolveComponentPropTriggers(
          source,
          component,
          propName,
          components,
          setters,
          warnings,
        ).length > 0,
    );
  }
  return true;
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
