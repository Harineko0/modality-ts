import type { SourceAnchor, StateVarDecl } from "modality-ts/core";
import type { SourceDecl, TypePlugin } from "modality-ts/extract/engine/spi";
import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { modelSlackCaveat } from "../../../lang/ts/driver/caveats.js";
import { compilerBackedTypeAliases } from "../../../lang/ts/driver/domains.js";
import { semanticSourceFileFor } from "../../../lang/ts/driver/semantic-source-file.js";
import {
  inferFieldDomain,
  isActionFunction,
  propertyNameFromMember,
  returnObjectLiteral,
} from "./domains.js";
import { storeVarId } from "./ids.js";
import {
  isMiddlewareCall,
  isStoreCreatorCall,
  middlewareName,
  resolveZustandImports,
} from "./imports.js";
import { metadataToRecord } from "./types.js";

export interface UnwrappedCreator {
  creatorFn: ts.ArrowFunction | ts.FunctionExpression;
  combineInitial?: ts.ObjectLiteralExpression;
  middleware: string[];
  immer: boolean;
  storageKind?: string;
}

export interface DiscoverZustandResult {
  decls: SourceDecl[];
  warnings: ZustandDiscoveryWarning[];
  storeNames: Set<string>;
  storeFields: Map<string, Set<string>>;
  storeActions: Map<
    string,
    Map<string, ts.ArrowFunction | ts.FunctionExpression>
  >;
  middlewareUsed: Map<string, string[]>;
  storeImmer: Map<string, boolean>;
  storeFieldInitials: Map<
    string,
    Map<string, import("modality-ts/core").Value>
  >;
}

interface ZustandDiscoveryWarning {
  message: string;
  source?: SourceAnchor;
  caveat?: import("modality-ts/core").ExtractionCaveat;
}

function dynamicStoreFieldWarning(
  source: ts.SourceFile,
  fileName: string,
  storeName: string,
  node: ts.Node,
): ZustandDiscoveryWarning {
  const src = anchor(source, fileName, node);
  const message = "Zustand dynamic store field unsupported";
  return {
    message,
    source: src,
    caveat: modelSlackCaveat(
      `zustand:${storeName}.dynamic-field`,
      message,
      src,
    ),
  };
}

export function discoverZustandStores(
  sourceText: string,
  fileName = "state.ts",
): SourceDecl[] {
  return discoverZustandStoresDetailed(sourceText, fileName).decls;
}

function sourceFileForDiscovery(
  sourceText: string,
  fileName: string,
  types?: SemanticTypeContext,
): ts.SourceFile {
  return semanticSourceFileFor(sourceText, fileName, types, ts.ScriptKind.TSX);
}

export function discoverZustandStoresDetailed(
  sourceText: string,
  fileName = "state.ts",
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): DiscoverZustandResult {
  const source = sourceFileForDiscovery(sourceText, fileName, types);
  const imports = resolveZustandImports(source, types);
  if (imports.storeCreators.size === 0) return emptyDiscoverResult();

  const typeAliases = compilerBackedTypeAliases(source, types);
  const warnings: ZustandDiscoveryWarning[] = [];
  const storeNames = new Set<string>();
  const storeFields = new Map<string, Set<string>>();
  const storeActions = new Map<
    string,
    Map<string, ts.ArrowFunction | ts.FunctionExpression>
  >();
  const middlewareUsed = new Map<string, string[]>();
  const storeImmer = new Map<string, boolean>();
  const storeFieldInitials = new Map<
    string,
    Map<string, import("modality-ts/core").Value>
  >();
  const decls: SourceDecl[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isStoreCreatorCall(node.initializer, imports.storeCreators)
    ) {
      const storeName = node.name.text;
      const creatorCall = resolveCreatorArgument(
        node.initializer,
        imports,
        warnings,
        source,
        fileName,
      );
      if (!creatorCall) {
        ts.forEachChild(node, visit);
        return;
      }
      storeNames.add(storeName);
      middlewareUsed.set(storeName, creatorCall.middleware);
      if (creatorCall.immer) storeImmer.set(storeName, true);

      if (creatorCall.combineInitial) {
        processCombineStore(
          creatorCall.combineInitial,
          creatorCall.creatorFn,
          storeName,
          creatorCall,
          typeAliases,
          source,
          fileName,
          decls,
          storeFields,
          storeActions,
          storeFieldInitials,
          warnings,
          types,
          typePlugins,
        );
      } else {
        const objectLiteral = returnObjectLiteral(creatorCall.creatorFn);
        if (objectLiteral) {
          processStoreObject(
            objectLiteral,
            storeName,
            creatorCall,
            typeAliases,
            source,
            fileName,
            decls,
            storeFields,
            storeActions,
            storeFieldInitials,
            warnings,
            types,
            typePlugins,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return {
    decls,
    warnings,
    storeNames,
    storeFields,
    storeActions,
    middlewareUsed,
    storeImmer,
    storeFieldInitials,
  };
}

function processCombineStore(
  initialLiteral: ts.ObjectLiteralExpression,
  creatorFn: ts.ArrowFunction | ts.FunctionExpression,
  storeName: string,
  creatorCall: UnwrappedCreator,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  source: ts.SourceFile,
  fileName: string,
  decls: SourceDecl[],
  storeFields: Map<string, Set<string>>,
  storeActions: Map<
    string,
    Map<string, ts.ArrowFunction | ts.FunctionExpression>
  >,
  storeFieldInitials: Map<
    string,
    Map<string, import("modality-ts/core").Value>
  >,
  warnings: ZustandDiscoveryWarning[],
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): void {
  emitStateFieldsFromObject(
    initialLiteral,
    storeName,
    creatorCall,
    typeAliases,
    source,
    fileName,
    decls,
    storeFields,
    storeFieldInitials,
    warnings,
    types,
    typePlugins,
  );
  const creatorObject = returnObjectLiteral(creatorFn);
  if (creatorObject) {
    collectActionsFromObject(
      creatorObject,
      storeName,
      storeActions,
      storeFields,
    );
  }
  storeFields.set(storeName, storeFields.get(storeName) ?? new Set());
  storeActions.set(storeName, storeActions.get(storeName) ?? new Map());
  storeFieldInitials.set(
    storeName,
    storeFieldInitials.get(storeName) ?? new Map(),
  );
}

function processStoreObject(
  objectLiteral: ts.ObjectLiteralExpression,
  storeName: string,
  creatorCall: UnwrappedCreator,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  source: ts.SourceFile,
  fileName: string,
  decls: SourceDecl[],
  storeFields: Map<string, Set<string>>,
  storeActions: Map<
    string,
    Map<string, ts.ArrowFunction | ts.FunctionExpression>
  >,
  storeFieldInitials: Map<
    string,
    Map<string, import("modality-ts/core").Value>
  >,
  warnings: ZustandDiscoveryWarning[],
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): void {
  const fields = storeFields.get(storeName) ?? new Set<string>();
  const actions =
    storeActions.get(storeName) ??
    new Map<string, ts.ArrowFunction | ts.FunctionExpression>();
  const initials =
    storeFieldInitials.get(storeName) ??
    new Map<string, import("modality-ts/core").Value>();

  emitStateFieldsFromObject(
    objectLiteral,
    storeName,
    creatorCall,
    typeAliases,
    source,
    fileName,
    decls,
    storeFields,
    storeFieldInitials,
    warnings,
    types,
    typePlugins,
  );
  collectActionsFromObject(objectLiteral, storeName, storeActions, storeFields);

  storeFields.set(storeName, storeFields.get(storeName) ?? fields);
  storeActions.set(storeName, storeActions.get(storeName) ?? actions);
  storeFieldInitials.set(
    storeName,
    storeFieldInitials.get(storeName) ?? initials,
  );
}

function emitStateFieldsFromObject(
  objectLiteral: ts.ObjectLiteralExpression,
  storeName: string,
  creatorCall: UnwrappedCreator,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  source: ts.SourceFile,
  fileName: string,
  decls: SourceDecl[],
  storeFields: Map<string, Set<string>>,
  storeFieldInitials: Map<
    string,
    Map<string, import("modality-ts/core").Value>
  >,
  warnings: ZustandDiscoveryWarning[],
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): void {
  const fields = storeFields.get(storeName) ?? new Set<string>();
  const initials =
    storeFieldInitials.get(storeName) ??
    new Map<string, import("modality-ts/core").Value>();
  const typeArg = extractStoreTypeArg(creatorCall.creatorFn);

  for (const prop of objectLiteral.properties) {
    if (ts.isSpreadAssignment(prop)) {
      warnings.push(
        dynamicStoreFieldWarning(source, fileName, storeName, prop),
      );
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) {
      if (ts.isShorthandPropertyAssignment(prop)) {
        warnings.push(
          dynamicStoreFieldWarning(source, fileName, storeName, prop),
        );
      }
      continue;
    }
    const name = propertyNameFromMember(prop.name);
    if (!name) {
      warnings.push(
        dynamicStoreFieldWarning(source, fileName, storeName, prop),
      );
      continue;
    }
    if (isActionFunction(prop.initializer)) continue;
    const fieldType = typeArg ? lookupFieldType(typeArg, name) : undefined;
    const varId = storeVarId(storeName, name);
    const fieldDomain = inferFieldDomain(
      prop.initializer,
      fieldType,
      typeAliases,
      varId,
      source,
      types,
      typePlugins,
    );
    fields.add(name);
    initials.set(name, fieldDomain.initial);
    const origin = anchor(source, fileName, prop);
    const variable: StateVarDecl = {
      id: varId,
      domain: fieldDomain.domain,
      origin,
      scope: { kind: "global" },
      initial: fieldDomain.initial,
    };
    const middlewareLabel =
      creatorCall.middleware.length > 0
        ? creatorCall.middleware.join(",")
        : undefined;
    decls.push({
      id: varId,
      kind: "zustand/state",
      var: variable,
      origin,
      metadata: metadataToRecord({
        storeName,
        field: name,
        ...(middlewareLabel ? { middleware: middlewareLabel } : {}),
        ...(creatorCall.storageKind
          ? { storageKind: creatorCall.storageKind }
          : {}),
        ...(creatorCall.immer ? { immer: true } : {}),
      }),
    });
  }
  storeFields.set(storeName, fields);
  storeFieldInitials.set(storeName, initials);
}

function collectActionsFromObject(
  objectLiteral: ts.ObjectLiteralExpression,
  storeName: string,
  storeActions: Map<
    string,
    Map<string, ts.ArrowFunction | ts.FunctionExpression>
  >,
  storeFields: Map<string, Set<string>>,
): void {
  const actions =
    storeActions.get(storeName) ??
    new Map<string, ts.ArrowFunction | ts.FunctionExpression>();
  const fields = storeFields.get(storeName) ?? new Set<string>();

  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyNameFromMember(prop.name);
    if (!name) continue;
    if (isActionFunction(prop.initializer)) {
      actions.set(name, prop.initializer);
    }
  }
  storeActions.set(storeName, actions);
  storeFields.set(storeName, fields);
}

function resolveCreatorArgument(
  storeCall: ts.CallExpression,
  imports: ReturnType<typeof resolveZustandImports>,
  warnings: ZustandDiscoveryWarning[],
  source: ts.SourceFile,
  fileName: string,
): UnwrappedCreator | undefined {
  const creatorArg = storeCreatorArgument(storeCall);
  if (!creatorArg) return undefined;
  return unwrapMiddlewareChain(creatorArg, imports, warnings, source, fileName);
}

function storeCreatorArgument(
  storeCall: ts.CallExpression,
): ts.Expression | undefined {
  if (ts.isIdentifier(storeCall.expression)) {
    return storeCall.arguments[0];
  }
  if (ts.isCallExpression(storeCall.expression)) {
    return storeCall.arguments[0];
  }
  return undefined;
}

function unwrapMiddlewareChain(
  expr: ts.Expression,
  imports: ReturnType<typeof resolveZustandImports>,
  warnings: ZustandDiscoveryWarning[],
  source: ts.SourceFile,
  fileName: string,
  middleware: string[] = [],
): UnwrappedCreator | undefined {
  if (isMiddlewareCall(expr, imports.middlewares)) {
    const call = expr;
    const name = middlewareName(call, imports.middlewares);
    if (!name) return undefined;
    const nextMiddleware = [...middleware, name];
    switch (name) {
      case "subscribeWithSelector":
      case "devtools":
      case "immer": {
        const inner = call.arguments[0];
        if (!inner) return undefined;
        const result = unwrapMiddlewareChain(
          inner,
          imports,
          warnings,
          source,
          fileName,
          nextMiddleware,
        );
        if (result && name === "immer") result.immer = true;
        return result;
      }
      case "persist": {
        const inner = call.arguments[0];
        if (!inner) return undefined;
        const result = unwrapMiddlewareChain(
          inner,
          imports,
          warnings,
          source,
          fileName,
          nextMiddleware,
        );
        if (result) {
          result.storageKind = "localStorage";
        }
        return result;
      }
      case "combine": {
        const initial = call.arguments[0];
        const creatorFn = call.arguments[1];
        if (
          !initial ||
          !ts.isObjectLiteralExpression(initial) ||
          !creatorFn ||
          !isActionFunction(creatorFn)
        ) {
          return undefined;
        }
        return {
          creatorFn,
          combineInitial: initial,
          middleware: nextMiddleware,
          immer: false,
        };
      }
      case "redux": {
        const reducer = call.arguments[0];
        const initial = call.arguments[1];
        if (!initial || !ts.isObjectLiteralExpression(initial)) {
          return undefined;
        }
        const dispatchFn = makeDispatchCreator(reducer);
        return {
          creatorFn: dispatchFn,
          combineInitial: initial,
          middleware: nextMiddleware,
          immer: false,
        };
      }
      default:
        return undefined;
    }
  }
  if (isActionFunction(expr)) {
    return { creatorFn: expr, middleware, immer: false };
  }
  return undefined;
}

function makeDispatchCreator(
  reducer: ts.Expression | undefined,
): ts.ArrowFunction {
  const dispatchBody = ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment(
      "dispatch",
      ts.factory.createArrowFunction(
        undefined,
        undefined,
        [
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            "action",
            undefined,
            undefined,
            undefined,
          ),
        ],
        undefined,
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        reducer ?? ts.factory.createBlock([]),
      ),
    ),
  ]);
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    [
      ts.factory.createParameterDeclaration(
        undefined,
        undefined,
        "set",
        undefined,
        undefined,
        undefined,
      ),
    ],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    dispatchBody,
  );
}

function extractStoreTypeArg(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): ts.TypeNode | undefined {
  let current: ts.Node | undefined = fn.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      if (current.typeArguments?.[0]) {
        return current.typeArguments[0];
      }
      if (
        ts.isCallExpression(current.expression) &&
        current.expression.typeArguments?.[0]
      ) {
        return current.expression.typeArguments[0];
      }
    }
    current = current.parent;
  }
  return undefined;
}

function lookupFieldType(
  typeNode: ts.TypeNode,
  field: string,
): ts.TypeNode | undefined {
  if (!ts.isTypeLiteralNode(typeNode)) return undefined;
  for (const member of typeNode.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const name = propertyNameFromMember(member.name);
    if (name === field) return member.type;
  }
  return undefined;
}

function anchor(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
): SourceAnchor {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: fileName, line: pos.line + 1, column: pos.character + 1 };
}

function emptyDiscoverResult(): DiscoverZustandResult {
  return {
    decls: [],
    warnings: [],
    storeNames: new Set(),
    storeFields: new Map(),
    storeActions: new Map(),
    middlewareUsed: new Map(),
    storeImmer: new Map(),
    storeFieldInitials: new Map(),
  };
}

export { anchor };
