import type { SourceAnchor, Value } from "modality-ts/core";
import * as ts from "typescript";
import { literalValue, propertyName } from "../../engine/ts/ast.js";
import { modelSlackCaveat } from "../../engine/ts/caveats.js";
import { atomVarId } from "./ids.js";
import { isHookCall, resolveJotaiImports } from "./imports.js";
import { providerScopeFromJsx } from "./jsx.js";

export interface HydrationOverride {
  varId: string;
  initial: Value;
}

export interface HydrationDiscovery {
  overrides: HydrationOverride[];
  warnings: HydrationWarning[];
}

interface HydrationWarning {
  message: string;
  source?: import("modality-ts/core").SourceAnchor;
  caveat?: import("modality-ts/core").ExtractionCaveat;
}

export function discoverHydrationOverrides(
  source: ts.SourceFile,
  fileName: string,
  imports = resolveJotaiImports(source),
): HydrationDiscovery {
  const overrides: HydrationOverride[] = [];
  const warnings: HydrationWarning[] = [];
  if (!imports.hooks.size) return { overrides, warnings };

  const visit = (node: ts.Node, storeScope?: string): void => {
    if (
      ts.isCallExpression(node) &&
      isHookCall(node, imports.hooks, "useHydrateAtoms")
    ) {
      const valuesArg = node.arguments[0];
      const optionsArg = node.arguments[1];
      let scopedStore = storeScope;
      if (optionsArg && ts.isObjectLiteralExpression(optionsArg)) {
        for (const prop of optionsArg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const name = propertyName(prop.name);
          if (name === "store" && ts.isIdentifier(prop.initializer)) {
            scopedStore = prop.initializer.text;
          }
          if (
            name === "dangerouslyForceHydrate" &&
            prop.initializer.kind === ts.SyntaxKind.TrueKeyword
          ) {
            const src = anchor(source, fileName, node);
            const message =
              "Jotai dangerouslyForceHydrate concurrent semantics not modeled";
            warnings.push({
              message,
              source: src,
              caveat: modelSlackCaveat(
                "jotai:useHydrateAtoms.dangerouslyForceHydrate",
                message,
                src,
              ),
            });
          }
        }
      }
      if (!valuesArg) return;
      const pairs = hydrationPairs(valuesArg);
      if (!pairs) {
        const src = anchor(source, fileName, node);
        const message = "Jotai useHydrateAtoms dynamic values unsupported";
        warnings.push({
          message,
          source: src,
          caveat: modelSlackCaveat(
            "jotai:useHydrateAtoms.dynamic-values",
            message,
            src,
          ),
        });
        return;
      }
      for (const [atomName, value] of pairs) {
        if (value === undefined) {
          const src = anchor(source, fileName, node);
          const message = `Jotai useHydrateAtoms dynamic value for ${atomName} unsupported`;
          warnings.push({
            message,
            source: src,
            caveat: modelSlackCaveat(
              `jotai:useHydrateAtoms.${atomName}`,
              message,
              src,
            ),
          });
          continue;
        }
        overrides.push({
          varId: atomVarId(atomName, scopedStore),
          initial: value,
        });
      }
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const providerScope = providerScopeFromJsx(node, imports, source);
      const childScope = providerScope ?? storeScope;
      ts.forEachChild(node, (child) => visit(child, childScope));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, storeScope));
  };
  visit(source, undefined);
  return { overrides, warnings };
}

export function applyHydrationOverrides(
  decls: readonly import("modality-ts/extract/engine/spi").SourceDecl[],
  overrides: readonly HydrationOverride[],
): import("modality-ts/extract/engine/spi").SourceDecl[] {
  if (overrides.length === 0) return [...decls];
  const overrideMap = new Map(
    overrides.map((entry) => [entry.varId, entry.initial]),
  );
  return decls.map((decl) => {
    if (!decl.var) return decl;
    const override = overrideMap.get(decl.var.id);
    if (override === undefined) return decl;
    return {
      ...decl,
      var: { ...decl.var, initial: override },
      metadata: { ...decl.metadata, hydrated: true },
    };
  });
}

function hydrationPairs(
  expression: ts.Expression,
): [string, Value | undefined][] | undefined {
  if (ts.isArrayLiteralExpression(expression)) {
    const pairs: [string, Value | undefined][] = [];
    for (const element of expression.elements) {
      if (
        !ts.isArrayLiteralExpression(element) ||
        element.elements.length < 2
      ) {
        return undefined;
      }
      const atom = element.elements[0];
      const value = element.elements[1];
      if (!atom || !ts.isIdentifier(atom) || !value) return undefined;
      const lit = literalValue(value);
      pairs.push([atom.text, lit as Value | undefined]);
    }
    return pairs;
  }
  if (
    ts.isNewExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "Map" &&
    expression.arguments?.[0] &&
    ts.isArrayLiteralExpression(expression.arguments[0])
  ) {
    return hydrationPairs(expression.arguments[0]);
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
