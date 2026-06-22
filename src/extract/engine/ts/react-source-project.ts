import { resolve } from "node:path";
import type { StateVarDecl } from "modality-ts/core";
import * as ts from "typescript";
import type { SemanticTypeContext } from "../../lang/ts/semantic-type-context.js";
import type { RouteInventory, RoutePlugin } from "../spi/index.js";
import { typeAliasDeclarations } from "./domains.js";
import { routeMountScope } from "./routes.js";
import type { ContextBindings, SetterBinding } from "./types.js";

export interface ReactSourceProjectOptions {
  relatedFragments?: readonly { sourceText: string; fileName: string }[];
  types?: SemanticTypeContext;
}

export function relatedDiscoverySourceFiles(
  primary: ts.SourceFile,
  options: ReactSourceProjectOptions,
): ts.SourceFile[] {
  if (!options.types?.getSourceFile) {
    const seen = new Set<string>();
    const files: ts.SourceFile[] = [];
    for (const fragment of options.relatedFragments ?? []) {
      const key = resolve(fragment.fileName);
      if (seen.has(key) || fragment.fileName === primary.fileName) continue;
      seen.add(key);
      files.push(
        ts.createSourceFile(
          fragment.fileName,
          fragment.sourceText,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        ),
      );
    }
    return files;
  }
  const seen = new Set<string>();
  const files: ts.SourceFile[] = [];
  const addFile = (fileName: string): void => {
    const key =
      options.types?.canonicalFileName?.(fileName) ?? resolve(fileName);
    if (seen.has(key)) return;
    seen.add(key);
    const sourceFile = options.types?.getSourceFile(fileName);
    if (!sourceFile || sourceFile === primary) return;
    files.push(sourceFile);
  };
  for (const fragment of options.relatedFragments ?? []) {
    addFile(fragment.fileName);
  }
  return files;
}

export function collectProjectTypeAliases(
  primary: ts.SourceFile,
  options: ReactSourceProjectOptions,
): Map<string, ts.TypeNode> {
  const aliases = typeAliasDeclarations(primary);
  if (options.types?.getSourceFile) {
    const seen = new Set<string>();
    const mergeFrom = (fragment: {
      sourceText: string;
      fileName: string;
    }): void => {
      const key =
        options.types?.canonicalFileName?.(fragment.fileName) ??
        resolve(fragment.fileName);
      if (seen.has(key)) return;
      seen.add(key);
      const sourceFile =
        options.types?.getSourceFile(fragment.fileName) ??
        ts.createSourceFile(
          fragment.fileName,
          fragment.sourceText,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        );
      for (const [name, node] of typeAliasDeclarations(sourceFile)) {
        if (!aliases.has(name)) aliases.set(name, node);
      }
    };
    mergeFrom({ sourceText: primary.text, fileName: primary.fileName });
    for (const fragment of options.relatedFragments ?? []) {
      mergeFrom(fragment);
    }
    return aliases;
  }
  for (const fragment of options.relatedFragments ?? []) {
    if (fragment.fileName === primary.fileName) continue;
    const sourceFile = ts.createSourceFile(
      fragment.fileName,
      fragment.sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const [name, node] of typeAliasDeclarations(sourceFile)) {
      if (!aliases.has(name)) aliases.set(name, node);
    }
  }
  return aliases;
}

export function supplementalSourcesForRegistry(
  relatedFragments: readonly { sourceText: string; fileName: string }[],
  primaryFileName: string,
  _types?: SemanticTypeContext,
): { sourceText: string; fileName: string }[] {
  return relatedFragments
    .filter((fragment) => fragment.fileName !== primaryFileName)
    .map((fragment) => ({
      sourceText: fragment.sourceText,
      fileName: fragment.fileName,
    }));
}

export function cloneContextBindings(
  bindings: ContextBindings,
): ContextBindings {
  const hookReturns = new Map<string, Map<string, SetterBinding>>();
  for (const [hook, fields] of bindings.hookReturns) {
    hookReturns.set(hook, new Map(fields));
  }
  return {
    vars: [...bindings.vars],
    setters: new Map(bindings.setters),
    hookReturns,
  };
}

export function mergeContextBindings(
  target: ContextBindings,
  source: ContextBindings,
): void {
  for (const decl of source.vars) {
    if (!target.vars.some((candidate) => candidate.id === decl.id)) {
      target.vars.push(decl);
    }
  }
  for (const [name, setter] of source.setters) {
    target.setters.set(name, setter);
  }
  for (const [hook, fields] of source.hookReturns) {
    const merged = target.hookReturns.get(hook) ?? new Map();
    for (const [field, setter] of fields) {
      merged.set(field, setter);
    }
    target.hookReturns.set(hook, merged);
  }
}

export function resolveComponentRoutePattern(
  adapter: RoutePlugin | undefined,
  inventory: RouteInventory | undefined,
  componentName: string,
): string | undefined {
  if (!adapter?.routeForComponent || !inventory) return undefined;
  return adapter.routeForComponent(componentName, inventory);
}

export function scopeForLocalState(
  component: string,
  route: string,
  routePlugin: RoutePlugin | undefined,
  inventory: RouteInventory | undefined,
  providerGlobal: boolean,
): StateVarDecl["scope"] {
  if (providerGlobal) return { kind: "global" };
  const mountScope = routePlugin?.mountScopeForComponent?.(
    component,
    inventory ?? { routes: [] },
  );
  if (mountScope) return mountScope;
  return routeMountScope(route);
}
