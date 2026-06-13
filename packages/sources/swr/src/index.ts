import { canonicalJson, enumerateDomain } from "@modality-ts/kernel";
import type { AbstractDomain, ExprIR, ModelState, StateVarDecl, TemplateFragment, Transition, Value } from "@modality-ts/kernel";
import type { SourceDecl, StateSourcePlugin } from "@modality-ts/extraction/spi";
import * as ts from "typescript";
import * as harness from "./harness.js";

export interface SwrTemplateOptions {
  id: string;
  op: string;
  payloadDomain: AbstractDomain;
  activeWhen?: ExprIR;
  revalidateOnFocus?: boolean;
  mutate?: boolean;
  sourceFile?: string;
}

export interface SwrKeyWindowEntry {
  id: string;
  op?: string;
  activeWhen?: ExprIR;
}

export interface SwrKeyWindowTemplateOptions {
  id: string;
  op: string;
  payloadDomain: AbstractDomain;
  entries: readonly SwrKeyWindowEntry[];
  windowSize?: number;
  activeWhen?: ExprIR;
  revalidateOnFocus?: boolean;
  mutate?: boolean;
  sourceFile?: string;
}

export interface SwrView {
  active: boolean;
  data: Value | null;
  error: boolean;
  isLoading: boolean;
  isValidating: boolean;
  loadedEmpty: boolean;
  loadedSome: boolean;
}

export function swrSource(): StateSourcePlugin {
  return {
    id: "swr",
    version: "0.1.0",
    packageNames: ["swr"],
    discover: (ctx) => discoverSwrHooks(ctx.sourceText, ctx.fileName),
    writeChannels: () => [],
    template: (decl) => templateForSwrDecl(decl),
    harness,
    conformance: {
      templateProbes: [],
      testedVersions: "swr>=2"
    }
  };
}

export function discoverSwrHooks(sourceText: string, fileName = "App.tsx"): SourceDecl[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const useSwrNames = useSwrImportNames(source);
  if (useSwrNames.size === 0) return [];

  const decls: SourceDecl[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && useSwrNames.has(node.expression.text)) {
      const key = keyFromExpression(node.arguments[0]);
      if (key) {
        const id = swrIdFromKey(key.id);
        const origin = { file: fileName, ...lineAndColumn(source, node) };
        decls.push({
          id: `swr:${id}`,
          kind: "swr/useSWR",
          origin,
          metadata: {
            key: key.id,
            id,
            op: `GET ${key.id}`,
            payloadDomain: inferPayloadDomain(node.typeArguments?.[0]) as Value,
            ...(key.activeWhen ? { activeWhen: key.activeWhen as Value } : {}),
            ...optionsMetadata(node.arguments[2])
          }
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return decls;
}

function templateForSwrDecl(decl: SourceDecl): TemplateFragment {
  const metadata = decl.metadata ?? {};
  return createSwrTemplate({
    id: stringMetadata(metadata, "id", decl.id.replace(/^swr:/, "")),
    op: stringMetadata(metadata, "op", decl.id),
    payloadDomain: domainMetadata(metadata.payloadDomain),
    activeWhen: exprMetadata(metadata.activeWhen),
    revalidateOnFocus: booleanMetadata(metadata, "revalidateOnFocus", false),
    sourceFile: decl.origin !== "system" && decl.origin !== "library-template" ? decl.origin.file : undefined
  });
}

function useSwrImportNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "swr") continue;
    if (statement.importClause?.name) names.add(statement.importClause.name.text);
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === "useSWR") names.add(specifier.name.text);
    }
  }
  return names;
}

function keyFromExpression(expr: ts.Expression | undefined): { id: string; activeWhen?: ExprIR } | undefined {
  if (!expr) return undefined;
  if (ts.isStringLiteral(expr) && expr.text.length > 0) return { id: expr.text };
  if (ts.isNoSubstitutionTemplateLiteral(expr) && expr.text.length > 0) return { id: expr.text };
  if (ts.isArrayLiteralExpression(expr)) {
    const parts = expr.elements.map(keyPartFromExpression);
    if (parts.every((part): part is string => Boolean(part))) return { id: `[${parts.join(",")}]` };
  }
  if (ts.isConditionalExpression(expr) && isNullish(expr.whenFalse)) {
    const key = keyFromExpression(expr.whenTrue);
    const activeWhen = exprFromCondition(expr.condition);
    if (key && activeWhen) return { ...key, activeWhen };
  }
  return undefined;
}

function keyPartFromExpression(expr: ts.Expression): string | undefined {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isNumericLiteral(expr)) return expr.text;
  return undefined;
}

function exprFromCondition(expr: ts.Expression): ExprIR | undefined {
  if (ts.isIdentifier(expr)) return { kind: "read", var: expr.text };
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return { kind: "lit", value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return { kind: "lit", value: false };
  if (ts.isBinaryExpression(expr) && (expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
    const left = ts.isIdentifier(expr.left) ? { kind: "read" as const, var: expr.left.text } : undefined;
    const right = literalExpr(expr.right);
    if (left && right) return { kind: expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? "eq" : "neq", args: [left, right] };
  }
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = exprFromCondition(expr.operand);
    if (inner) return { kind: "not", args: [inner] };
  }
  return undefined;
}

function literalExpr(expr: ts.Expression): ExprIR | undefined {
  if (ts.isStringLiteral(expr)) return { kind: "lit", value: expr.text };
  if (ts.isNumericLiteral(expr)) return { kind: "lit", value: Number(expr.text) };
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return { kind: "lit", value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return { kind: "lit", value: false };
  if (expr.kind === ts.SyntaxKind.NullKeyword) return { kind: "lit", value: null };
  return undefined;
}

function isNullish(expr: ts.Expression): boolean {
  return expr.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(expr) && expr.text === "undefined");
}

function optionsMetadata(expr: ts.Expression | undefined): Record<string, Value> {
  if (!expr || !ts.isObjectLiteralExpression(expr)) return {};
  const metadata: Record<string, Value> = {};
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === "revalidateOnFocus" && prop.initializer.kind === ts.SyntaxKind.TrueKeyword) metadata.revalidateOnFocus = true;
    if (prop.name.text === "revalidateOnFocus" && prop.initializer.kind === ts.SyntaxKind.FalseKeyword) metadata.revalidateOnFocus = false;
  }
  return metadata;
}

function inferPayloadDomain(typeArg: ts.TypeNode | undefined): AbstractDomain {
  if (!typeArg) return { kind: "tokens", count: 1 };
  switch (typeArg.kind) {
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: "bool" };
    case ts.SyntaxKind.LiteralType:
      return domainFromLiteralType(typeArg as ts.LiteralTypeNode);
    case ts.SyntaxKind.UnionType:
      return domainFromUnion(typeArg as ts.UnionTypeNode);
    case ts.SyntaxKind.ArrayType:
      return { kind: "lengthCat" };
    case ts.SyntaxKind.TypeReference: {
      const name = (typeArg as ts.TypeReferenceNode).typeName.getText();
      if (name === "Array" || name === "ReadonlyArray") return { kind: "lengthCat" };
      return { kind: "tokens", count: 1 };
    }
    default:
      return { kind: "tokens", count: 1 };
  }
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
  const literalValues: string[] = [];
  const numericValues: number[] = [];
  for (const part of node.types) {
    if (!ts.isLiteralTypeNode(part)) return { kind: "tokens", count: 1 };
    const lit = part.literal;
    if (ts.isStringLiteral(lit)) literalValues.push(lit.text);
    else if (ts.isNumericLiteral(lit)) numericValues.push(Number(lit.text));
    else return { kind: "tokens", count: 1 };
  }
  if (numericValues.length === node.types.length) return { kind: "boundedInt", min: Math.min(...numericValues), max: Math.max(...numericValues) };
  return { kind: "enum", values: literalValues };
}

export function createSwrTemplate(options: SwrTemplateOptions): TemplateFragment {
  const vars = swrVars(options);
  const active = options.activeWhen ?? lit(true);
  const source = options.sourceFile ? [{ file: options.sourceFile }] : [];
  const dataVar = swrVarId(options.id, "data");
  const validatingVar = swrVarId(options.id, "isValidating");
  const errorVar = swrVarId(options.id, "error");
  const transitions: Transition[] = [
    {
      id: `swr:${options.id}:fetch`,
      cls: "library",
      label: { kind: "timer", key: options.id },
      source,
      guard: active,
      effect: {
        kind: "seq",
        effects: [
          { kind: "assign", var: validatingVar, expr: lit(true) },
          { kind: "enqueue", op: options.op, continuation: `swr:${options.id}:resolve`, args: {} }
        ]
      },
      reads: [...exprReadList(active)],
      writes: [validatingVar, "sys:pending"],
      confidence: "exact"
    },
    ...(options.revalidateOnFocus ? [fetchTransition(options, active, source, "focus")] : []),
    ...(options.mutate ? mutateTransitions(options, active, source, dataVar, validatingVar, errorVar) : []),
    ...successTransitions(options),
    {
      id: `swr:${options.id}:resolve:error`,
      cls: "env",
      label: { kind: "resolve", op: options.op, outcome: "error" },
      source,
      guard: pendingIs(options.op),
      effect: {
        kind: "seq",
        effects: [
          { kind: "dequeue", index: 0 },
          { kind: "assign", var: validatingVar, expr: lit(false) },
          { kind: "assign", var: errorVar, expr: lit(true) }
        ]
      },
      reads: ["sys:pending"],
      writes: ["sys:pending", validatingVar, errorVar],
      confidence: "exact"
    }
  ];
  return { vars, transitions };

  function successTransitions(template: SwrTemplateOptions): Transition[] {
    return enumerateDomain(template.payloadDomain).map((value, index) => ({
      id: `swr:${template.id}:resolve:success:${index}`,
      cls: "env" as const,
      label: { kind: "resolve" as const, op: template.op, outcome: `success:${index}` },
      source,
      guard: pendingIs(template.op),
      effect: {
        kind: "seq" as const,
        effects: [
          { kind: "dequeue" as const, index: 0 },
          { kind: "assign" as const, var: dataVar, expr: lit(value) },
          { kind: "assign" as const, var: validatingVar, expr: lit(false) },
          { kind: "assign" as const, var: errorVar, expr: lit(false) }
        ]
      },
      reads: ["sys:pending"],
      writes: ["sys:pending", dataVar, validatingVar, errorVar],
      confidence: "exact" as const
    }));
  }
}

function fetchTransition(
  options: SwrTemplateOptions,
  active: ExprIR,
  source: Transition["source"],
  trigger: "timer" | "focus"
): Transition {
  const validatingVar = swrVarId(options.id, "isValidating");
  return {
    id: trigger === "timer" ? `swr:${options.id}:fetch` : `swr:${options.id}:focus-revalidate`,
    cls: "library",
    label: trigger === "timer" ? { kind: "timer", key: options.id } : { kind: "focus-revalidate", key: options.id },
    source,
    guard: active,
    effect: {
      kind: "seq",
      effects: [
        { kind: "assign", var: validatingVar, expr: lit(true) },
        { kind: "enqueue", op: options.op, continuation: `swr:${options.id}:resolve`, args: {} }
      ]
    },
    reads: [...exprReadList(active)],
    writes: [validatingVar, "sys:pending"],
    confidence: "exact"
  };
}

function mutateTransitions(
  options: SwrTemplateOptions,
  active: ExprIR,
  source: Transition["source"],
  dataVar: string,
  validatingVar: string,
  errorVar: string
): Transition[] {
  return enumerateDomain(options.payloadDomain).map((value, index) => ({
    id: `swr:${options.id}:mutate:${index}`,
    cls: "library" as const,
    label: { kind: "internal" as const, text: `mutate ${options.id}:${index}` },
    source,
    guard: active,
    effect: {
      kind: "seq" as const,
      effects: [
        { kind: "assign" as const, var: dataVar, expr: lit(value) },
        { kind: "assign" as const, var: validatingVar, expr: lit(false) },
        { kind: "assign" as const, var: errorVar, expr: lit(false) }
      ]
    },
    reads: [...exprReadList(active)],
    writes: [dataVar, validatingVar, errorVar],
    confidence: "exact" as const
  }));
}

export function createSwrKeyWindowTemplate(options: SwrKeyWindowTemplateOptions): TemplateFragment {
  const windowSize = options.windowSize ?? 2;
  const entries = options.entries.slice(0, windowSize);
  const fragments = entries.map((entry) =>
    createSwrTemplate({
      id: swrWindowEntryId(options.id, entry.id),
      op: entry.op ?? `${options.op}:${entry.id}`,
      payloadDomain: options.payloadDomain,
      activeWhen: combineActive(options.activeWhen, entry.activeWhen),
      revalidateOnFocus: options.revalidateOnFocus,
      mutate: options.mutate,
      sourceFile: options.sourceFile
    })
  );
  return {
    vars: fragments.flatMap((fragment) => fragment.vars),
    transitions: fragments.flatMap((fragment) => fragment.transitions)
  };
}

export function swrVars(options: SwrTemplateOptions): StateVarDecl[] {
  return [
    { id: swrVarId(options.id, "data"), domain: { kind: "option", inner: options.payloadDomain }, origin: "library-template", scope: { kind: "global" }, initial: null },
    { id: swrVarId(options.id, "isValidating"), domain: { kind: "bool" }, origin: "library-template", scope: { kind: "global" }, initial: false },
    { id: swrVarId(options.id, "error"), domain: { kind: "bool" }, origin: "library-template", scope: { kind: "global" }, initial: false }
  ];
}

export function swrView(state: ModelState, id: string, options: { active?: boolean } = {}): SwrView {
  const data = state[swrVarId(id, "data")] ?? null;
  const error = state[swrVarId(id, "error")] === true;
  const isValidating = state[swrVarId(id, "isValidating")] === true;
  return {
    active: options.active ?? true,
    data,
    error,
    isLoading: data === null && isValidating,
    isValidating,
    loadedEmpty: data === "0",
    loadedSome: data === "1" || data === "many" || (Array.isArray(data) && data.length > 0)
  };
}

export function swrWindowView(state: ModelState, id: string, currentKey: string, options: { active?: boolean } = {}): SwrView {
  return swrView(state, swrWindowEntryId(id, currentKey), options);
}

export function swrVarId(id: string, field: "data" | "isValidating" | "error"): string {
  return `swr:${id}:${field}`;
}

export function swrWindowEntryId(id: string, key: string): string {
  return `${id}:${key}`;
}

function swrIdFromKey(key: string): string {
  return key.replace(/^\/+/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "root";
}

function stringMetadata(metadata: Record<string, Value>, key: string, fallback: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value : fallback;
}

function booleanMetadata(metadata: Record<string, Value>, key: string, fallback: boolean): boolean {
  const value = metadata[key];
  return typeof value === "boolean" ? value : fallback;
}

function domainMetadata(value: Value | undefined): AbstractDomain {
  if (isDomain(value)) return value;
  return { kind: "tokens", count: 1 };
}

function exprMetadata(value: Value | undefined): ExprIR | undefined {
  return isExpr(value) ? value : undefined;
}

function isDomain(value: Value | undefined): value is AbstractDomain {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "kind" in value);
}

function isExpr(value: Value | undefined): value is ExprIR {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "kind" in value);
}

function pendingIs(op: string): ExprIR {
  return { kind: "eq", args: [{ kind: "read", var: "sys:pending", path: ["0", "opId"] }, lit(op)] };
}

function lit(value: Value): ExprIR {
  return { kind: "lit", value };
}

function combineActive(global: ExprIR | undefined, local: ExprIR | undefined): ExprIR | undefined {
  if (!global) return local;
  if (!local) return global;
  return { kind: "and", args: [global, local] };
}

function exprReadList(expr: ExprIR): string[] {
  const reads = new Set<string>();
  const walk = (node: ExprIR): void => {
    if (node.kind === "read") reads.add(node.var);
    if ("args" in node) node.args.forEach(walk);
    if (node.kind === "updateField") {
      walk(node.target);
      walk(node.value);
    }
    if (node.kind === "tagIs" || node.kind === "lenCat") walk(node.arg);
  };
  walk(expr);
  return [...reads];
}

export function outcomeFor(value: Value): string {
  return canonicalJson(value);
}

function lineAndColumn(source: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}
