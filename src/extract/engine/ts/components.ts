import { resolve } from "node:path";
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
import {
  domainInferenceWarnings,
  inferUseStateDomainSemanticDetailed,
  useStateCallForSemanticInference,
  initialValueForUseStateDetailed,
} from "./domains.js";
import { routeMountScope } from "./routes.js";
import type {
  SemanticTypeContext,
  DomainRefinementProvider,
} from "../spi/index.js";
import type {
  ComponentDecl,
  CustomHookDecl,
  ExtractableHandler,
  ExtractionWarning,
  HookStateReturn,
  SetterBinding,
} from "./types.js";

export interface ComponentRegistryEntry {
  symbolKey?: string;
  displayName: string;
  decl: ComponentDecl;
  sourceFile?: string;
}

export interface ComponentRegistry {
  bySymbolKey: Map<string, ComponentRegistryEntry>;
  byDisplayName: Map<string, ComponentRegistryEntry>;
}

export interface CustomHookRegistryEntry {
  symbolKey?: string;
  displayName: string;
  decl: CustomHookDecl;
  sourceFile?: string;
}

export interface CustomHookRegistry {
  bySymbolKey: Map<string, CustomHookRegistryEntry>;
  byDisplayName: Map<string, CustomHookRegistryEntry>;
}

export interface RegistryBuildOptions {
  types?: SemanticTypeContext;
  primaryFileName?: string;
  relatedSourceFiles?: readonly ts.SourceFile[];
  supplementalSources?: readonly { sourceText: string; fileName?: string }[];
}

export function emptyComponentRegistry(): ComponentRegistry {
  return { bySymbolKey: new Map(), byDisplayName: new Map() };
}

export function emptyCustomHookRegistry(): CustomHookRegistry {
  return { bySymbolKey: new Map(), byDisplayName: new Map() };
}

export function componentRegistryDisplayMap(
  registry: ComponentRegistry,
): Map<string, ComponentDecl> {
  return new Map(
    [...registry.byDisplayName].map(([name, entry]) => [name, entry.decl]),
  );
}

export function customHookRegistryDisplayNames(
  registry: CustomHookRegistry,
): Set<string> {
  return new Set(registry.byDisplayName.keys());
}

function canonicalRegistryFileName(
  fileName: string,
  types?: SemanticTypeContext,
): string {
  return types?.canonicalFileName?.(fileName) ?? resolve(fileName);
}

function isPrimaryRegistrySource(
  source: ts.SourceFile,
  primaryFileName: string | undefined,
  types?: SemanticTypeContext,
): boolean {
  if (!primaryFileName) return true;
  return (
    canonicalRegistryFileName(source.fileName, types) ===
    canonicalRegistryFileName(primaryFileName, types)
  );
}

function addComponentRegistryEntry(
  registry: ComponentRegistry,
  displayName: string,
  decl: ComponentDecl,
  source: ts.SourceFile,
  nameIdentifier: ts.Identifier,
  options: {
    types?: SemanticTypeContext;
    primaryFileName?: string;
    syntaxOnlyMerge?: boolean;
  },
): void {
  const symbolKey = options.types?.localSymbolKey?.(nameIdentifier);
  const entry: ComponentRegistryEntry = {
    ...(symbolKey ? { symbolKey } : {}),
    displayName,
    decl,
    sourceFile: canonicalRegistryFileName(source.fileName, options.types),
  };
  if (symbolKey) registry.bySymbolKey.set(symbolKey, entry);
  const primary = isPrimaryRegistrySource(
    source,
    options.primaryFileName,
    options.types,
  );
  if (primary || options.syntaxOnlyMerge) {
    if (options.syntaxOnlyMerge && registry.byDisplayName.has(displayName))
      return;
    registry.byDisplayName.set(displayName, entry);
  }
}

function addCustomHookRegistryEntry(
  registry: CustomHookRegistry,
  displayName: string,
  decl: CustomHookDecl,
  source: ts.SourceFile,
  nameIdentifier: ts.Identifier,
  options: {
    types?: SemanticTypeContext;
    primaryFileName?: string;
    syntaxOnlyMerge?: boolean;
  },
): void {
  const symbolKey = options.types?.localSymbolKey?.(nameIdentifier);
  const entry: CustomHookRegistryEntry = {
    ...(symbolKey ? { symbolKey } : {}),
    displayName,
    decl,
    sourceFile: canonicalRegistryFileName(source.fileName, options.types),
  };
  if (symbolKey) registry.bySymbolKey.set(symbolKey, entry);
  const primary = isPrimaryRegistrySource(
    source,
    options.primaryFileName,
    options.types,
  );
  if (primary || options.syntaxOnlyMerge) {
    if (options.syntaxOnlyMerge && registry.byDisplayName.has(displayName))
      return;
    registry.byDisplayName.set(displayName, entry);
  }
}

function populateComponentRegistryFromSource(
  registry: ComponentRegistry,
  source: ts.SourceFile,
  options: {
    types?: SemanticTypeContext;
    primaryFileName?: string;
    syntaxOnlyMerge?: boolean;
  },
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      startsUppercase(node.name.text)
    ) {
      addComponentRegistryEntry(
        registry,
        node.name.text,
        node,
        source,
        node.name,
        options,
      );
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      startsUppercase(node.name.text) &&
      node.initializer &&
      isExtractableHandler(node.initializer)
    ) {
      addComponentRegistryEntry(
        registry,
        node.name.text,
        node.initializer,
        source,
        node.name,
        options,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function populateCustomHookRegistryFromSource(
  registry: CustomHookRegistry,
  source: ts.SourceFile,
  options: {
    types?: SemanticTypeContext;
    primaryFileName?: string;
    syntaxOnlyMerge?: boolean;
  },
): void {
  const visit = (node: ts.Node): void => {
    const name = customHookDeclarationName(node);
    if (!name) {
      ts.forEachChild(node, visit);
      return;
    }
    const nameIdentifier = customHookNameIdentifier(node);
    if (!nameIdentifier) {
      ts.forEachChild(node, visit);
      return;
    }
    if (ts.isFunctionDeclaration(node)) {
      addCustomHookRegistryEntry(
        registry,
        name,
        node,
        source,
        nameIdentifier,
        options,
      );
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isExtractableHandler(node.initializer)
    ) {
      addCustomHookRegistryEntry(
        registry,
        name,
        node.initializer,
        source,
        nameIdentifier,
        options,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function collectRelatedSourceFiles(
  primary: ts.SourceFile,
  options: RegistryBuildOptions,
): ts.SourceFile[] {
  if (options.relatedSourceFiles && options.relatedSourceFiles.length > 0) {
    if (!options.types?.getSourceFile) {
      return options.relatedSourceFiles.filter((file) => file !== primary);
    }
  } else if (!options.types?.getSourceFile) {
    return [];
  }
  const seen = new Set<string>();
  const files: ts.SourceFile[] = [];
  const addFile = (fileName: string): void => {
    const key = canonicalRegistryFileName(fileName, options.types);
    if (seen.has(key)) return;
    seen.add(key);
    const sourceFile = options.types?.getSourceFile(fileName);
    if (!sourceFile || sourceFile === primary) return;
    files.push(sourceFile);
  };
  addFile(primary.fileName);
  for (const sourceFile of options.relatedSourceFiles ?? []) {
    addFile(sourceFile.fileName);
  }
  return files;
}

export function componentRegistryWithPrimaryDisplay(
  shared: ComponentRegistry,
  primary: ts.SourceFile,
  types?: SemanticTypeContext,
): ComponentRegistry {
  const registry: ComponentRegistry = {
    bySymbolKey: new Map(shared.bySymbolKey),
    byDisplayName: new Map(shared.byDisplayName),
  };
  populateComponentRegistryFromSource(registry, primary, {
    types,
    primaryFileName: primary.fileName,
  });
  return registry;
}

export function customHookRegistryWithPrimaryDisplay(
  shared: CustomHookRegistry,
  primary: ts.SourceFile,
  types?: SemanticTypeContext,
): CustomHookRegistry {
  const registry: CustomHookRegistry = {
    bySymbolKey: new Map(shared.bySymbolKey),
    byDisplayName: new Map(shared.byDisplayName),
  };
  populateCustomHookRegistryFromSource(registry, primary, {
    types,
    primaryFileName: primary.fileName,
  });
  return registry;
}

export function buildComponentRegistry(
  primary: ts.SourceFile,
  options: RegistryBuildOptions = {},
): ComponentRegistry {
  const registry = emptyComponentRegistry();
  const populateOptions = {
    types: options.types,
    primaryFileName: options.primaryFileName ?? primary.fileName,
  };
  populateComponentRegistryFromSource(registry, primary, populateOptions);
  for (const sourceFile of collectRelatedSourceFiles(primary, options)) {
    populateComponentRegistryFromSource(registry, sourceFile, {
      ...populateOptions,
      syntaxOnlyMerge: !options.types,
    });
  }
  for (const supplemental of options.supplementalSources ?? []) {
    const supplementalSource =
      options.types?.getSourceFile?.(supplemental.fileName ?? primary.fileName) ??
      ts.createSourceFile(
        supplemental.fileName ?? primary.fileName,
        supplemental.sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
    populateComponentRegistryFromSource(registry, supplementalSource, {
      primaryFileName: populateOptions.primaryFileName,
      syntaxOnlyMerge: true,
    });
  }
  return registry;
}

export function buildCustomHookRegistry(
  primary: ts.SourceFile,
  options: RegistryBuildOptions = {},
): CustomHookRegistry {
  const registry = emptyCustomHookRegistry();
  const populateOptions = {
    types: options.types,
    primaryFileName: options.primaryFileName ?? primary.fileName,
  };
  populateCustomHookRegistryFromSource(registry, primary, populateOptions);
  for (const sourceFile of collectRelatedSourceFiles(primary, options)) {
    populateCustomHookRegistryFromSource(registry, sourceFile, {
      ...populateOptions,
      syntaxOnlyMerge: !options.types,
    });
  }
  for (const supplemental of options.supplementalSources ?? []) {
    const supplementalSource =
      options.types?.getSourceFile?.(supplemental.fileName ?? primary.fileName) ??
      ts.createSourceFile(
        supplemental.fileName ?? primary.fileName,
        supplemental.sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
    populateCustomHookRegistryFromSource(registry, supplementalSource, {
      primaryFileName: populateOptions.primaryFileName,
      syntaxOnlyMerge: true,
    });
  }
  return registry;
}

export function resolveComponentEntry(
  registry: ComponentRegistry,
  tag: string | ts.Identifier,
  types?: SemanticTypeContext,
): ComponentRegistryEntry | undefined {
  if (typeof tag !== "string" && types?.localSymbolKey) {
    const symbolKey = types.localSymbolKey(tag);
    if (symbolKey) {
      const bySymbol = registry.bySymbolKey.get(symbolKey);
      if (bySymbol) return bySymbol;
    }
  }
  const displayName = typeof tag === "string" ? tag : tag.text;
  return registry.byDisplayName.get(displayName);
}

export function resolveCustomHookEntry(
  registry: CustomHookRegistry,
  callee: string | ts.Identifier,
  types?: SemanticTypeContext,
): CustomHookRegistryEntry | undefined {
  if (typeof callee !== "string" && types?.localSymbolKey) {
    const symbolKey = types.localSymbolKey(callee);
    if (symbolKey) {
      const bySymbol = registry.bySymbolKey.get(symbolKey);
      if (bySymbol) return bySymbol;
    }
  }
  const displayName = typeof callee === "string" ? callee : callee.text;
  return registry.byDisplayName.get(displayName);
}

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
  types?: SemanticTypeContext,
  relatedSourceFiles?: readonly ts.SourceFile[],
): Map<string, ComponentDecl> {
  return componentRegistryDisplayMap(
    buildComponentRegistry(source, {
      ...(types ? { types } : {}),
      primaryFileName: source.fileName,
      ...(relatedSourceFiles ? { relatedSourceFiles } : {}),
    }),
  );
}

export function customHookDeclarations(
  source: ts.SourceFile,
  types?: SemanticTypeContext,
  relatedSourceFiles?: readonly ts.SourceFile[],
): Map<string, CustomHookDecl> {
  const registry = buildCustomHookRegistry(source, {
    ...(types ? { types } : {}),
    primaryFileName: source.fileName,
    ...(relatedSourceFiles ? { relatedSourceFiles } : {}),
  });
  return new Map(
    [...registry.byDisplayName].map(([name, entry]) => [name, entry.decl]),
  );
}

export function isCustomHookDeclaration(node: ts.Node): boolean {
  return Boolean(customHookDeclarationName(node));
}

export function inlineCustomHookState(
  source: ts.SourceFile,
  fileName: string,
  node: ts.VariableDeclaration,
  customHooks: CustomHookRegistry,
  vars: StateVarDecl[],
  setters: Map<string, SetterBinding>,
  component: string,
  route: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  warnings: ExtractionWarning[],
  scope?: StateVarDecl["scope"],
  types?: SemanticTypeContext,
  domainRefinements?: readonly DomainRefinementProvider[],
): boolean {
  if (
    !ts.isArrayBindingPattern(node.name) ||
    !node.initializer ||
    !ts.isCallExpression(node.initializer) ||
    !ts.isIdentifier(node.initializer.expression)
  )
    return false;
  const hookEntry = resolveCustomHookEntry(
    customHooks,
    node.initializer.expression,
    types,
  );
  if (!hookEntry) return false;
  const hook = hookEntry.decl;
  const stateName = node.name.elements[0];
  const setterName = node.name.elements[1];
  if (
    !ts.isBindingElement(stateName) ||
    !ts.isIdentifier(stateName.name) ||
    !ts.isBindingElement(setterName) ||
    !ts.isIdentifier(setterName.name)
  )
    return false;
  const varId = `local:${component}.${stateName.name.text}`;
  const anchor = lineAndColumn(source, node);
  const summary = hookStateReturn(
    hook,
    source,
    varId,
    typeAliases,
    anchor,
    types,
    domainRefinements,
  );
  if (!summary) return false;
  if (summary.warnings) warnings.push(...summary.warnings);
  const decl: StateVarDecl = {
    id: varId,
    domain: summary.domain,
    origin: { file: fileName, ...lineAndColumn(source, node) },
    scope: scope ?? routeMountScope(route),
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
  customHooks: CustomHookRegistry,
  types?: SemanticTypeContext,
): CustomHookRegistryEntry | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression))
    return undefined;
  return resolveCustomHookEntry(customHooks, node.expression, types);
}

export function detectStatefulListComponents(
  source: ts.SourceFile,
  registry: ComponentRegistry,
  types?: SemanticTypeContext,
): Set<string> {
  const listComponents = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "map"
    ) {
      for (const tag of jsxComponentTagIdentifiers(node)) {
        const entry = resolveComponentEntry(registry, tag, types);
        if (entry && componentHasUseState(entry.decl))
          listComponents.add(entry.displayName);
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
        return itemName && values.length > 0 ? { itemName, values } : undefined;
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
  const identifier = jsxTagIdentifier(attribute);
  return identifier?.text;
}

export function jsxTagIdentifier(
  attribute: ts.JsxAttribute,
): ts.Identifier | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const parent = attrs.parent;
  if (!ts.isJsxOpeningElement(parent) && !ts.isJsxSelfClosingElement(parent))
    return undefined;
  return ts.isIdentifier(parent.tagName) ? parent.tagName : undefined;
}

export function componentName(component: ComponentDecl): string | undefined {
  if (ts.isFunctionDeclaration(component) && component.name)
    return component.name.text;
  return componentNameFor(component.parent);
}

function hookStateReturn(
  hook: CustomHookDecl,
  source: ts.SourceFile,
  varId: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  anchor: { line?: number; column?: number },
  types?: SemanticTypeContext,
  domainRefinements?: readonly DomainRefinementProvider[],
): HookStateReturn | undefined {
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
  const callForInference = useStateCallForSemanticInference(
    stateCall,
    source,
    types,
    varId,
  );
  const inferred = inferUseStateDomainSemanticDetailed(
    callForInference,
    typeAliases,
    source,
    varId,
    types,
    domainRefinements ?? [],
  );
  const domain = inferred.domain;
  const hookWarnings = [...domainInferenceWarnings(inferred, anchor)];
  const initialResult = initialValueForUseStateDetailed(
    callForInference,
    domain,
    source,
    varId,
  );
  hookWarnings.push(...domainInferenceWarnings(initialResult, anchor));
  return {
    domain,
    initial: initialResult.value,
    warnings: hookWarnings.length > 0 ? hookWarnings : undefined,
  };
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

function customHookNameIdentifier(node: ts.Node): ts.Identifier | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
    return node.name;
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

function jsxComponentTagIdentifiers(node: ts.Node): ts.Identifier[] {
  const tags: ts.Identifier[] = [];
  const visit = (candidate: ts.Node): void => {
    const tag = jsxElementTagIdentifier(candidate);
    if (tag && startsUppercase(tag.text)) tags.push(tag);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return tags;
}

function jsxElementTagIdentifier(node: ts.Node): ts.Identifier | undefined {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    return ts.isIdentifier(node.tagName) ? node.tagName : undefined;
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
