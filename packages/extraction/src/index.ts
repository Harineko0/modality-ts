import * as ts from "typescript";
import type { AbstractDomain, StateVarDecl, Transition, Value } from "@modality/kernel";

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
  const setters = new Map<string, { varId: string; component: string; stateName: string }>();
  const visit = (node: ts.Node, componentName: string | undefined): void => {
    const nextComponent = componentNameFor(node) ?? componentName;
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
          setters.set(setterName.name.text, { varId, component, stateName: stateName.name.text });
        }
      } else {
        warnings.push({ message: "Unsupported useState binding pattern", ...lineAndColumn(source, node) });
      }
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.initializer && isEventAttribute(node.name.text)) {
      transitions.push(...transitionsFromJsxAttribute(source, fileName, node, setters, nextComponent ?? "Anonymous", effectApis, options.asyncOutcomes ?? {}));
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
  if (ts.isStringLiteral(lit) || ts.isNumericLiteral(lit)) return { kind: "enum", values: [lit.text] };
  if (lit.kind === ts.SyntaxKind.NullKeyword) return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}

function domainFromUnion(node: ts.UnionTypeNode): AbstractDomain {
  const nonNull = node.types.filter((part) => part.kind !== ts.SyntaxKind.UndefinedKeyword && !(ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword));
  if (nonNull.length !== node.types.length && nonNull.length === 1) {
    return { kind: "option", inner: inferDomainFromTypeNode(nonNull[0]) };
  }
  const literalValues: string[] = [];
  for (const part of node.types) {
    if (!ts.isLiteralTypeNode(part)) return taggedUnionFrom(node) ?? { kind: "tokens", count: 1 };
    const lit = part.literal;
    if (ts.isStringLiteral(lit) || ts.isNumericLiteral(lit)) literalValues.push(lit.text);
    else return taggedUnionFrom(node) ?? { kind: "tokens", count: 1 };
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

function transitionsFromJsxAttribute(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  setters: Map<string, { varId: string; component: string; stateName: string }>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>
): Transition[] {
  if (!node.initializer) return [];
  const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
  if (!expression || !ts.isArrowFunction(expression)) return [];
  if (!ts.isIdentifier(node.name)) return [];
  const attr = node.name.text;
  const asyncTransitions = transitionsFromAsyncHandler(source, fileName, attr, expression, setters, component, effectApis, asyncOutcomes);
  if (asyncTransitions.length > 0) return asyncTransitions;
  const body = expression.body;
  const call = ts.isCallExpression(body)
    ? body
    : ts.isBlock(body) && body.statements.length === 1 && ts.isExpressionStatement(body.statements[0]) && ts.isCallExpression(body.statements[0].expression)
      ? body.statements[0].expression
      : undefined;
  if (!call || !ts.isIdentifier(call.expression) || call.arguments.length !== 1) return [];
  const setter = setters.get(call.expression.text);
  if (!setter) return [];
  const value = literalValue(call.arguments[0]);
  if (value === undefined) return [];
  return [{
    id: `${component}.${attr}.${setter.stateName}`,
    cls: "user",
    label: labelForEvent(attr),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "assign", var: setter.varId, expr: { kind: "lit", value } },
    reads: [],
    writes: [setter.varId],
    confidence: "exact"
  }];
}

function transitionsFromAsyncHandler(
  source: ts.SourceFile,
  fileName: string,
  attr: string,
  expression: ts.ArrowFunction,
  setters: Map<string, { varId: string; component: string; stateName: string }>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>
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
    label: labelForEvent(attr),
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

function isEventAttribute(name: string): boolean {
  return name === "onClick" || name === "onSubmit" || name === "onChange";
}

function labelForEvent(name: string): Transition["label"] {
  if (name === "onSubmit") return { kind: "submit" };
  if (name === "onChange") return { kind: "input", valueClass: "literal" };
  return { kind: "click" };
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
