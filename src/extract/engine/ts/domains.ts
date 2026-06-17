import * as ts from "typescript";
import {
  validateValue,
  type AbstractDomain,
  type ExtractionCaveat,
  type NumericReduction,
  type Value,
} from "modality-ts/core";
import type { DomainRefinementProvider } from "../spi/index.js";
import { modelSlackCaveat, unprovableNumericDomainCaveat } from "./caveats.js";
import type { ExtractionWarning } from "./types.js";
import { resolveDomainRefinements } from "./domain-refinements.js";
import {
  exactFirstReduction,
  mergeNumericReductions,
} from "./numeric/abstraction.js";
import { componentNameFor } from "./ast.js";
import {
  inferDomainFromExpressionSemanticDetailed,
  inferDomainFromTypeNodeSemanticDetailed,
} from "./type-domains.js";

export interface DomainInferenceResult {
  domain: AbstractDomain;
  caveats: ExtractionCaveat[];
  reductions?: NumericReduction[];
}

export interface DomainInferenceContext {
  initializer?: ts.Expression;
  declaration?: ts.VariableDeclaration;
  sourceFile?: ts.SourceFile;
  varId?: string;
  domainRefinements?: readonly DomainRefinementProvider[];
}

export function inferDomainFromTypeNode(
  node: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  visited: ReadonlySet<string> = new Set(),
): AbstractDomain {
  return inferDomainFromTypeNodeDetailed(node, typeAliases, visited).domain;
}

export function inferDomainFromTypeNodeDetailed(
  node: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  visited: ReadonlySet<string> = new Set(),
  context: DomainInferenceContext = {},
): DomainInferenceResult {
  if (!node) return abstractNumeric("missing type");
  switch (node.kind) {
    case ts.SyntaxKind.BooleanKeyword:
      return { domain: { kind: "bool" }, caveats: [] };
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return { domain: { kind: "tokens", count: 1 }, caveats: [] };
    case ts.SyntaxKind.NumberKeyword:
      return inferNumericDomain(node, typeAliases, visited, context);
    case ts.SyntaxKind.LiteralType:
      return {
        domain: domainFromLiteralType(node as ts.LiteralTypeNode),
        caveats: [],
      };
    case ts.SyntaxKind.UnionType:
      return domainFromUnionDetailed(
        node as ts.UnionTypeNode,
        typeAliases,
        visited,
        context,
      );
    case ts.SyntaxKind.TypeLiteral:
      return domainFromTypeLiteralDetailed(
        node as ts.TypeLiteralNode,
        undefined,
        typeAliases,
        visited,
        context,
      );
    case ts.SyntaxKind.ArrayType:
      return { domain: { kind: "lengthCat" }, caveats: [] };
    case ts.SyntaxKind.TypeReference:
      return domainFromTypeReferenceDetailed(
        node as ts.TypeReferenceNode,
        typeAliases,
        visited,
        context,
      );
    case ts.SyntaxKind.TypeQuery:
      return domainFromTypeQueryDetailed(
        node as ts.TypeQueryNode,
        typeAliases,
        visited,
        context,
      );
    default:
      return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }
}

export function inferUseStateDomain(
  call: ts.CallExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
): AbstractDomain {
  return inferUseStateDomainDetailed(call, typeAliases).domain;
}

export function inferUseStateDomainDetailed(
  call: ts.CallExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  sourceFile?: ts.SourceFile,
  varId?: string,
  domainRefinements: readonly DomainRefinementProvider[] = [],
): DomainInferenceResult {
  const typeArg = call.typeArguments?.[0];
  const initializer = call.arguments[0];
  if (typeArg) {
    return inferDomainFromTypeNodeDetailed(typeArg, typeAliases, new Set(), {
      initializer,
      sourceFile,
      varId,
      domainRefinements,
    });
  }
  if (initializer) {
    const schemaResolved = resolveDomainRefinements(
      {
        initializer,
        sourceFile,
        typeAliases,
        visited: new Set(),
        varId,
      },
      domainRefinements,
    );
    if (schemaResolved.domain) {
      return {
        domain: schemaResolved.domain,
        caveats: schemaResolved.caveats,
        reductions: schemaResolved.reductions,
      };
    }
    if (schemaResolved.caveats.length > 0) {
      return {
        domain: { kind: "tokens", count: 1 },
        caveats: schemaResolved.caveats,
      };
    }
    if (
      initializer.kind === ts.SyntaxKind.TrueKeyword ||
      initializer.kind === ts.SyntaxKind.FalseKeyword
    )
      return { domain: { kind: "bool" }, caveats: [] };
    if (ts.isStringLiteral(initializer))
      return {
        domain: { kind: "enum", values: [initializer.text] },
        caveats: [],
      };
    if (ts.isNumericLiteral(initializer))
      return {
        domain: {
          kind: "boundedInt",
          min: Number(initializer.text),
          max: Number(initializer.text),
        },
        caveats: [],
      };
    if (initializer.kind === ts.SyntaxKind.NullKeyword)
      return {
        domain: { kind: "option", inner: { kind: "tokens", count: 1 } },
        caveats: [],
      };
    if (ts.isArrayLiteralExpression(initializer))
      return { domain: { kind: "lengthCat" }, caveats: [] };
  }
  return { domain: { kind: "tokens", count: 1 }, caveats: [] };
}

export interface UseStateSemanticTypeContext {
  checker: ts.TypeChecker;
  sourceFile?: ts.SourceFile;
}

/**
 * Semantic useState domain inference order when a `TypeChecker` is available:
 * 1. schema/native numeric refinement adapters when they prove finite numeric bounds
 * 2. TypeScript semantic type mapper (`inferDomainFromTypeNodeSemanticDetailed`) for
 *    structural finite domains (records, enums, bool, tagged unions, …)
 * 3. conservative AST initializer / token fallback
 */
export function inferUseStateDomainSemanticDetailed(
  call: ts.CallExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  sourceFile?: ts.SourceFile,
  varId?: string,
  types?: UseStateSemanticTypeContext,
  domainRefinements: readonly DomainRefinementProvider[] = [],
): DomainInferenceResult {
  const semanticSource = types?.sourceFile;
  const callForSemantic =
    semanticSource && sourceFile && semanticSource !== sourceFile
      ? findMatchingUseStateCall(semanticSource, call, varId)
      : call;
  const aliasesForSemantic =
    semanticSource && sourceFile && semanticSource !== sourceFile
      ? typeAliasDeclarations(semanticSource)
      : typeAliases;
  const typeArg = callForSemantic.typeArguments?.[0];
  const initializer = callForSemantic.arguments[0];
  if (typeArg && types?.checker) {
    const inferenceCtx = {
      checker: types.checker,
      sourceFile: semanticSource ?? sourceFile,
      varId,
      typeAliases: aliasesForSemantic,
      initializer,
      domainRefinements,
    };
    const semantic = inferDomainFromTypeNodeSemanticDetailed(
      typeArg,
      inferenceCtx,
      new Set(),
      {
        initializer,
        sourceFile: inferenceCtx.sourceFile,
        varId,
        domainRefinements,
      },
    );
    const ast = inferUseStateDomainDetailed(
      call,
      typeAliases,
      sourceFile,
      varId,
      domainRefinements,
    );
    if (
      ts.isTypeReferenceNode(typeArg) &&
      sameEnumValues(semantic.domain, ast.domain)
    ) {
      return { ...semantic, domain: ast.domain };
    }
    if (semantic.domain.kind !== "tokens" || semantic.caveats.length > 0) {
      return semantic;
    }
    if (ast.domain.kind !== "tokens" || ast.caveats.length > 0) {
      return ast;
    }
    return semantic;
  }
  if (initializer && types?.checker) {
    const semanticFile = semanticSource ?? sourceFile;
    const inferenceCtx = {
      checker: types.checker,
      sourceFile: semanticFile,
      varId,
      typeAliases: aliasesForSemantic,
      initializer,
      domainRefinements,
    };
    const schemaResolved = resolveDomainRefinements(
      {
        initializer,
        sourceFile: semanticFile,
        typeAliases: aliasesForSemantic,
        visited: new Set(),
        varId,
      },
      domainRefinements,
    );
    if (schemaResolved.domain) {
      return {
        domain: schemaResolved.domain,
        caveats: schemaResolved.caveats,
        reductions: schemaResolved.reductions,
      };
    }
    if (schemaResolved.caveats.length > 0) {
      return {
        domain: { kind: "tokens", count: 1 },
        caveats: schemaResolved.caveats,
      };
    }
    if (!typeArg) {
      const ast = inferUseStateDomainDetailed(
        call,
        typeAliases,
        sourceFile,
        varId,
        domainRefinements,
      );
      if (ast.domain.kind !== "tokens" || ast.caveats.length > 0) {
        return ast;
      }
    }
    return inferDomainFromExpressionSemanticDetailed(
      initializer,
      inferenceCtx,
      aliasesForSemantic,
      typeArg,
    );
  }
  return inferUseStateDomainDetailed(
    call,
    typeAliases,
    sourceFile,
    varId,
    domainRefinements,
  );
}

function sameEnumValues(left: AbstractDomain, right: AbstractDomain): boolean {
  if (left.kind !== "enum" || right.kind !== "enum") return false;
  if (left.values.length !== right.values.length) return false;
  const rightValues = new Set(right.values);
  return left.values.every((value) => rightValues.has(value));
}

function parseLocalStateVarId(
  varId?: string,
): { component: string; stateName: string } | undefined {
  if (!varId?.startsWith("local:")) return undefined;
  const rest = varId.slice("local:".length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return { component: rest.slice(0, dot), stateName: rest.slice(dot + 1) };
}

function findMatchingUseStateCall(
  semanticSource: ts.SourceFile,
  fragmentCall: ts.CallExpression,
  varId?: string,
): ts.CallExpression {
  const parsed = parseLocalStateVarId(varId);
  if (!parsed) return fragmentCall;
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node, currentComponent: string | undefined): void => {
    if (found) return;
    const comp = componentNameFor(node) ?? currentComponent;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "useState"
    ) {
      const el = node.name.elements[0];
      if (
        ts.isBindingElement(el) &&
        ts.isIdentifier(el.name) &&
        el.name.text === parsed.stateName
      ) {
        const compId = comp ?? "Anonymous";
        if (compId === parsed.component) {
          found = node.initializer;
          return;
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, comp));
  };
  visit(semanticSource, undefined);
  return found ?? fragmentCall;
}

export function domainInferenceWarnings(
  result: { caveats: readonly ExtractionCaveat[] },
  anchor?: { line?: number; column?: number },
): ExtractionWarning[] {
  return result.caveats.map((caveat) => ({
    message: caveat.reason,
    ...anchor,
    caveat,
  }));
}

export interface InitialValueResult {
  value: Value;
  caveats: ExtractionCaveat[];
}

export function initialValueForUseState(
  call: ts.CallExpression,
  domain: AbstractDomain,
  sourceFile?: ts.SourceFile,
  varId?: string,
): Value {
  return initialValueForUseStateDetailed(call, domain, sourceFile, varId).value;
}

export function initialValueForUseStateDetailed(
  call: ts.CallExpression,
  domain: AbstractDomain,
  sourceFile?: ts.SourceFile,
  varId?: string,
): InitialValueResult {
  const initial = call.arguments[0];
  if (!initial) return { value: firstValue(domain), caveats: [] };
  const context: DomainInferenceContext = {
    initializer: initial,
    sourceFile,
    varId,
  };
  const direct = evaluateInitialExpression(initial, domain, context);
  if (direct) return direct;
  const unwrapped = unwrapLazyInitializer(initial);
  if (unwrapped) {
    const lazy = evaluateInitialExpression(unwrapped, domain, context);
    if (lazy) return lazy;
  }
  return { value: firstValue(domain), caveats: [] };
}

export function firstValue(domain: AbstractDomain): Value {
  switch (domain.kind) {
    case "bool":
      return false;
    case "enum":
      return domain.values[0] ?? "";
    case "boundedInt":
      return domain.min;
    case "intSet":
      return domain.values[0] ?? 0;
    case "option":
      return null;
    case "record":
      return Object.fromEntries(
        Object.entries(domain.fields).map(([key, field]) => [
          key,
          firstValue(field),
        ]),
      );
    case "tagged": {
      const [tagValue, variant] = Object.entries(domain.variants)[0] ?? [
        "unknown",
        { kind: "record", fields: {} } as const,
      ];
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

export function typeAliasDeclarations(
  source: ts.SourceFile,
): Map<string, ts.TypeNode> {
  const aliases = new Map<string, ts.TypeNode>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && ts.isIdentifier(node.name))
      aliases.set(node.name.text, node.type);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return aliases;
}

function inferNumericDomain(
  node: ts.TypeNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const resolved = resolveDomainRefinements(
    {
      typeNode: node,
      initializer: context.initializer,
      declaration: context.declaration,
      sourceFile: context.sourceFile,
      typeAliases,
      visited,
      varId: context.varId,
    },
    context.domainRefinements ?? [],
  );
  if (resolved.domain) {
    return withDomainReductions(
      {
        domain: resolved.domain,
        caveats: resolved.caveats,
        reductions: resolved.reductions,
      },
      context,
    );
  }
  if (resolved.caveats.length > 0) {
    return { domain: { kind: "tokens", count: 1 }, caveats: resolved.caveats };
  }
  return abstractNumeric(context.varId ?? "numeric", node, context.sourceFile);
}

function withDomainReductions(
  result: DomainInferenceResult,
  context: DomainInferenceContext,
): DomainInferenceResult {
  if (!context.varId) return result;
  const inferred = exactFirstReduction(context.varId, result.domain);
  const reductions = mergeNumericReductions(
    result.reductions,
    inferred ? [inferred] : [],
  );
  return reductions.length > 0 ? { ...result, reductions } : result;
}

function reductionsForDomain(
  varId: string,
  domain: AbstractDomain,
  context: DomainInferenceContext,
): NumericReduction[] | undefined {
  const reduction = exactFirstReduction(
    varId,
    domain,
    sourceFromContext(context),
  );
  return reduction ? [reduction] : undefined;
}

function sourceFromContext(
  context: DomainInferenceContext,
): { file: string; line: number; column: number } | undefined {
  if (!context.declaration || !context.sourceFile) return undefined;
  const { line, character } = context.sourceFile.getLineAndCharacterOfPosition(
    context.declaration.getStart(context.sourceFile),
  );
  return {
    file: context.sourceFile.fileName,
    line: line + 1,
    column: character + 1,
  };
}

function abstractNumeric(
  id: string,
  node?: ts.Node,
  sourceFile?: ts.SourceFile,
): DomainInferenceResult {
  const source =
    node && sourceFile
      ? (() => {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          return {
            file: sourceFile.fileName,
            line: line + 1,
            column: character + 1,
          };
        })()
      : undefined;
  return {
    domain: { kind: "tokens", count: 1 },
    caveats: [
      unprovableNumericDomainCaveat(
        id,
        "bare number without statically provable finite domain",
        source,
      ),
    ],
  };
}

type StaticInitialResult = InitialValueResult;

function evaluateInitialExpression(
  expression: ts.Expression,
  domain: AbstractDomain,
  context: DomainInferenceContext,
): StaticInitialResult | undefined {
  const parsed = initialValueFromExpression(expression, domain);
  if (parsed !== undefined) return { value: parsed, caveats: [] };
  if (expression.kind === ts.SyntaxKind.TrueKeyword)
    return { value: validInitialOrFirst(domain, true), caveats: [] };
  if (expression.kind === ts.SyntaxKind.FalseKeyword)
    return { value: validInitialOrFirst(domain, false), caveats: [] };
  if (ts.isStringLiteral(expression))
    return { value: validInitialOrFirst(domain, expression.text), caveats: [] };
  if (ts.isNumericLiteral(expression))
    return {
      value: validInitialOrFirst(domain, Number(expression.text)),
      caveats: [],
    };
  if (expression.kind === ts.SyntaxKind.NullKeyword)
    return { value: validInitialOrFirst(domain, null), caveats: [] };
  if (ts.isArrayLiteralExpression(expression))
    return {
      value: validInitialOrFirst(
        domain,
        lengthCatFromCount(expression.elements.length),
      ),
      caveats: [],
    };
  if (domain.kind === "lengthCat") {
    const arrayLength = staticArrayLength(expression, context);
    if (arrayLength) return arrayLength;
  }
  return undefined;
}

function unwrapLazyInitializer(
  expression: ts.Expression,
): ts.Expression | undefined {
  if (ts.isArrowFunction(expression)) {
    if (ts.isBlock(expression.body)) {
      const returns = expression.body.statements.filter(ts.isReturnStatement);
      if (returns.length !== 1) return undefined;
      return returns[0]?.expression;
    }
    return expression.body;
  }
  if (ts.isFunctionExpression(expression) && ts.isBlock(expression.body)) {
    const returns = expression.body.statements.filter(ts.isReturnStatement);
    if (returns.length !== 1) return undefined;
    return returns[0]?.expression;
  }
  return undefined;
}

function staticArrayLength(
  expression: ts.Expression,
  context: DomainInferenceContext,
): StaticInitialResult | undefined {
  const lengthResult = resolveArrayConstructorLength(expression, context);
  if (!lengthResult) return undefined;
  if (lengthResult.kind === "finite") {
    return {
      value: lengthCatFromCount(lengthResult.length),
      caveats: [],
    };
  }
  const source = sourceAnchorFromExpression(expression, context);
  const id = context.varId ?? "array-initializer";
  return {
    value: firstValue({ kind: "lengthCat" }),
    caveats: [
      modelSlackCaveat(
        id,
        `Unprovable array initializer length for ${id}`,
        source,
      ),
    ],
  };
}

type ArrayLengthResolution =
  | { kind: "finite"; length: number }
  | { kind: "unprovable" };

function resolveArrayConstructorLength(
  expression: ts.Expression,
  context: DomainInferenceContext,
): ArrayLengthResolution | undefined {
  if (ts.isCallExpression(expression) && isArrayFromCall(expression)) {
    const firstArg = expression.arguments[0];
    if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return undefined;
    const lengthProperty = firstArg.properties.find(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) &&
        propertyName(property.name) === "length",
    );
    if (!lengthProperty) return undefined;
    return (
      resolveStaticNumeric(lengthProperty.initializer, context) ?? {
        kind: "unprovable",
      }
    );
  }
  if (ts.isNewExpression(expression) && isNewArrayCall(expression)) {
    const lengthArgs = expression.arguments;
    if (!lengthArgs || lengthArgs.length !== 1) return undefined;
    return (
      resolveStaticNumeric(lengthArgs[0], context) ?? { kind: "unprovable" }
    );
  }
  return undefined;
}

function isArrayFromCall(expression: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "Array" &&
    expression.expression.name.text === "from"
  );
}

function isNewArrayCall(expression: ts.NewExpression): boolean {
  return (
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "Array"
  );
}

function resolveStaticNumeric(
  expression: ts.Expression,
  context: DomainInferenceContext,
): ArrayLengthResolution | undefined {
  if (ts.isNumericLiteral(expression)) {
    const value = Number(expression.text);
    return isSafeFiniteNonNegativeInteger(value)
      ? { kind: "finite", length: value }
      : { kind: "unprovable" };
  }
  if (ts.isIdentifier(expression) && context.sourceFile) {
    const resolved = resolveConstNumericIdentifier(
      expression,
      context.sourceFile,
    );
    if (resolved === undefined) return { kind: "unprovable" };
    return resolved;
  }
  return undefined;
}

function resolveConstNumericIdentifier(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): ArrayLengthResolution | undefined {
  const name = identifier.text;
  const usePos = identifier.getStart(sourceFile);
  const scopes: ts.Node[] = [];
  let current: ts.Node | undefined = identifier;
  while (current) {
    if (
      ts.isSourceFile(current) ||
      ts.isBlock(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      scopes.push(current);
    }
    current = current.parent;
  }
  for (const scope of scopes) {
    const binding = findConstNumericBindingInScope(
      scope,
      name,
      usePos,
      sourceFile,
    );
    if (binding !== undefined) return binding;
  }
  return undefined;
}

function findConstNumericBindingInScope(
  scope: ts.Node,
  name: string,
  usePos: number,
  sourceFile: ts.SourceFile,
): ArrayLengthResolution | undefined {
  const bindings: { pos: number; value: ArrayLengthResolution }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      node !== scope &&
      (ts.isBlock(node) ||
        ts.isSourceFile(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node))
    ) {
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.name.text !== name) {
        ts.forEachChild(node, visit);
        return;
      }
      const statement = node.parent?.parent;
      if (!ts.isVariableStatement(statement)) return;
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return;
      const pos = node.getStart(sourceFile);
      if (pos >= usePos) return;
      const initializer = node.initializer;
      if (!initializer || !ts.isNumericLiteral(initializer)) return;
      const value = Number(initializer.text);
      bindings.push({
        pos,
        value: isSafeFiniteNonNegativeInteger(value)
          ? { kind: "finite", length: value }
          : { kind: "unprovable" },
      });
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (ts.isSourceFile(scope)) {
    for (const statement of scope.statements) visit(statement);
  } else if (ts.isBlock(scope)) {
    for (const statement of scope.statements) visit(statement);
  } else if (
    (ts.isFunctionDeclaration(scope) ||
      ts.isFunctionExpression(scope) ||
      ts.isArrowFunction(scope) ||
      ts.isMethodDeclaration(scope) ||
      ts.isGetAccessorDeclaration(scope) ||
      ts.isSetAccessorDeclaration(scope) ||
      ts.isConstructorDeclaration(scope)) &&
    scope.body &&
    ts.isBlock(scope.body)
  ) {
    for (const statement of scope.body.statements) visit(statement);
  }
  if (bindings.length === 0) return undefined;
  bindings.sort((left, right) => right.pos - left.pos);
  return bindings[0]?.value;
}

function lengthCatFromCount(count: number): Value {
  if (count === 0) return "0";
  if (count === 1) return "1";
  return "many";
}

function isSafeFiniteNonNegativeInteger(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function sourceAnchorFromExpression(
  expression: ts.Expression,
  context: DomainInferenceContext,
): { file: string; line: number; column: number } | undefined {
  if (!context.sourceFile) return undefined;
  const { line, character } = context.sourceFile.getLineAndCharacterOfPosition(
    expression.getStart(context.sourceFile),
  );
  return {
    file: context.sourceFile.fileName,
    line: line + 1,
    column: character + 1,
  };
}

function initialValueFromExpression(
  expression: ts.Expression,
  domain: AbstractDomain,
): Value | undefined {
  const literal = literalValue(expression);
  if (literal !== undefined)
    return validateValue(domain, literal) ? literal : undefined;
  if (domain.kind === "option")
    return initialValueFromExpression(expression, domain.inner);
  if (domain.kind === "record" && ts.isObjectLiteralExpression(expression)) {
    const fields: Record<string, Value> = {};
    for (const [field, fieldDomain] of Object.entries(domain.fields)) {
      const property = expression.properties.find(
        (candidate): candidate is ts.PropertyAssignment =>
          ts.isPropertyAssignment(candidate) &&
          propertyName(candidate.name) === field,
      );
      fields[field] = property
        ? (initialValueFromExpression(property.initializer, fieldDomain) ??
          firstValue(fieldDomain))
        : firstValue(fieldDomain);
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
  if (
    lit.kind === ts.SyntaxKind.TrueKeyword ||
    lit.kind === ts.SyntaxKind.FalseKeyword
  )
    return { kind: "bool" };
  if (ts.isStringLiteral(lit)) return { kind: "enum", values: [lit.text] };
  if (ts.isNumericLiteral(lit))
    return { kind: "boundedInt", min: Number(lit.text), max: Number(lit.text) };
  if (lit.kind === ts.SyntaxKind.NullKeyword)
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}

function domainFromUnionDetailed(
  node: ts.UnionTypeNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const nonNull = node.types.filter(
    (part) =>
      part.kind !== ts.SyntaxKind.UndefinedKeyword &&
      !(
        ts.isLiteralTypeNode(part) &&
        part.literal.kind === ts.SyntaxKind.NullKeyword
      ),
  );
  if (nonNull.length !== node.types.length && nonNull.length > 0) {
    const inner =
      nonNull.length === 1
        ? inferDomainFromTypeNodeDetailed(
            nonNull[0],
            typeAliases,
            visited,
            context,
          )
        : domainFromUnionMembersDetailed(
            nonNull,
            typeAliases,
            visited,
            context,
          );
    return {
      domain: { kind: "option", inner: inner.domain },
      caveats: inner.caveats,
      reductions: inner.reductions,
    };
  }
  return domainFromUnionMembersDetailed(
    node.types,
    typeAliases,
    visited,
    context,
  );
}

function domainFromUnionMembersDetailed(
  types: readonly ts.TypeNode[],
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const literalValues: string[] = [];
  const numericValues: number[] = [];
  for (const part of types) {
    if (!ts.isLiteralTypeNode(part)) {
      const tagged =
        taggedUnionFromMembers(types, typeAliases, visited) ??
        ({ kind: "tokens", count: 1 } as const);
      return { domain: tagged, caveats: [] };
    }
    const lit = part.literal;
    if (ts.isStringLiteral(lit)) literalValues.push(lit.text);
    else if (ts.isNumericLiteral(lit)) numericValues.push(Number(lit.text));
    else {
      const tagged =
        taggedUnionFromMembers(types, typeAliases, visited) ??
        ({ kind: "tokens", count: 1 } as const);
      return { domain: tagged, caveats: [] };
    }
  }
  if (numericValues.length === types.length) {
    const domain = domainFromNumericLiterals(numericValues);
    return {
      domain,
      caveats: [],
      reductions: context.varId
        ? reductionsForDomain(context.varId, domain, context)
        : undefined,
    };
  }
  return { domain: { kind: "enum", values: literalValues }, caveats: [] };
}

function domainFromNumericLiterals(values: readonly number[]): AbstractDomain {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  if (sorted.length === 0) return { kind: "tokens", count: 1 };
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === undefined || max === undefined)
    return { kind: "tokens", count: 1 };
  const dense = sorted.length === max - min + 1;
  if (dense) return { kind: "boundedInt", min, max };
  return { kind: "intSet", values: sorted };
}

function taggedUnionFromMembers(
  types: readonly ts.TypeNode[],
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  visited: ReadonlySet<string> = new Set(),
): AbstractDomain | undefined {
  const members = types.filter(ts.isTypeLiteralNode);
  if (members.length !== types.length) return undefined;
  const tagCandidates = new Map<string, Set<string>>();
  for (const member of members) {
    for (const prop of member.members.filter(ts.isPropertySignature)) {
      if (
        !prop.type ||
        !ts.isIdentifier(prop.name) ||
        !ts.isLiteralTypeNode(prop.type) ||
        !ts.isStringLiteral(prop.type.literal)
      )
        continue;
      const set = tagCandidates.get(prop.name.text) ?? new Set<string>();
      set.add(prop.type.literal.text);
      tagCandidates.set(prop.name.text, set);
    }
  }
  const tag = [...tagCandidates].find(
    ([, values]) => values.size === members.length,
  )?.[0];
  if (!tag) return undefined;
  const variants: Record<string, AbstractDomain> = {};
  for (const member of members) {
    const tagProp = member.members.find(
      (prop): prop is ts.PropertySignature =>
        ts.isPropertySignature(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === tag,
    );
    if (
      !tagProp?.type ||
      !ts.isLiteralTypeNode(tagProp.type) ||
      !ts.isStringLiteral(tagProp.type.literal)
    )
      return undefined;
    variants[tagProp.type.literal.text] = domainFromTypeLiteral(
      member,
      tag,
      typeAliases,
      visited,
    );
  }
  return { kind: "tagged", tag, variants };
}

function domainFromTypeLiteralDetailed(
  node: ts.TypeLiteralNode,
  omitField: string | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const fields: Record<string, AbstractDomain> = {};
  const caveats: ExtractionCaveat[] = [];
  for (const member of node.members) {
    if (
      !ts.isPropertySignature(member) ||
      !member.type ||
      !ts.isIdentifier(member.name) ||
      member.name.text === omitField
    )
      continue;
    const inferred = inferDomainFromTypeNodeDetailed(
      member.type,
      typeAliases,
      visited,
      context,
    );
    fields[member.name.text] = inferred.domain;
    caveats.push(...inferred.caveats);
  }
  return { domain: { kind: "record", fields }, caveats };
}

function domainFromTypeLiteral(
  node: ts.TypeLiteralNode,
  omitField?: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  visited: ReadonlySet<string> = new Set(),
): AbstractDomain {
  return domainFromTypeLiteralDetailed(
    node,
    omitField,
    typeAliases,
    visited,
    {},
  ).domain;
}

function domainFromTypeReferenceDetailed(
  node: ts.TypeReferenceNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const name = node.typeName.getText();
  if (visited.has(name))
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  const resolved = resolveDomainRefinements(
    {
      typeNode: node,
      initializer: context.initializer,
      declaration: context.declaration,
      sourceFile: context.sourceFile,
      typeAliases,
      visited,
      varId: context.varId,
    },
    context.domainRefinements ?? [],
  );
  if (resolved.domain) {
    return withDomainReductions(
      {
        domain: resolved.domain,
        caveats: resolved.caveats,
        reductions: resolved.reductions,
      },
      context,
    );
  }
  if (resolved.caveats.length > 0) {
    return { domain: { kind: "tokens", count: 1 }, caveats: resolved.caveats };
  }
  const alias = typeAliases.get(name);
  if (alias) {
    return inferDomainFromTypeNodeDetailed(
      alias,
      typeAliases,
      new Set([...visited, name]),
      context,
    );
  }
  if (
    (name === "Array" || name === "ReadonlyArray") &&
    node.typeArguments?.length === 1
  )
    return { domain: { kind: "lengthCat" }, caveats: [] };
  if (name === "Record")
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  return { domain: { kind: "tokens", count: 1 }, caveats: [] };
}

function domainFromTypeQueryDetailed(
  node: ts.TypeQueryNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const resolved = resolveDomainRefinements(
    {
      typeNode: node,
      initializer: context.initializer,
      declaration: context.declaration,
      sourceFile: context.sourceFile,
      typeAliases,
      visited,
      varId: context.varId,
    },
    context.domainRefinements ?? [],
  );
  if (resolved.domain) {
    return withDomainReductions(
      {
        domain: resolved.domain,
        caveats: resolved.caveats,
        reductions: resolved.reductions,
      },
      context,
    );
  }
  if (resolved.caveats.length > 0) {
    return { domain: { kind: "tokens", count: 1 }, caveats: resolved.caveats };
  }
  return { domain: { kind: "tokens", count: 1 }, caveats: [] };
}

function literalValue(expression: ts.Expression): Value | undefined {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  )
    return name.text;
  return undefined;
}
