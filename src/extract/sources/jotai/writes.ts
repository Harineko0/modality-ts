import * as ts from "typescript";
import type {
  ExtractionWarning,
  WriteChannel,
  SemanticTypeContext,
} from "modality-ts/extract/engine/spi";
import { semanticSourceFileFor } from "../../engine/ts/semantic-source-file.js";
import type { EffectIR, SourceAnchor, Value } from "modality-ts/core";
import {
  caveatMessage,
  globalTaintCaveat,
  modelSlackCaveat,
} from "../../engine/ts/caveats.js";
import { propertyName, componentNameFor } from "../../engine/ts/ast.js";
import { discoverComponentStoreScopes } from "./stores.js";
import { providerScopeFromJsx } from "./jsx.js";
import {
  discoverJotaiAtomsDetailed,
  duplicateAtomsForStore,
} from "./discover.js";
import {
  hookImportedName,
  isHookCall,
  isJotaiModuleSpecifier,
  resolveJotaiImports,
} from "./imports.js";
import { atomVarId, familyVarId } from "./ids.js";
import { discoverHydrationOverrides } from "./hydration.js";
import { isReadFunction, summarizeDerivedWriteBody } from "./derived-writes.js";
import { classifyAtomCall, staticFamilyParam } from "./domains.js";
import { typeAliasDeclarations } from "modality-ts/extract/engine/spi";
import { isResettableKind, metadataFromRecord } from "./types.js";
import { atomCreatorName, isAtomCreatorCall } from "./imports.js";

export interface JotaiWriteDiscovery {
  channels: WriteChannel[];
  warnings: ExtractionWarning[];
  resetSymbol?: string;
  resettableVarIds: Set<string>;
  derivedWriteEffects: Map<string, EffectIR>;
  setterFixedEffects: Map<string, EffectIR>;
  storeScopedDecls: import("modality-ts/extract/engine/spi").SourceDecl[];
}

export function discoverJotaiSafetyWarnings(
  sourceText: string,
  fileName = "state.ts",
  types?: SemanticTypeContext,
): ExtractionWarning[] {
  const source = semanticSourceFileFor(
    sourceText,
    fileName,
    types,
    ts.ScriptKind.TSX,
  );
  const imports = resolveJotaiImports(source, types);
  const warnings: ExtractionWarning[] = [];
  const discovery = discoverJotaiAtomsDetailed(sourceText, fileName);
  warnings.push(...discovery.warnings);

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !isJotaiModuleSpecifier(statement.moduleSpecifier)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported !== "getDefaultStore") continue;
      const src = anchor(source, fileName, specifier);
      const caveat = globalTaintCaveat("jotai:getDefaultStore", src);
      warnings.push({
        message: caveatMessage(caveat),
        source: src,
        caveat,
        confidence: "over-approx",
        producer: { kind: "state-source", id: "jotai" },
      });
    }
  }

  const hydration = discoverHydrationOverrides(source, fileName, imports);
  warnings.push(...hydration.warnings);

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
      const providerScope = providerScopeFromJsx(node, imports, source);
      if (providerScope === undefined) {
        const tag = ts.isJsxSelfClosingElement(node)
          ? node.tagName.getText()
          : node.openingElement.tagName.getText();
        if (
          tag === imports.providerTag ||
          tag === "Provider" ||
          tag.endsWith(".Provider")
        ) {
          const src = anchor(source, fileName, node);
          const caveat = modelSlackCaveat(
            "jotai:dynamic-provider",
            "Jotai dynamic Provider store unsupported",
            src,
            "over-approx",
          );
          warnings.push({
            message: caveat.reason,
            source: src,
            caveat,
            confidence: "over-approx",
            producer: { kind: "state-source", id: "jotai" },
          });
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setShouldRemove"
    ) {
      const src = anchor(source, fileName, node);
      const caveat = modelSlackCaveat(
        "jotai:atomFamily.setShouldRemove",
        "Jotai atomFamily.setShouldRemove cache lifecycle not modeled",
        src,
        "over-approx",
      );
      warnings.push({
        message: caveat.reason,
        source: src,
        caveat,
        confidence: "over-approx",
        producer: { kind: "state-source", id: "jotai" },
      });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "unstable_listen"
    ) {
      const src = anchor(source, fileName, node);
      const caveat = modelSlackCaveat(
        "jotai:atomFamily.unstable_listen",
        "Jotai atomFamily.unstable_listen cache lifecycle not modeled",
        src,
        "over-approx",
      );
      warnings.push({
        message: caveat.reason,
        source: src,
        caveat,
        confidence: "over-approx",
        producer: { kind: "state-source", id: "jotai" },
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const decl of discovery.decls) {
    const metadata = metadataFromRecord(decl.metadata);
    if (metadata?.storageKind === "localStorage" && !hasWindowGuard(source)) {
      const src =
        decl.origin === "system" || decl.origin === "library-template"
          ? undefined
          : decl.origin;
      const caveat = modelSlackCaveat(
        `jotai:${metadata.atomName}.${metadata.storageKind}`,
        `Jotai SSR-unsafe unguarded ${metadata.storageKind} access for ${metadata.atomName}`,
        src,
        "unsound-risk",
      );
      warnings.push({
        message: caveat.reason,
        ...(src ? { source: src } : {}),
        caveat,
        confidence: "over-approx",
        producer: { kind: "state-source", id: "jotai" },
      });
    }
  }

  return warnings;
}

export function discoverJotaiWriteChannels(
  sourceText: string,
  fileName = "state.ts",
  types?: SemanticTypeContext,
): WriteChannel[] {
  return discoverJotaiWritesDetailed(sourceText, fileName, types).channels;
}

export function discoverJotaiWritesDetailed(
  sourceText: string,
  fileName = "state.ts",
  types?: SemanticTypeContext,
): JotaiWriteDiscovery {
  const source = semanticSourceFileFor(
    sourceText,
    fileName,
    types,
    ts.ScriptKind.TSX,
  );
  const imports = resolveJotaiImports(source, types);
  const discovery = discoverJotaiAtomsDetailed(sourceText, fileName, types);
  const atomNames = new Set(discovery.atomNames);
  for (const [name] of discovery.atomMetadata) atomNames.add(name);

  const derivedWriteEffects = new Map<string, EffectIR>();
  const setterFixedEffects = new Map<string, EffectIR>();
  const atomClassifications = collectAtomClassifications(source, imports);
  for (const [atomName, info] of atomClassifications) {
    if (
      info.configKind === "writeOnlyDerived" ||
      info.configKind === "readWriteDerived"
    ) {
      const writeFn = info.writeFn;
      if (writeFn) {
        const effect = summarizeDerivedWriteBody(writeFn, { atomNames });
        if (effect !== "unsupported") derivedWriteEffects.set(atomName, effect);
      }
    }
  }

  const resettableVarIds = new Set<string>();
  for (const decl of discovery.decls) {
    const metadata = metadataFromRecord(decl.metadata);
    if (metadata && isResettableKind(metadata.configKind) && decl.var) {
      resettableVarIds.add(decl.var.id);
    }
  }

  if (
    imports.hooks.size === 0 &&
    imports.storeCreators.size === 0 &&
    discovery.decls.length === 0
  ) {
    return {
      channels: [],
      warnings: [],
      resetSymbol: imports.resetSymbol,
      resettableVarIds,
      derivedWriteEffects,
      setterFixedEffects,
      storeScopedDecls: [],
    };
  }

  const channels: WriteChannel[] = [];
  const warnings: ExtractionWarning[] = [];
  const storeNames = new Set<string>();
  const defaultStoreNames = new Set<string>();
  const storeScopedDecls: import("modality-ts/extract/engine/spi").SourceDecl[] =
    [];
  const componentStoreScopes = discoverComponentStoreScopes(source, imports);

  const visit = (
    node: ts.Node,
    storeScope?: string,
    componentName?: string,
  ): void => {
    const nextComponent = componentNameFor(node) ?? componentName;
    const effectiveScope =
      (nextComponent ? componentStoreScopes.get(nextComponent) : undefined) ??
      storeScope;

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      if (isStoreCreatorCall(node.initializer, imports.storeCreators)) {
        storeNames.add(node.name.text);
        if (isGetDefaultStoreCall(node.initializer, imports.storeCreators)) {
          defaultStoreNames.add(node.name.text);
        }
      }
      if (isHookCall(node.initializer, imports.hooks, "useStore")) {
        storeNames.add(node.name.text);
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      isHookCall(node.initializer, imports.hooks, "useAtom")
    ) {
      const atomArg = node.initializer.arguments[0];
      const storeScopeForCall = resolveStoreScope(
        node.initializer,
        effectiveScope,
        imports,
      );
      const varId = resolveAtomVarId(
        atomArg,
        storeScopeForCall,
        source,
        imports,
        warnings,
        fileName,
        defaultStoreNames,
      );
      if (!varId) {
        ts.forEachChild(node, (child) =>
          visit(child, effectiveScope, nextComponent),
        );
        return;
      }
      const reader = node.name.elements[0];
      const setter = node.name.elements.at(-1);
      const src = anchor(source, fileName, node);
      if (
        reader &&
        ts.isBindingElement(reader) &&
        ts.isIdentifier(reader.name)
      ) {
        channels.push({
          id: `${varId}.read`,
          varId,
          symbolName: reader.name.text,
          source: src,
        });
      }
      if (
        setter &&
        ts.isBindingElement(setter) &&
        ts.isIdentifier(setter.name)
      ) {
        channels.push({
          id: `${varId}.setter`,
          varId,
          symbolName: setter.name.text,
          source: src,
        });
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (isHookCall(node.initializer, imports.hooks, "useSetAtom") ||
        isHookCall(node.initializer, imports.hooks, "useResetAtom"))
    ) {
      const hookName = hookImportedName(node.initializer, imports.hooks);
      const atomArg = node.initializer.arguments[0];
      const storeScopeForCall = resolveStoreScope(
        node.initializer,
        effectiveScope,
        imports,
      );
      const varId = resolveAtomVarId(
        atomArg,
        storeScopeForCall,
        source,
        imports,
        warnings,
        fileName,
        defaultStoreNames,
      );
      if (!varId) {
        ts.forEachChild(node, (child) =>
          visit(child, effectiveScope, nextComponent),
        );
        return;
      }
      const src = anchor(source, fileName, node);
      if (hookName === "useResetAtom") {
        channels.push({
          id: `${varId}.reset`,
          varId,
          symbolName: node.name.text,
          source: src,
        });
      } else {
        const atomName =
          atomArg && ts.isIdentifier(atomArg) ? atomArg.text : undefined;
        const derivedEffect =
          atomName && derivedWriteEffects.has(atomName)
            ? derivedWriteEffects.get(atomName)
            : undefined;
        const derivedVarId = derivedEffect
          ? (effectTargetVar(derivedEffect) ?? varId)
          : varId;
        if (derivedEffect) {
          setterFixedEffects.set(node.name.text, derivedEffect);
        }
        channels.push({
          id: `${derivedVarId}.setter`,
          varId: derivedVarId,
          symbolName: node.name.text,
          source: src,
        });
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "set" ||
        node.expression.name.text === "get" ||
        node.expression.name.text === "sub") &&
      ts.isIdentifier(node.expression.expression) &&
      storeNames.has(node.expression.expression.text)
    ) {
      const atomArg = node.arguments[0];
      const storeScopeForCall = node.expression.expression.text;
      const varId = resolveAtomVarId(
        atomArg,
        defaultStoreNames.has(storeScopeForCall)
          ? undefined
          : storeScopeForCall,
        source,
        imports,
        warnings,
        fileName,
        defaultStoreNames,
      );
      if (varId && node.expression.name.text === "set") {
        channels.push({
          id: `${varId}.store-set`,
          varId,
          symbolName: `${node.expression.expression.text}.set:${atomArg && ts.isIdentifier(atomArg) ? atomArg.text : "atom"}`,
          source: anchor(source, fileName, node),
        });
      }
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const providerScope = providerScopeFromJsx(node, imports, source);
      if (providerScope && providerScope !== effectiveScope) {
        storeScopedDecls.push(
          ...duplicateAtomsForStore(discovery.decls, providerScope),
        );
      }
      const childScope = providerScope ?? effectiveScope;
      ts.forEachChild(node, (child) => visit(child, childScope, nextComponent));
      return;
    }

    ts.forEachChild(node, (child) =>
      visit(child, effectiveScope, nextComponent),
    );
  };
  visit(source, undefined, undefined);

  return {
    channels,
    warnings,
    resetSymbol: imports.resetSymbol,
    resettableVarIds,
    derivedWriteEffects,
    setterFixedEffects,
    storeScopedDecls,
  };
}

function collectAtomClassifications(
  source: ts.SourceFile,
  imports: ReturnType<typeof resolveJotaiImports>,
): Map<
  string,
  {
    configKind: string;
    writeFn?: ts.ArrowFunction | ts.FunctionExpression;
  }
> {
  const typeAliases = typeAliasDeclarations(source);
  const result = new Map<
    string,
    { configKind: string; writeFn?: ts.ArrowFunction | ts.FunctionExpression }
  >();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isAtomCreatorCall(node.initializer, imports.atomCreators) &&
      atomCreatorName(node.initializer, imports.atomCreators) === "atom"
    ) {
      const classification = classifyAtomCall(
        node.initializer,
        node.name.text,
        imports,
        typeAliases,
      );
      const second = node.initializer.arguments[1];
      result.set(node.name.text, {
        configKind: classification.metadata.configKind,
        ...(second && isReadFunction(second) ? { writeFn: second } : {}),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

function resolveAtomVarId(
  atomArg: ts.Expression | undefined,
  storeScope: string | undefined,
  source: ts.SourceFile,
  imports: ReturnType<typeof resolveJotaiImports>,
  warnings: ExtractionWarning[],
  fileName: string,
  defaultStoreNames: ReadonlySet<string> = new Set(),
): string | undefined {
  const effectiveScope =
    storeScope && !defaultStoreNames.has(storeScope) ? storeScope : undefined;
  if (!atomArg) return undefined;
  if (ts.isIdentifier(atomArg)) {
    return atomVarId(atomArg.text, effectiveScope);
  }
  if (ts.isCallExpression(atomArg) && ts.isIdentifier(atomArg.expression)) {
    const param = atomArg.arguments[0];
    const staticParam = param ? staticFamilyParam(param) : undefined;
    if (!staticParam) {
      const src = anchor(source, fileName, atomArg);
      const message = `Jotai dynamic atom family param unsupported for ${atomArg.expression.text}`;
      const caveat = modelSlackCaveat(
        `jotai:${atomArg.expression.text}.family-param`,
        message,
        src,
      );
      warnings.push({
        message,
        source: src,
        caveat,
      });
      return undefined;
    }
    return familyVarId(atomArg.expression.text, staticParam);
  }
  return undefined;
}

function resolveStoreScope(
  call: ts.CallExpression,
  inheritedScope: string | undefined,
  imports: ReturnType<typeof resolveJotaiImports>,
): string | undefined {
  const options = call.arguments[1];
  if (options && ts.isObjectLiteralExpression(options)) {
    for (const prop of options.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = propertyName(prop.name);
      if (name === "store" && ts.isIdentifier(prop.initializer)) {
        return prop.initializer.text;
      }
    }
  }
  return inheritedScope;
}

function isStoreCreatorCall(
  node: ts.Expression,
  storeCreators: ReadonlyMap<string, string>,
): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    storeCreators.has(node.expression.text)
  );
}

function isGetDefaultStoreCall(
  node: ts.Expression,
  storeCreators: ReadonlyMap<string, string>,
): boolean {
  if (!isStoreCreatorCall(node, storeCreators)) return false;
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression))
    return false;
  return storeCreators.get(node.expression.text) === "getDefaultStore";
}

function effectTargetVar(effect: EffectIR): string | undefined {
  if (effect.kind === "assign") return effect.var;
  if (effect.kind === "seq") {
    for (const child of effect.effects) {
      const target = effectTargetVar(child);
      if (target) return target;
    }
  }
  return undefined;
}

function hasWindowGuard(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      ts.isIdentifier(node.right) &&
      node.right.text === "Window"
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function anchor(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
): SourceAnchor {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: fileName, line: pos.line + 1, column: pos.character + 1 };
}

export function setAtomImportNames(source: ts.SourceFile): {
  useAtom: Set<string>;
  useSetAtom: Set<string>;
} {
  const imports = resolveJotaiImports(source);
  const useAtom = new Set<string>();
  const useSetAtom = new Set<string>();
  for (const [local, imported] of imports.hooks) {
    if (imported === "useAtom") useAtom.add(local);
    if (imported === "useSetAtom") useSetAtom.add(local);
  }
  return { useAtom, useSetAtom };
}

export function getDefaultStoreImportNames(source: ts.SourceFile): Set<string> {
  const imports = resolveJotaiImports(source);
  const names = new Set<string>();
  for (const [local, imported] of imports.storeCreators) {
    if (imported === "getDefaultStore") names.add(local);
  }
  return names;
}

export function isUseAtomLikeCall(
  node: ts.Expression,
  names: Set<string>,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    names.has(node.expression.text)
  );
}

export function jotaiResetSymbols(
  sourceText: string,
  fileName: string,
): Set<string> {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports = resolveJotaiImports(source);
  const symbols = new Set<string>();
  if (imports.resetSymbol) symbols.add(imports.resetSymbol);
  symbols.add("RESET");
  return symbols;
}

export function jotaiInitialByVarId(
  decls: readonly import("modality-ts/extract/engine/spi").SourceDecl[],
): Map<string, Value> {
  const map = new Map<string, Value>();
  for (const decl of decls) {
    if (decl.var) map.set(decl.var.id, decl.var.initial as Value);
  }
  return map;
}
