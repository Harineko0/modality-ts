import * as ts from "typescript";
import { effectReads, effectWrites, validateValue, type AbstractDomain, type EffectIR, type ExprIR, type Locator, type StateVarDecl, type Transition, type Value } from "modality-ts/kernel";
import type { CallSite, M0Ctx, RouterPlugin, StateSourcePlugin, WriteChannel } from "./spi/index.js";

export * from "./pipeline/index.js";
export * from "./spi/index.js";

export interface UseStateExtractionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  routePatterns?: readonly string[];
  asyncOutcomes?: Record<string, { success: Value; error?: Value }>;
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  sourcePlugins?: readonly StateSourcePlugin[];
  routerPlugin?: RouterPlugin;
}

export interface ExtractionWarning {
  message: string;
  line?: number;
}

export interface UseStateExtractionResult {
  vars: StateVarDecl[];
  warnings: ExtractionWarning[];
}

export interface ExtractedModelSkeleton extends UseStateExtractionResult {
  transitions: Transition[];
}

interface SetterBinding {
  varId: string;
  component: string;
  stateName: string;
  domain: AbstractDomain;
}
interface SetterCall {
  setter: SetterBinding;
  argument: ts.Expression;
}

type ExtractableHandler = ts.ArrowFunction | ts.FunctionExpression | (ts.FunctionDeclaration & { body: ts.Block });
type ComponentDecl = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
type CustomHookDecl = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
type InternalTransition = Transition & { __stableIdKey?: string };
interface BoundExpr {
  expr: ExprIR;
  reads: string[];
  setter?: SetterBinding;
}
interface HookStateReturn {
  domain: AbstractDomain;
  initial: Value;
}
interface ContextBindings {
  vars: StateVarDecl[];
  setters: Map<string, SetterBinding>;
  hookReturns: Map<string, Map<string, SetterBinding>>;
}

interface EffectSummary {
  effect: EffectIR;
  reads: string[];
}

function emptyContextBindings(): ContextBindings {
  return { vars: [], setters: new Map(), hookReturns: new Map() };
}

function setterBindingFromDecl(decl: StateVarDecl): SetterBinding {
  const localMatch = /^local:([^.]+)\.(.+)$/.exec(decl.id);
  const atomMatch = /^atom:(.+)$/.exec(decl.id);
  return {
    varId: decl.id,
    component: localMatch?.[1] ?? "Anonymous",
    stateName: localMatch?.[2] ?? atomMatch?.[1] ?? decl.id,
    domain: decl.domain
  };
}

function bindSetter(setters: Map<string, SetterBinding>, symbolName: string, setter: SetterBinding): void {
  setters.set(scopedSetterKey(setter.component, symbolName), setter);
  const current = setters.get(symbolName);
  if (!current || current.varId === setter.varId) {
    setters.set(symbolName, setter);
    return;
  }
  setters.delete(symbolName);
}

function scopedSetterKey(component: string, symbolName: string): string {
  return `${component}:${symbolName}`;
}

function settersForComponent(setters: ReadonlyMap<string, SetterBinding>, component: string | undefined): Map<string, SetterBinding> {
  if (!component) return new Map(setters);
  const scoped = new Map(setters);
  for (const [key, setter] of setters) {
    if (!key.startsWith(`${component}:`)) continue;
    scoped.set(key.slice(component.length + 1), setter);
  }
  return scoped;
}

function discoverContextBindings(
  source: ts.SourceFile,
  fileName: string,
  route: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>
): ContextBindings {
  const bindings = emptyContextBindings();
  const providerValues = new Map<string, Map<string, SetterBinding>>();
  const visitProvider = (node: ts.Node, componentName: string | undefined): void => {
    const component = componentNameFor(node) ?? componentName;
    const localSetters = new Map<string, SetterBinding>();
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && component && node.body && ts.isBlock(node.body)) {
      for (const statement of node.body.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isArrayBindingPattern(declaration.name) || !declaration.initializer || !isUseStateCall(declaration.initializer)) continue;
          const stateName = declaration.name.elements[0];
          const setterName = declaration.name.elements[1];
          if (!setterName || !ts.isBindingElement(stateName) || !ts.isIdentifier(stateName.name) || !ts.isBindingElement(setterName) || !ts.isIdentifier(setterName.name)) continue;
          const domain = inferUseStateDomain(declaration.initializer, typeAliases);
          const varId = `local:${component}.${stateName.name.text}`;
          const setter = { varId, component, stateName: stateName.name.text, domain };
          localSetters.set(setterName.name.text, setter);
        }
      }
      for (const statement of node.body.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          const setter = setterAliasBinding(declaration.initializer, localSetters);
          if (setter) localSetters.set(declaration.name.text, setter);
        }
      }
    }
    if (component && localSetters.size > 0 && node.getText(source).includes(".Provider")) {
      const fields = providerValueFields(node, localSetters);
      if (fields.size > 0) {
        providerValues.set(component, fields);
        for (const setter of fields.values()) bindings.setters.set(setter.stateName, setter);
      }
    }
    ts.forEachChild(node, (child) => visitProvider(child, component));
  };
  visitProvider(source, undefined);

  const providerFieldMaps = [...providerValues.values()];
  const visitHook = (node: ts.Node): void => {
    const name = customHookDeclarationName(node);
    if (name && (ts.isFunctionDeclaration(node) || (ts.isVariableDeclaration(node) && node.initializer && isExtractableHandler(node.initializer)))) {
      const hook = ts.isFunctionDeclaration(node) ? node : node.initializer as CustomHookDecl;
      if (hookUsesContext(hook) && providerFieldMaps.length > 0) {
        const merged = new Map<string, SetterBinding>();
        for (const map of providerFieldMaps) for (const [field, setter] of map) merged.set(field, setter);
        bindings.hookReturns.set(name, merged);
      }
    }
    ts.forEachChild(node, visitHook);
  };
  visitHook(source);
  return bindings;
}

function providerValueFields(node: ts.Node, localSetters: ReadonlyMap<string, SetterBinding>): Map<string, SetterBinding> {
  const fields = new Map<string, SetterBinding>();
  const visit = (candidate: ts.Node): void => {
    if (ts.isJsxAttribute(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === "value" && candidate.initializer && ts.isJsxExpression(candidate.initializer)) {
      const value = providerValueObject(node, candidate.initializer.expression);
      if (value) {
        for (const property of value.properties) {
          if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property)) continue;
          const name = ts.isShorthandPropertyAssignment(property) ? property.name.text : propertyName(property.name);
          const expr = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
          if (!name || !ts.isIdentifier(expr)) continue;
          const setter = localSetters.get(expr.text);
          if (setter) fields.set(name, setter);
        }
      }
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return fields;
}

function setterAliasBinding(expression: ts.Expression, localSetters: ReadonlyMap<string, SetterBinding>): SetterBinding | undefined {
  const callback = useCallbackFunction(expression);
  if (!callback || callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0].name)) return undefined;
  const parameter = callback.parameters[0].name.text;
  const call = firstCallInFunction(callback);
  if (!call || !ts.isIdentifier(call.expression) || call.arguments.length !== 1 || !ts.isIdentifier(call.arguments[0]) || call.arguments[0].text !== parameter) return undefined;
  return localSetters.get(call.expression.text);
}

function useCallbackFunction(expression: ts.Expression): ExtractableHandler | undefined {
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression) || expression.expression.text !== "useCallback") return undefined;
  const first = expression.arguments[0];
  return first && isExtractableHandler(first) ? first : undefined;
}

function firstCallInFunction(fn: ExtractableHandler): ts.CallExpression | undefined {
  if (!ts.isBlock(fn.body)) return ts.isCallExpression(fn.body) ? fn.body : undefined;
  for (const statement of fn.body.statements) {
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) return statement.expression;
  }
  return undefined;
}

function providerValueObject(scope: ts.Node, expression: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  if (!expression) return undefined;
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (!ts.isIdentifier(expression)) return undefined;
  const declaration = variableDeclarationIn(scope, expression.text);
  if (!declaration?.initializer || !ts.isCallExpression(declaration.initializer)) return undefined;
  if (!ts.isIdentifier(declaration.initializer.expression) || declaration.initializer.expression.text !== "useMemo") return undefined;
  const callback = declaration.initializer.arguments[0];
  if (!callback || !isExtractableHandler(callback)) return undefined;
  if (ts.isObjectLiteralExpression(callback.body)) return callback.body;
  if (ts.isParenthesizedExpression(callback.body) && ts.isObjectLiteralExpression(callback.body.expression)) return callback.body.expression;
  return undefined;
}

function variableDeclarationIn(scope: ts.Node, name: string): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

function hookUsesContext(hook: CustomHookDecl): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useContext") {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(hook);
  return found;
}

function bindContextHookObjectDeclaration(node: ts.Node, contextBindings: ContextBindings, setters: Map<string, SetterBinding>): void {
  if (!ts.isVariableDeclaration(node) || !ts.isObjectBindingPattern(node.name) || !node.initializer || !ts.isCallExpression(node.initializer) || !ts.isIdentifier(node.initializer.expression)) return;
  const hook = contextBindings.hookReturns.get(node.initializer.expression.text);
  if (!hook) return;
  for (const element of node.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const property = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
    const setter = hook.get(property);
    if (setter) setters.set(element.name.text, setter);
  }
}

export function inferDomainFromTypeNode(node: ts.TypeNode | undefined, typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map()): AbstractDomain {
  if (!node) return { kind: "tokens", count: 1 };
  switch (node.kind) {
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: "bool" };
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.NumberKeyword:
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return { kind: "tokens", count: 1 };
    case ts.SyntaxKind.LiteralType:
      return domainFromLiteralType(node as ts.LiteralTypeNode);
    case ts.SyntaxKind.UnionType:
      return domainFromUnion(node as ts.UnionTypeNode, typeAliases);
    case ts.SyntaxKind.TypeLiteral:
      return domainFromTypeLiteral(node as ts.TypeLiteralNode);
    case ts.SyntaxKind.ArrayType:
      return { kind: "lengthCat" };
    case ts.SyntaxKind.TypeReference:
      return domainFromTypeReference(node as ts.TypeReferenceNode, typeAliases);
    default:
      return { kind: "tokens", count: 1 };
  }
}

export function extractUseStateVars(sourceText: string, options: UseStateExtractionOptions = {}): UseStateExtractionResult {
  return extractUseStateSkeleton(sourceText, options);
}

export function extractUseStateSkeleton(sourceText: string, options: UseStateExtractionOptions = {}): ExtractedModelSkeleton {
  const fileName = options.fileName ?? "App.tsx";
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const typeAliases = typeAliasDeclarations(source);
  const vars: StateVarDecl[] = options.stateVars ? [...options.stateVars] : [];
  const transitions: Transition[] = [];
  const warnings: ExtractionWarning[] = [];
  const route = options.route ?? "/";
  const routePatterns = options.routePatterns ?? [];
  const effectApis = new Set(options.effectApis ?? []);
  const sourcePlugins = options.sourcePlugins ?? [];
  const routerPlugin = options.routerPlugin;
  const setters = new Map<string, SetterBinding>();
  const contextBindings = discoverContextBindings(source, fileName, route, typeAliases);
  const globalTaints = new Set<string>();
  const components = componentDeclarations(source);
  const providerComponents = providerComponentNames(source);
  const customHooks = customHookDeclarations(source);
  const statefulListComponents = detectStatefulListComponents(source, components);
  const reportedStatefulListComponents = new Set<string>();
  const reportedCustomHooks = new Set<string>();
  if (options.stateVars && options.writeChannels) {
    for (const channel of options.writeChannels) {
      const decl = options.stateVars.find((candidate) => candidate.id === channel.varId);
      if (!decl) continue;
      bindSetter(setters, channel.symbolName, setterBindingFromDecl(decl));
    }
  }
  for (const decl of contextBindings.vars) {
    if (!vars.some((candidate) => candidate.id === decl.id)) vars.push(decl);
  }
  for (const [symbolName, setter] of contextBindings.setters) setters.set(symbolName, setter);
  const handlers = new Map<string, ExtractableHandler>();
  const visit = (node: ts.Node, componentName: string | undefined): void => {
    if (!componentName && isCustomHookDeclaration(node)) return;
    const nextComponent = componentNameFor(node) ?? componentName;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const handler = extractableHandlerInitializer(node.initializer);
      if (handler) handlers.set(node.name.text, handler);
    }
    if (ts.isFunctionDeclaration(node) && node.name && isExtractableHandler(node)) {
      handlers.set(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node) && node.initializer && isUseReducerCall(node.initializer)) {
      warnings.push({ message: `Unsupported useReducer ${nextComponent ?? "Anonymous"}.useReducer`, ...lineAndColumn(source, node) });
    }
    bindContextHookObjectDeclaration(node, contextBindings, setters);
    if (ts.isVariableDeclaration(node) && nextComponent && inlineCustomHookState(source, fileName, node, customHooks, vars, setters, nextComponent, route)) {
      return;
    }
    const customHook = calledCustomHook(node, new Set(customHooks.keys()));
    if (customHook && nextComponent) {
      const key = `${nextComponent}.${customHook}`;
      if (!contextBindings.hookReturns.has(customHook) && !reportedCustomHooks.has(key)) {
        reportedCustomHooks.add(key);
        warnings.push({ message: `Unextractable custom hook ${key}`, ...lineAndColumn(source, node) });
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && isUseStateCall(node.initializer)) {
      if (nextComponent && statefulListComponents.has(nextComponent)) {
        if (!reportedStatefulListComponents.has(nextComponent)) {
          reportedStatefulListComponents.add(nextComponent);
          warnings.push({ message: `Unextractable stateful list item ${nextComponent}`, ...lineAndColumn(source, node) });
        }
        ts.forEachChild(node, (child) => visit(child, nextComponent));
        return;
      }
      const stateName = node.name.elements[0];
      const setterName = node.name.elements[1];
      if (ts.isBindingElement(stateName) && ts.isIdentifier(stateName.name)) {
        const domain = inferUseStateDomain(node.initializer, typeAliases);
        const component = nextComponent ?? "Anonymous";
        const varId = `local:${component}.${stateName.name.text}`;
        if (!options.stateVars) {
          vars.push({
            id: varId,
            domain,
            origin: { file: fileName, ...lineAndColumn(source, node) },
            scope: providerComponents.has(component) ? { kind: "global" } : { kind: "route-local", route },
            initial: initialValueForUseState(node.initializer, domain)
          });
        }
        if (setterName && ts.isBindingElement(setterName) && ts.isIdentifier(setterName.name)) {
          if (!options.writeChannels) bindSetter(setters, setterName.name.text, { varId, component, stateName: stateName.name.text, domain });
        }
      } else {
        warnings.push({ message: "Unsupported useState binding pattern", ...lineAndColumn(source, node) });
      }
    }
    const link = linkNavigationTransition(source, fileName, node, nextComponent ?? "Anonymous", routePatterns);
    if (link) transitions.push(link);
    const scopedSetters = settersForComponent(setters, nextComponent);
    const refTaint = refSetterTaint(node, scopedSetters);
    if (refTaint) {
      const key = `Global taint ${refTaint.varId}`;
      if (!globalTaints.has(key)) {
        globalTaints.add(key);
        warnings.push({ message: key, ...lineAndColumn(source, refTaint.node) });
      }
    }
    transitions.push(...transitionsFromTimerCall(source, fileName, node, scopedSetters, nextComponent ?? "Anonymous"));
    for (const timerTaint of timerSetterTaints(node, scopedSetters)) {
      const key = `Global taint ${timerTaint.varId}`;
      if (!globalTaints.has(key)) {
        globalTaints.add(key);
        warnings.push({ message: key, ...lineAndColumn(source, timerTaint.node) });
      }
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.initializer && isForwardablePropName(node.name.text) && !isIntrinsicJsxAttribute(node)) {
      const extracted = transitionsFromComponentPropAttribute(source, fileName, node, scopedSetters, handlers, components, nextComponent ?? "Anonymous", effectApis, options.asyncOutcomes ?? {}, sourcePlugins, routerPlugin, warnings);
      transitions.push(...extracted);
      if (extracted.length === 0) {
        warnings.push({ message: `Unextractable handler ${nextComponent ?? "Anonymous"}.${node.name.text}`, ...lineAndColumn(source, node) });
      }
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.initializer && isEventAttribute(node.name.text) && isIntrinsicJsxAttribute(node)) {
      const listInfo = listRenderedHandlerInfo(node, vars, nextComponent ?? "Anonymous");
      if (listInfo) {
        if (listInfo.domain.kind === "boundedList") {
          const extracted = transitionsFromBoundedListAttribute(source, fileName, node, scopedSetters, handlers, nextComponent ?? "Anonymous", {
            varId: listInfo.varId,
            domain: listInfo.domain,
            itemName: listInfo.itemName
          });
          if (extracted.length > 0) {
            transitions.push(...tagStableIdKey(extracted, node));
            ts.forEachChild(node, (child) => visit(child, nextComponent));
            return;
          }
        }
        warnings.push({ message: `Unextractable list-rendered handler ${nextComponent ?? "Anonymous"}.${node.name.text} over ${listInfo.domain.kind} ${listInfo.varId}`, ...lineAndColumn(source, node) });
        ts.forEachChild(node, (child) => visit(child, nextComponent));
        return;
      }
      const guardLocals = componentGuardLocalsFor(node, scopedSetters);
      const guard = combineParsedGuards([
        renderGuardFor(node, scopedSetters, warnings, source, nextComponent ?? "Anonymous", guardLocals),
        disabledGuardFor(node, scopedSetters, warnings, source, nextComponent ?? "Anonymous", guardLocals)
      ]);
      const extracted = transitionsFromJsxAttribute(source, fileName, node, scopedSetters, handlers, nextComponent ?? "Anonymous", effectApis, options.asyncOutcomes ?? {}, sourcePlugins, routerPlugin, guard, routePatterns, contextBindings, warnings);
      transitions.push(...extracted);
      if (extracted.length === 0 && !forwardsComponentProp(node, handlers, components.get(nextComponent ?? "")) && !handlerSchedulesModeledTimer(node, handlers, scopedSetters)) {
        warnings.push({ message: `Unextractable handler ${nextComponent ?? "Anonymous"}.${node.name.text}`, ...lineAndColumn(source, node) });
      }
    }
    if (ts.isCallExpression(node) && isUseEffectCall(node)) {
      const extracted = transitionsFromUseEffect(source, fileName, node, scopedSetters, nextComponent ?? "Anonymous");
      transitions.push(...extracted);
      if (extracted.length === 0 && useEffectWritesModeledState(node, scopedSetters) && !providerComponents.has(nextComponent ?? "")) {
        warnings.push({ message: `Unextractable effect ${nextComponent ?? "Anonymous"}.useEffect`, ...lineAndColumn(source, node) });
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextComponent));
  };
  visit(source, undefined);
  return { vars, transitions: withStableTransitionIds(transitions), warnings };
}

function withStableTransitionIds(transitions: readonly Transition[]): Transition[] {
  const groups = new Map<string, InternalTransition[]>();
  for (const transition of transitions) {
    const group = groups.get(transition.id) ?? [];
    group.push(transition as InternalTransition);
    groups.set(transition.id, group);
  }
  const emitted = new Map<string, number>();
  return transitions.map((transition) => {
    const internal = transition as InternalTransition;
    const group = groups.get(transition.id) ?? [];
    const base = stripInternalTransition(internal);
    if (group.length <= 1) return base;
    const suffix = shortHash(internal.__stableIdKey ?? canonicalTransitionKey(base));
    const id = `${transition.id}.${suffix}`;
    const count = emitted.get(id) ?? 0;
    emitted.set(id, count + 1);
    return { ...base, id: count === 0 ? id : `${id}.${count + 1}` };
  });
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
    writes: transition.writes
  });
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}

function inferUseStateDomain(call: ts.CallExpression, typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map()): AbstractDomain {
  const typeArg = call.typeArguments?.[0];
  if (typeArg) return inferDomainFromTypeNode(typeArg, typeAliases);
  const initial = call.arguments[0];
  if (!initial) return { kind: "tokens", count: 1 };
  if (initial.kind === ts.SyntaxKind.TrueKeyword || initial.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
  if (ts.isStringLiteral(initial) || ts.isNumericLiteral(initial)) return { kind: "enum", values: [initial.text] };
  if (initial.kind === ts.SyntaxKind.NullKeyword) return { kind: "option", inner: { kind: "tokens", count: 1 } };
  if (ts.isArrayLiteralExpression(initial)) return { kind: "lengthCat" };
  return { kind: "tokens", count: 1 };
}

function initialValueForUseState(call: ts.CallExpression, domain: AbstractDomain): Value {
  const initial = call.arguments[0];
  if (!initial) return firstValue(domain);
  const parsed = initialValueFromExpression(initial, domain);
  if (parsed !== undefined) return parsed;
  if (initial.kind === ts.SyntaxKind.TrueKeyword) return validInitialOrFirst(domain, true);
  if (initial.kind === ts.SyntaxKind.FalseKeyword) return validInitialOrFirst(domain, false);
  if (ts.isStringLiteral(initial)) return validInitialOrFirst(domain, initial.text);
  if (ts.isNumericLiteral(initial)) return validInitialOrFirst(domain, Number(initial.text));
  if (initial.kind === ts.SyntaxKind.NullKeyword) return validInitialOrFirst(domain, null);
  if (ts.isArrayLiteralExpression(initial)) return validInitialOrFirst(domain, initial.elements.length === 0 ? "0" : initial.elements.length === 1 ? "1" : "many");
  return firstValue(domain);
}

function initialValueFromExpression(expression: ts.Expression, domain: AbstractDomain): Value | undefined {
  const literal = literalValue(expression);
  if (literal !== undefined) return validateValue(domain, literal) ? literal : undefined;
  if (domain.kind === "option") return initialValueFromExpression(expression, domain.inner);
  if (domain.kind === "record" && ts.isObjectLiteralExpression(expression)) {
    const fields: Record<string, Value> = {};
    for (const [field, fieldDomain] of Object.entries(domain.fields)) {
      const property = expression.properties.find((candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === field
      );
      fields[field] = property ? initialValueFromExpression(property.initializer, fieldDomain) ?? firstValue(fieldDomain) : firstValue(fieldDomain);
    }
    return fields;
  }
  return undefined;
}

function validInitialOrFirst(domain: AbstractDomain, value: Value): Value {
  return validateValue(domain, value) ? value : firstValue(domain);
}

function domainFromLiteralType(node: ts.LiteralTypeNode): AbstractDomain {
  const lit = node.literal;
  if (lit.kind === ts.SyntaxKind.TrueKeyword || lit.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
  if (ts.isStringLiteral(lit)) return { kind: "enum", values: [lit.text] };
  if (ts.isNumericLiteral(lit)) return { kind: "boundedInt", min: Number(lit.text), max: Number(lit.text) };
  if (lit.kind === ts.SyntaxKind.NullKeyword) return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}

function domainFromUnion(node: ts.UnionTypeNode, typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map()): AbstractDomain {
  const nonNull = node.types.filter((part) => part.kind !== ts.SyntaxKind.UndefinedKeyword && !(ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword));
  if (nonNull.length !== node.types.length && nonNull.length > 0) {
    return { kind: "option", inner: nonNull.length === 1 ? inferDomainFromTypeNode(nonNull[0], typeAliases) : domainFromUnionMembers(nonNull) };
  }
  return domainFromUnionMembers(node.types);
}

function domainFromUnionMembers(types: readonly ts.TypeNode[]): AbstractDomain {
  const literalValues: string[] = [];
  const numericValues: number[] = [];
  for (const part of types) {
    if (!ts.isLiteralTypeNode(part)) return taggedUnionFromMembers(types) ?? { kind: "tokens", count: 1 };
    const lit = part.literal;
    if (ts.isStringLiteral(lit)) literalValues.push(lit.text);
    else if (ts.isNumericLiteral(lit)) numericValues.push(Number(lit.text));
    else return taggedUnionFromMembers(types) ?? { kind: "tokens", count: 1 };
  }
  if (numericValues.length === types.length) {
    return { kind: "boundedInt", min: Math.min(...numericValues), max: Math.max(...numericValues) };
  }
  return { kind: "enum", values: literalValues };
}

function taggedUnionFrom(node: ts.UnionTypeNode): AbstractDomain | undefined {
  return taggedUnionFromMembers(node.types);
}

function taggedUnionFromMembers(types: readonly ts.TypeNode[]): AbstractDomain | undefined {
  const members = types.filter(ts.isTypeLiteralNode);
  if (members.length !== types.length) return undefined;
  const tagCandidates = new Map<string, Set<string>>();
  for (const member of members) {
    for (const prop of member.members.filter(ts.isPropertySignature)) {
      if (!prop.type || !ts.isIdentifier(prop.name) || !ts.isLiteralTypeNode(prop.type) || !ts.isStringLiteral(prop.type.literal)) continue;
      const set = tagCandidates.get(prop.name.text) ?? new Set<string>();
      set.add(prop.type.literal.text);
      tagCandidates.set(prop.name.text, set);
    }
  }
  const tag = [...tagCandidates].find(([, values]) => values.size === members.length)?.[0];
  if (!tag) return undefined;
  const variants: Record<string, AbstractDomain> = {};
  for (const member of members) {
    const tagProp = member.members.find((prop): prop is ts.PropertySignature => ts.isPropertySignature(prop) && ts.isIdentifier(prop.name) && prop.name.text === tag);
    if (!tagProp?.type || !ts.isLiteralTypeNode(tagProp.type) || !ts.isStringLiteral(tagProp.type.literal)) return undefined;
    variants[tagProp.type.literal.text] = domainFromTypeLiteral(member, tag);
  }
  return { kind: "tagged", tag, variants };
}

function domainFromTypeLiteral(node: ts.TypeLiteralNode, omitField?: string): AbstractDomain {
  const fields: Record<string, AbstractDomain> = {};
  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.type || !ts.isIdentifier(member.name) || member.name.text === omitField) continue;
    fields[member.name.text] = inferDomainFromTypeNode(member.type);
  }
  return { kind: "record", fields };
}

function domainFromTypeReference(node: ts.TypeReferenceNode, typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map()): AbstractDomain {
  const name = node.typeName.getText();
  const alias = typeAliases.get(name);
  if (alias) return inferDomainFromTypeNode(alias, typeAliases);
  if ((name === "Array" || name === "ReadonlyArray") && node.typeArguments?.length === 1) return { kind: "lengthCat" };
  if (name === "Record") return { kind: "tokens", count: 1 };
  return { kind: "tokens", count: 1 };
}

function typeAliasDeclarations(source: ts.SourceFile): Map<string, ts.TypeNode> {
  const aliases = new Map<string, ts.TypeNode>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && ts.isIdentifier(node.name)) aliases.set(node.name.text, node.type);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return aliases;
}

function isUseStateCall(node: ts.Expression): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useState";
}

function isUseReducerCall(node: ts.Expression): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useReducer";
}

function isUseRefCall(node: ts.Expression): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useRef";
}

function isUseEffectCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "useEffect";
}

function isExtractableHandler(node: ts.Node): node is ExtractableHandler {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || (ts.isFunctionDeclaration(node) && Boolean(node.body));
}

function extractableHandlerInitializer(node: ts.Expression): ExtractableHandler | undefined {
  if (isExtractableHandler(node)) return node;
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useCallback") {
    const callback = node.arguments[0];
    return callback && isExtractableHandler(callback) ? callback : undefined;
  }
  return undefined;
}

function refSetterTaint(node: ts.Node, setters: Map<string, SetterBinding>): { varId: string; node: ts.Node } | undefined {
  if (ts.isVariableDeclaration(node) && node.initializer && isUseRefCall(node.initializer)) {
    const arg = node.initializer.arguments[0];
    if (arg && ts.isIdentifier(arg)) {
      const setter = setters.get(arg.text);
      if (setter) return { varId: setter.varId, node: arg };
    }
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && node.left.name.text === "current" && ts.isIdentifier(node.right)) {
    const setter = setters.get(node.right.text);
    if (setter) return { varId: setter.varId, node: node.right };
  }
  return undefined;
}

function timerSetterTaints(node: ts.Node, setters: Map<string, SetterBinding>): { varId: string; node: ts.Node }[] {
  if (!ts.isCallExpression(node)) return [];
  const name = callName(node.expression);
  if (name !== "setTimeout" && name !== "setInterval") return [];
  const callback = node.arguments[0];
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return [];
  if (timerCallbackSummaries(callback, setters)) return [];
  return uniqueSetters(settersWrittenIn(callback.body, setters)).map((setter) => ({ varId: setter.varId, node: callback }));
}

function transitionsFromTimerCall(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
  setters: Map<string, SetterBinding>,
  component: string
): Transition[] {
  if (!ts.isCallExpression(node)) return [];
  const name = callName(node.expression);
  if (name !== "setTimeout" && name !== "setInterval") return [];
  const callback = node.arguments[0];
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return [];
  const summaries = timerCallbackSummaries(callback, setters);
  if (!summaries || summaries.length === 0) return [];
  const effects = summaries.map((summary) => summary.effect);
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  const suffix = writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_") || "callback";
  return [{
    id: `${component}.${name}.${suffix}`,
    cls: "env",
    label: { kind: "timer", key: `${component}.${name}.${suffix}` },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: effects.length === 1 ? effects[0]! : { kind: "seq", effects },
    reads: uniqueStrings(summaries.flatMap((summary) => summary.reads)),
    writes,
    confidence: effects.some((effect) => effect.kind === "havoc") ? "over-approx" : "exact"
  }];
}

function timerCallbackSummaries(callback: ExtractableHandler, setters: Map<string, SetterBinding>): EffectSummary[] | undefined {
  if (ts.isCallExpression(callback.body)) {
    const summary = summarizeSetterCall(callback.body, setters);
    return summary ? [summary] : undefined;
  }
  if (!ts.isBlock(callback.body) || callback.body.statements.length === 0) return undefined;
  const summaries: EffectSummary[] = [];
  for (const statement of callback.body.statements) {
    const summary = summarizeSetterStatement(statement, setters);
    if (!summary) return undefined;
    summaries.push(summary);
  }
  return summaries;
}

function handlerSchedulesModeledTimer(attribute: ts.JsxAttribute, handlers: Map<string, ExtractableHandler>, setters: Map<string, SetterBinding>): boolean {
  if (!attribute.initializer) return false;
  const expression = ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      const callback = node.arguments[0];
      if (
        (name === "setTimeout" || name === "setInterval") &&
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        timerCallbackSummaries(callback, setters)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(handler.body);
  return found;
}

function transitionsFromJsxAttribute(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  sourcePlugins: readonly StateSourcePlugin[],
  routerPlugin: RouterPlugin | undefined,
  disabledGuard: ParsedGuard | undefined,
  routePatterns: readonly string[],
  contextBindings: ContextBindings,
  warnings: ExtractionWarning[]
): Transition[] {
  if (!node.initializer) return [];
  const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return [];
  if (!ts.isIdentifier(node.name)) return [];
  const attr = node.name.text;
  const locator = locatorForEventAttribute(node);
  return tagStableIdKey(
    transitionsFromResolvedHandler(source, fileName, node, attr, handler, setters, handlers, component, effectApis, asyncOutcomes, sourcePlugins, routerPlugin, disabledGuard, locator, routePatterns, contextBindings, warnings),
    handler
  );
}

function transitionsFromComponentPropAttribute(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  components: Map<string, ComponentDecl>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  sourcePlugins: readonly StateSourcePlugin[],
  routerPlugin: RouterPlugin | undefined,
  warnings: ExtractionWarning[]
): Transition[] {
  if (!node.initializer || !ts.isIdentifier(node.name)) return [];
  const tag = jsxTagName(node);
  if (!tag) return [];
  const callee = components.get(tag);
  if (!callee) return [];
  const trigger = componentPropTrigger(source, callee, node.name.text, setters, warnings) ?? transparentComponentPropTrigger(callee, node.name.text);
  if (!trigger) return [];
  const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return [];
  const guardLocals = componentGuardLocalsFor(node, setters);
  const callerGuard = combineParsedGuards([
    renderGuardFor(node, setters, warnings, source, component, guardLocals),
    disabledGuardFor(node, setters, warnings, source, component, guardLocals)
  ]);
  return tagStableIdKey(
    transitionsFromResolvedHandler(
      source,
      fileName,
      node,
      trigger.attr,
      handler,
      setters,
      handlers,
      component,
      effectApis,
      asyncOutcomes,
      sourcePlugins,
      routerPlugin,
      combineParsedGuards([trigger.guard, callerGuard]),
      trigger.locator,
      [],
      emptyContextBindings(),
      warnings
    ),
    handler
  );
}

function transitionsFromBoundedListAttribute(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  listInfo: { varId: string; domain: Extract<AbstractDomain, { kind: "boundedList" }>; itemName: string }
): Transition[] {
  if (!node.initializer || !ts.isIdentifier(node.name)) return [];
  const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return [];
  const attr = node.name.text;
  const summary = callSummaryFromHandler(handler, setters, new Map([[listInfo.itemName, readListItemBinding(listInfo.varId, 0)]]));
  if (!summary) return [];
  const setterCall = setterCallFrom(summary.call, setters);
  if (!setterCall) return [];
  const baseLocator = locatorForEventAttribute(node);
  const transitions: Transition[] = [];
  for (let index = 0; index < listInfo.domain.maxLen; index += 1) {
    const locals = new Map(summary.locals);
    locals.set(listInfo.itemName, readListItemBinding(listInfo.varId, index));
    const assigned = setterArgumentExpr(setterCall.argument, setterCall.setter, setters, locals);
    if (!assigned) return [];
    const locator = baseLocator ? { kind: "positional" as const, base: baseLocator, index } : undefined;
    const guard = boundedListIndexGuard(listInfo.varId, index);
    transitions.push({
      id: `${component}.${attr}.${setterCall.setter.stateName}.${index}`,
      cls: "user" as const,
      label: labelForEvent(attr, locator),
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard,
      effect: { kind: "assign" as const, var: setterCall.setter.varId, expr: assigned.expr },
      reads: uniqueStrings([listInfo.varId, ...assigned.reads]),
      writes: [setterCall.setter.varId],
      confidence: index <= 1 ? "exact" as const : "over-approx" as const
    });
  }
  return transitions;
}

function readListItemBinding(varId: string, index: number): BoundExpr {
  return { expr: { kind: "read", var: varId, path: [String(index)] }, reads: [varId] };
}

function boundedListIndexGuard(varId: string, index: number): ExprIR {
  const len = { kind: "lenCat" as const, arg: { kind: "read" as const, var: varId } };
  if (index === 0) return { kind: "neq", args: [len, { kind: "lit", value: "0" }] };
  return { kind: "eq", args: [len, { kind: "lit", value: "many" }] };
}

function tagStableIdKey(transitions: readonly Transition[], node: ts.Node): Transition[] {
  const key = normalizedAstKey(node);
  return transitions.map((transition) => ({ ...(transition as InternalTransition), __stableIdKey: key }));
}

function normalizedAstKey(node: ts.Node): string {
  return node
    .getText()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, "");
}

function transitionsFromResolvedHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  sourcePlugins: readonly StateSourcePlugin[],
  routerPlugin: RouterPlugin | undefined,
  disabledGuard: ParsedGuard | undefined,
  locator: Locator | undefined,
  routePatterns: readonly string[],
  contextBindings: ContextBindings,
  warnings: ExtractionWarning[]
): Transition[] {
  const asyncTransitions = transitionsFromAsyncHandler(source, fileName, attr, handler, setters, component, effectApis, asyncOutcomes, locator, routePatterns, warnings);
  if (asyncTransitions.length > 0) return applyParsedGuard(asyncTransitions, disabledGuard);
  const conditionalTransition = conditionalTransitionFromHandler(source, fileName, node, attr, handler, setters, component, locator);
  if (conditionalTransition) return applyParsedGuard([conditionalTransition], disabledGuard);
  const loopTransitions = loopWriteTransitions(source, fileName, node, attr, handler, setters, component, locator);
  if (loopTransitions.length > 0) return applyParsedGuard(loopTransitions, disabledGuard);
  const sequentialTransition = sequentialTransitionFromHandler(source, fileName, node, attr, handler, setters, handlers, component, locator);
  if (sequentialTransition) return applyParsedGuard([sequentialTransition], disabledGuard);
  const summary = callSummaryFromHandler(handler, setters, componentScopeLocalsFor(node, setters, contextBindings));
  if (!summary) return [];
  const inlined = inlinedHelperCall(summary.call, handlers, setters);
  const inlinedCall = inlined?.call ?? summary.call;
  const locals = inlined?.locals ?? summary.locals;
  const navigation = navigationTransition(source, fileName, node, attr, component, inlinedCall, locator, routerPlugin, routePatterns);
  if (navigation) return applyParsedGuard([navigation], disabledGuard);
  const pluginWrite = pluginWriteTransition(source, fileName, node, attr, component, inlinedCall, setters, locals, sourcePlugins, locator);
  if (pluginWrite) return applyParsedGuard([pluginWrite], disabledGuard);
  const swrMutate = swrMutateTransition(source, fileName, node, attr, component, inlinedCall, locator);
  if (swrMutate) return applyParsedGuard([swrMutate], disabledGuard);
  const noop = noopCallTransition(source, fileName, node, attr, component, inlinedCall, locator);
  if (noop) return applyParsedGuard([noop], disabledGuard);
  const setterCall = setterCallFrom(inlinedCall, setters);
  if (!setterCall) {
    const escaped = escapedSetters(inlinedCall, setters, locals);
    if (escaped.length === 0) return [];
    return applyParsedGuard(escapedSetterTransitions(source, fileName, node, attr, component, escaped, locator), disabledGuard);
  }
  const { setter, argument } = setterCall;
  if ((attr === "onChange" || attr === "onInput") && isInputValueExpression(inlinedCall.arguments[0], handler.parameters[0])) {
    return applyParsedGuard(inputTransitions(source, fileName, node, attr, component, setter, locator), disabledGuard);
  }
  const assignment = setterArgumentExpr(argument, setter, setters, locals);
  if (!assignment) {
    return applyParsedGuard([havocSetterTransition(source, fileName, node, attr, component, setter, locator, "unrepresentable")], disabledGuard);
  }
  return applyParsedGuard([{
    id: `${component}.${attr}.${setter.stateName}`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "assign", var: setter.varId, expr: assignment.expr },
    reads: assignment.reads,
    writes: [setter.varId],
    confidence: "exact"
  }], disabledGuard);
}

function sequentialTransitionFromHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  locator: Locator | undefined
): Transition | undefined {
  if (!ts.isBlock(handler.body)) return undefined;
  const locals = new Map<string, BoundExpr>();
  const summaries: EffectSummary[] = [];
  for (const statement of handler.body.statements) {
    if (bindConstStatement(statement, setters, locals)) continue;
    const helper = helperSummariesFromStatement(statement, handlers, setters);
    if (helper) {
      summaries.push(...helper);
      continue;
    }
    const summary = summarizeSetterStatement(statement, setters, locals);
    if (!summary) return undefined;
    summaries.push(summary);
  }
  if (summaries.length <= 1) return undefined;
  const effects = summaries.map((summary) => summary.effect);
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  return {
    id: `${component}.${attr}.${writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_")}.seq`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "seq", effects },
    reads: uniqueStrings(summaries.flatMap((summary) => summary.reads)),
    writes,
    confidence: effects.some((effect) => effect.kind === "havoc") ? "over-approx" : "exact"
  };
}

function helperSummariesFromStatement(
  statement: ts.Statement,
  handlers: Map<string, ExtractableHandler>,
  setters: Map<string, SetterBinding>
): EffectSummary[] | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression) || !ts.isIdentifier(statement.expression.expression)) return undefined;
  const helper = handlers.get(statement.expression.expression.text);
  if (!helper || !ts.isBlock(helper.body)) return undefined;
  const locals = new Map<string, BoundExpr>();
  const summaries: EffectSummary[] = [];
  for (const child of helper.body.statements) {
    if (bindConstStatement(child, setters, locals)) continue;
    const summary = summarizeSetterStatement(child, setters, locals);
    if (summary) summaries.push(summary);
  }
  return summaries.length > 0 ? summaries : undefined;
}

function loopWriteTransitions(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  locator: Locator | undefined
): Transition[] {
  if (!ts.isBlock(handler.body)) return [];
  const loopSetters: SetterBinding[] = [];
  for (const statement of handler.body.statements) {
    if (!isLoopStatement(statement)) continue;
    for (const setter of settersWrittenIn(statement, setters)) loopSetters.push(setter);
  }
  return uniqueSetters(loopSetters).map((setter) => havocSetterTransition(source, fileName, node, attr, component, setter, locator, "loop"));
}

function isLoopStatement(statement: ts.Statement): boolean {
  return ts.isForStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isWhileStatement(statement) ||
    ts.isDoStatement(statement);
}

function settersWrittenIn(node: ts.Node, setters: Map<string, SetterBinding>): SetterBinding[] {
  const found: SetterBinding[] = [];
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate)) {
      const setterCall = setterCallFrom(candidate, setters);
      if (setterCall) found.push(setterCall.setter);
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function uniqueSetters(setters: readonly SetterBinding[]): SetterBinding[] {
  const byVar = new Map<string, SetterBinding>();
  for (const setter of setters) byVar.set(setter.varId, setter);
  return [...byVar.values()].sort((left, right) => left.varId.localeCompare(right.varId));
}

function setterCallFrom(call: ts.CallExpression, setters: Map<string, SetterBinding>): SetterCall | undefined {
  if (ts.isIdentifier(call.expression) && call.arguments.length === 1) {
    const setter = setters.get(call.expression.text);
    return setter ? { setter, argument: call.arguments[0]! } : undefined;
  }
  const name = callName(call.expression);
  const atomArg = call.arguments[0];
  if (name && call.arguments.length === 2 && atomArg && ts.isIdentifier(atomArg)) {
    const setter = setters.get(`${name}:${atomArg.text}`);
    return setter ? { setter, argument: call.arguments[1]! } : undefined;
  }
  return undefined;
}

function havocSetterTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  setter: SetterBinding,
  locator: Locator | undefined,
  suffix: string
): Transition {
  return {
    id: `${component}.${attr}.${setter.stateName}.${suffix}`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "havoc", var: setter.varId },
    reads: [],
    writes: [setter.varId],
    confidence: "over-approx"
  };
}

function setterArgumentExpr(
  argument: ts.Expression,
  setter: SetterBinding,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  if (ts.isObjectLiteralExpression(argument)) {
    const object = objectLiteralAssignmentExpr(argument, setter.domain, setters, locals);
    if (object) return object;
  }
  if ((ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) && argument.parameters.length === 1 && ts.isIdentifier(argument.parameters[0].name)) {
    if (ts.isBlock(argument.body)) return undefined;
    return valueExpr(argument.body, setters, new Map([...locals, [argument.parameters[0].name.text, readBinding(setter.varId)]]));
  }
  return valueExpr(argument, setters, locals);
}

function objectLiteralAssignmentExpr(
  expression: ts.ObjectLiteralExpression,
  domain: AbstractDomain,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  const value: Record<string, Value> = {};
  const reads = new Set<string>();
  const fields = domain.kind === "record" ? domain.fields : domain.kind === "tagged" ? taggedFieldsForObject(expression, domain) : {};
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = propertyName(property.name);
    if (!name) return undefined;
    const literal = literalValue(property.initializer);
    if (literal !== undefined) {
      value[name] = literal;
      continue;
    }
    const bound = valueExpr(property.initializer, setters, locals);
    if (bound?.expr.kind === "lit") {
      value[name] = bound.expr.value;
      bound.reads.forEach((read) => reads.add(read));
      continue;
    }
    value[name] = firstValue(fields[name] ?? { kind: "tokens", count: 1 });
  }
  return { expr: { kind: "lit", value }, reads: [...reads] };
}

function taggedFieldsForObject(expression: ts.ObjectLiteralExpression, domain: Extract<AbstractDomain, { kind: "tagged" }>): Record<string, AbstractDomain> {
  const tagProperty = expression.properties.find((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property) && propertyName(property.name) === domain.tag
  );
  const tag = tagProperty ? literalValue(tagProperty.initializer) : undefined;
  const variant = typeof tag === "string" ? domain.variants[tag] : undefined;
  return variant?.kind === "record" ? variant.fields : {};
}

function valueExpr(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  const value = literalValue(expression);
  if (value !== undefined) return { expr: { kind: "lit", value }, reads: [] };
  if (ts.isIdentifier(expression) || isPropertyAccessLike(expression)) return modeledReadExpr(expression, setters, locals);
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const parsed = booleanExpr(expression.operand, setters, locals);
    return parsed ? { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads } : undefined;
  }
  if (ts.isParenthesizedExpression(expression)) return valueExpr(expression.expression, setters, locals);
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return booleanExpr(expression, setters, locals);
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return nullishOptionalReadExpr(expression, setters, locals);
  }
  if (ts.isConditionalExpression(expression)) {
    const condition = booleanExpr(expression.condition, setters, locals);
    const whenTrue = valueExpr(expression.whenTrue, setters, locals);
    const whenFalse = valueExpr(expression.whenFalse, setters, locals);
    if (!condition || !whenTrue || !whenFalse) return undefined;
    return {
      expr: { kind: "cond", args: [condition.expr, whenTrue.expr, whenFalse.expr] },
      reads: [...new Set([...condition.reads, ...whenTrue.reads, ...whenFalse.reads])]
    };
  }
  if (ts.isObjectLiteralExpression(expression)) return objectSpreadUpdateExpr(expression, setters, locals);
  return undefined;
}

function objectSpreadUpdateExpr(
  expression: ts.ObjectLiteralExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  if (expression.properties.length < 2) return undefined;
  const [spread, ...properties] = expression.properties;
  if (!ts.isSpreadAssignment(spread)) return undefined;
  let current = valueExpr(spread.expression, setters, locals);
  if (!current) return undefined;
  const reads = new Set(current.reads);
  for (const property of properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = propertyName(property.name);
    if (!name) return undefined;
    const value = valueExpr(property.initializer, setters, locals);
    if (!value) return undefined;
    value.reads.forEach((read) => reads.add(read));
    current = {
      expr: { kind: "updateField", target: current.expr, path: [name], value: value.expr },
      reads: [...reads]
    };
  }
  return current;
}

interface OptionalReadPath {
  base: string;
  path: string[];
  optional: boolean;
}

function nullishOptionalReadExpr(
  expression: ts.BinaryExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map()
): BoundExpr | undefined {
  const fallback = literalValue(expression.right);
  if (fallback === undefined) return undefined;
  const read = optionalReadPath(expression.left);
  if (!read?.optional || read.path.length === 0) return undefined;
  const local = locals.get(read.base);
  const varId = local?.expr.kind === "read" ? local.expr.var : stateVarForName(read.base, setters);
  if (!varId) return undefined;
  const basePath = local?.expr.kind === "read" ? local.expr.path ?? [] : [];
  return {
    expr: {
      kind: "cond",
      args: [
        { kind: "eq", args: [{ kind: "read", var: varId, ...(basePath.length > 0 ? { path: basePath } : {}) }, { kind: "lit", value: null }] },
        { kind: "lit", value: fallback },
        { kind: "read", var: varId, path: [...basePath, ...read.path] }
      ]
    },
    reads: [varId]
  };
}

function optionalReadPath(expression: ts.Expression): OptionalReadPath | undefined {
  if (ts.isIdentifier(expression)) return { base: expression.text, path: [], optional: false };
  if (isPropertyAccessLike(expression)) {
    const base = optionalReadPath(expression.expression);
    if (!base) return undefined;
    return {
      base: base.base,
      path: [...base.path, expression.name.text],
      optional: base.optional || Boolean((expression as ts.PropertyAccessExpression & { questionDotToken?: unknown }).questionDotToken)
    };
  }
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function booleanExpr(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { expr: { kind: "lit", value: true }, reads: [] };
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { expr: { kind: "lit", value: false }, reads: [] };
  if (ts.isIdentifier(expression)) return valueExpr(expression, setters, locals);
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const parsed = booleanExpr(expression.operand, setters, locals);
    return parsed ? { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads } : undefined;
  }
  if (ts.isParenthesizedExpression(expression)) return booleanExpr(expression.expression, setters, locals);
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      const left = booleanExpr(expression.left, setters, locals);
      const right = booleanExpr(expression.right, setters, locals);
      if (!left || !right) return undefined;
      return {
        expr: { kind: expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? "and" : "or", args: [left.expr, right.expr] },
        reads: [...new Set([...left.reads, ...right.reads])]
      };
    }
    if (
      expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
      expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
    ) {
      const left = valueExpr(expression.left, setters, locals);
      const right = valueExpr(expression.right, setters, locals);
      if (!left || !right) return undefined;
      return {
        expr: {
          kind: expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ? "neq" : "eq",
          args: [left.expr, right.expr]
        },
        reads: [...new Set([...left.reads, ...right.reads])]
      };
    }
  }
  return undefined;
}

function modeledReadExpr(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  const path = propertyAccessPath(expression);
  if (!path || path.length === 0) return undefined;
  const [base, ...segments] = path;
  const local = locals.get(base);
  if (local) {
    if (segments.length === 0) return local;
    if (local.expr.kind !== "read") return undefined;
    return {
      expr: { kind: "read", var: local.expr.var, path: [...(local.expr.path ?? []), ...segments] },
      reads: local.reads
    };
  }
  const setter = setterForName(base, setters);
  const stateVar = setter?.varId;
  if (!stateVar) return undefined;
  if (setter.domain.kind === "tagged" && segments.length > 0 && segments[0] !== setter.domain.tag) {
    return { expr: { kind: "lit", value: firstValue(taggedPathDomain(setter.domain, segments) ?? { kind: "tokens", count: 1 }) }, reads: [] };
  }
  return {
    expr: { kind: "read", var: stateVar, ...(segments.length > 0 ? { path: segments } : {}) },
    reads: [stateVar]
  };
}

function readBinding(varId: string): BoundExpr {
  return { expr: { kind: "read", var: varId }, reads: [varId] };
}

function conditionalTransitionFromHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  locator: Locator | undefined
): Transition | undefined {
  const body = handler.body;
  if (!ts.isBlock(body) || body.statements.length !== 1 || !ts.isIfStatement(body.statements[0])) return undefined;
  const statement = body.statements[0];
  const condition = parseGuardExpression(statement.expression, setters);
  if (!condition) return undefined;
  const thenEffect = singleSetterEffect(statement.thenStatement, setters) ?? identityEffect();
  const elseEffect = statement.elseStatement ? singleSetterEffect(statement.elseStatement, setters) ?? identityEffect() : identityEffect();
  if (thenEffect.kind === "seq" && elseEffect.kind === "seq") return undefined;
  const writes = [...new Set([...effectWriteVars(thenEffect), ...effectWriteVars(elseEffect)])];
  const suffix = writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_") || "if";
  return {
    id: `${component}.${attr}.${suffix}.if`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "if", cond: condition.expr, then: thenEffect, else: elseEffect },
    reads: condition.reads,
    writes,
    confidence: "exact"
  };
}

function singleSetterEffect(statement: ts.Statement, setters: Map<string, SetterBinding>): Extract<Transition["effect"], { kind: "assign" }> | undefined {
  if (ts.isBlock(statement) && statement.statements.length === 1) return setterAssignEffect(statement.statements[0], setters);
  return setterAssignEffect(statement, setters);
}

function identityEffect(): Extract<Transition["effect"], { kind: "seq" }> {
  return { kind: "seq", effects: [] };
}

function effectWriteVars(effect: Transition["effect"]): string[] {
  if (effect.kind === "assign" || effect.kind === "havoc" || effect.kind === "choose") return [effect.var];
  if (effect.kind === "seq") return effect.effects.flatMap(effectWriteVars);
  if (effect.kind === "if") return [...effectWriteVars(effect.then), ...effectWriteVars(effect.else)];
  if (effect.kind === "enqueue" || effect.kind === "dequeue") return ["sys:pending"];
  if (effect.kind === "navigate") return ["sys:route", "sys:history"];
  return [...effect.ref.declaredWrites];
}

function stateNameForVar(varId: string, setters: Map<string, SetterBinding>): string | undefined {
  return [...setters.values()].find((setter) => setter.varId === varId)?.stateName;
}

function componentGuardLocalsFor(attribute: ts.JsxAttribute, setters: Map<string, SetterBinding>): Map<string, BoundExpr> {
  const body = enclosingFunctionBody(attribute);
  if (!body) return new Map();
  const locals = new Map<string, BoundExpr>();
  for (const statement of body.statements) {
    if (statement.pos > attribute.pos) break;
    if (ts.isReturnStatement(statement)) break;
    bindConstStatement(statement, setters, locals, true);
  }
  return locals;
}

function componentScopeLocalsFor(attribute: ts.JsxAttribute, setters: Map<string, SetterBinding>, contextBindings: ContextBindings): Map<string, BoundExpr> {
  const body = enclosingFunctionBody(attribute);
  if (!body) return new Map();
  const locals = new Map<string, BoundExpr>();
  for (const statement of body.statements) {
    if (statement.pos > attribute.pos) break;
    if (ts.isReturnStatement(statement)) break;
    bindConstStatement(statement, setters, locals, true);
    for (const declaration of variableDeclarations(statement)) {
      bindContextHookObjectDeclaration(declaration, contextBindings, setters);
    }
  }
  return locals;
}

function variableDeclarations(node: ts.Node): ts.VariableDeclaration[] {
  if (!ts.isVariableStatement(node)) return [];
  return [...node.declarationList.declarations];
}

function enclosingFunctionBody(node: ts.Node): ts.Block | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if ((ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) && current.body && ts.isBlock(current.body)) {
      return current.body;
    }
    current = current.parent;
  }
  return undefined;
}

function callSummaryFromHandler(handler: ExtractableHandler, setters: Map<string, SetterBinding>, initialLocals: Map<string, BoundExpr> = new Map()): { call: ts.CallExpression; locals: Map<string, BoundExpr> } | undefined {
  const body = handler.body;
  if (ts.isCallExpression(body)) return { call: body, locals: new Map(initialLocals) };
  if (ts.isVoidExpression(body) && ts.isCallExpression(body.expression)) return { call: body.expression, locals: new Map(initialLocals) };
  if (ts.isBlock(body)) {
    const locals = new Map<string, BoundExpr>(initialLocals);
    for (let index = 0; index < body.statements.length; index += 1) {
      const statement = body.statements[index];
      const isLast = index === body.statements.length - 1;
      if (isLast && ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) return { call: statement.expression, locals };
      if (isLast && ts.isExpressionStatement(statement) && ts.isVoidExpression(statement.expression) && ts.isCallExpression(statement.expression.expression)) return { call: statement.expression.expression, locals };
      if (!bindConstStatement(statement, setters, locals)) return undefined;
    }
  }
  return undefined;
}

function pluginWriteTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>,
  sourcePlugins: readonly StateSourcePlugin[],
  locator: Locator | undefined
): Transition | undefined {
  const callee = callName(call.expression);
  if (!callee) return undefined;
  const ctx: M0Ctx = {
    read: (name, path) => {
      const local = locals.get(name);
      if (local?.expr.kind === "read") {
        return { kind: "read", var: local.expr.var, path: [...(local.expr.path ?? []), ...(path ?? [])] };
      }
      const varId = stateVarForName(name, setters) ?? name;
      return { kind: "read", var: varId, ...(path && path.length > 0 ? { path } : {}) };
    },
    locator
  };
  const callSite: CallSite = {
    callee,
    arguments: call.arguments.map(callArgumentValue),
    source: { file: fileName, ...lineAndColumn(source, call) }
  };
  for (const plugin of sourcePlugins) {
    const summary = plugin.summarizeWrite?.(callSite, ctx);
    if (!summary || summary === "unsupported") continue;
    const reads = [...effectReads(summary)].sort();
    const writes = [...effectWrites(summary)].sort();
    return {
      id: `${component}.${attr}.${safeId(plugin.id)}.${safeId(callee)}`,
      cls: "user",
      label: labelForEvent(attr, locator),
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit", value: true },
      effect: summary,
      reads,
      writes,
      confidence: "exact"
    };
  }
  return undefined;
}

function callArgumentValue(argument: ts.Expression): unknown {
  const literal = literalValue(argument);
  if (literal !== undefined) return literal;
  if (ts.isIdentifier(argument)) return argument.text;
  if (ts.isObjectLiteralExpression(argument)) {
    const fields: Record<string, unknown> = {};
    for (const property of argument.properties) {
      if (!ts.isPropertyAssignment(property)) return argument.getText();
      const name = propertyName(property.name);
      if (!name) return argument.getText();
      fields[name] = callArgumentValue(property.initializer);
    }
    return fields;
  }
  return argument.getText();
}

function swrMutateTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  locator: Locator | undefined
): Transition | undefined {
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "mutate") return undefined;
  return {
    id: `${component}.${attr}.mutate`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "seq", effects: [] },
    reads: [],
    writes: [],
    confidence: "exact"
  };
}

function noopCallTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  locator: Locator | undefined
): Transition | undefined {
  const name = callName(call.expression) ?? call.expression.getText(source);
  if (!isKnownPureUiCall(name)) return undefined;
  return {
    id: `${component}.${attr}.${safeId(name)}.noop`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "seq", effects: [] },
    reads: [],
    writes: [],
    confidence: "exact"
  };
}

function isKnownPureUiCall(name: string): boolean {
  return name.endsWith(".click") || name === "confirm" || name === "navigator.clipboard.writeText" || name.endsWith(".writeText");
}

function bindConstStatement(statement: ts.Statement, setters: Map<string, SetterBinding>, locals: Map<string, BoundExpr>, partialBoolean = false): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  if ((ts.getCombinedNodeFlags(statement.declarationList) & ts.NodeFlags.Const) === 0) return false;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return false;
    const setterAlias = ts.isIdentifier(declaration.initializer) ? setters.get(declaration.initializer.text) ?? locals.get(declaration.initializer.text)?.setter : undefined;
    const binding: BoundExpr | undefined = setterAlias ? { expr: { kind: "lit", value: null }, reads: [], setter: setterAlias } : valueExpr(declaration.initializer, setters, locals) ??
      (partialBoolean ? parseConjunctiveGuardExpression(declaration.initializer, setters, locals) : booleanExpr(declaration.initializer, setters, locals));
    if (!binding) return false;
    locals.set(declaration.name.text, binding);
  }
  return true;
}

function inlinedHelperCall(call: ts.CallExpression, handlers: Map<string, ExtractableHandler>, setters: Map<string, SetterBinding>): { call: ts.CallExpression; locals: Map<string, BoundExpr> } | undefined {
  if (!ts.isIdentifier(call.expression) || call.arguments.length !== 0) return undefined;
  const helper = handlers.get(call.expression.text);
  return helper ? callSummaryFromHandler(helper, setters) : undefined;
}

function navigationTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  locator: Locator | undefined,
  routerPlugin: RouterPlugin | undefined,
  routePatterns: readonly string[] = []
): Transition | undefined {
  const navigation = navigationCall(call, routerPlugin, routePatterns);
  if (!navigation) return undefined;
  const routeId = navigation.to ? safeId(navigation.to) : "back";
  return {
    id: `${component}.${attr}.navigate.${routeId}`,
    cls: "nav",
    label: {
      kind: "navigate",
      mode: navigation.mode === "replace" ? "push" : navigation.mode,
      ...(navigation.to ? { to: navigation.to } : {})
    },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: {
      kind: "navigate",
      mode: navigation.mode,
      ...(navigation.to ? { to: { kind: "lit", value: navigation.to } } : {})
    },
    reads: navigation.mode === "push" || navigation.mode === "back" ? ["sys:route", "sys:history"] : ["sys:history"],
    writes: ["sys:route", "sys:history"],
    confidence: "exact"
  };
}

function navigationCall(call: ts.CallExpression, routerPlugin: RouterPlugin | undefined, routePatterns: readonly string[] = []): { mode: "push" | "replace" | "back"; to?: string } | undefined {
  const name = callName(call.expression);
  if (!name) return undefined;
  const pluginNavigation = routerPlugin?.navigationCall(name, call.arguments.map(callArgumentValue));
  if (pluginNavigation && pluginNavigation !== "unsupported") return pluginNavigation;
  if (name === "navigate" && call.arguments.length === 1) {
    const to = routeTargetValue(call.arguments[0], routePatterns);
    return typeof to === "string" ? { mode: "push", to } : undefined;
  }
  if ((name.endsWith(".push") || name.endsWith(".replace")) && call.arguments.length === 1) {
    const to = routeTargetValue(call.arguments[0], routePatterns);
    if (typeof to !== "string") return undefined;
    return { mode: name.endsWith(".replace") ? "replace" : "push", to };
  }
  if (name.endsWith(".back") && call.arguments.length === 0) {
    return { mode: "back" };
  }
  return undefined;
}

function linkNavigationTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
  component: string,
  routePatterns: readonly string[]
): Transition | undefined {
  if ((!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) || node.tagName.getText(source) !== "Link") return undefined;
  const toAttr = node.attributes.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === "to"
  );
  if (!toAttr) return undefined;
  const to = jsxRouteTarget(toAttr, routePatterns);
  if (!to) return undefined;
  return {
    id: `${component}.Link.navigate.${safeId(to)}`,
    cls: "nav",
    label: { kind: "navigate", mode: "push", to },
    source: [{ file: fileName, ...lineAndColumn(source, toAttr) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "navigate", mode: "push", to: { kind: "lit", value: to } },
    reads: ["sys:route", "sys:history"],
    writes: ["sys:route", "sys:history"],
    confidence: "exact"
  };
}

function jsxRouteTarget(attribute: ts.JsxAttribute, routePatterns: readonly string[]): string | undefined {
  if (!attribute.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return normalizeRouteTarget(attribute.initializer.text, routePatterns);
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return undefined;
  return routeTargetValue(attribute.initializer.expression, routePatterns);
}

function routeTargetValue(expression: ts.Expression | undefined, routePatterns: readonly string[]): string | undefined {
  if (!expression) return undefined;
  const literal = literalValue(expression);
  if (typeof literal === "string") return normalizeRouteTarget(literal, routePatterns);
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return normalizeRouteTarget(expression.text, routePatterns);
  if (ts.isTemplateExpression(expression)) {
    const pattern = templateRoutePattern(expression);
    return pattern ? normalizeRouteTarget(pattern, routePatterns) : undefined;
  }
  return undefined;
}

function templateRoutePattern(expression: ts.TemplateExpression): string | undefined {
  let value = expression.head.text;
  for (const span of expression.templateSpans) value += ":param" + span.literal.text;
  return value;
}

function normalizeRouteTarget(target: string, routePatterns: readonly string[]): string {
  const slash = target.startsWith("/") ? target : `/${target}`;
  const matched = routePatterns.find((pattern) => routePatternMatches(pattern, slash));
  return matched ?? slash.replace(/\/:param(?=\/|$)/g, "/:id");
}

function routePatternMatches(pattern: string, target: string): boolean {
  const left = pattern.replace(/^\/+/, "").split("/");
  const right = target.replace(/^\/+/, "").split("/");
  if (left.length !== right.length) return false;
  return left.every((part, index) => part.startsWith(":") || part === "*" || part === right[index] || right[index] === ":param");
}

function escapedSetters(call: ts.CallExpression, setters: Map<string, SetterBinding>, locals: Map<string, BoundExpr> = new Map()): SetterBinding[] {
  return call.arguments
    .filter(ts.isIdentifier)
    .map((arg) => setters.get(arg.text) ?? locals.get(arg.text)?.setter)
    .filter((setter): setter is SetterBinding => Boolean(setter));
}

function escapedSetterTransitions(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  setters: readonly SetterBinding[],
  locator: Locator | undefined
): Transition[] {
  return setters.map((setter) => ({
    id: `${component}.${attr}.${setter.stateName}.escaped`,
    cls: "user" as const,
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit" as const, value: true },
    effect: { kind: "havoc" as const, var: setter.varId },
    reads: [],
    writes: [setter.varId],
    confidence: "over-approx" as const
  }));
}

function inputTransitions(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  setter: SetterBinding,
  locator: Locator | undefined
): Transition[] {
  const literalValues = literalInputValues(node);
  const finite = literalValues
    ? finiteInputValues(setter.domain).filter(({ valueClass }) => literalValues.has(valueClass))
    : finiteInputValues(setter.domain);
  if (finite.length > 0) {
    return finite.map(({ value, valueClass }) => ({
      id: `${component}.${attr}.${setter.stateName}.${safeId(valueClass)}`,
      cls: "user" as const,
      label: { kind: "input" as const, valueClass, ...(locator ? { locator } : {}) },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit" as const, value: true },
      effect: { kind: "assign" as const, var: setter.varId, expr: { kind: "lit" as const, value } },
      reads: [],
      writes: [setter.varId],
      confidence: "exact" as const
    }));
  }
  return [{
    id: `${component}.${attr}.${setter.stateName}`,
    cls: "user",
    label: { kind: "input", valueClass: valueClassForDomain(setter.domain), ...(locator ? { locator } : {}) },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "havoc", var: setter.varId },
    reads: [],
    writes: [setter.varId],
    confidence: "over-approx"
  }];
}

function literalInputValues(attribute: ts.JsxAttribute): Set<string> | undefined {
  return selectOptionValues(attribute) ?? radioInputValue(attribute);
}

function selectOptionValues(attribute: ts.JsxAttribute): Set<string> | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const opening = attrs.parent;
  if (!ts.isJsxOpeningElement(opening) || opening.tagName.getText() !== "select" || !ts.isJsxElement(opening.parent)) return undefined;
  const values = opening.parent.children
    .filter(ts.isJsxElement)
    .filter((child) => child.openingElement.tagName.getText() === "option")
    .map((child) => optionValue(child))
    .filter((value): value is string => Boolean(value));
  return values.length > 0 ? new Set(values) : undefined;
}

function optionValue(option: ts.JsxElement): string | undefined {
  const value = stringAttribute(option.openingElement.attributes, "value");
  if (value) return value;
  return simpleElementText(option.openingElement);
}

function radioInputValue(attribute: ts.JsxAttribute): Set<string> | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const opening = attrs.parent;
  if (!ts.isJsxOpeningElement(opening) && !ts.isJsxSelfClosingElement(opening)) return undefined;
  if (opening.tagName.getText() !== "input" || stringAttribute(attrs, "type") !== "radio") return undefined;
  const value = stringAttribute(attrs, "value");
  return value ? new Set([value]) : undefined;
}

function finiteInputValues(domain: AbstractDomain): { value: Value; valueClass: string }[] {
  if (domain.kind === "enum") return domain.values.map((value) => ({ value, valueClass: value }));
  if (domain.kind === "boundedInt") {
    return Array.from({ length: domain.max - domain.min + 1 }, (_, index) => {
      const value = domain.min + index;
      return { value, valueClass: String(value) };
    });
  }
  if (domain.kind === "bool") {
    return [
      { value: false, valueClass: "false" },
      { value: true, valueClass: "true" }
    ];
  }
  return [];
}

function handlerExpression(expression: ts.Expression | undefined, handlers: Map<string, ExtractableHandler>): ExtractableHandler | undefined {
  if (!expression) return undefined;
  if (isExtractableHandler(expression)) return expression;
  if (ts.isIdentifier(expression)) return handlers.get(expression.text);
  return undefined;
}

function componentDeclarations(source: ts.SourceFile): Map<string, ComponentDecl> {
  const components = new Map<string, ComponentDecl>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && startsUppercase(node.name.text)) {
      components.set(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && startsUppercase(node.name.text) && node.initializer && isExtractableHandler(node.initializer)) {
      components.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return components;
}

function customHookDeclarations(source: ts.SourceFile): Map<string, CustomHookDecl> {
  const hooks = new Map<string, CustomHookDecl>();
  const visit = (node: ts.Node): void => {
    const name = customHookDeclarationName(node);
    if (name) {
      if (ts.isFunctionDeclaration(node)) hooks.set(name, node);
      else if (ts.isVariableDeclaration(node) && node.initializer && isExtractableHandler(node.initializer)) hooks.set(name, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hooks;
}

function isCustomHookDeclaration(node: ts.Node): boolean {
  return Boolean(customHookDeclarationName(node));
}

function inlineCustomHookState(
  source: ts.SourceFile,
  fileName: string,
  node: ts.VariableDeclaration,
  customHooks: Map<string, CustomHookDecl>,
  vars: StateVarDecl[],
  setters: Map<string, SetterBinding>,
  component: string,
  route: string
): boolean {
  if (!ts.isArrayBindingPattern(node.name) || !node.initializer || !ts.isCallExpression(node.initializer) || !ts.isIdentifier(node.initializer.expression)) return false;
  const hook = customHooks.get(node.initializer.expression.text);
  if (!hook) return false;
  const stateName = node.name.elements[0];
  const setterName = node.name.elements[1];
  if (!ts.isBindingElement(stateName) || !ts.isIdentifier(stateName.name) || !ts.isBindingElement(setterName) || !ts.isIdentifier(setterName.name)) return false;
  const summary = hookStateReturn(hook);
  if (!summary) return false;
  const varId = `local:${component}.${stateName.name.text}`;
  const decl: StateVarDecl = {
    id: varId,
    domain: summary.domain,
    origin: { file: fileName, ...lineAndColumn(source, node) },
    scope: { kind: "route-local", route },
    initial: summary.initial
  };
  vars.push(decl);
  setters.set(setterName.name.text, { varId, component, stateName: stateName.name.text, domain: summary.domain });
  return true;
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
      if (!ts.isArrayBindingPattern(decl.name) || !decl.initializer || !isUseStateCall(decl.initializer)) continue;
      const state = decl.name.elements[0];
      const setter = decl.name.elements[1];
      if (!ts.isBindingElement(state) || !ts.isIdentifier(state.name) || !ts.isBindingElement(setter) || !ts.isIdentifier(setter.name)) return undefined;
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
  if (!ts.isIdentifier(elements[0]) || elements[0].text !== stateName || !ts.isIdentifier(elements[1]) || elements[1].text !== setterName) return undefined;
  const domain = inferUseStateDomain(stateCall);
  return { domain, initial: initialValueForUseState(stateCall, domain) };
}

function hookBody(hook: CustomHookDecl): ts.Block | undefined {
  if (ts.isFunctionDeclaration(hook)) return hook.body;
  return ts.isBlock(hook.body) ? hook.body : undefined;
}

function returnedArrayElements(expression: ts.Expression): ts.NodeArray<ts.Expression> | undefined {
  if (ts.isArrayLiteralExpression(expression)) return expression.elements;
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isParenthesizedExpression(expression)) return returnedArrayElements(expression.expression);
  return undefined;
}

function customHookDeclarationName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name && isCustomHookName(node.name.text)) return node.name.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isCustomHookName(node.name.text) && node.initializer && isExtractableHandler(node.initializer)) {
    return node.name.text;
  }
  return undefined;
}

function calledCustomHook(node: ts.Node, customHooks: Set<string>): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
  return customHooks.has(node.expression.text) ? node.expression.text : undefined;
}

function isCustomHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name) && name !== "useState" && name !== "useEffect" && name !== "useReducer" && name !== "useRef";
}

function detectStatefulListComponents(source: ts.SourceFile, components: Map<string, ComponentDecl>): Set<string> {
  const listComponents = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map") {
      for (const rendered of jsxComponentTags(node)) {
        const component = components.get(rendered);
        if (component && componentHasUseState(component)) listComponents.add(rendered);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return listComponents;
}

function listRenderedHandlerInfo(
  attribute: ts.JsxAttribute,
  vars: readonly StateVarDecl[],
  component: string
): { varId: string; domain: AbstractDomain; itemName: string } | undefined {
  let current: ts.Node = attribute;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === "map") {
      const callback = parent.arguments[0];
      if (callback && current.pos >= callback.pos && current.end <= callback.end) {
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

function mapItemName(callback: ts.Expression): string | undefined {
  if ((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters.length > 0) {
    const name = callback.parameters[0]?.name;
    return name && ts.isIdentifier(name) ? name.text : undefined;
  }
  return undefined;
}

function stateVarInfoForName(
  name: string,
  vars: readonly StateVarDecl[],
  component: string
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

function componentPropTrigger(
  source: ts.SourceFile,
  component: ComponentDecl,
  propName: string,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[]
): { attr: string; locator?: Locator; guard?: ParsedGuard } | undefined {
  const localHandlers = componentLocalHandlers(component);
  let trigger: { attr: string; locator?: Locator; guard?: ParsedGuard } | undefined;
  const visit = (node: ts.Node): void => {
    if (trigger) return;
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.initializer && isEventAttribute(node.name.text) && isIntrinsicJsxAttribute(node)) {
      const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
      const handler = handlerExpression(expression, localHandlers);
      if (expression && (expressionReferencesProp(expression, component, propName) || (handler && handlerCallsProp(handler, component, propName, localHandlers)))) {
        trigger = {
          attr: node.name.text,
          locator: locatorForEventAttribute(node),
          guard: disabledGuardFor(node, setters, warnings, source, componentName(component) ?? "Anonymous")
        };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(component);
  return trigger;
}

function transparentComponentPropTrigger(component: ComponentDecl, propName: string): { attr: string; locator?: Locator; guard?: ParsedGuard } | undefined {
  if (!isForwardablePropName(propName) || !componentSpreadsPropsToElement(component)) return undefined;
  return { attr: propName };
}

function componentSpreadsPropsToElement(component: ComponentDecl): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.attributes.properties.some(ts.isJsxSpreadAttribute)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(component);
  return found;
}

function forwardsComponentProp(node: ts.JsxAttribute, handlers: Map<string, ExtractableHandler>, component: ComponentDecl | undefined): boolean {
  if (!component || !node.initializer) return false;
  const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
  if (expression && expressionReferencesForwardableProp(expression, component)) return true;
  const localHandlers = componentLocalHandlers(component);
  const handler = handlerExpression(expression, handlers) ?? handlerExpression(expression, localHandlers);
  return Boolean(handler && handlerCallsForwardableProp(handler, component, localHandlers));
}

function componentLocalHandlers(component: ComponentDecl): Map<string, ExtractableHandler> {
  const localHandlers = new Map<string, ExtractableHandler>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isExtractableHandler(node.initializer)) {
      localHandlers.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(component);
  return localHandlers;
}

function handlerCallsProp(handler: ExtractableHandler, component: ComponentDecl, propName: string, localHandlers: Map<string, ExtractableHandler>, seen = new Set<ExtractableHandler>()): boolean {
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
        if (local && handlerCallsProp(local, component, propName, localHandlers, seen)) {
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

function handlerCallsForwardableProp(handler: ExtractableHandler, component: ComponentDecl, localHandlers: Map<string, ExtractableHandler>): boolean {
  return forwardableComponentPropNames(component).some((propName) => handlerCallsProp(handler, component, propName, localHandlers));
}

function expressionReferencesForwardableProp(expression: ts.Expression, component: ComponentDecl): boolean {
  return forwardableComponentPropNames(component).some((propName) => expressionReferencesProp(expression, component, propName));
}

function expressionReferencesProp(expression: ts.Expression, component: ComponentDecl, propName: string): boolean {
  const aliases = componentPropAliases(component, propName);
  const propObjects = componentPropObjectNames(component);
  if (ts.isIdentifier(expression)) return aliases.has(expression.text);
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== propName) return false;
  if (propObjects.size === 0) return true;
  return ts.isIdentifier(expression.expression) && propObjects.has(expression.expression.text);
}

function callInvokesProp(expression: ts.Expression, propName: string, aliases: Set<string>, propObjects: Set<string>): boolean {
  if (ts.isIdentifier(expression)) return aliases.has(expression.text);
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== propName) return false;
  if (propObjects.size === 0) return true;
  return ts.isIdentifier(expression.expression) && propObjects.has(expression.expression.text);
}

function componentPropAliases(component: ComponentDecl, propName: string): Set<string> {
  const aliases = new Set<string>();
  const firstParam = component.parameters[0];
  if (!firstParam || !ts.isObjectBindingPattern(firstParam.name)) return aliases;
  for (const element of firstParam.name.elements) {
    const name = element.name;
    if (!ts.isIdentifier(name)) continue;
    const propertyName = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : name.text;
    if (propertyName === propName) aliases.add(name.text);
  }
  return aliases;
}

function forwardableComponentPropNames(component: ComponentDecl): string[] {
  const names = new Set<string>();
  const firstParam = component.parameters[0];
  if (!firstParam) return [];
  if (ts.isObjectBindingPattern(firstParam.name)) {
    for (const element of firstParam.name.elements) {
      const name = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : ts.isIdentifier(element.name) ? element.name.text : undefined;
      if (name && isForwardablePropName(name)) names.add(name);
    }
  }
  if (ts.isIdentifier(firstParam.name)) {
    if (!component.body) return [...names].sort();
    const objectName = firstParam.name.text;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === objectName && isForwardablePropName(node.name.text)) {
        names.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(component.body);
  }
  return [...names].sort();
}

function componentPropObjectNames(component: ComponentDecl): Set<string> {
  const firstParam = component.parameters[0];
  return new Set(firstParam && ts.isIdentifier(firstParam.name) ? [firstParam.name.text] : []);
}

function componentName(component: ComponentDecl): string | undefined {
  if (ts.isFunctionDeclaration(component) && component.name) return component.name.text;
  return componentNameFor(component.parent);
}

function isForwardablePropName(name: string): boolean {
  return /^on[A-Z]/.test(name);
}

function isIntrinsicJsxAttribute(attribute: ts.JsxAttribute): boolean {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return false;
  const parent = attrs.parent;
  if (!ts.isJsxOpeningElement(parent) && !ts.isJsxSelfClosingElement(parent)) return false;
  const tag = parent.tagName;
  return ts.isIdentifier(tag) && !startsUppercase(tag.text);
}

function jsxTagName(attribute: ts.JsxAttribute): string | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const parent = attrs.parent;
  if (!ts.isJsxOpeningElement(parent) && !ts.isJsxSelfClosingElement(parent)) return undefined;
  return ts.isIdentifier(parent.tagName) ? parent.tagName.text : undefined;
}

function transitionsFromAsyncHandler(
  source: ts.SourceFile,
  fileName: string,
  attr: string,
  expression: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  locator: Locator | undefined,
  routePatterns: readonly string[],
  warnings: ExtractionWarning[]
): Transition[] {
  if (!ts.isBlock(expression.body)) return [];
  const statements = expression.body.statements;
  const tryStatement = statements.find(ts.isTryStatement);
  const awaitStatement = tryStatement
    ? tryStatement.tryBlock.statements.find((statement) => expressionStatementAwait(statement, effectApis))
    : statements.find((statement) => expressionStatementAwait(statement, effectApis));
  if (!awaitStatement) return [];
  const awaited = awaitedCall(awaitStatement, effectApis);
  const op = awaited?.op;
  if (!op) return [];
  const opArgs = awaited ? effectCallArgs(awaited.call, setters, new Map()) : { args: {}, reads: [] };
  const preStatements = tryStatement ? statements.slice(0, statements.indexOf(tryStatement)) : statements.slice(0, statements.indexOf(awaitStatement));
  const preSummaries = summarizeAsyncSegment(preStatements, setters);
  const successStatements = tryStatement ? tryStatement.tryBlock.statements.slice(tryStatement.tryBlock.statements.indexOf(awaitStatement) + 1) : statements.slice(statements.indexOf(awaitStatement) + 1);
  if (!tryStatement) {
    const chained = transitionsFromSequentialAwait(source, fileName, attr, expression, awaitStatement, op, preSummaries, successStatements, setters, effectApis, component, locator, warnings);
    if (chained.length > 0) return chained;
  }
  if (containsAwaitedEffect(successStatements, effectApis) || (tryStatement?.catchClause && containsAwaitedEffect(tryStatement.catchClause.block.statements, effectApis))) {
    warnings.push({ message: `Unextractable handler ${component}.${attr}`, ...lineAndColumn(source, awaitStatement) });
    return [];
  }
  const successSummaries = summarizeAsyncSegment(successStatements, setters);
  const catchSummaries = tryStatement?.catchClause ? summarizeAsyncSegment(tryStatement.catchClause.block.statements, setters) : [];
  const preEffects = preSummaries.map((summary) => summary.effect);
  const finallySummaries = tryStatement?.finallyBlock ? summarizeAsyncSegment(tryStatement.finallyBlock.statements, setters) : [];
  const finallyEffects = finallySummaries.map((summary) => summary.effect);
  const successEffects = [...successSummaries.map((summary) => summary.effect), ...finallyEffects];
  const catchEffects = [...catchSummaries.map((summary) => summary.effect), ...finallyEffects];
  const preReads = uniqueStrings([...preSummaries.flatMap((summary) => summary.reads), ...opArgs.reads]);
  const successReads = uniqueStrings([...successSummaries.flatMap((summary) => summary.reads), ...finallySummaries.flatMap((summary) => summary.reads)]);
  const catchReads = uniqueStrings([...catchSummaries.flatMap((summary) => summary.reads), ...finallySummaries.flatMap((summary) => summary.reads)]);
  if (successEffects.length === 0 && catchEffects.length === 0) return [];
  const writes = uniqueStrings([...preEffects, ...successEffects, ...catchEffects].flatMap(effectWriteVars));
  const baseId = `${component}.${attr}.${op}`;
  for (const read of uniqueStrings([...successReads, ...catchReads])) {
    warnings.push({ message: `Stale-read risk ${baseId}:${read}`, ...lineAndColumn(source, awaitStatement) });
  }
  const sourceAnchor = [{ file: fileName, ...lineAndColumn(source, expression) }];
  const enqueue: Transition = {
    id: `${baseId}.start`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: sourceAnchor,
    guard: { kind: "lit", value: true },
    effect: { kind: "seq", effects: [...preEffects, { kind: "enqueue", op, continuation: `${baseId}.cont`, args: opArgs.args }] },
    reads: preReads,
    writes: uniqueStrings([...preEffects.flatMap(effectWriteVars), "sys:pending"]),
    confidence: confidenceForEffects(preEffects)
  };
  const success: Transition = {
    id: `${baseId}.success`,
    cls: "env",
    label: { kind: "resolve", op, outcome: "success" },
    source: sourceAnchor,
    guard: pendingIs(op),
    effect: { kind: "seq", effects: [{ kind: "dequeue", index: 0 }, ...successEffects] },
    reads: uniqueStrings(["sys:pending", ...successReads]),
    writes: [...new Set(["sys:pending", ...successEffects.flatMap(effectWriteVars)])],
    confidence: confidenceForEffects(successEffects)
  };
  const successNavigate = firstNavigationInStatements(successStatements, routePatterns);
  const transitions = [enqueue, successNavigate ? appendEffect(success, navigationEffect(successNavigate)) : success];
  if (catchEffects.length > 0 || asyncOutcomes[op]?.error !== undefined) {
    const errorTransition: Transition = {
      id: `${baseId}.error`,
      cls: "env",
      label: { kind: "resolve", op, outcome: "error" },
      source: sourceAnchor,
      guard: pendingIs(op),
      effect: { kind: "seq", effects: [{ kind: "dequeue", index: 0 }, ...catchEffects] },
      reads: uniqueStrings(["sys:pending", ...catchReads]),
      writes: [...new Set(["sys:pending", ...catchEffects.flatMap(effectWriteVars)])],
      confidence: confidenceForEffects(catchEffects)
    };
    transitions.push(errorTransition);
  } else {
    warnings.push({ message: `Unhandled rejection ${baseId}`, ...lineAndColumn(source, awaitStatement) });
  }
  return transitions.map((transition) => ({ ...transition, writes: [...new Set(transition.writes)] }));
}

function transitionsFromSequentialAwait(
  source: ts.SourceFile,
  fileName: string,
  attr: string,
  expression: ExtractableHandler,
  firstAwait: ts.Statement,
  firstOp: string,
  preSummaries: readonly EffectSummary[],
  successStatements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  effectApis: Set<string>,
  component: string,
  locator: Locator | undefined,
  warnings: ExtractionWarning[]
): Transition[] {
  const secondIndex = successStatements.findIndex((statement) => expressionStatementAwait(statement, effectApis));
  if (secondIndex < 0) return [];
  const secondAwait = successStatements[secondIndex]!;
  const secondOp = awaitedOp(secondAwait, effectApis);
  const promiseAllOps = secondOp ? undefined : promiseAllAwaitOps(secondAwait, effectApis);
  if (!secondOp && !promiseAllOps) return [];
  const betweenStatements = successStatements.slice(0, secondIndex);
  const tailStatements = successStatements.slice(secondIndex + 1);
  if (containsAwaitedEffect(tailStatements, effectApis)) return [];
  const betweenSummaries = summarizeAsyncSegment(betweenStatements, setters);
  const tailSummaries = summarizeAsyncSegment(tailStatements, setters);
  const preEffects = preSummaries.map((summary) => summary.effect);
  const betweenEffects = betweenSummaries.map((summary) => summary.effect);
  const tailEffects = tailSummaries.map((summary) => summary.effect);
  if (tailEffects.length === 0) return [];
  const preReads = uniqueStrings(preSummaries.flatMap((summary) => summary.reads));
  const betweenReads = uniqueStrings(betweenSummaries.flatMap((summary) => summary.reads));
  const tailReads = uniqueStrings(tailSummaries.flatMap((summary) => summary.reads));
  const firstBaseId = `${component}.${attr}.${firstOp}`;
  const secondBaseId = `${component}.${attr}.${secondOp ?? "Promise_all"}`;
  for (const read of uniqueStrings([...betweenReads, ...tailReads])) {
    warnings.push({ message: `Stale-read risk ${firstBaseId}:${read}`, ...lineAndColumn(source, firstAwait) });
  }
  warnings.push({ message: `Unhandled rejection ${firstBaseId}`, ...lineAndColumn(source, firstAwait) });
  for (const op of promiseAllOps ?? [secondOp!]) {
    warnings.push({ message: `Unhandled rejection ${component}.${attr}.${op}`, ...lineAndColumn(source, secondAwait) });
  }
  const sourceAnchor = [{ file: fileName, ...lineAndColumn(source, expression) }];
  const secondEnqueueEffects: EffectIR[] = promiseAllOps
    ? promiseAllOps.map((op) => ({ kind: "enqueue", op, continuation: `${secondBaseId}.cont`, args: {} }))
    : [{ kind: "enqueue", op: secondOp!, continuation: `${secondBaseId}.cont`, args: {} }];
  const secondSuccess: Transition = promiseAllOps
    ? {
        id: `${secondBaseId}.success`,
        cls: "env",
        label: { kind: "internal", text: `${secondBaseId}.join` },
        source: sourceAnchor,
        guard: promiseAllGuard(promiseAllOps),
        effect: { kind: "seq", effects: [...promiseAllOps.map((_, index) => ({ kind: "dequeue" as const, index })).reverse(), ...tailEffects] },
        reads: uniqueStrings(["sys:pending", ...tailReads]),
        writes: uniqueStrings(["sys:pending", ...tailEffects.flatMap(effectWriteVars)]),
        confidence: confidenceForEffects(tailEffects)
      }
    : {
        id: `${secondBaseId}.success`,
        cls: "env",
        label: { kind: "resolve", op: secondOp!, outcome: "success" },
        source: sourceAnchor,
        guard: pendingIs(secondOp!),
        effect: { kind: "seq", effects: [{ kind: "dequeue", index: 0 }, ...tailEffects] },
        reads: uniqueStrings(["sys:pending", ...tailReads]),
        writes: uniqueStrings(["sys:pending", ...tailEffects.flatMap(effectWriteVars)]),
        confidence: confidenceForEffects(tailEffects)
      };
  const transitions: Transition[] = [
    {
      id: `${firstBaseId}.start`,
      cls: "user",
      label: labelForEvent(attr, locator),
      source: sourceAnchor,
      guard: { kind: "lit", value: true },
      effect: { kind: "seq", effects: [...preEffects, { kind: "enqueue", op: firstOp, continuation: `${firstBaseId}.cont`, args: {} }] },
      reads: preReads,
      writes: uniqueStrings([...preEffects.flatMap(effectWriteVars), "sys:pending"]),
      confidence: confidenceForEffects(preEffects)
    },
    {
      id: `${firstBaseId}.success`,
      cls: "env",
      label: { kind: "resolve", op: firstOp, outcome: "success" },
      source: sourceAnchor,
      guard: pendingIs(firstOp),
      effect: { kind: "seq", effects: [{ kind: "dequeue", index: 0 }, ...betweenEffects, ...secondEnqueueEffects] },
      reads: uniqueStrings(["sys:pending", ...betweenReads]),
      writes: uniqueStrings(["sys:pending", ...betweenEffects.flatMap(effectWriteVars)]),
      confidence: confidenceForEffects(betweenEffects)
    },
    secondSuccess
  ];
  return transitions.map((transition) => ({ ...transition, writes: uniqueStrings(transition.writes) }));
}

function promiseAllGuard(ops: readonly string[]): ExprIR {
  return ops
    .map((op, index): ExprIR => pendingIsAt(index, op))
    .reduce(andGuard);
}

function confidenceForEffects(effects: readonly EffectIR[]): Transition["confidence"] {
  return effects.some((effect) => effect.kind === "havoc") ? "over-approx" : "exact";
}

function summarizeAsyncSegment(statements: readonly ts.Statement[], setters: Map<string, SetterBinding>): EffectSummary[] {
  const summaries: EffectSummary[] = [];
  for (const statement of statements) {
    const summary = summarizeSetterStatement(statement, setters);
    if (summary) {
      summaries.push(summary);
      continue;
    }
    for (const setter of escapedSettersInStatement(statement, setters)) {
      summaries.push({ effect: { kind: "havoc", var: setter.varId }, reads: [] });
    }
    for (const setter of settersWrittenIn(statement, setters)) {
      summaries.push({ effect: { kind: "havoc", var: setter.varId }, reads: [] });
    }
  }
  return uniqueSummariesByEffect(summaries);
}

function escapedSettersInStatement(statement: ts.Statement, setters: Map<string, SetterBinding>): SetterBinding[] {
  const found: SetterBinding[] = [];
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate)) found.push(...escapedSetters(candidate, setters));
    ts.forEachChild(candidate, visit);
  };
  visit(statement);
  return uniqueSetters(found);
}

function uniqueSummariesByEffect(summaries: readonly EffectSummary[]): EffectSummary[] {
  const seen = new Set<string>();
  const out: EffectSummary[] = [];
  for (const summary of summaries) {
    const key = JSON.stringify(summary.effect);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(summary);
  }
  return out;
}

function summarizeSetterStatement(statement: ts.Statement, setters: Map<string, SetterBinding>, locals: Map<string, BoundExpr> = new Map()): EffectSummary | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return undefined;
  return summarizeSetterCall(statement.expression, setters, locals);
}

function summarizeSetterCall(call: ts.CallExpression, setters: Map<string, SetterBinding>, locals: Map<string, BoundExpr> = new Map()): EffectSummary | undefined {
  const setterCall = setterCallFrom(call, setters);
  if (!setterCall) return undefined;
  const assignment = setterArgumentExpr(setterCall.argument, setterCall.setter, setters, locals);
  if (!assignment) {
    return {
      effect: { kind: "havoc", var: setterCall.setter.varId },
      reads: []
    };
  }
  return {
    effect: { kind: "assign", var: setterCall.setter.varId, expr: assignment.expr },
    reads: assignment.reads
  };
}

function transitionsFromUseEffect(
  source: ts.SourceFile,
  fileName: string,
  node: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  component: string
): Transition[] {
  const callback = node.arguments[0];
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) || !ts.isBlock(callback.body)) return [];
  const cleanup = cleanupSummaries(callback.body.statements, setters);
  const bodyStatements = callback.body.statements.filter((statement) => !isCleanupReturn(statement));
  const summaries = summarizeEffectStatements(bodyStatements, setters);
  if (!summaries || !cleanup) return [];
  const transitions: Transition[] = [];
  const effectReads = uniqueStrings(summaries.flatMap((summary) => summary.reads));
  const deps = dependencyReads(node.arguments[1], setters, effectReads);
  const effects = summaries.map((summary) => summary.effect);
  const hasExplicitDependencyArray = Boolean(node.arguments[1] && ts.isArrayLiteralExpression(node.arguments[1]));
  const hasUntriggeredHavocEffect = hasExplicitDependencyArray && deps.length === 0 && effects.some((effect) => effect.kind === "havoc");
  if (effects.length > 0 && !hasUntriggeredHavocEffect) {
    const assignEffects = effects.filter((effect): effect is Extract<Transition["effect"], { kind: "assign" }> => effect.kind === "assign");
    const guards: ExprIR[] = assignEffects.map((effect) => ({ kind: "neq", args: [{ kind: "read", var: effect.var }, effect.expr] }));
    const guard = guards.length > 0 ? guards.slice(1).reduce((acc, next) => andGuard(acc, next), guards[0]!) : { kind: "lit" as const, value: true };
    transitions.push({
      id: `${component}.useEffect.${effects.flatMap(effectWriteVars).map((varId) => varId.split(".").at(-1) ?? varId).join("_")}`,
      cls: "internal",
      label: { kind: "internal", text: `${component}.useEffect` },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard,
      effect: effects.length === 1 ? effects[0] : { kind: "seq", effects },
      reads: uniqueStrings([...deps, ...effectReads, ...effects.flatMap(effectWriteVars)]),
      writes: uniqueStrings(effects.flatMap(effectWriteVars)),
      confidence: effects.some((effect) => effect.kind === "havoc") ? "over-approx" : "exact",
      triggeredBy: deps
    });
  }
  if (cleanup.length > 0) {
    const cleanupEffects = cleanup.map((summary) => summary.effect);
    const cleanupReads = uniqueStrings(cleanup.flatMap((summary) => summary.reads));
    transitions.push({
      id: `${component}.useEffect.cleanup.${cleanupEffects.flatMap(effectWriteVars).map((varId) => varId.split(".").at(-1) ?? varId).join("_")}`,
      cls: "internal",
      label: { kind: "internal", text: `${component}.useEffect.cleanup` },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit", value: true },
      effect: cleanupEffects.length === 1 ? cleanupEffects[0] : { kind: "seq", effects: cleanupEffects },
      reads: cleanupReads,
      writes: uniqueStrings(cleanupEffects.flatMap(effectWriteVars)),
      confidence: "over-approx",
      triggeredBy: deps
    });
  }
  return transitions;
}

function summarizeEffectStatements(statements: readonly ts.Statement[], setters: Map<string, SetterBinding>): EffectSummary[] | undefined {
  const locals = new Map<string, BoundExpr>();
  const summaries: EffectSummary[] = [];
  for (const statement of statements) {
    if (bindConstStatement(statement, setters, locals)) continue;
    const summary = summarizeSetterStatement(statement, setters, locals);
    if (!summary) return undefined;
    summaries.push(summary);
  }
  return summaries;
}

function cleanupSummaries(statements: readonly ts.Statement[], setters: Map<string, SetterBinding>): EffectSummary[] | undefined {
  const returns = statements.filter(isCleanupReturn);
  if (returns.length === 0) return [];
  if (returns.length > 1) return undefined;
  const expression = returns[0]!.expression;
  if (!expression || (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) || !ts.isBlock(expression.body)) return undefined;
  return summarizeEffectStatements(expression.body.statements, setters);
}

function isCleanupReturn(statement: ts.Statement): statement is ts.ReturnStatement {
  if (!ts.isReturnStatement(statement) || !statement.expression) return false;
  return ts.isArrowFunction(statement.expression) || ts.isFunctionExpression(statement.expression);
}

function dependencyReads(node: ts.Expression | undefined, setters: Map<string, SetterBinding>, fallbackReads: readonly string[] = []): string[] {
  if (!node || !ts.isArrayLiteralExpression(node)) {
    return uniqueStrings(fallbackReads);
  }
  return [...new Set(node.elements.flatMap((element) => ts.isIdentifier(element) ? [stateVarForName(element.text, setters)].filter((id): id is string => Boolean(id)) : []))];
}

function useEffectWritesModeledState(node: ts.CallExpression, setters: Map<string, SetterBinding>): boolean {
  let writes = false;
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression) && setters.has(candidate.expression.text)) writes = true;
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return writes;
}

interface ParsedGuard {
  expr: ExprIR;
  reads: string[];
}

function applyParsedGuard(transitions: Transition[], parsed: ParsedGuard | undefined): Transition[] {
  if (!parsed) return transitions;
  return transitions.map((transition) => transition.cls === "user"
    ? {
        ...transition,
        guard: andGuard(parsed.expr, transition.guard),
        reads: [...new Set([...transition.reads, ...parsed.reads])]
      }
    : transition);
}

function combineParsedGuards(guards: readonly (ParsedGuard | undefined)[]): ParsedGuard | undefined {
  const parsed = guards.filter((guard): guard is ParsedGuard => Boolean(guard));
  if (parsed.length === 0) return undefined;
  return {
    expr: parsed.map((guard) => guard.expr).reduce(andGuard),
    reads: [...new Set(parsed.flatMap((guard) => guard.reads))]
  };
}

function renderGuardFor(
  eventAttribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  source: ts.SourceFile,
  component: string,
  locals: Map<string, BoundExpr> = new Map()
): ParsedGuard | undefined {
  const element = jsxElementForAttribute(eventAttribute);
  if (!element) return undefined;
  const guards: ParsedGuard[] = [];
  let current: ts.Node = element;
  while (current.parent) {
    const parent = current.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === current
    ) {
      const parsed = parseConjunctiveGuardExpression(parent.left, setters, locals);
      if (!parsed) {
        warnings.push({ message: `Unsupported render guard ${component}.${eventAttribute.name.getText(source)}`, ...lineAndColumn(source, parent.left) });
        return undefined;
      }
      guards.push(parsed);
      current = parent;
      continue;
    }
    if (ts.isConditionalExpression(parent) && parent.whenTrue === current) {
      const parsed = parseConjunctiveGuardExpression(parent.condition, setters, locals);
      if (!parsed) {
        warnings.push({ message: `Unsupported render guard ${component}.${eventAttribute.name.getText(source)}`, ...lineAndColumn(source, parent.condition) });
        return undefined;
      }
      guards.push(parsed);
      current = parent;
      continue;
    }
    if (ts.isConditionalExpression(parent) && parent.whenFalse === current) {
      const parsed = parseConjunctiveGuardExpression(parent.condition, setters, locals);
      if (!parsed) {
        warnings.push({ message: `Unsupported render guard ${component}.${eventAttribute.name.getText(source)}`, ...lineAndColumn(source, parent.condition) });
        return undefined;
      }
      guards.push({ expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads });
      current = parent;
      continue;
    }
    if (ts.isParenthesizedExpression(parent) || ts.isJsxExpression(parent) || ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
      current = parent;
      continue;
    }
    return combineParsedGuards(guards);
  }
  return combineParsedGuards(guards);
}

function jsxElementForAttribute(attribute: ts.JsxAttribute): ts.JsxElement | ts.JsxSelfClosingElement | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const element = attrs.parent;
  if (ts.isJsxOpeningElement(element) && ts.isJsxElement(element.parent)) return element.parent;
  return ts.isJsxSelfClosingElement(element) ? element : undefined;
}

function disabledGuardFor(
  eventAttribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  source: ts.SourceFile,
  component: string,
  locals: Map<string, BoundExpr> = new Map()
): ParsedGuard | undefined {
  const attrs = eventAttribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const disabled = attrs.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && (property.name.text === "disabled" || property.name.text === "aria-disabled")
  ) ?? submitButtonDisabledAttribute(eventAttribute);
  if (!disabled) return undefined;
  const parsed = jsxAttributeBoolean(disabled, setters, locals);
  if (!parsed) {
    warnings.push({ message: `Unsupported disabled guard ${component}.${eventAttribute.name.getText(source)}`, ...lineAndColumn(source, disabled) });
    return undefined;
  }
  return { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads };
}

function submitButtonDisabledAttribute(eventAttribute: ts.JsxAttribute): ts.JsxAttribute | undefined {
  if (!ts.isIdentifier(eventAttribute.name) || eventAttribute.name.text !== "onSubmit") return undefined;
  const element = jsxElementForAttribute(eventAttribute);
  if (!element || !ts.isJsxElement(element)) return undefined;
  let found: ts.JsxAttribute | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isIdentifier(node.tagName) ? node.tagName.text : undefined;
      if (tag === "button" && stringAttribute(node.attributes, "type") === "submit") {
        found = node.attributes.properties.find((property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && (property.name.text === "disabled" || property.name.text === "aria-disabled")
        );
        if (found) return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(element);
  return found;
}

function jsxAttributeBoolean(
  attribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map()
): ParsedGuard | undefined {
  if (!attribute.initializer) return { expr: { kind: "lit", value: true }, reads: [] };
  if (ts.isStringLiteral(attribute.initializer)) return { expr: { kind: "lit", value: attribute.initializer.text === "true" }, reads: [] };
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return undefined;
  return parseConjunctiveGuardExpression(attribute.initializer.expression, setters, locals);
}

function parseGuardExpression(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map()
): ParsedGuard | undefined {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { expr: { kind: "lit", value: true }, reads: [] };
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { expr: { kind: "lit", value: false }, reads: [] };
  if (ts.isIdentifier(expression) || isPropertyAccessLike(expression)) return valueExpr(expression, setters, locals);
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const parsed = parseGuardExpression(expression.operand, setters, locals);
    return parsed ? { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads } : undefined;
  }
  if (ts.isParenthesizedExpression(expression)) return parseGuardExpression(expression.expression, setters, locals);
  if (ts.isBinaryExpression(expression)) return parseBinaryGuardExpression(expression, setters, locals);
  return undefined;
}

function parseBinaryGuardExpression(
  expression: ts.BinaryExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map()
): ParsedGuard | undefined {
  if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const left = parseGuardExpression(expression.left, setters, locals);
    const right = parseGuardExpression(expression.right, setters, locals);
    if (!left || !right) return undefined;
    return {
      expr: { kind: expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? "and" : "or", args: [left.expr, right.expr] },
      reads: [...new Set([...left.reads, ...right.reads])]
    };
  }
  if (
    expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
    expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
  ) {
    const left = parseGuardOperand(expression.left, setters, locals);
    const right = parseGuardOperand(expression.right, setters, locals);
    if (!left || !right) return undefined;
    return {
      expr: {
        kind: expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ? "neq" : "eq",
        args: [left.expr, right.expr]
      },
      reads: [...new Set([...left.reads, ...right.reads])]
    };
  }
  return undefined;
}

function parseGuardOperand(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map()
): ParsedGuard | undefined {
  const value = literalValue(expression);
  if (value !== undefined) return { expr: { kind: "lit", value }, reads: [] };
  if (ts.isIdentifier(expression) || isPropertyAccessLike(expression)) return valueExpr(expression, setters, locals);
  return parseGuardExpression(expression, setters, locals);
}

function parseConjunctiveGuardExpression(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map()
): ParsedGuard | undefined {
  if (ts.isParenthesizedExpression(expression)) return parseConjunctiveGuardExpression(expression.expression, setters, locals);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return combineParsedGuards([
      parseConjunctiveGuardExpression(expression.left, setters, locals),
      parseConjunctiveGuardExpression(expression.right, setters, locals)
    ]);
  }
  return parseGuardExpression(expression, setters, locals);
}

function stateVarForName(name: string, setters: Map<string, SetterBinding>): string | undefined {
  return setterForName(name, setters)?.varId;
}

function setterForName(name: string, setters: Map<string, SetterBinding>): SetterBinding | undefined {
  return setters.get(name) ?? [...setters.values()].find((setter) => setter.stateName === name);
}

function taggedPathDomain(domain: Extract<AbstractDomain, { kind: "tagged" }>, path: readonly string[]): AbstractDomain | undefined {
  const [field, ...rest] = path;
  if (!field) return domain;
  const variants = Object.values(domain.variants).filter((variant): variant is Extract<AbstractDomain, { kind: "record" }> => variant.kind === "record");
  const fieldDomains = variants.map((variant) => variant.fields[field]).filter((candidate): candidate is AbstractDomain => Boolean(candidate));
  if (fieldDomains.length === 0) return undefined;
  const first = fieldDomains[0]!;
  if (rest.length === 0) return first;
  return first.kind === "record" ? domainAtRecordPath(first, rest) : undefined;
}

function domainAtRecordPath(domain: Extract<AbstractDomain, { kind: "record" }>, path: readonly string[]): AbstractDomain | undefined {
  const [field, ...rest] = path;
  if (!field) return domain;
  const next = domain.fields[field];
  if (!next || rest.length === 0) return next;
  return next.kind === "record" ? domainAtRecordPath(next, rest) : undefined;
}

function andGuard(left: ExprIR, right: ExprIR): ExprIR {
  if (isTrueLiteral(left)) return right;
  if (isTrueLiteral(right)) return left;
  return { kind: "and", args: [left, right] };
}

function isTrueLiteral(expr: ExprIR): boolean {
  return expr.kind === "lit" && expr.value === true;
}

function isEventAttribute(name: string): boolean {
  return name === "onClick" || name === "onSubmit" || name === "onChange" || name === "onInput";
}

function labelForEvent(name: string, locator?: Locator): Transition["label"] {
  if (name === "onSubmit") return { kind: "submit", ...(locator ? { locator } : {}) };
  if (name === "onChange" || name === "onInput") return { kind: "input", valueClass: "literal", ...(locator ? { locator } : {}) };
  return { kind: "click", ...(locator ? { locator } : {}) };
}

function locatorForEventAttribute(attribute: ts.JsxAttribute): Locator | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const testId = stringAttribute(attrs, "data-testid");
  if (testId) return { kind: "testId", value: testId };
  const element = attrs.parent;
  const role = stringAttribute(attrs, "role") ?? inferredRole(element);
  if (!role) return undefined;
  const name = stringAttribute(attrs, "aria-label") ?? simpleElementText(element);
  return name ? { kind: "role", role, name } : { kind: "role", role };
}

function stringAttribute(attrs: ts.JsxAttributes, name: string): string | undefined {
  const attr = attrs.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name
  );
  if (!attr?.initializer || !ts.isStringLiteral(attr.initializer)) return undefined;
  return attr.initializer.text;
}

function inferredRole(node: ts.Node): string | undefined {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return undefined;
  const tag = node.tagName.getText();
  if (tag === "button") return "button";
  if (tag === "form") return "form";
  if (tag === "input" && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
    const type = stringAttribute(node.attributes, "type");
    if (type === "radio") return "radio";
    if (type === "checkbox") return "checkbox";
    return "textbox";
  }
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  return undefined;
}

function simpleElementText(node: ts.Node): string | undefined {
  if (!ts.isJsxOpeningElement(node) || !ts.isJsxElement(node.parent)) return undefined;
  const text = node.parent.children
    .filter(ts.isJsxText)
    .map((child) => child.getText().replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return text || undefined;
}

function isEventTargetValue(node: ts.Expression, parameter: ts.ParameterDeclaration | undefined): boolean {
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

function isInputValueExpression(node: ts.Expression, parameter: ts.ParameterDeclaration | undefined): boolean {
  if (isEventTargetValue(node, parameter)) return true;
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "Number" || node.expression.text === "String")) {
    return node.arguments.length === 1 && isInputValueExpression(node.arguments[0], parameter);
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && (node.expression.name.text === "trim" || node.expression.name.text === "toLowerCase")) {
    return node.arguments.length === 0 && isInputValueExpression(node.expression.expression, parameter);
  }
  return false;
}

function propertyAccessPath(node: ts.Expression): string[] | undefined {
  if (ts.isIdentifier(node)) return [node.text];
  if (isPropertyAccessLike(node)) {
    const base = propertyAccessPath(node.expression);
    return base ? [...base, node.name.text] : undefined;
  }
  return undefined;
}

function isPropertyAccessLike(node: ts.Expression): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node);
}

function valueClassForDomain(domain: AbstractDomain): string {
  if (domain.kind === "enum") return domain.values.join("|") || "enum";
  if (domain.kind === "boundedInt") return `${domain.min}..${domain.max}`;
  return domain.kind;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_") || "value";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function literalValue(node: ts.Expression): Value | undefined {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  return undefined;
}

function setterAssignEffect(statement: ts.Statement, setters: Map<string, { varId: string }>): Extract<Transition["effect"], { kind: "assign" }> | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return undefined;
  const call = statement.expression;
  if (!ts.isIdentifier(call.expression) || call.arguments.length !== 1) return undefined;
  const setter = setters.get(call.expression.text);
  const value = literalValue(call.arguments[0]);
  if (!setter || value === undefined) return undefined;
  return { kind: "assign", var: setter.varId, expr: { kind: "lit", value } };
}

function expressionStatementAwait(statement: ts.Statement, effectApis: Set<string>): boolean {
  return Boolean(awaitedOp(statement, effectApis) ?? promiseAllAwaitOps(statement, effectApis));
}

function containsAwaitedEffect(statements: readonly ts.Statement[], effectApis: Set<string>): boolean {
  return statements.some((statement) => {
    let found = false;
    const visit = (node: ts.Node, insideAwait = false): void => {
      if (found) return;
      if (ts.isAwaitExpression(node)) {
        visit(node.expression, true);
        return;
      }
      if (insideAwait && ts.isCallExpression(node)) {
        const name = callName(node.expression);
        if (name && effectApis.has(effectOpForCall(name, node))) {
          found = true;
          return;
        }
      }
      ts.forEachChild(node, (child) => visit(child, insideAwait));
    };
    visit(statement);
    return found;
  });
}

function awaitedOp(statement: ts.Statement, effectApis: Set<string>): string | undefined {
  return awaitedCall(statement, effectApis)?.op;
}

function awaitedCall(statement: ts.Statement, effectApis: Set<string>): { op: string; call: ts.CallExpression } | undefined {
  const awaitExpression = awaitedCallExpressionInStatement(statement);
  if (!awaitExpression) return undefined;
  const name = callName(awaitExpression.expression);
  if (!name) return undefined;
  const op = effectOpForCall(name, awaitExpression);
  if (!effectApis.has(op)) return undefined;
  return { op, call: awaitExpression };
}

function awaitedCallExpressionInStatement(statement: ts.Statement): ts.CallExpression | undefined {
  if (ts.isExpressionStatement(statement) && ts.isAwaitExpression(statement.expression) && ts.isCallExpression(statement.expression.expression)) {
    return statement.expression.expression;
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.initializer &&
        ts.isAwaitExpression(declaration.initializer) &&
        ts.isCallExpression(declaration.initializer.expression) &&
        callName(declaration.initializer.expression.expression) === "fetch"
      ) {
        return declaration.initializer.expression;
      }
    }
  }
  return undefined;
}

function effectOpForCall(name: string, call: ts.CallExpression): string {
  if (name !== "fetch") return name;
  const url = fetchUrl(call.arguments[0]);
  const method = fetchMethod(call.arguments[1]) ?? "GET";
  return url ? `${method} ${url}` : "fetch";
}

function fetchUrl(argument: ts.Expression | undefined): string | undefined {
  if (!argument) return undefined;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return normalizeFetchUrl(argument.text);
  if (ts.isTemplateExpression(argument)) {
    const pattern = templateRoutePattern(argument);
    return pattern ? normalizeFetchUrl(pattern.replace(/\/:param(?=\/|$)/g, "/:id")) : undefined;
  }
  return undefined;
}

function normalizeFetchUrl(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function fetchMethod(argument: ts.Expression | undefined): string | undefined {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return undefined;
  const method = argument.properties.find((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property) && propertyName(property.name) === "method"
  );
  const value = method ? literalValue(method.initializer) : undefined;
  return typeof value === "string" ? value.toUpperCase() : undefined;
}

function firstNavigationInStatements(statements: readonly ts.Statement[], routePatterns: readonly string[]): { mode: "push" | "replace" | "back"; to?: string } | undefined {
  for (const statement of statements) {
    let found: { mode: "push" | "replace" | "back"; to?: string } | undefined;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(node)) found = navigationCall(node, undefined, routePatterns);
      ts.forEachChild(node, visit);
    };
    visit(statement);
    if (found) return found;
  }
  return undefined;
}

function navigationEffect(navigation: { mode: "push" | "replace" | "back"; to?: string }): EffectIR {
  return {
    kind: "navigate",
    mode: navigation.mode,
    ...(navigation.to ? { to: { kind: "lit", value: navigation.to } } : {})
  };
}

function appendEffect(transition: Transition, effect: EffectIR): Transition {
  const current = transition.effect.kind === "seq" ? transition.effect.effects : [transition.effect];
  const writes = uniqueStrings([...transition.writes, ...effectWriteVars(effect)]);
  const reads = uniqueStrings([...transition.reads, ...(effect.kind === "navigate" ? ["sys:route", "sys:history"] : [])]);
  return {
    ...transition,
    effect: { kind: "seq", effects: [...current, effect] },
    reads,
    writes
  };
}

function effectCallArgs(call: ts.CallExpression, setters: Map<string, SetterBinding>, locals: Map<string, BoundExpr>): { args: Record<string, ExprIR>; reads: string[] } {
  const first = call.arguments[0];
  if (!first) return { args: {}, reads: [] };
  if (ts.isObjectLiteralExpression(first)) {
    const args: Record<string, ExprIR> = {};
    const reads = new Set<string>();
    for (const property of first.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return { args: {}, reads: [] };
      const name = propertyName(property.name);
      if (!name) return { args: {}, reads: [] };
      const value = ts.isShorthandPropertyAssignment(property) ? valueExpr(property.name, setters, locals) : valueExpr(property.initializer, setters, locals);
      if (!value) return { args: {}, reads: [] };
      args[name] = value.expr;
      value.reads.forEach((read) => reads.add(read));
    }
    return { args, reads: [...reads] };
  }
  const value = valueExpr(first, setters, locals);
  return value ? { args: { value: value.expr }, reads: value.reads } : { args: {}, reads: [] };
}

function promiseAllAwaitOps(statement: ts.Statement, effectApis: Set<string>): string[] | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const expression = statement.expression;
  if (!ts.isAwaitExpression(expression) || !ts.isCallExpression(expression.expression)) return undefined;
  const call = expression.expression;
  if (callName(call.expression) !== "Promise.all" || call.arguments.length !== 1 || !ts.isArrayLiteralExpression(call.arguments[0])) return undefined;
  const ops: string[] = [];
  for (const element of call.arguments[0].elements) {
    if (!ts.isCallExpression(element)) return undefined;
    const name = callName(element.expression);
    if (!name || !effectApis.has(name)) return undefined;
    ops.push(name);
  }
  return ops.length > 0 ? ops : undefined;
}

function callName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) || ts.isPropertyAccessChain(expression)) return `${callName(expression.expression) ?? expression.expression.getText()}.${expression.name.text}`;
  return undefined;
}

function pendingIs(op: string): Transition["guard"] {
  return pendingIsAt(0, op);
}

function pendingIsAt(index: number, op: string): Transition["guard"] {
  return { kind: "eq", args: [{ kind: "read", var: "sys:pending", path: [String(index), "opId"] }, { kind: "lit", value: op }] };
}

function componentNameFor(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name && startsUppercase(node.name.text)) return node.name.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && startsUppercase(node.name.text)) return node.name.text;
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

function firstValue(domain: AbstractDomain): Value {
  switch (domain.kind) {
    case "bool":
      return false;
    case "enum":
      return domain.values[0] ?? "";
    case "boundedInt":
      return domain.min;
    case "option":
      return null;
    case "record":
      return Object.fromEntries(Object.entries(domain.fields).map(([key, field]) => [key, firstValue(field)]));
    case "tagged": {
      const [tagValue, variant] = Object.entries(domain.variants)[0] ?? ["unknown", { kind: "record", fields: {} } as const];
      return { ...(firstValue(variant) as object), [domain.tag]: tagValue };
    }
    case "tokens":
      return domain.names?.[0] ?? "tok1";
    case "lengthCat":
      return "0";
    case "boundedList":
      return [];
  }
}

function lineAndColumn(source: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}
