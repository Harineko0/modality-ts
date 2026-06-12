import * as ts from "typescript";
import type { AbstractDomain, ExprIR, Locator, StateVarDecl, Transition, Value } from "@modality/kernel";

export interface UseStateExtractionOptions {
  route?: string;
  fileName?: string;
  effectApis?: readonly string[];
  asyncOutcomes?: Record<string, { success: Value; error?: Value }>;
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

type ExtractableHandler = ts.ArrowFunction | ts.FunctionExpression;

export function inferDomainFromTypeNode(node: ts.TypeNode | undefined): AbstractDomain {
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
      return domainFromUnion(node as ts.UnionTypeNode);
    case ts.SyntaxKind.TypeLiteral:
      return domainFromTypeLiteral(node as ts.TypeLiteralNode);
    case ts.SyntaxKind.ArrayType:
      return { kind: "lengthCat" };
    case ts.SyntaxKind.TypeReference:
      return domainFromTypeReference(node as ts.TypeReferenceNode);
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
  const vars: StateVarDecl[] = [];
  const transitions: Transition[] = [];
  const warnings: ExtractionWarning[] = [];
  const route = options.route ?? "/";
  const effectApis = new Set(options.effectApis ?? []);
  const setters = new Map<string, SetterBinding>();
  const handlers = new Map<string, ExtractableHandler>();
  const visit = (node: ts.Node, componentName: string | undefined): void => {
    const nextComponent = componentNameFor(node) ?? componentName;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isExtractableHandler(node.initializer)) {
      handlers.set(node.name.text, node.initializer);
    }
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && isUseStateCall(node.initializer)) {
      const stateName = node.name.elements[0];
      const setterName = node.name.elements[1];
      if (ts.isBindingElement(stateName) && ts.isIdentifier(stateName.name)) {
        const domain = inferUseStateDomain(node.initializer);
        const component = nextComponent ?? "Anonymous";
        const varId = `local:${component}.${stateName.name.text}`;
        vars.push({
          id: varId,
          domain,
          origin: { file: fileName, ...lineAndColumn(source, node) },
          scope: { kind: "route-local", route },
          initial: initialValueForUseState(node.initializer, domain)
        });
        if (setterName && ts.isBindingElement(setterName) && ts.isIdentifier(setterName.name)) {
          setters.set(setterName.name.text, { varId, component, stateName: stateName.name.text, domain });
        }
      } else {
        warnings.push({ message: "Unsupported useState binding pattern", ...lineAndColumn(source, node) });
      }
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.initializer && isEventAttribute(node.name.text)) {
      const guard = combineParsedGuards([
        renderGuardFor(node, setters, warnings, source, nextComponent ?? "Anonymous"),
        disabledGuardFor(node, setters, warnings, source, nextComponent ?? "Anonymous")
      ]);
      const extracted = transitionsFromJsxAttribute(source, fileName, node, setters, handlers, nextComponent ?? "Anonymous", effectApis, options.asyncOutcomes ?? {}, guard);
      transitions.push(...extracted);
      if (extracted.length === 0) {
        warnings.push({ message: `Unextractable handler ${nextComponent ?? "Anonymous"}.${node.name.text}`, ...lineAndColumn(source, node) });
      }
    }
    if (ts.isCallExpression(node) && isUseEffectCall(node)) {
      const extracted = transitionsFromUseEffect(source, fileName, node, setters, nextComponent ?? "Anonymous");
      transitions.push(...extracted);
      if (extracted.length === 0 && useEffectWritesModeledState(node, setters)) {
        warnings.push({ message: `Unextractable effect ${nextComponent ?? "Anonymous"}.useEffect`, ...lineAndColumn(source, node) });
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextComponent));
  };
  visit(source, undefined);
  return { vars, transitions, warnings };
}

function inferUseStateDomain(call: ts.CallExpression): AbstractDomain {
  const typeArg = call.typeArguments?.[0];
  if (typeArg) return inferDomainFromTypeNode(typeArg);
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
  if (initial.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (initial.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteral(initial)) return initial.text;
  if (ts.isNumericLiteral(initial)) return Number(initial.text);
  if (initial.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(initial)) return initial.elements.length === 0 ? "0" : initial.elements.length === 1 ? "1" : "many";
  return firstValue(domain);
}

function domainFromLiteralType(node: ts.LiteralTypeNode): AbstractDomain {
  const lit = node.literal;
  if (lit.kind === ts.SyntaxKind.TrueKeyword || lit.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
  if (ts.isStringLiteral(lit)) return { kind: "enum", values: [lit.text] };
  if (ts.isNumericLiteral(lit)) return { kind: "boundedInt", min: Number(lit.text), max: Number(lit.text) };
  if (lit.kind === ts.SyntaxKind.NullKeyword) return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}

function domainFromUnion(node: ts.UnionTypeNode): AbstractDomain {
  const nonNull = node.types.filter((part) => part.kind !== ts.SyntaxKind.UndefinedKeyword && !(ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword));
  if (nonNull.length !== node.types.length && nonNull.length === 1) {
    return { kind: "option", inner: inferDomainFromTypeNode(nonNull[0]) };
  }
  const literalValues: string[] = [];
  const numericValues: number[] = [];
  for (const part of node.types) {
    if (!ts.isLiteralTypeNode(part)) return taggedUnionFrom(node) ?? { kind: "tokens", count: 1 };
    const lit = part.literal;
    if (ts.isStringLiteral(lit)) literalValues.push(lit.text);
    else if (ts.isNumericLiteral(lit)) numericValues.push(Number(lit.text));
    else return taggedUnionFrom(node) ?? { kind: "tokens", count: 1 };
  }
  if (numericValues.length === node.types.length) {
    return { kind: "boundedInt", min: Math.min(...numericValues), max: Math.max(...numericValues) };
  }
  return { kind: "enum", values: literalValues };
}

function taggedUnionFrom(node: ts.UnionTypeNode): AbstractDomain | undefined {
  const members = node.types.filter(ts.isTypeLiteralNode);
  if (members.length !== node.types.length) return undefined;
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

function domainFromTypeReference(node: ts.TypeReferenceNode): AbstractDomain {
  const name = node.typeName.getText();
  if ((name === "Array" || name === "ReadonlyArray") && node.typeArguments?.length === 1) return { kind: "lengthCat" };
  if (name === "Record") return { kind: "tokens", count: 1 };
  return { kind: "tokens", count: 1 };
}

function isUseStateCall(node: ts.Expression): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useState";
}

function isUseEffectCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "useEffect";
}

function isExtractableHandler(node: ts.Expression): node is ExtractableHandler {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
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
  disabledGuard: ParsedGuard | undefined
): Transition[] {
  if (!node.initializer) return [];
  const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return [];
  if (!ts.isIdentifier(node.name)) return [];
  const attr = node.name.text;
  const locator = locatorForEventAttribute(node);
  const asyncTransitions = transitionsFromAsyncHandler(source, fileName, attr, handler, setters, component, effectApis, asyncOutcomes, locator);
  if (asyncTransitions.length > 0) return applyParsedGuard(asyncTransitions, disabledGuard);
  const body = handler.body;
  const call = ts.isCallExpression(body)
    ? body
    : ts.isBlock(body) && body.statements.length === 1 && ts.isExpressionStatement(body.statements[0]) && ts.isCallExpression(body.statements[0].expression)
      ? body.statements[0].expression
      : undefined;
  if (!call || !ts.isIdentifier(call.expression) || call.arguments.length !== 1) return [];
  const setter = setters.get(call.expression.text);
  if (!setter) {
    const escaped = escapedSetters(call, setters);
    if (escaped.length === 0) return [];
    return applyParsedGuard(escapedSetterTransitions(source, fileName, node, attr, component, escaped, locator), disabledGuard);
  }
  if ((attr === "onChange" || attr === "onInput") && isInputValueExpression(call.arguments[0], handler.parameters[0])) {
    return applyParsedGuard(inputTransitions(source, fileName, node, attr, component, setter, locator), disabledGuard);
  }
  const value = literalValue(call.arguments[0]);
  if (value === undefined) return [];
  return applyParsedGuard([{
    id: `${component}.${attr}.${setter.stateName}`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "assign", var: setter.varId, expr: { kind: "lit", value } },
    reads: [],
    writes: [setter.varId],
    confidence: "exact"
  }], disabledGuard);
}

function escapedSetters(call: ts.CallExpression, setters: Map<string, SetterBinding>): SetterBinding[] {
  return call.arguments
    .filter(ts.isIdentifier)
    .map((arg) => setters.get(arg.text))
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
  const finite = finiteInputValues(setter.domain);
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

function transitionsFromAsyncHandler(
  source: ts.SourceFile,
  fileName: string,
  attr: string,
  expression: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  locator: Locator | undefined
): Transition[] {
  if (!ts.isBlock(expression.body)) return [];
  const statements = expression.body.statements;
  const tryStatement = statements.find(ts.isTryStatement);
  const preStatements = tryStatement ? statements.slice(0, statements.indexOf(tryStatement)) : statements;
  const awaitStatement = tryStatement
    ? tryStatement.tryBlock.statements.find((statement) => expressionStatementAwait(statement, effectApis))
    : statements.find((statement) => expressionStatementAwait(statement, effectApis));
  if (!awaitStatement) return [];
  const op = awaitedOp(awaitStatement, effectApis);
  if (!op) return [];
  const preEffects = preStatements.map((statement) => setterAssignEffect(statement, setters)).filter((effect): effect is Extract<Transition["effect"], { kind: "assign" }> => Boolean(effect));
  const successStatements = tryStatement ? tryStatement.tryBlock.statements.slice(tryStatement.tryBlock.statements.indexOf(awaitStatement) + 1) : statements.slice(statements.indexOf(awaitStatement) + 1);
  const successEffects = successStatements.map((statement) => setterAssignEffect(statement, setters)).filter((effect): effect is Extract<Transition["effect"], { kind: "assign" }> => Boolean(effect));
  const catchEffects = tryStatement?.catchClause?.block.statements.map((statement) => setterAssignEffect(statement, setters)).filter((effect): effect is Extract<Transition["effect"], { kind: "assign" }> => Boolean(effect)) ?? [];
  if (successEffects.length === 0 && catchEffects.length === 0) return [];
  const writes = [...new Set([...preEffects, ...successEffects, ...catchEffects].map((effect) => effect.var))];
  const baseId = `${component}.${attr}.${op}`;
  const sourceAnchor = [{ file: fileName, ...lineAndColumn(source, expression) }];
  const enqueue: Transition = {
    id: `${baseId}.start`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: sourceAnchor,
    guard: { kind: "lit", value: true },
    effect: { kind: "seq", effects: [...preEffects, { kind: "enqueue", op, continuation: `${baseId}.cont`, args: {} }] },
    reads: [],
    writes: [...new Set([...preEffects.map((effect) => effect.var), "sys:pending"])],
    confidence: "exact"
  };
  const success: Transition = {
    id: `${baseId}.success`,
    cls: "env",
    label: { kind: "resolve", op, outcome: "success" },
    source: sourceAnchor,
    guard: pendingIs(op),
    effect: { kind: "seq", effects: [{ kind: "dequeue", index: 0 }, ...successEffects] },
    reads: ["sys:pending"],
    writes: ["sys:pending", ...successEffects.map((effect) => effect.var)],
    confidence: "exact"
  };
  const transitions = [enqueue, success];
  if (catchEffects.length > 0 || asyncOutcomes[op]?.error !== undefined) {
    transitions.push({
      id: `${baseId}.error`,
      cls: "env",
      label: { kind: "resolve", op, outcome: "error" },
      source: sourceAnchor,
      guard: pendingIs(op),
      effect: { kind: "seq", effects: [{ kind: "dequeue", index: 0 }, ...catchEffects] },
      reads: ["sys:pending"],
      writes: ["sys:pending", ...catchEffects.map((effect) => effect.var)],
      confidence: "exact"
    });
  }
  return transitions.map((transition) => ({ ...transition, writes: [...new Set(transition.writes)] }));
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
  const effects = callback.body.statements.map((statement) => setterAssignEffect(statement, setters)).filter((effect): effect is Extract<Transition["effect"], { kind: "assign" }> => Boolean(effect));
  if (effects.length === 0) return [];
  const deps = dependencyReads(node.arguments[1], setters);
  const guards: ExprIR[] = effects.map((effect) => ({ kind: "neq", args: [{ kind: "read", var: effect.var }, effect.expr] }));
  const guard = guards.slice(1).reduce((acc, next) => andGuard(acc, next), guards[0]!);
  return [{
    id: `${component}.useEffect.${effects.map((effect) => effect.var.split(".").at(-1) ?? effect.var).join("_")}`,
    cls: "internal",
    label: { kind: "internal", text: `${component}.useEffect` },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard,
    effect: effects.length === 1 ? effects[0] : { kind: "seq", effects },
    reads: [...new Set([...deps, ...effects.map((effect) => effect.var)])],
    writes: [...new Set(effects.map((effect) => effect.var))],
    confidence: "exact",
    triggeredBy: deps
  }];
}

function dependencyReads(node: ts.Expression | undefined, setters: Map<string, SetterBinding>): string[] {
  if (!node || !ts.isArrayLiteralExpression(node)) {
    return [...new Set([...setters.values()].map((setter) => setter.varId))];
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
  return transitions.map((transition) => ({
    ...transition,
    guard: andGuard(parsed.expr, transition.guard),
    reads: [...new Set([...transition.reads, ...parsed.reads])]
  }));
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
  component: string
): ParsedGuard | undefined {
  const element = jsxElementForAttribute(eventAttribute);
  if (!element) return undefined;
  let current: ts.Node = element;
  while (current.parent) {
    const parent = current.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === current
    ) {
      const parsed = parseGuardExpression(parent.left, setters);
      if (!parsed) {
        warnings.push({ message: `Unsupported render guard ${component}.${eventAttribute.name.getText(source)}`, ...lineAndColumn(source, parent.left) });
        return undefined;
      }
      return parsed;
    }
    if (ts.isConditionalExpression(parent) && parent.whenTrue === current) {
      const parsed = parseGuardExpression(parent.condition, setters);
      if (!parsed) {
        warnings.push({ message: `Unsupported render guard ${component}.${eventAttribute.name.getText(source)}`, ...lineAndColumn(source, parent.condition) });
        return undefined;
      }
      return parsed;
    }
    if (ts.isConditionalExpression(parent) && parent.whenFalse === current) {
      const parsed = parseGuardExpression(parent.condition, setters);
      if (!parsed) {
        warnings.push({ message: `Unsupported render guard ${component}.${eventAttribute.name.getText(source)}`, ...lineAndColumn(source, parent.condition) });
        return undefined;
      }
      return { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads };
    }
    if (ts.isParenthesizedExpression(parent) || ts.isJsxExpression(parent)) {
      current = parent;
      continue;
    }
    return undefined;
  }
  return undefined;
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
  component: string
): ParsedGuard | undefined {
  const attrs = eventAttribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const disabled = attrs.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && (property.name.text === "disabled" || property.name.text === "aria-disabled")
  );
  if (!disabled) return undefined;
  const parsed = jsxAttributeBoolean(disabled, setters);
  if (!parsed) {
    warnings.push({ message: `Unsupported disabled guard ${component}.${eventAttribute.name.getText(source)}`, ...lineAndColumn(source, disabled) });
    return undefined;
  }
  return { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads };
}

function jsxAttributeBoolean(
  attribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>
): ParsedGuard | undefined {
  if (!attribute.initializer) return { expr: { kind: "lit", value: true }, reads: [] };
  if (ts.isStringLiteral(attribute.initializer)) return { expr: { kind: "lit", value: attribute.initializer.text === "true" }, reads: [] };
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return undefined;
  return parseGuardExpression(attribute.initializer.expression, setters);
}

function parseGuardExpression(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>
): ParsedGuard | undefined {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { expr: { kind: "lit", value: true }, reads: [] };
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { expr: { kind: "lit", value: false }, reads: [] };
  if (ts.isIdentifier(expression)) {
    const stateVar = stateVarForName(expression.text, setters);
    if (!stateVar) return undefined;
    return { expr: { kind: "read", var: stateVar }, reads: [stateVar] };
  }
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const parsed = parseGuardExpression(expression.operand, setters);
    return parsed ? { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads } : undefined;
  }
  if (ts.isParenthesizedExpression(expression)) return parseGuardExpression(expression.expression, setters);
  if (ts.isBinaryExpression(expression)) return parseBinaryGuardExpression(expression, setters);
  return undefined;
}

function parseBinaryGuardExpression(
  expression: ts.BinaryExpression,
  setters: Map<string, SetterBinding>
): ParsedGuard | undefined {
  if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const left = parseGuardExpression(expression.left, setters);
    const right = parseGuardExpression(expression.right, setters);
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
    const left = parseGuardOperand(expression.left, setters);
    const right = parseGuardOperand(expression.right, setters);
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
  setters: Map<string, SetterBinding>
): ParsedGuard | undefined {
  const value = literalValue(expression);
  if (value !== undefined) return { expr: { kind: "lit", value }, reads: [] };
  if (ts.isIdentifier(expression)) {
    const stateVar = stateVarForName(expression.text, setters);
    if (!stateVar) return undefined;
    return { expr: { kind: "read", var: stateVar }, reads: [stateVar] };
  }
  return parseGuardExpression(expression, setters);
}

function stateVarForName(name: string, setters: Map<string, SetterBinding>): string | undefined {
  return [...setters.values()].find((setter) => setter.stateName === name)?.varId;
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
  if (tag === "input") return "textbox";
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
  return ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "Number" &&
    node.arguments.length === 1 &&
    isEventTargetValue(node.arguments[0], parameter);
}

function propertyAccessPath(node: ts.Expression): string[] | undefined {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const base = propertyAccessPath(node.expression);
    return base ? [...base, node.name.text] : undefined;
  }
  return undefined;
}

function valueClassForDomain(domain: AbstractDomain): string {
  if (domain.kind === "enum") return domain.values.join("|") || "enum";
  if (domain.kind === "boundedInt") return `${domain.min}..${domain.max}`;
  return domain.kind;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_") || "value";
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
  return Boolean(awaitedOp(statement, effectApis));
}

function awaitedOp(statement: ts.Statement, effectApis: Set<string>): string | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const expression = statement.expression;
  if (!ts.isAwaitExpression(expression) || !ts.isCallExpression(expression.expression)) return undefined;
  const name = callName(expression.expression.expression);
  return name && effectApis.has(name) ? name : undefined;
}

function callName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return `${callName(expression.expression) ?? expression.expression.getText()}.${expression.name.text}`;
  return undefined;
}

function pendingIs(op: string): Transition["guard"] {
  return { kind: "eq", args: [{ kind: "read", var: "sys:pending", path: ["0", "opId"] }, { kind: "lit", value: op }] };
}

function componentNameFor(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name && startsUppercase(node.name.text)) return node.name.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && startsUppercase(node.name.text)) return node.name.text;
  return undefined;
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
