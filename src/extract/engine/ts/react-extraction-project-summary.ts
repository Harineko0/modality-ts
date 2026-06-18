import { resolve } from "node:path";
import * as ts from "typescript";
import type { SemanticTypeContext } from "../spi/index.js";
import {
  buildComponentRegistry,
  buildCustomHookRegistry,
  componentRegistryWithPrimaryDisplay,
  customHookRegistryWithPrimaryDisplay,
  type ComponentRegistry,
  type CustomHookRegistry,
} from "./components.js";
import { discoverContextBindings } from "./context.js";
import { typeAliasDeclarations } from "./domains.js";
import type { ContextBindings } from "./types.js";

export interface ReactExtractionProjectSummary {
  canonicalFileNames: readonly string[];
  relatedSourceFiles: readonly ts.SourceFile[];
  typeAliases: ReadonlyMap<string, ts.TypeNode>;
  contextBindings: ContextBindings;
  componentRegistry: ComponentRegistry;
  customHookRegistry: CustomHookRegistry;
}

export interface BuildReactExtractionProjectSummaryOptions {
  discoverFragments: readonly { sourceText: string; fileName: string }[];
  relatedFragments: readonly { sourceText: string; fileName: string }[];
  types?: SemanticTypeContext;
  route: string;
}

export function buildReactExtractionProjectSummary(
  options: BuildReactExtractionProjectSummaryOptions,
): ReactExtractionProjectSummary {
  const { discoverFragments, relatedFragments, types, route } = options;
  const canonicalFileNames = [
    ...new Set(
      discoverFragments.map(
        (fragment) =>
          types?.canonicalFileName?.(fragment.fileName) ??
          resolve(fragment.fileName),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const relatedSourceFiles = collectRelatedSourceFiles(relatedFragments, types);
  const typeAliases = collectProjectTypeAliases(relatedFragments, types);
  const contextBindings = collectMergedContextBindings(
    discoverFragments,
    relatedSourceFiles,
    route,
    typeAliases,
    types,
  );
  const primaryFragment = discoverFragments[0]!;
  const primarySource = sourceFileForFragment(primaryFragment, types);
  const supplementalSources = supplementalSourcesForRegistry(
    relatedFragments,
    primaryFragment.fileName,
  );
  const componentRegistry = buildComponentRegistry(primarySource, {
    ...(types ? { types } : {}),
    primaryFileName: primaryFragment.fileName,
    relatedSourceFiles,
    ...(supplementalSources.length > 0 ? { supplementalSources } : {}),
  });
  const customHookRegistry = buildCustomHookRegistry(primarySource, {
    ...(types ? { types } : {}),
    primaryFileName: primaryFragment.fileName,
    relatedSourceFiles,
    ...(supplementalSources.length > 0 ? { supplementalSources } : {}),
  });
  return {
    canonicalFileNames,
    relatedSourceFiles,
    typeAliases,
    contextBindings,
    componentRegistry,
    customHookRegistry,
  };
}

export function componentRegistryForPrimary(
  summary: ReactExtractionProjectSummary,
  primary: ts.SourceFile,
  types?: SemanticTypeContext,
): ComponentRegistry {
  return componentRegistryWithPrimaryDisplay(
    summary.componentRegistry,
    primary,
    types,
  );
}

export function customHookRegistryForPrimary(
  summary: ReactExtractionProjectSummary,
  primary: ts.SourceFile,
  types?: SemanticTypeContext,
): CustomHookRegistry {
  return customHookRegistryWithPrimaryDisplay(
    summary.customHookRegistry,
    primary,
    types,
  );
}

function sourceFileForFragment(
  fragment: { sourceText: string; fileName: string },
  types?: SemanticTypeContext,
): ts.SourceFile {
  return (
    types?.getSourceFile(fragment.fileName) ??
    ts.createSourceFile(
      fragment.fileName,
      fragment.sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
  );
}

function collectRelatedSourceFiles(
  relatedFragments: readonly { sourceText: string; fileName: string }[],
  types?: SemanticTypeContext,
): ts.SourceFile[] {
  if (!types?.getSourceFile) {
    const seen = new Set<string>();
    const files: ts.SourceFile[] = [];
    for (const fragment of relatedFragments) {
      const key = resolve(fragment.fileName);
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(sourceFileForFragment(fragment, types));
    }
    return files;
  }
  const seen = new Set<string>();
  const files: ts.SourceFile[] = [];
  for (const fragment of relatedFragments) {
    const key =
      types.canonicalFileName?.(fragment.fileName) ??
      resolve(fragment.fileName);
    if (seen.has(key)) continue;
    seen.add(key);
    const sourceFile = types.getSourceFile(fragment.fileName);
    if (sourceFile) files.push(sourceFile);
  }
  return files;
}

function collectProjectTypeAliases(
  relatedFragments: readonly { sourceText: string; fileName: string }[],
  types?: SemanticTypeContext,
): Map<string, ts.TypeNode> {
  const aliases = new Map<string, ts.TypeNode>();
  const seen = new Set<string>();
  for (const fragment of relatedFragments) {
    const key =
      types?.canonicalFileName?.(fragment.fileName) ??
      resolve(fragment.fileName);
    if (seen.has(key)) continue;
    seen.add(key);
    const sourceFile = sourceFileForFragment(fragment, types);
    for (const [name, node] of typeAliasDeclarations(sourceFile)) {
      if (!aliases.has(name)) aliases.set(name, node);
    }
  }
  return aliases;
}

function collectMergedContextBindings(
  discoverFragments: readonly { sourceText: string; fileName: string }[],
  relatedSourceFiles: readonly ts.SourceFile[],
  route: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  types?: SemanticTypeContext,
): ContextBindings {
  const bindings = discoverContextBindings(
    sourceFileForFragment(discoverFragments[0]!, types),
    discoverFragments[0]!.fileName,
    route,
    typeAliases,
  );
  for (const fragment of discoverFragments.slice(1)) {
    mergeContextBindings(
      bindings,
      discoverContextBindings(
        sourceFileForFragment(fragment, types),
        fragment.fileName,
        route,
        typeAliases,
      ),
    );
  }
  const primaryKeys = new Set(
    discoverFragments.map(
      (fragment) =>
        types?.canonicalFileName?.(fragment.fileName) ??
        resolve(fragment.fileName),
    ),
  );
  for (const relatedSource of relatedSourceFiles) {
    const key =
      types?.canonicalFileName?.(relatedSource.fileName) ??
      resolve(relatedSource.fileName);
    if (primaryKeys.has(key)) continue;
    mergeContextBindings(
      bindings,
      discoverContextBindings(
        relatedSource,
        relatedSource.fileName,
        route,
        typeAliases,
      ),
    );
  }
  return bindings;
}

function supplementalSourcesForRegistry(
  relatedFragments: readonly { sourceText: string; fileName: string }[],
  primaryFileName: string,
): { sourceText: string; fileName: string }[] {
  return relatedFragments
    .filter((fragment) => fragment.fileName !== primaryFileName)
    .map((fragment) => ({
      sourceText: fragment.sourceText,
      fileName: fragment.fileName,
    }));
}

function mergeContextBindings(
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
