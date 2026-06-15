import * as ts from "typescript";
import type { AbstractDomain, Value } from "modality-ts/core";
import {
  firstValue,
  inferDomainFromTypeNode,
  typeAliasDeclarations,
} from "modality-ts/extract/engine/spi";
import { literalValue, propertyName } from "../../engine/ts/ast.js";
import {
  validateValue,
  type AbstractDomain as CoreDomain,
} from "modality-ts/core";
import { atomCreatorName, type JotaiResolvedImports } from "./imports.js";
import {
  getCallsInReadFunction,
  isAsyncReadFunction,
  isReadFunction,
} from "./derived-writes.js";
import type { AtomConfigKind, JotaiAtomMetadata } from "./types.js";

export { typeAliasDeclarations };

export interface AtomClassification {
  configKind: AtomConfigKind;
  domain: AbstractDomain;
  initial: Value;
  metadata: JotaiAtomMetadata;
  emitVar: boolean;
  warning?: string;
}

export function classifyAtomCall(
  call: ts.CallExpression,
  atomName: string,
  imports: JotaiResolvedImports,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AtomClassification {
  const creator = atomCreatorName(call, imports.atomCreators) ?? "atom";
  switch (creator) {
    case "atomWithStorage":
      return classifyStorageAtom(call, atomName, typeAliases);
    case "atomWithLazy":
      return classifyLazyAtom(call, atomName, typeAliases);
    case "atomWithReset":
      return classifyResetAtom(call, atomName, typeAliases);
    case "atomWithDefault":
      return classifyDefaultAtom(call, atomName, typeAliases);
    case "atomWithRefresh":
      return classifyRefreshAtom(call, atomName, typeAliases);
    case "loadable":
      return classifyLoadableAtom(call, atomName);
    case "unwrap":
      return classifyUnwrapAtom(call, atomName);
    case "atomWithObservable":
      return classifyObservableAtom(call, atomName, typeAliases);
    case "atomFamily":
      return classifyFamilyAtom(atomName);
    default:
      return classifyCoreAtom(call, atomName, typeAliases);
  }
}

function classifyCoreAtom(
  call: ts.CallExpression,
  atomName: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AtomClassification {
  const args = call.arguments;
  const first = args[0];
  const second = args[1];
  if (first && isReadFunction(first)) {
    if (isAsyncReadFunction(first)) {
      return {
        configKind: "readOnlyDerived",
        domain: { kind: "tokens", count: 1 },
        initial: "tok1",
        emitVar: true,
        metadata: {
          atomName,
          configKind: "readOnlyDerived",
          creator: "atom",
          asyncDerived: true,
          readDependencies: getCallsInReadFunction(first),
          warning: "Jotai async derived atom read abstracted",
        },
        warning: "Jotai async derived atom read abstracted",
      };
    }
    if (second && isReadFunction(second)) {
      return {
        configKind: "readWriteDerived",
        domain: inferAtomDomain(call, typeAliases),
        initial: firstValue(inferAtomDomain(call, typeAliases)),
        emitVar: false,
        metadata: {
          atomName,
          configKind: "readWriteDerived",
          creator: "atom",
          readDependencies: getCallsInReadFunction(first),
        },
      };
    }
    return {
      configKind: "readOnlyDerived",
      domain: { kind: "tokens", count: 1 },
      initial: "tok1",
      emitVar: true,
      metadata: {
        atomName,
        configKind: "readOnlyDerived",
        creator: "atom",
        readDependencies: getCallsInReadFunction(first),
        warning: "Jotai derived read-only atom uses token domain",
      },
      warning: "Jotai derived read-only atom uses token domain",
    };
  }
  if (
    (first === undefined ||
      first.kind === ts.SyntaxKind.NullKeyword ||
      !isReadFunction(first)) &&
    second &&
    isReadFunction(second)
  ) {
    return {
      configKind: "writeOnlyDerived",
      domain: { kind: "tokens", count: 1 },
      initial: "tok1",
      emitVar: false,
      metadata: {
        atomName,
        configKind: "writeOnlyDerived",
        creator: "atom",
      },
    };
  }
  const domain = inferAtomDomain(call, typeAliases);
  return {
    configKind: "primitive",
    domain,
    initial: initialValueForAtom(call, domain),
    emitVar: true,
    metadata: { atomName, configKind: "primitive", creator: "atom" },
  };
}

function classifyStorageAtom(
  call: ts.CallExpression,
  atomName: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AtomClassification {
  const keyArg = call.arguments[0];
  const initialArg = call.arguments[1];
  const optionsArg = call.arguments[3];
  const storageKey =
    keyArg && ts.isStringLiteral(keyArg) ? keyArg.text : undefined;
  const domain: AbstractDomain = initialArg
    ? domainFromExpression(initialArg, typeAliases, call.typeArguments?.[0])
    : { kind: "tokens", count: 1 };
  const initial = initialArg
    ? valueFromExpression(initialArg, domain)
    : firstValue(domain);
  let getOnInit = false;
  let storageKind: string | undefined;
  if (optionsArg && ts.isObjectLiteralExpression(optionsArg)) {
    for (const prop of optionsArg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = propertyName(prop.name);
      if (
        name === "getOnInit" &&
        prop.initializer.kind === ts.SyntaxKind.TrueKeyword
      ) {
        getOnInit = true;
      }
    }
  }
  const storageArg = call.arguments[2];
  if (storageArg) {
    const text = storageArg.getText();
    if (text.includes("localStorage")) storageKind = "localStorage";
    else if (text.includes("sessionStorage")) storageKind = "sessionStorage";
  }
  const warning = getOnInit
    ? "Jotai atomWithStorage getOnInit may read unknown stored value"
    : undefined;
  return {
    configKind: "storage",
    domain,
    initial,
    emitVar: true,
    warning,
    metadata: {
      atomName,
      configKind: "storage",
      creator: "atomWithStorage",
      ...(storageKey ? { storageKey } : {}),
      ...(storageKind ? { storageKind } : {}),
      getOnInit,
      resettableInitial: initial,
      ...(warning ? { warning } : {}),
    },
  };
}

function classifyLazyAtom(
  call: ts.CallExpression,
  atomName: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AtomClassification {
  const initArg = call.arguments[0];
  if (
    initArg &&
    (ts.isArrowFunction(initArg) || ts.isFunctionExpression(initArg))
  ) {
    if (!ts.isBlock(initArg.body)) {
      const domain = domainFromExpression(initArg.body, typeAliases);
      const initial = valueFromExpression(initArg.body, domain);
      return {
        configKind: "lazy",
        domain,
        initial,
        emitVar: true,
        metadata: { atomName, configKind: "lazy", creator: "atomWithLazy" },
      };
    }
  }
  const warning = `Jotai lazy initializer ${atomName} not statically evaluated`;
  return {
    configKind: "lazy",
    domain: { kind: "tokens", count: 1 },
    initial: "tok1",
    emitVar: true,
    warning,
    metadata: {
      atomName,
      configKind: "lazy",
      creator: "atomWithLazy",
      warning,
    },
  };
}

function classifyResetAtom(
  call: ts.CallExpression,
  atomName: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AtomClassification {
  const domain = inferAtomDomain(call, typeAliases);
  const initial = initialValueForAtom(call, domain);
  return {
    configKind: "resettable",
    domain,
    initial,
    emitVar: true,
    metadata: {
      atomName,
      configKind: "resettable",
      creator: "atomWithReset",
      resettableInitial: initial,
    },
  };
}

function classifyDefaultAtom(
  call: ts.CallExpression,
  atomName: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AtomClassification {
  const readArg = call.arguments[0];
  if (readArg && isReadFunction(readArg)) {
    const deps = getCallsInReadFunction(readArg);
    if (deps.length > 0) {
      const warning = `Jotai atomWithDefault ${atomName} read not statically inlined`;
      return {
        configKind: "defaultResettable",
        domain: { kind: "tokens", count: 1 },
        initial: "tok1",
        emitVar: true,
        warning,
        metadata: {
          atomName,
          configKind: "defaultResettable",
          creator: "atomWithDefault",
          readDependencies: deps,
          warning,
        },
      };
    }
  }
  const domain = inferAtomDomain(call, typeAliases);
  return {
    configKind: "defaultResettable",
    domain,
    initial: initialValueForAtom(call, domain),
    emitVar: true,
    metadata: {
      atomName,
      configKind: "defaultResettable",
      creator: "atomWithDefault",
    },
  };
}

function classifyRefreshAtom(
  call: ts.CallExpression,
  atomName: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AtomClassification {
  const readArg = call.arguments[0];
  const warning =
    readArg && isReadFunction(readArg)
      ? `Jotai atomWithRefresh ${atomName} re-evaluation abstracted`
      : undefined;
  const domain = inferAtomDomain(call, typeAliases);
  return {
    configKind: "refreshable",
    domain,
    initial: initialValueForAtom(call, domain),
    emitVar: true,
    warning,
    metadata: {
      atomName,
      configKind: "refreshable",
      creator: "atomWithRefresh",
      ...(warning ? { warning } : {}),
    },
  };
}

function classifyLoadableAtom(
  call: ts.CallExpression,
  atomName: string,
): AtomClassification {
  return {
    configKind: "asyncWrapper",
    domain: {
      kind: "tagged",
      tag: "state",
      variants: {
        loading: { kind: "record", fields: {} },
        hasData: {
          kind: "record",
          fields: { data: { kind: "tokens", count: 1 } },
        },
        hasError: {
          kind: "record",
          fields: { error: { kind: "tokens", count: 1 } },
        },
      },
    },
    initial: { state: "loading" },
    emitVar: true,
    metadata: {
      atomName,
      configKind: "asyncWrapper",
      creator: "loadable",
      loadableState: true,
    },
  };
}

function classifyUnwrapAtom(
  call: ts.CallExpression,
  atomName: string,
): AtomClassification {
  const fallback = call.arguments[1];
  let warning: string | undefined;
  let domain: AbstractDomain = {
    kind: "option",
    inner: { kind: "tokens", count: 1 },
  };
  let initial: Value = null;
  if (
    fallback &&
    (ts.isArrowFunction(fallback) || ts.isFunctionExpression(fallback))
  ) {
    if (!ts.isBlock(fallback.body)) {
      const lit = literalValue(fallback.body);
      if (lit !== undefined) {
        domain = { kind: "enum", values: [String(lit)] };
        initial = lit as Value;
      } else {
        warning = `Jotai unwrap fallback for ${atomName} not statically evaluated`;
      }
    } else {
      warning = `Jotai unwrap fallback for ${atomName} not statically evaluated`;
    }
  } else {
    warning = `Jotai unwrap ${atomName} pending value abstracted`;
  }
  return {
    configKind: "asyncWrapper",
    domain,
    initial,
    emitVar: true,
    warning,
    metadata: {
      atomName,
      configKind: "asyncWrapper",
      creator: "unwrap",
      ...(warning ? { warning } : {}),
    },
  };
}

function classifyObservableAtom(
  call: ts.CallExpression,
  atomName: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AtomClassification {
  const optionsArg = call.arguments[1];
  let initialArg: ts.Expression | undefined;
  if (optionsArg && ts.isObjectLiteralExpression(optionsArg)) {
    for (const prop of optionsArg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (propertyName(prop.name) === "initialValue") {
        initialArg = prop.initializer;
      }
    }
  }
  if (initialArg) {
    const domain = domainFromExpression(initialArg, typeAliases);
    return {
      configKind: "asyncWrapper",
      domain,
      initial: valueFromExpression(initialArg, domain),
      emitVar: true,
      metadata: {
        atomName,
        configKind: "asyncWrapper",
        creator: "atomWithObservable",
      },
    };
  }
  const warning = `Jotai atomWithObservable ${atomName} may suspend before first value`;
  return {
    configKind: "asyncWrapper",
    domain: { kind: "tokens", count: 1 },
    initial: "tok1",
    emitVar: true,
    warning,
    metadata: {
      atomName,
      configKind: "asyncWrapper",
      creator: "atomWithObservable",
      warning,
    },
  };
}

function classifyFamilyAtom(atomName: string): AtomClassification {
  return {
    configKind: "family",
    domain: { kind: "tokens", count: 1 },
    initial: "tok1",
    emitVar: false,
    metadata: {
      atomName,
      configKind: "family",
      creator: "atomFamily",
    },
  };
}

export function classifyFamilyInstance(
  familyName: string,
  param: string,
  innerCall: ts.CallExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AtomClassification {
  const domain = inferAtomDomain(innerCall, typeAliases);
  const initial = initialValueForAtom(innerCall, domain);
  return {
    configKind: "familyInstance",
    domain,
    initial,
    emitVar: true,
    metadata: {
      atomName: familyName,
      configKind: "familyInstance",
      creator: "atomFamily",
      familyFactory: familyName,
      familyParam: param,
    },
  };
}

export function inferAtomDomain(
  call: ts.CallExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
): AbstractDomain {
  const typeArg = call.typeArguments?.[0];
  if (typeArg) return inferDomainFromTypeNode(typeArg, typeAliases);
  const initial = call.arguments[0];
  if (!initial || isReadFunction(initial)) return { kind: "tokens", count: 1 };
  return domainFromExpression(initial, typeAliases);
}

export function initialValueForAtom(
  call: ts.CallExpression,
  domain: AbstractDomain,
): Value {
  const initial = call.arguments[0];
  if (!initial || isReadFunction(initial)) return firstValue(domain);
  return valueFromExpression(initial, domain);
}

function domainFromExpression(
  expr: ts.Expression,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  typeArg?: ts.TypeNode,
): AbstractDomain {
  if (typeArg) return inferDomainFromTypeNode(typeArg, typeAliases);
  if (
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword
  )
    return { kind: "bool" };
  if (ts.isStringLiteral(expr)) return { kind: "enum", values: [expr.text] };
  if (ts.isNumericLiteral(expr))
    return {
      kind: "boundedInt",
      min: Number(expr.text),
      max: Number(expr.text),
    };
  if (expr.kind === ts.SyntaxKind.NullKeyword)
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  if (ts.isArrayLiteralExpression(expr)) return { kind: "lengthCat" };
  if (ts.isObjectLiteralExpression(expr)) return domainFromObjectLiteral(expr);
  return { kind: "tokens", count: 1 };
}

function domainFromObjectLiteral(
  node: ts.ObjectLiteralExpression,
): AbstractDomain {
  const fields: Record<string, AbstractDomain> = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    fields[prop.name.text] = domainFromExpression(prop.initializer, new Map());
  }
  return { kind: "record", fields };
}

function valueFromExpression(
  expr: ts.Expression,
  domain: AbstractDomain,
): Value {
  if (expr.kind === ts.SyntaxKind.TrueKeyword)
    return validInitialOrFirst(domain, true);
  if (expr.kind === ts.SyntaxKind.FalseKeyword)
    return validInitialOrFirst(domain, false);
  if (ts.isStringLiteral(expr)) return validInitialOrFirst(domain, expr.text);
  if (ts.isNumericLiteral(expr))
    return validInitialOrFirst(domain, Number(expr.text));
  if (expr.kind === ts.SyntaxKind.NullKeyword)
    return validInitialOrFirst(domain, null);
  if (ts.isArrayLiteralExpression(expr))
    return validInitialOrFirst(
      domain,
      expr.elements.length === 0
        ? "0"
        : expr.elements.length === 1
          ? "1"
          : "many",
    );
  if (ts.isObjectLiteralExpression(expr))
    return valueFromObjectLiteral(expr, domain);
  return firstValue(domain);
}

function validInitialOrFirst(domain: AbstractDomain, value: Value): Value {
  return validateValue(domain as CoreDomain, value)
    ? value
    : firstValue(domain);
}

function valueFromObjectLiteral(
  node: ts.ObjectLiteralExpression,
  domain: AbstractDomain,
): Value {
  const values: Record<string, Value> = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const fieldDomain =
      domain.kind === "record"
        ? domain.fields[prop.name.text]
        : domain.kind === "tagged"
          ? taggedFieldDomain(domain, prop.name.text)
          : undefined;
    values[prop.name.text] = valueFromExpression(
      prop.initializer,
      fieldDomain ?? { kind: "tokens", count: 1 },
    );
  }
  if (domain.kind === "tagged") {
    const tagField = domain.tag;
    if (!(tagField in values)) {
      const tag = Object.keys(domain.variants)[0] ?? "unknown";
      return { ...values, [tagField]: tag };
    }
  }
  return values;
}

function taggedFieldDomain(
  domain: Extract<AbstractDomain, { kind: "tagged" }>,
  field: string,
): AbstractDomain | undefined {
  if (field === domain.tag) {
    return {
      kind: "enum",
      values: Object.keys(domain.variants),
    };
  }
  const variants = Object.values(domain.variants).filter(
    (variant): variant is Extract<AbstractDomain, { kind: "record" }> =>
      variant.kind === "record",
  );
  const fieldDomains = variants
    .map((variant) => variant.fields[field])
    .filter((candidate): candidate is AbstractDomain => Boolean(candidate));
  return fieldDomains[0];
}

export function staticFamilyParam(
  expression: ts.Expression,
): string | undefined {
  if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) {
    return expression.text;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const fields: Record<string, string> = {};
    for (const prop of expression.properties) {
      if (!ts.isPropertyAssignment(prop)) return undefined;
      const name = propertyName(prop.name);
      if (!name) return undefined;
      const lit = literalValue(prop.initializer);
      if (lit === undefined || typeof lit !== "string") return undefined;
      fields[name] = lit;
    }
    return JSON.stringify(fields);
  }
  return undefined;
}
