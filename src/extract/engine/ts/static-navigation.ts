import * as ts from "typescript";
import type { Transition } from "modality-ts/core";
import {
  isPropertyAccessLike,
  lineAndColumn,
  literalValue,
  propertyName,
  startsUppercase,
} from "./ast.js";
import {
  jsxRouteTarget,
  normalizeRouteTarget,
  routeMountGuard,
  templateRoutePattern,
} from "./routes.js";
import {
  isNavigationJsxTag,
  navigationRouteJsxAttribute,
  applyLowerNavigation,
  historyRouteValuesForNavigation,
  locationEffect,
} from "./transition/navigation.js";
import type { NavigationAdapter, RouteInventory } from "../spi/index.js";
import type {
  ComponentDecl,
  InternalTransition,
  StaticEnv,
  StaticValue,
} from "./types.js";

export function staticNavigationTransitions(
  source: ts.SourceFile,
  fileName: string,
  routePatterns: readonly string[],
  components: ReadonlyMap<string, ComponentDecl>,
  adapter?: NavigationAdapter,
  inventory?: RouteInventory,
): Transition[] {
  const transitions: InternalTransition[] = [];
  const topEnv = topLevelStaticEnv(source);
  const visit = (
    node: ts.Node,
    component: string,
    env: StaticEnv,
    depth: number,
  ): void => {
    if (depth > 5) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (isNavigationJsxTag(adapter, tag)) {
        const routePattern = adapter?.routeForComponent?.(
          component,
          inventory ?? { routes: [] },
        );
        const extracted = staticNavigationJsxTransitions(
          source,
          fileName,
          node,
          tag,
          component,
          env,
          routePatterns,
          adapter,
          routePattern,
          inventory,
        );
        transitions.push(...extracted);
      } else if (startsUppercase(tag)) {
        const decl = components.get(tag);
        if (decl) {
          const props = staticPropsFromAttributes(
            node.attributes.properties,
            env,
          );
          const inlinedEnv = componentParameterEnv(decl, props, topEnv);
          for (const returned of componentReturnExpressions(decl))
            visitStaticExpression(returned, tag, inlinedEnv, depth + 1);
        }
      }
    }
    if (ts.isJsxExpression(node) && node.expression) {
      visitStaticExpression(node.expression, component, env, depth);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, component, env, depth));
  };
  const visitStaticExpression = (
    expression: ts.Expression,
    component: string,
    env: StaticEnv,
    depth: number,
  ): void => {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      visitStaticExpression(expression.expression, component, env, depth);
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      const condition = staticValues(expression.condition, env);
      const bools =
        condition?.filter(
          (value): value is boolean => typeof value === "boolean",
        ) ?? [];
      if (bools.length === 1)
        visitStaticExpression(
          bools[0] ? expression.whenTrue : expression.whenFalse,
          component,
          env,
          depth,
        );
      else {
        visitStaticExpression(expression.whenTrue, component, env, depth);
        visitStaticExpression(expression.whenFalse, component, env, depth);
      }
      return;
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      const condition = staticValues(expression.left, env);
      if (!condition || condition.some(Boolean))
        visitStaticExpression(expression.right, component, env, depth);
      return;
    }
    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements)
        visitStaticExpression(element, component, env, depth);
      return;
    }
    const map = staticMapCall(expression, env);
    if (map) {
      for (let index = 0; index < map.items.length; index += 1) {
        const item = map.items[index];
        if (item === undefined) continue;
        const callbackEnv = new Map(env);
        const [itemParam, indexParam] = map.callback.parameters;
        if (itemParam && ts.isIdentifier(itemParam.name))
          callbackEnv.set(itemParam.name.text, [item]);
        if (indexParam && ts.isIdentifier(indexParam.name))
          callbackEnv.set(indexParam.name.text, [index]);
        if (ts.isBlock(map.callback.body)) {
          for (const returned of blockReturnExpressions(
            map.callback.body,
            callbackEnv,
          ))
            visitStaticExpression(returned, component, callbackEnv, depth + 1);
        } else {
          visitStaticExpression(
            map.callback.body,
            component,
            callbackEnv,
            depth + 1,
          );
        }
      }
      return;
    }
    visit(expression, component, env, depth);
  };
  visit(source, "Anonymous", topEnv, 0);
  return uniqueStaticTransitions(transitions);
}

function uniqueStaticTransitions(
  transitions: readonly InternalTransition[],
): Transition[] {
  const seen = new Set<string>();
  const unique: InternalTransition[] = [];
  for (const transition of transitions) {
    const key = canonicalTransitionKey(stripInternalTransition(transition));
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(transition);
  }
  return unique;
}

function staticNavigationJsxTransitions(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  tag: string,
  component: string,
  env: StaticEnv,
  routePatterns: readonly string[],
  adapter: NavigationAdapter | undefined,
  routePattern: string | undefined,
  inventory?: RouteInventory,
): InternalTransition[] {
  if (!adapter) return [];
  const toAttr = navigationRouteJsxAttribute(
    adapter,
    tag,
    node.attributes.properties,
  );
  if (!toAttr) return [];
  const legacyTarget = jsxRouteTarget(toAttr, routePatterns);
  const targets = staticRouteTargetsFromJsxAttribute(
    toAttr,
    env,
    routePatterns,
  );
  return targets
    .filter((target) => target.to !== legacyTarget)
    .map((target) => {
      const lowered = applyLowerNavigation(
        adapter,
        { mode: "push", to: target.to },
        inventory,
        routePatterns,
        {
          ...locationEffect({
            currentVar: "sys:route",
            historyVar: "sys:history",
            mode: "push",
            to: { kind: "lit", value: target.to },
            routeValues: routePatterns,
            historyRouteValues: historyRouteValuesForNavigation(routePatterns, {
              mountRoute: routePattern,
              pushTo: target.to,
            }),
          }),
          confidence: target.confidence,
        },
      );
      return {
        id: `${component}.${tag}.navigate.${safeId(target.to)}`,
        cls: "nav" as const,
        label: {
          kind: "navigate" as const,
          mode: "push" as const,
          to: target.to,
        },
        source: [{ file: fileName, ...lineAndColumn(source, toAttr) }],
        guard: routeMountGuard(routePattern),
        effect: lowered.effect,
        reads: lowered.reads,
        writes: lowered.writes,
        confidence: lowered.confidence,
        __stableIdKey: `${component}:${toAttr.getText(source)}:${target.to}`,
      };
    });
}

function staticRouteTargetsFromJsxAttribute(
  attribute: ts.JsxAttribute,
  env: StaticEnv,
  routePatterns: readonly string[],
): { to: string; confidence: "exact" | "over-approx" }[] {
  if (!attribute.initializer) return [];
  if (ts.isStringLiteral(attribute.initializer)) {
    return [
      {
        to: normalizeRouteTarget(attribute.initializer.text, routePatterns),
        confidence: "exact",
      },
    ];
  }
  if (
    !ts.isJsxExpression(attribute.initializer) ||
    !attribute.initializer.expression
  )
    return [];
  return staticRouteTargets(
    attribute.initializer.expression,
    env,
    routePatterns,
  );
}

function staticRouteTargets(
  expression: ts.Expression,
  env: StaticEnv,
  routePatterns: readonly string[],
): { to: string; confidence: "exact" | "over-approx" }[] {
  if (ts.isConditionalExpression(expression)) {
    const condition = staticValues(expression.condition, env);
    const bools =
      condition?.filter(
        (value): value is boolean => typeof value === "boolean",
      ) ?? [];
    if (bools.length === 1)
      return staticRouteTargets(
        bools[0] ? expression.whenTrue : expression.whenFalse,
        env,
        routePatterns,
      );
    return uniqueRouteTargets([
      ...staticRouteTargets(expression.whenTrue, env, routePatterns).map(
        (target) => ({ ...target, confidence: "over-approx" as const }),
      ),
      ...staticRouteTargets(expression.whenFalse, env, routePatterns).map(
        (target) => ({ ...target, confidence: "over-approx" as const }),
      ),
    ]);
  }
  const staticStrings = staticStringValues(expression, env);
  if (staticStrings.length > 0) {
    return uniqueRouteTargets(
      staticStrings.map((value) => ({
        to: normalizeRouteTarget(value, routePatterns),
        confidence: "exact" as const,
      })),
    );
  }
  if (ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [
      {
        to: normalizeRouteTarget(expression.text, routePatterns),
        confidence: "exact",
      },
    ];
  }
  if (ts.isTemplateExpression(expression)) {
    const pattern = templateRoutePattern(expression);
    return pattern
      ? [
          {
            to: normalizeRouteTarget(pattern, routePatterns),
            confidence: "over-approx",
          },
        ]
      : [];
  }
  return ts.isIdentifier(expression)
    ? routePatterns.map((to) => ({ to, confidence: "over-approx" as const }))
    : [];
}

function uniqueRouteTargets(
  targets: readonly { to: string; confidence: "exact" | "over-approx" }[],
): { to: string; confidence: "exact" | "over-approx" }[] {
  const byTarget = new Map<string, "exact" | "over-approx">();
  for (const target of targets) {
    const current = byTarget.get(target.to);
    byTarget.set(
      target.to,
      current === "exact" && target.confidence === "exact"
        ? "exact"
        : (current ?? target.confidence),
    );
  }
  return [...byTarget].map(([to, confidence]) => ({ to, confidence }));
}

function topLevelStaticEnv(source: ts.SourceFile): StaticEnv {
  const env: StaticEnv = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst =
      (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    if (!isConst) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
        continue;
      const values = staticValues(declaration.initializer, env);
      if (values) env.set(declaration.name.text, values);
    }
  }
  return env;
}

function staticPropsFromAttributes(
  attributes: ts.NodeArray<ts.JsxAttributeLike>,
  env: StaticEnv,
): StaticEnv {
  const props: StaticEnv = new Map();
  for (const attr of attributes) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
    if (!attr.initializer) {
      props.set(attr.name.text, [true]);
      continue;
    }
    if (ts.isStringLiteral(attr.initializer)) {
      props.set(attr.name.text, [attr.initializer.text]);
      continue;
    }
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      const values = staticValues(attr.initializer.expression, env);
      if (values) props.set(attr.name.text, values);
    }
  }
  return props;
}

function componentParameterEnv(
  component: ComponentDecl,
  props: StaticEnv,
  base: StaticEnv,
): StaticEnv {
  const env = new Map(base);
  const parameter = component.parameters[0];
  if (!parameter) return env;
  if (ts.isIdentifier(parameter.name)) {
    env.set(parameter.name.text, [
      Object.fromEntries(
        [...props].map(([key, values]) => [key, values[0] ?? null]),
      ),
    ]);
  }
  if (ts.isObjectBindingPattern(parameter.name)) {
    for (const element of parameter.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const propName =
        element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : element.name.text;
      const values = props.get(propName);
      if (values) env.set(element.name.text, values);
    }
  }
  return env;
}

function componentReturnExpressions(component: ComponentDecl): ts.Expression[] {
  if (!component.body) return [];
  if (!ts.isBlock(component.body)) return [component.body];
  return blockReturnExpressions(component.body, new Map());
}

function blockReturnExpressions(
  block: ts.Block,
  env: StaticEnv,
): ts.Expression[] {
  const returns: ts.Expression[] = [];
  const locals = new Map(env);
  for (const statement of block.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
          continue;
        const values = staticValues(declaration.initializer, locals);
        if (values) locals.set(declaration.name.text, values);
      }
    }
    if (ts.isReturnStatement(statement) && statement.expression)
      returns.push(statement.expression);
    if (ts.isIfStatement(statement)) {
      returns.push(
        ...returnExpressionsFromStatement(statement.thenStatement, locals),
      );
      if (statement.elseStatement)
        returns.push(
          ...returnExpressionsFromStatement(statement.elseStatement, locals),
        );
    }
    if (ts.isForOfStatement(statement)) {
      const values =
        staticValues(statement.expression, locals)
          ?.filter(Array.isArray)
          .flat() ?? [];
      for (const value of values) {
        const loopEnv = new Map(locals);
        if (ts.isIdentifier(statement.initializer))
          loopEnv.set(statement.initializer.text, [value]);
        else if (ts.isVariableDeclarationList(statement.initializer)) {
          const decl = statement.initializer.declarations[0];
          if (decl && ts.isIdentifier(decl.name))
            loopEnv.set(decl.name.text, [value]);
        }
        returns.push(
          ...returnExpressionsFromStatement(statement.statement, loopEnv),
        );
      }
    }
  }
  return returns;
}

function returnExpressionsFromStatement(
  statement: ts.Statement,
  env: StaticEnv,
): ts.Expression[] {
  if (ts.isBlock(statement)) return blockReturnExpressions(statement, env);
  if (ts.isReturnStatement(statement) && statement.expression)
    return [statement.expression];
  if (ts.isIfStatement(statement)) {
    return [
      ...returnExpressionsFromStatement(statement.thenStatement, env),
      ...(statement.elseStatement
        ? returnExpressionsFromStatement(statement.elseStatement, env)
        : []),
    ];
  }
  return [];
}

function staticMapCall(
  expression: ts.Expression,
  env: StaticEnv,
):
  | { items: StaticValue[]; callback: ts.ArrowFunction | ts.FunctionExpression }
  | undefined {
  if (
    !ts.isCallExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "map"
  )
    return undefined;
  const callback = expression.arguments[0];
  if (
    !callback ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  )
    return undefined;
  const arrays =
    staticValues(expression.expression.expression, env)?.filter(
      Array.isArray,
    ) ?? [];
  const items = arrays.flat();
  return items.length > 0 ? { items, callback } : undefined;
}

function staticStringValues(
  expression: ts.Expression,
  env: StaticEnv,
): string[] {
  const values = staticValues(expression, env) ?? [];
  return values.filter((value): value is string => typeof value === "string");
}

function staticValues(
  expression: ts.Expression,
  env: StaticEnv,
): StaticValue[] | undefined {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  )
    return staticValues(expression.expression, env);
  const literal = literalValue(expression);
  if (literal !== undefined) return [literal];
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return [expression.text];
  if (ts.isIdentifier(expression)) {
    const bound = env.get(expression.text);
    return bound ? [...bound] : undefined;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    const items: StaticValue[] = [];
    for (const element of expression.elements) {
      const values = staticValues(element, env);
      if (values?.length !== 1) return undefined;
      const [single] = values;
      if (single === undefined) return undefined;
      items.push(single);
    }
    return [items];
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const object: Record<string, StaticValue> = {};
    for (const property of expression.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        const values = env.get(property.name.text);
        object[property.name.text] =
          values?.length === 1 ? (values[0] ?? null) : null;
        continue;
      }
      if (!ts.isPropertyAssignment(property)) return undefined;
      const name = propertyName(property.name);
      if (!name) return undefined;
      const values = staticValues(property.initializer, env);
      object[name] = values?.length === 1 ? (values[0] ?? null) : null;
    }
    return [object];
  }
  if (isPropertyAccessLike(expression)) {
    const baseValues = staticValues(expression.expression, env);
    if (!baseValues) return undefined;
    const out: StaticValue[] = [];
    for (const value of baseValues) {
      if (!isStaticObject(value)) continue;
      if (Object.hasOwn(value, expression.name.text)) {
        const field = value[expression.name.text];
        if (field !== undefined) out.push(field);
      }
    }
    return out.length > 0 ? out : undefined;
  }
  if (ts.isConditionalExpression(expression)) {
    const condition = staticValues(expression.condition, env);
    const bools =
      condition?.filter(
        (value): value is boolean => typeof value === "boolean",
      ) ?? [];
    if (bools.length === 1)
      return staticValues(
        bools[0] ? expression.whenTrue : expression.whenFalse,
        env,
      );
    return [
      ...(staticValues(expression.whenTrue, env) ?? []),
      ...(staticValues(expression.whenFalse, env) ?? []),
    ];
  }
  return undefined;
}

function isStaticObject(
  value: StaticValue,
): value is { readonly [key: string]: StaticValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripInternalTransition(transition: InternalTransition): Transition {
  const { __stableIdKey: _ignored, ...publicTransition } = transition;
  return publicTransition;
}

function canonicalTransitionKey(transition: Transition): string {
  return JSON.stringify({
    label: transition.label,
    guard: transition.guard,
    effect: transition.effect,
    reads: transition.reads,
    writes: transition.writes,
  });
}

function safeId(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "event"
  );
}
