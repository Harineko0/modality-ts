import type { StateVarDecl, Value } from "modality-ts/core";
import * as ts from "typescript";
import type { SemanticTypeContext } from "../../lang/ts/semantic-type-context.js";
import type { StateSourcePlugin, WriteChannel } from "../spi/index.js";
import { componentNameFor, isExtractableHandler, propertyName } from "./ast.js";
import {
  type CustomHookRegistry,
  customHookDeclarationName,
  resolveCustomHookEntry,
} from "./components.js";
import type {
  ContextBindings,
  CustomHookDecl,
  ExtractableHandler,
  SetterBinding,
} from "./types.js";

export function emptyContextBindings(): ContextBindings {
  return { vars: [], setters: new Map(), hookReturns: new Map() };
}

export function decodeSetterBinding(
  decl: StateVarDecl,
  statePlugins: readonly StateSourcePlugin[] = [],
): SetterBinding {
  for (const plugin of statePlugins) {
    const binding = plugin.decodeBinding?.(decl);
    if (binding) return binding;
  }
  return {
    varId: decl.id,
    component: "Anonymous",
    stateName: decl.id,
    domain: decl.domain,
    initial: decl.initial as Value,
  };
}

export interface DiscoverContextBindingsOptions {
  stateVars?: readonly StateVarDecl[];
  writeChannels?: readonly WriteChannel[];
  statePlugins?: readonly StateSourcePlugin[];
  route?: string;
  types?: SemanticTypeContext;
}

export function resolveSetterBinding(
  setters: ReadonlyMap<string, SetterBinding>,
  nameOrIdentifier: string | ts.Identifier,
  types?: SemanticTypeContext,
): SetterBinding | undefined {
  if (typeof nameOrIdentifier !== "string" && types?.localSymbolKey) {
    const symbolKey = types.localSymbolKey(nameOrIdentifier);
    if (symbolKey) {
      const bySymbol = setters.get(symbolKey);
      if (bySymbol) return bySymbol;
    }
  }
  const name =
    typeof nameOrIdentifier === "string"
      ? nameOrIdentifier
      : nameOrIdentifier.text;
  return setters.get(name);
}

export function bindSetter(
  setters: Map<string, SetterBinding>,
  symbolName: string,
  setter: SetterBinding,
): void {
  const primaryKey = setter.symbolKey ?? symbolName;
  setters.set(scopedSetterKey(setter.component, primaryKey), setter);
  if (setter.symbolKey) {
    setters.set(scopedSetterKey(setter.component, symbolName), setter);
    const currentByKey = setters.get(setter.symbolKey);
    if (!currentByKey || currentByKey.varId === setter.varId) {
      setters.set(setter.symbolKey, setter);
    }
    return;
  }
  setters.set(scopedSetterKey(setter.component, symbolName), setter);
  const current = setters.get(symbolName);
  if (!current || current.varId === setter.varId) {
    setters.set(symbolName, setter);
    return;
  }
  setters.delete(symbolName);
}

export function settersForComponent(
  setters: ReadonlyMap<string, SetterBinding>,
  component: string | undefined,
): Map<string, SetterBinding> {
  if (!component) return new Map(setters);
  const scoped = new Map(
    [...setters].filter(
      ([key, setter]) =>
        !setter.varId.startsWith("local:") ||
        !key.startsWith(`${setter.component}:`),
    ),
  );
  for (const [key, setter] of setters) {
    if (!key.startsWith(`${component}:`)) continue;
    scoped.set(key.slice(component.length + 1), setter);
  }
  return scoped;
}

export function discoverContextBindings(
  source: ts.SourceFile,
  fileName: string,
  _route: string,
  _typeAliases: ReadonlyMap<string, ts.TypeNode>,
  options: DiscoverContextBindingsOptions = {},
): ContextBindings {
  const bindings = emptyContextBindings();
  const providerValues = new Map<string, Map<string, SetterBinding>>();
  const discovery = resolveUseStateDiscoveryForFile(source, fileName, options);
  const visitProvider = (
    node: ts.Node,
    componentName: string | undefined,
  ): void => {
    const component = componentNameFor(node) ?? componentName;
    const localSetters = new Map<string, SetterBinding>();
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      component &&
      node.body &&
      ts.isBlock(node.body)
    ) {
      for (const [symbolName, setter] of localSettersForComponent(
        component,
        fileName,
        discovery,
        options.statePlugins ?? [],
      )) {
        localSetters.set(symbolName, setter);
      }
      for (const statement of node.body.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
            continue;
          const setter = setterAliasBinding(
            declaration.initializer,
            localSetters,
          );
          if (setter) localSetters.set(declaration.name.text, setter);
        }
      }
    }
    if (
      component &&
      localSetters.size > 0 &&
      node.getText(source).includes(".Provider")
    ) {
      const fields = providerValueFields(node, localSetters);
      if (fields.size > 0) {
        providerValues.set(component, fields);
        for (const setter of fields.values())
          bindings.setters.set(setter.stateName, setter);
      }
    }
    ts.forEachChild(node, (child) => visitProvider(child, component));
  };
  visitProvider(source, undefined);

  const providerFieldMaps = [...providerValues.values()];
  const visitHook = (node: ts.Node): void => {
    const name = customHookDeclarationName(node);
    if (
      name &&
      (ts.isFunctionDeclaration(node) ||
        (ts.isVariableDeclaration(node) &&
          node.initializer &&
          isExtractableHandler(node.initializer)))
    ) {
      const hook = ts.isFunctionDeclaration(node)
        ? node
        : (node.initializer as CustomHookDecl);
      if (hookUsesContext(hook) && providerFieldMaps.length > 0) {
        const merged = new Map<string, SetterBinding>();
        for (const map of providerFieldMaps)
          for (const [field, setter] of map) merged.set(field, setter);
        bindings.hookReturns.set(name, merged);
      }
    }
    ts.forEachChild(node, visitHook);
  };
  visitHook(source);
  return bindings;
}

export function bindContextHookObjectDeclaration(
  node: ts.Node,
  contextBindings: ContextBindings,
  setters: Map<string, SetterBinding>,
  customHooks?: CustomHookRegistry,
  types?: SemanticTypeContext,
): void {
  if (
    !ts.isVariableDeclaration(node) ||
    !ts.isObjectBindingPattern(node.name) ||
    !node.initializer ||
    !ts.isCallExpression(node.initializer) ||
    !ts.isIdentifier(node.initializer.expression)
  )
    return;
  const callee = node.initializer.expression;
  let hook = contextBindings.hookReturns.get(callee.text);
  if (!hook && customHooks) {
    const entry = resolveCustomHookEntry(customHooks, callee, types);
    if (entry) hook = contextBindings.hookReturns.get(entry.displayName);
  }
  if (!hook) return;
  for (const element of node.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const property =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text;
    const setter = hook.get(property);
    if (setter) setters.set(element.name.text, setter);
  }
}

function scopedSetterKey(component: string, symbolName: string): string {
  return `${component}:${symbolName}`;
}

function resolveUseStateDiscoveryForFile(
  source: ts.SourceFile,
  fileName: string,
  options: DiscoverContextBindingsOptions,
): {
  stateVars: readonly StateVarDecl[];
  writeChannels: readonly WriteChannel[];
} {
  if (options.stateVars && options.writeChannels) {
    return {
      stateVars: options.stateVars,
      writeChannels: options.writeChannels,
    };
  }
  const useStatePlugin = options.statePlugins?.find(
    (plugin) => plugin.id === "use-state",
  );
  if (!useStatePlugin) {
    return { stateVars: [], writeChannels: [] };
  }
  const sourceText = source.getFullText();
  const route = options.route ?? "/";
  const decls = useStatePlugin.discover({
    sourceText,
    fileName,
    route,
    ...(options.types ? { types: options.types } : {}),
  });
  const writeChannels = useStatePlugin.writeChannels({
    sourceText,
    fileName,
    ...(options.types ? { types: options.types } : {}),
  });
  const stateVars = decls.flatMap((decl) => (decl.var ? [decl.var] : []));
  return { stateVars, writeChannels };
}

function localSettersForComponent(
  component: string,
  fileName: string,
  discovery: {
    stateVars: readonly StateVarDecl[];
    writeChannels: readonly WriteChannel[];
  },
  statePlugins: readonly StateSourcePlugin[],
): Map<string, SetterBinding> {
  const localSetters = new Map<string, SetterBinding>();
  const prefix = `local:${component}.`;
  for (const channel of discovery.writeChannels) {
    if (!channel.varId.startsWith(prefix)) continue;
    if (channel.source.file !== fileName) continue;
    const decl = discovery.stateVars.find(
      (candidate) => candidate.id === channel.varId,
    );
    if (!decl) continue;
    const binding = decodeSetterBinding(decl, statePlugins);
    if (channel.symbolKey) binding.symbolKey = channel.symbolKey;
    localSetters.set(channel.symbolName, binding);
  }
  return localSetters;
}

function providerValueFields(
  node: ts.Node,
  localSetters: ReadonlyMap<string, SetterBinding>,
): Map<string, SetterBinding> {
  const fields = new Map<string, SetterBinding>();
  const visit = (candidate: ts.Node): void => {
    if (
      ts.isJsxAttribute(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === "value" &&
      candidate.initializer &&
      ts.isJsxExpression(candidate.initializer)
    ) {
      const value = providerValueObject(node, candidate.initializer.expression);
      if (value) {
        for (const property of value.properties) {
          if (
            !ts.isShorthandPropertyAssignment(property) &&
            !ts.isPropertyAssignment(property)
          )
            continue;
          const name = ts.isShorthandPropertyAssignment(property)
            ? property.name.text
            : propertyName(property.name);
          const expr = ts.isShorthandPropertyAssignment(property)
            ? property.name
            : property.initializer;
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

function setterAliasBinding(
  expression: ts.Expression,
  localSetters: ReadonlyMap<string, SetterBinding>,
): SetterBinding | undefined {
  const callback = useCallbackFunction(expression);
  if (
    callback?.parameters.length !== 1 ||
    !ts.isIdentifier(callback.parameters[0].name)
  )
    return undefined;
  const parameter = callback.parameters[0].name.text;
  const call = firstCallInFunction(callback);
  if (
    !call ||
    !ts.isIdentifier(call.expression) ||
    call.arguments.length !== 1 ||
    !ts.isIdentifier(call.arguments[0]) ||
    call.arguments[0].text !== parameter
  )
    return undefined;
  return localSetters.get(call.expression.text);
}

function useCallbackFunction(
  expression: ts.Expression,
): ExtractableHandler | undefined {
  if (
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "useCallback"
  )
    return undefined;
  const first = expression.arguments[0];
  return first && isExtractableHandler(first) ? first : undefined;
}

function firstCallInFunction(
  fn: ExtractableHandler,
): ts.CallExpression | undefined {
  if (!ts.isBlock(fn.body))
    return ts.isCallExpression(fn.body) ? fn.body : undefined;
  for (const statement of fn.body.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression)
    )
      return statement.expression;
  }
  return undefined;
}

function providerValueObject(
  scope: ts.Node,
  expression: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!expression) return undefined;
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (!ts.isIdentifier(expression)) return undefined;
  const declaration = variableDeclarationIn(scope, expression.text);
  if (
    !declaration?.initializer ||
    !ts.isCallExpression(declaration.initializer)
  )
    return undefined;
  if (
    !ts.isIdentifier(declaration.initializer.expression) ||
    declaration.initializer.expression.text !== "useMemo"
  )
    return undefined;
  const callback = declaration.initializer.arguments[0];
  if (!callback || !isExtractableHandler(callback)) return undefined;
  if (ts.isObjectLiteralExpression(callback.body)) return callback.body;
  if (
    ts.isParenthesizedExpression(callback.body) &&
    ts.isObjectLiteralExpression(callback.body.expression)
  )
    return callback.body.expression;
  return undefined;
}

function variableDeclarationIn(
  scope: ts.Node,
  name: string,
): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
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
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "useContext"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(hook);
  return found;
}
