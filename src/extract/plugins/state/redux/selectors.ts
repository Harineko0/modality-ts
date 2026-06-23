import type { WriteChannel } from "modality-ts/extract/engine/spi";
import * as ts from "typescript";
import { propertyName } from "../../../lang/ts/driver/ast.js";
import { storeVarId } from "./ids.js";
import type { ReduxResolvedImports } from "./imports.js";
import { isUseSelectorCall } from "./imports.js";
import { anchor } from "./store.js";

export function discoverSelectorReadChannels(
  source: ts.SourceFile,
  fileName: string,
  imports: ReduxResolvedImports,
  storeName: string,
  sliceKeys: ReadonlyMap<string, string>,
  exportedSelectors: ReadonlyMap<
    string,
    ts.ArrowFunction | ts.FunctionExpression
  >,
): WriteChannel[] {
  const channels: WriteChannel[] = [];
  const typedSelectors = collectTypedSelectorAliases(source, imports);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        const selectorChannel = selectorBindingChannel(
          node,
          source,
          fileName,
          imports,
          storeName,
          sliceKeys,
          exportedSelectors,
          typedSelectors,
        );
        if (selectorChannel) channels.push(selectorChannel);
      }
      if (
        ts.isObjectBindingPattern(node.name) &&
        isUseSelectorCall(node.initializer, imports)
      ) {
        const paths = objectSelectorFieldsFromArg(
          node.initializer.arguments[0],
          storeName,
          sliceKeys,
        );
        for (const path of paths) {
          channels.push({
            id: `redux:${path}.selector-read`,
            varId: storeVarId(storeName, path),
            symbolName: path.split(".").pop() ?? path,
            source: anchor(source, fileName, node),
          });
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      typedSelectors.has(node.expression.text)
    ) {
      const parent = node.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        const channel = channelFromSelectorArg(
          node.arguments[0],
          parent.name.text,
          source,
          fileName,
          storeName,
          sliceKeys,
          exportedSelectors,
          parent,
        );
        if (channel) channels.push(channel);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return channels;
}

function collectTypedSelectorAliases(
  source: ts.SourceFile,
  imports: ReduxResolvedImports,
): Set<string> {
  const aliases = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isPropertyAccessExpression(node.initializer.expression) &&
      node.initializer.expression.name.text === "withTypes" &&
      ts.isIdentifier(node.initializer.expression.expression) &&
      imports.selectors.has(node.initializer.expression.expression.text)
    ) {
      aliases.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return aliases;
}

function selectorBindingChannel(
  node: ts.VariableDeclaration,
  source: ts.SourceFile,
  fileName: string,
  imports: ReduxResolvedImports,
  defaultStoreName: string,
  sliceKeys: ReadonlyMap<string, string>,
  exportedSelectors: ReadonlyMap<
    string,
    ts.ArrowFunction | ts.FunctionExpression
  >,
  typedSelectors: ReadonlySet<string>,
): WriteChannel | undefined {
  if (!node.initializer || !ts.isIdentifier(node.name)) return undefined;
  const init = node.initializer;
  if (isUseSelectorCall(init, imports)) {
    return channelFromSelectorArg(
      init.arguments[0],
      node.name.text,
      source,
      fileName,
      defaultStoreName,
      sliceKeys,
      exportedSelectors,
      node,
    );
  }
  if (
    ts.isCallExpression(init) &&
    ts.isIdentifier(init.expression) &&
    typedSelectors.has(init.expression.text)
  ) {
    return channelFromSelectorArg(
      init.arguments[0],
      node.name.text,
      source,
      fileName,
      defaultStoreName,
      sliceKeys,
      exportedSelectors,
      node,
    );
  }
  if (
    ts.isCallExpression(init) &&
    ts.isPropertyAccessExpression(init.expression) &&
    init.expression.name.text === "withTypes" &&
    ts.isIdentifier(init.expression.expression) &&
    imports.selectors.has(init.expression.expression.text)
  ) {
    return channelFromSelectorArg(
      init.arguments[0],
      node.name.text,
      source,
      fileName,
      defaultStoreName,
      sliceKeys,
      exportedSelectors,
      node,
    );
  }
  if (
    ts.isCallExpression(init) &&
    ts.isIdentifier(init.expression) &&
    exportedSelectors.has(init.expression.text)
  ) {
    const fn = exportedSelectors.get(init.expression.text);
    if (!fn) return undefined;
    return channelFromSelectorFn(
      fn,
      node.name.text,
      source,
      fileName,
      defaultStoreName,
      sliceKeys,
      node,
    );
  }
  return undefined;
}

function channelFromSelectorArg(
  selector: ts.Expression | undefined,
  symbolName: string,
  source: ts.SourceFile,
  fileName: string,
  defaultStoreName: string,
  sliceKeys: ReadonlyMap<string, string>,
  exportedSelectors: ReadonlyMap<
    string,
    ts.ArrowFunction | ts.FunctionExpression
  >,
  node: ts.Node,
): WriteChannel | undefined {
  if (!selector) return undefined;
  if (ts.isIdentifier(selector) && exportedSelectors.has(selector.text)) {
    const fn = exportedSelectors.get(selector.text);
    if (!fn) return undefined;
    return channelFromSelectorFn(
      fn,
      symbolName,
      source,
      fileName,
      defaultStoreName,
      sliceKeys,
      node,
    );
  }
  if (
    (ts.isArrowFunction(selector) || ts.isFunctionExpression(selector)) &&
    ts.isIdentifier(selector.parameters[0]?.name)
  ) {
    return channelFromSelectorFn(
      selector,
      symbolName,
      source,
      fileName,
      defaultStoreName,
      sliceKeys,
      node,
    );
  }
  return undefined;
}

function channelFromSelectorFn(
  selector: ts.ArrowFunction | ts.FunctionExpression,
  symbolName: string,
  source: ts.SourceFile,
  fileName: string,
  defaultStoreName: string,
  sliceKeys: ReadonlyMap<string, string>,
  node: ts.Node,
): WriteChannel | undefined {
  const param =
    selector.parameters[0] && ts.isIdentifier(selector.parameters[0].name)
      ? selector.parameters[0].name.text
      : "state";
  const body = selector.body;
  if (ts.isPropertyAccessExpression(body)) {
    const varId = statePathToVarId(body, param, defaultStoreName, sliceKeys);
    if (!varId) return undefined;
    return {
      id: `redux:${symbolName}.selector-read`,
      varId,
      symbolName,
      source: anchor(source, fileName, node),
    };
  }
  if (ts.isObjectLiteralExpression(body)) {
    const fields = objectSelectorFields(body, param);
    if (fields.length >= 1) {
      const field = fields[0];
      if (!field) return undefined;
      const varId = storeVarId(defaultStoreName, field);
      return {
        id: `redux:${symbolName}.selector-read`,
        varId,
        symbolName,
        source: anchor(source, fileName, node),
      };
    }
  }
  return undefined;
}

function statePathToVarId(
  expr: ts.PropertyAccessExpression,
  param: string,
  storeName: string,
  sliceKeys: ReadonlyMap<string, string>,
): string | undefined {
  const parts: string[] = [];
  let current: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current) || current.text !== param) return undefined;
  if (parts.length < 2) return undefined;
  const sliceKey = parts[0];
  if (!sliceKey || !sliceKeys.has(sliceKey)) return undefined;
  return storeVarId(storeName, parts.join("."));
}

function objectSelectorFieldsFromArg(
  selector: ts.Expression | undefined,
  _storeName: string,
  _sliceKeys: ReadonlyMap<string, string>,
): string[] {
  if (
    !selector ||
    !(ts.isArrowFunction(selector) || ts.isFunctionExpression(selector)) ||
    !ts.isIdentifier(selector.parameters[0]?.name)
  ) {
    return [];
  }
  const param = selector.parameters[0].name.text;
  let body = selector.body;
  if (ts.isParenthesizedExpression(body)) {
    body = body.expression;
  }
  if (!ts.isObjectLiteralExpression(body)) return [];
  return objectSelectorFields(body, param);
}

function objectSelectorFields(
  object: ts.ObjectLiteralExpression,
  paramName: string,
): string[] {
  const fields: string[] = [];
  for (const prop of object.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyName(prop.name);
    if (!name) continue;
    const path = selectorFieldPath(prop.initializer, paramName);
    if (path) fields.push(path);
  }
  return fields;
}

function selectorFieldPath(
  expr: ts.Expression,
  paramName: string,
): string | undefined {
  const parts: string[] = [];
  let current: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current) || current.text !== paramName) return undefined;
  return parts.join(".");
}

export function collectExportedSelectors(
  source: ts.SourceFile,
): Map<string, ts.ArrowFunction | ts.FunctionExpression> {
  const selectors = new Map<string, ts.ArrowFunction | ts.FunctionExpression>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isExported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!isExported) continue;
    for (const decl of statement.declarationList.declarations) {
      if (
        !ts.isVariableDeclaration(decl) ||
        !ts.isIdentifier(decl.name) ||
        !decl.initializer
      ) {
        continue;
      }
      if (
        ts.isArrowFunction(decl.initializer) ||
        ts.isFunctionExpression(decl.initializer)
      ) {
        selectors.set(decl.name.text, decl.initializer);
      }
    }
  }
  return selectors;
}

export function discoverGetStateReadChannels(
  source: ts.SourceFile,
  fileName: string,
  storeHandles: ReadonlySet<string>,
): WriteChannel[] {
  const channels: WriteChannel[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const channel = getStateReadChannel(node, storeHandles, source, fileName);
      if (channel) channels.push(channel);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return channels;
}

function getStateReadChannel(
  node: ts.VariableDeclaration,
  storeHandles: ReadonlySet<string>,
  source: ts.SourceFile,
  fileName: string,
): WriteChannel | undefined {
  if (!node.initializer) return undefined;
  const path = getStateAccessPath(node.initializer, storeHandles);
  if (!path || !ts.isIdentifier(node.name)) return undefined;
  return {
    id: `redux:${path.storeName}.${path.path}.getState-read`,
    varId: storeVarId(path.storeName, path.path),
    symbolName: node.name.text,
    source: anchor(source, fileName, node),
  };
}

function getStateAccessPath(
  expr: ts.Expression,
  storeHandles: ReadonlySet<string>,
): { storeName: string; path: string } | undefined {
  const parts: string[] = [];
  let current: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    current.expression.name.text === "getState" &&
    ts.isIdentifier(current.expression.expression) &&
    storeHandles.has(current.expression.expression.text)
  ) {
    const storeName = current.expression.expression.text;
    if (parts.length < 2) return undefined;
    return { storeName, path: parts.join(".") };
  }
  if (
    ts.isPropertyAccessExpression(current) &&
    ts.isCallExpression(current.expression) &&
    ts.isPropertyAccessExpression(current.expression.expression) &&
    current.expression.expression.name.text === "getState"
  ) {
    return undefined;
  }
  return undefined;
}

function connectCallExpression(
  node: ts.CallExpression,
): ts.CallExpression | undefined {
  if (ts.isIdentifier(node.expression) && node.expression.text === "connect") {
    return node;
  }
  if (
    ts.isCallExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "connect"
  ) {
    return node.expression;
  }
  return undefined;
}

export function discoverConnectReadChannels(
  source: ts.SourceFile,
  fileName: string,
  storeName: string,
  _sliceKeys: ReadonlyMap<string, string>,
): { channels: WriteChannel[]; warnings: string[] } {
  const channels: WriteChannel[] = [];
  const warnings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const connectCall = connectCallExpression(node);
    if (!connectCall) {
      ts.forEachChild(node, visit);
      return;
    }
    const mapper = connectCall.arguments[0];
    if (!mapper) {
      ts.forEachChild(node, visit);
      return;
    }
    const resolvedMapper = resolveMapperFunction(mapper, source);
    if (resolvedMapper) {
      const param =
        resolvedMapper.parameters[0] &&
        ts.isIdentifier(resolvedMapper.parameters[0].name)
          ? resolvedMapper.parameters[0].name.text
          : "state";
      let body = resolvedMapper.body;
      if (ts.isParenthesizedExpression(body)) {
        body = body.expression;
      }
      if (ts.isObjectLiteralExpression(body)) {
        for (const prop of body.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
            continue;
          }
          const path = selectorFieldPath(prop.initializer, param);
          if (!path) continue;
          channels.push({
            id: `redux:connect.${prop.name.text}.read`,
            varId: storeVarId(storeName, path),
            symbolName: prop.name.text,
            source: anchor(source, fileName, connectCall),
          });
        }
        return;
      }
      if (
        resolvedMapper.parameters.length === 0 ||
        ts.isIdentifier(resolvedMapper.body)
      ) {
        warnings.push(
          "Redux dynamic connect mapStateToProps factory not modeled",
        );
        return;
      }
    }
    if (
      (ts.isArrowFunction(mapper) || ts.isFunctionExpression(mapper)) &&
      mapper.parameters[0] &&
      ts.isIdentifier(mapper.parameters[0].name)
    ) {
      const param = mapper.parameters[0].name.text;
      let body = mapper.body;
      if (ts.isParenthesizedExpression(body)) {
        body = body.expression;
      }
      if (ts.isObjectLiteralExpression(body)) {
        for (const prop of body.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
            continue;
          }
          const path = selectorFieldPath(prop.initializer, param);
          if (!path) continue;
          channels.push({
            id: `redux:connect.${prop.name.text}.read`,
            varId: storeVarId(storeName, path),
            symbolName: prop.name.text,
            source: anchor(source, fileName, connectCall),
          });
        }
      }
      return;
    }
    if (ts.isCallExpression(mapper)) {
      warnings.push(
        "Redux dynamic connect mapStateToProps factory not modeled",
      );
      return;
    }
    if (
      (ts.isArrowFunction(mapper) || ts.isFunctionExpression(mapper)) &&
      mapper.parameters.length === 0
    ) {
      warnings.push(
        "Redux dynamic connect mapStateToProps factory not modeled",
      );
      return;
    }
    if (
      (ts.isArrowFunction(mapper) || ts.isFunctionExpression(mapper)) &&
      ts.isIdentifier(mapper.body)
    ) {
      warnings.push(
        "Redux dynamic connect mapStateToProps factory not modeled",
      );
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { channels, warnings };
}

function resolveMapperFunction(
  mapper: ts.Expression,
  source: ts.SourceFile,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (ts.isArrowFunction(mapper) || ts.isFunctionExpression(mapper)) {
    return mapper;
  }
  if (!ts.isIdentifier(mapper)) return undefined;
  let found: ts.ArrowFunction | ts.FunctionExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === mapper.text &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
