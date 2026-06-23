import type { SourceAnchor, StateVarDecl } from "modality-ts/core";
import type { SourceDecl, TypePlugin } from "modality-ts/extract/engine/spi";
import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { modelSlackCaveat } from "../../../lang/ts/driver/caveats.js";
import { compilerBackedTypeAliases } from "../../../lang/ts/driver/domains.js";
import { semanticSourceFileFor } from "../../../lang/ts/driver/semantic-source-file.js";
import {
  classifyAtomCall,
  classifyFamilyInstance,
  staticFamilyParam,
} from "./domains.js";
import {
  applyHydrationOverrides,
  discoverHydrationOverrides,
} from "./hydration.js";
import { atomVarId, familyVarId } from "./ids.js";
import {
  atomCreatorName,
  isAtomCreatorCall,
  resolveJotaiImports,
} from "./imports.js";
import { discoverComponentStoreScopes } from "./stores.js";
import { metadataToRecord } from "./types.js";

export interface DiscoverJotaiResult {
  decls: SourceDecl[];
  warnings: JotaiDiscoveryWarning[];
  atomNames: Set<string>;
  atomMetadata: Map<string, ReturnType<typeof classifyAtomCall>["metadata"]>;
}

interface JotaiDiscoveryWarning {
  message: string;
  source?: SourceAnchor;
  caveat?: import("modality-ts/core").ExtractionCaveat;
}

export function discoverJotaiAtoms(
  sourceText: string,
  fileName = "state.ts",
): SourceDecl[] {
  return discoverJotaiAtomsDetailed(sourceText, fileName).decls;
}

function sourceFileForDiscovery(
  sourceText: string,
  fileName: string,
  types?: SemanticTypeContext,
): ts.SourceFile {
  return semanticSourceFileFor(sourceText, fileName, types, ts.ScriptKind.TSX);
}

export function discoverJotaiAtomsDetailed(
  sourceText: string,
  fileName = "state.ts",
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
  relatedFragments?: readonly { sourceText: string; fileName: string }[],
  options?: { skipStoreDuplication?: boolean },
): DiscoverJotaiResult {
  const source = sourceFileForDiscovery(sourceText, fileName, types);
  const imports = resolveJotaiImports(source, types);
  const componentStoreScopes = discoverComponentStoreScopes(source, imports);
  const hasStoreScopeWork =
    componentStoreScopes.size > 0 && relatedFragments !== undefined;
  if (imports.atomCreators.size === 0 && !hasStoreScopeWork) {
    return emptyDiscoverResult();
  }

  const typeAliases = compilerBackedTypeAliases(source, types);
  const warnings: JotaiDiscoveryWarning[] = [];
  const atomMetadata = new Map<
    string,
    ReturnType<typeof classifyAtomCall>["metadata"]
  >();
  const atomNames = new Set<string>();
  const familyFactories = new Map<string, ts.CallExpression>();
  const decls: SourceDecl[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isAtomCreatorCall(node.initializer, imports.atomCreators)
    ) {
      const atomName = node.name.text;
      const creator = atomCreatorName(node.initializer, imports.atomCreators);
      if (creator === "atomFamily") {
        familyFactories.set(atomName, node.initializer);
        const classification = classifyAtomCall(
          node.initializer,
          atomName,
          imports,
          typeAliases,
          types,
          source,
          typePlugins,
        );
        atomMetadata.set(atomName, classification.metadata);
        if (classification.warning) {
          const src = anchor(source, fileName, node);
          const caveat = modelSlackCaveat(
            `jotai:${atomName}`,
            classification.warning,
            src,
          );
          warnings.push({
            message: classification.warning,
            source: src,
            caveat,
          });
        }
      } else {
        const classification = classifyAtomCall(
          node.initializer,
          atomName,
          imports,
          typeAliases,
          types,
          source,
          typePlugins,
        );
        atomNames.add(atomName);
        atomMetadata.set(atomName, classification.metadata);
        if (classification.warning) {
          const src = anchor(source, fileName, node);
          const caveat = modelSlackCaveat(
            `jotai:${atomName}`,
            classification.warning,
            src,
          );
          warnings.push({
            message: classification.warning,
            source: src,
            caveat,
          });
        }
        if (classification.emitVar) {
          decls.push(
            atomDecl(node, atomName, classification, fileName, source),
          );
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      familyFactories.has(node.expression.text)
    ) {
      const familyName = node.expression.text;
      const paramArg = node.arguments[0];
      if (!paramArg) return;
      const staticParam = staticFamilyParam(paramArg);
      if (!staticParam) {
        const src = anchor(source, fileName, node);
        const message = `Jotai dynamic atom family param unsupported for ${familyName}`;
        warnings.push({
          message,
          source: src,
          caveat: modelSlackCaveat(
            `jotai:${familyName}.family-param`,
            message,
            src,
          ),
        });
      } else {
        const familyCall = familyFactories.get(familyName);
        const initializer = familyCall?.arguments[0];
        let innerCall: ts.CallExpression | undefined;
        if (
          initializer &&
          (ts.isArrowFunction(initializer) ||
            ts.isFunctionExpression(initializer))
        ) {
          const body = initializer.body;
          if (
            ts.isCallExpression(body) &&
            isAtomCreatorCall(body, imports.atomCreators)
          ) {
            innerCall = body;
          } else if (ts.isBlock(body)) {
            for (const stmt of body.statements) {
              if (
                ts.isReturnStatement(stmt) &&
                stmt.expression &&
                ts.isCallExpression(stmt.expression) &&
                isAtomCreatorCall(stmt.expression, imports.atomCreators)
              ) {
                innerCall = stmt.expression;
                break;
              }
            }
          }
        }
        if (innerCall) {
          const classification = classifyFamilyInstance(
            familyName,
            staticParam,
            innerCall,
            typeAliases,
            types,
            source,
          );
          const varId = familyVarId(familyName, staticParam);
          atomNames.add(varId);
          atomMetadata.set(varId, classification.metadata);
          decls.push({
            id: varId,
            kind: "jotai/atom-family",
            var: {
              id: varId,
              domain: classification.domain,
              origin: anchor(source, fileName, node),
              scope: { kind: "global" },
              initial: classification.initial,
            },
            origin: anchor(source, fileName, node),
            metadata: metadataToRecord(classification.metadata),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const hydration = discoverHydrationOverrides(source, fileName, imports);
  for (const warning of hydration.warnings) warnings.push(warning);
  const hydratedDecls = applyHydrationOverrides(decls, hydration.overrides);

  const storeScopedDecls: SourceDecl[] = [];
  if (!options?.skipStoreDuplication) {
    let atomsForStoreDuplication = hydratedDecls;
    if (componentStoreScopes.size > 0 && relatedFragments) {
      const externalDecls = relatedFragments
        .filter((fragment) => fragment.fileName !== fileName)
        .flatMap((fragment) =>
          discoverJotaiAtomsDetailed(
            fragment.sourceText,
            fragment.fileName,
            types,
            typePlugins,
            relatedFragments,
            { skipStoreDuplication: true },
          ).decls.filter((decl) => decl.var),
        );
      const seen = new Set<string>();
      atomsForStoreDuplication = [...hydratedDecls, ...externalDecls].filter(
        (decl) => {
          if (!decl.var || seen.has(decl.var.id)) return false;
          seen.add(decl.var.id);
          return true;
        },
      );
    }
    for (const storeScope of new Set(componentStoreScopes.values())) {
      storeScopedDecls.push(
        ...duplicateAtomsForStore(atomsForStoreDuplication, storeScope),
      );
    }
  }

  return {
    decls: [...hydratedDecls, ...storeScopedDecls],
    warnings,
    atomNames,
    atomMetadata,
  };
}

function atomDecl(
  node: ts.VariableDeclaration,
  atomName: string,
  classification: ReturnType<typeof classifyAtomCall>,
  fileName: string,
  source: ts.SourceFile,
): SourceDecl {
  const origin = anchor(source, fileName, node);
  const variable: StateVarDecl = {
    id: atomVarId(atomName),
    domain: classification.domain,
    origin,
    scope: { kind: "global" },
    initial: classification.initial,
  };
  return {
    id: variable.id,
    kind: "jotai/atom",
    var: variable,
    origin,
    metadata: metadataToRecord(classification.metadata),
  };
}

function anchor(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
): SourceAnchor {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: fileName, line: pos.line + 1, column: pos.character + 1 };
}

function emptyDiscoverResult(): DiscoverJotaiResult {
  return {
    decls: [],
    warnings: [],
    atomNames: new Set(),
    atomMetadata: new Map(),
  };
}

export function duplicateAtomsForStore(
  decls: readonly SourceDecl[],
  storeScope: string,
): SourceDecl[] {
  return decls
    .filter((decl) => decl.var && decl.kind.startsWith("jotai/"))
    .map((decl) => {
      const atomName =
        typeof decl.metadata?.atomName === "string"
          ? decl.metadata.atomName
          : decl.var!.id.replace(/^atom:/, "").replace(/@store:.+$/, "");
      const varId = atomVarId(atomName, storeScope);
      return {
        ...decl,
        id: varId,
        var: { ...decl.var!, id: varId },
        metadata: { ...decl.metadata, storeScope },
      };
    });
}

export function isAtomCall(
  node: ts.Expression,
  atomCreators: ReadonlyMap<string, string>,
): node is ts.CallExpression {
  return isAtomCreatorCall(node, atomCreators);
}

export { resolveJotaiImports } from "./imports.js";
