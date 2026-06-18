import * as ts from "typescript";
import type {
  CallSite,
  M0Ctx,
  WriteChannel,
  SemanticTypeContext,
} from "modality-ts/extract/engine/spi";
import { semanticSourceFileFor } from "../../engine/ts/semantic-source-file.js";
import type { EffectIR, SourceAnchor, Value } from "modality-ts/core";
import { propertyName } from "../../engine/ts/ast.js";
import { isStoreCreatorCall, resolveZustandImports } from "./imports.js";
import { anchor, discoverZustandStoresDetailed } from "./discover.js";
import { lowerActionBody, lowerSetCall } from "./effects.js";
import { storeVarId } from "./ids.js";
import { metadataFromRecord } from "./types.js";

export interface ZustandWriteDiscovery {
  channels: WriteChannel[];
  warnings: { message: string; source?: SourceAnchor }[];
  setterFixedEffects: Map<string, EffectIR>;
  resettableVarIds: Set<string>;
}

export function discoverZustandWriteChannels(
  sourceText: string,
  fileName = "state.ts",
  types?: SemanticTypeContext,
): WriteChannel[] {
  return discoverZustandWritesDetailed(sourceText, fileName, types).channels;
}

export function discoverZustandWritesDetailed(
  sourceText: string,
  fileName = "state.ts",
  types?: SemanticTypeContext,
): ZustandWriteDiscovery {
  const source = semanticSourceFileFor(
    sourceText,
    fileName,
    types,
    ts.ScriptKind.TSX,
  );
  const imports = resolveZustandImports(source, types);
  const discovery = discoverZustandStoresDetailed(sourceText, fileName, types);
  const channels: WriteChannel[] = [];
  const warnings: { message: string; source?: SourceAnchor }[] = [
    ...discovery.warnings,
  ];
  const setterFixedEffects = new Map<string, EffectIR>();
  const resettableVarIds = new Set<string>();
  const storeHandles = new Set<string>(discovery.storeNames);

  if (imports.storeCreators.size === 0 && discovery.decls.length === 0) {
    return { channels, warnings, setterFixedEffects, resettableVarIds };
  }

  const fieldVarIds = new Map<string, string>();
  const fieldInitials = new Map<string, Value>();
  for (const [storeName, fields] of discovery.storeFields) {
    for (const field of fields) {
      fieldVarIds.set(`${storeName}.${field}`, storeVarId(storeName, field));
    }
    const initials = discovery.storeFieldInitials.get(storeName);
    if (initials) {
      for (const [field, initial] of initials) {
        fieldInitials.set(`${storeName}.${field}`, initial);
      }
    }
  }

  const actionNameCounts = new Map<string, number>();
  for (const actions of discovery.storeActions.values()) {
    for (const actionName of actions.keys()) {
      actionNameCounts.set(
        actionName,
        (actionNameCounts.get(actionName) ?? 0) + 1,
      );
    }
  }

  for (const [storeName, actions] of discovery.storeActions) {
    const immer = discovery.storeImmer.get(storeName) ?? false;
    const storeFieldVarIds = new Map<string, string>();
    const storeFieldInitials = new Map<string, Value>();
    for (const field of discovery.storeFields.get(storeName) ?? []) {
      storeFieldVarIds.set(field, storeVarId(storeName, field));
      const initial = discovery.storeFieldInitials.get(storeName)?.get(field);
      if (initial !== undefined) storeFieldInitials.set(field, initial);
    }
    for (const [actionName, actionFn] of actions) {
      const actionWarnings: string[] = [];
      const effect = lowerActionBody(actionFn, {
        storeName,
        fieldVarIds: storeFieldVarIds,
        fieldInitials: storeFieldInitials,
        immer,
        warnings: actionWarnings,
      });
      for (const message of actionWarnings) {
        warnings.push({ message });
      }
      if (effect !== "unsupported") {
        setterFixedEffects.set(actionEffectKey(storeName, actionName), effect);
        if ((actionNameCounts.get(actionName) ?? 0) === 1) {
          setterFixedEffects.set(actionName, effect);
        }
        const primaryVar = primaryWrittenVar(effect, storeName);
        channels.push({
          id: `zustand:${storeName}.${actionName}.action`,
          varId: primaryVar ?? storeVarId(storeName, actionName),
          symbolName: actionName,
          source: anchor(source, fileName, actionFn),
        });
        if (isResetAction(effect, storeName, storeFieldInitials)) {
          for (const varId of storeFieldVarIds.values()) {
            resettableVarIds.add(varId);
          }
        }
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      if (isStoreCreatorCall(node.initializer, imports.storeCreators)) {
        storeHandles.add(node.name.text);
      }
      const selectorChannel = selectorReadChannel(
        node,
        storeHandles,
        source,
        fileName,
      );
      if (selectorChannel) {
        if (!selectorChannel.actionBinding) {
          channels.push(selectorChannel.channel);
        } else {
          const actionEffect = setterFixedEffects.get(
            actionEffectKey(
              selectorChannel.storeName,
              selectorChannel.actionBinding,
            ),
          );
          if (actionEffect) {
            setterFixedEffects.set(node.name.text, actionEffect);
            channels.push({
              ...selectorChannel.channel,
              varId:
                primaryWrittenVar(actionEffect, selectorChannel.storeName) ??
                selectorChannel.channel.varId,
            });
          }
        }
      }
      const getStateChannel = getStateReadChannel(
        node,
        storeHandles,
        source,
        fileName,
      );
      if (getStateChannel) channels.push(getStateChannel);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setState" &&
      ts.isIdentifier(node.expression.expression) &&
      storeHandles.has(node.expression.expression.text)
    ) {
      const storeName = node.expression.expression.text;
      channels.push({
        id: `zustand:${storeName}.setState`,
        varId: storeVarId(storeName, "_state"),
        symbolName: `${storeName}.setState`,
        source: anchor(source, fileName, node),
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return { channels, warnings, setterFixedEffects, resettableVarIds };
}

function actionEffectKey(storeName: string, actionName: string): string {
  return `${storeName}.${actionName}`;
}

function selectorReadChannel(
  node: ts.VariableDeclaration,
  storeHandles: ReadonlySet<string>,
  source: ts.SourceFile,
  fileName: string,
):
  | {
      channel: WriteChannel;
      storeName: string;
      actionBinding?: string;
    }
  | undefined {
  if (!node.initializer || !ts.isCallExpression(node.initializer)) {
    return undefined;
  }
  const call = node.initializer;
  if (!ts.isIdentifier(call.expression)) return undefined;
  const storeName = call.expression.text;
  if (!storeHandles.has(storeName)) return undefined;
  const selector = call.arguments[0];
  if (
    !selector ||
    !(ts.isArrowFunction(selector) || ts.isFunctionExpression(selector)) ||
    !ts.isIdentifier(selector.parameters[0]?.name)
  ) {
    return undefined;
  }
  const paramName = selector.parameters[0].name.text;
  const body = selector.body;
  let field: string | undefined;
  if (ts.isPropertyAccessExpression(body)) {
    if (
      ts.isIdentifier(body.expression) &&
      body.expression.text === paramName
    ) {
      field = body.name.text;
    }
  } else if (ts.isObjectLiteralExpression(body)) {
    const fields = objectSelectorFields(body, paramName);
    if (fields.length === 1) field = fields[0];
  }
  if (!field || !ts.isIdentifier(node.name)) return undefined;
  const storeActions = discoverZustandStoresDetailed(
    source.getFullText(),
    fileName,
  ).storeActions.get(storeName);
  const isAction = storeActions?.has(field) ?? false;
  if (isAction) {
    return {
      channel: {
        id: `zustand:${storeName}.${node.name.text}.action-bind`,
        varId: storeVarId(storeName, field),
        symbolName: node.name.text,
        source: anchor(source, fileName, node),
      },
      storeName,
      actionBinding: field,
    };
  }
  return {
    channel: {
      id: `zustand:${storeName}.${field}.read`,
      varId: storeVarId(storeName, field),
      symbolName: node.name.text,
      source: anchor(source, fileName, node),
    },
    storeName,
  };
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
    if (
      ts.isPropertyAccessExpression(prop.initializer) &&
      ts.isIdentifier(prop.initializer.expression) &&
      prop.initializer.expression.text === paramName
    ) {
      fields.push(prop.initializer.name.text);
    }
  }
  return fields;
}

function getStateReadChannel(
  node: ts.VariableDeclaration,
  storeHandles: ReadonlySet<string>,
  source: ts.SourceFile,
  fileName: string,
): WriteChannel | undefined {
  if (!node.initializer || !ts.isPropertyAccessExpression(node.initializer)) {
    return undefined;
  }
  const fieldAccess = node.initializer;
  const field = fieldAccess.name.text;
  const base = fieldAccess.expression;
  if (
    !ts.isCallExpression(base) ||
    !ts.isPropertyAccessExpression(base.expression) ||
    base.expression.name.text !== "getState" ||
    !ts.isIdentifier(base.expression.expression) ||
    !storeHandles.has(base.expression.expression.text) ||
    !ts.isIdentifier(node.name)
  ) {
    return undefined;
  }
  const storeName = base.expression.expression.text;
  return {
    id: `zustand:${storeName}.${field}.getState-read`,
    varId: storeVarId(storeName, field),
    symbolName: node.name.text,
    source: anchor(source, fileName, node),
  };
}

function primaryWrittenVar(
  effect: EffectIR,
  storeName: string,
): string | undefined {
  if (effect.kind === "assign") return effect.var;
  if (effect.kind === "seq") {
    for (const child of effect.effects) {
      const target = primaryWrittenVar(child, storeName);
      if (target) return target;
    }
  }
  return storeVarId(storeName, "_unknown");
}

function isResetAction(
  effect: EffectIR,
  storeName: string,
  fieldInitials: ReadonlyMap<string, Value>,
): boolean {
  if (fieldInitials.size === 0) return false;
  const assignments = collectAssignments(effect);
  if (assignments.size !== fieldInitials.size) return false;
  for (const [field, initial] of fieldInitials) {
    const varId = storeVarId(storeName, field);
    const assigned = assignments.get(varId);
    if (assigned?.kind !== "lit" || assigned.value !== initial) {
      return false;
    }
  }
  return true;
}

function collectAssignments(effect: EffectIR): Map<string, ExprIR> {
  const map = new Map<string, import("modality-ts/core").ExprIR>();
  if (effect.kind === "assign") {
    map.set(effect.var, effect.expr);
    return map;
  }
  if (effect.kind === "seq") {
    for (const child of effect.effects) {
      for (const [key, value] of collectAssignments(child)) {
        map.set(key, value);
      }
    }
  }
  return map;
}

type ExprIR = import("modality-ts/core").ExprIR;

export function discoverZustandSafetyWarnings(
  sourceText: string,
  fileName = "state.ts",
): { message: string; source?: SourceAnchor }[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const warnings: { message: string; source?: SourceAnchor }[] = [];
  const discovery = discoverZustandStoresDetailed(sourceText, fileName);
  warnings.push(...discovery.warnings);
  const writeDiscovery = discoverZustandWritesDetailed(sourceText, fileName);
  warnings.push(...writeDiscovery.warnings);

  for (const decl of discovery.decls) {
    const metadata = metadataFromRecord(decl.metadata);
    if (metadata?.storageKind === "localStorage" && !hasWindowGuard(source)) {
      warnings.push({
        message: `Zustand SSR-unsafe unguarded ${metadata.storageKind} access for ${metadata.storeName}.${metadata.field}`,
        source:
          decl.origin === "system" || decl.origin === "library-template"
            ? undefined
            : decl.origin,
      });
    }
  }

  return dedupeWarnings(warnings);
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

function dedupeWarnings(
  warnings: { message: string; source?: SourceAnchor }[],
): { message: string; source?: SourceAnchor }[] {
  const seen = new Set<string>();
  const result: { message: string; source?: SourceAnchor }[] = [];
  for (const warning of warnings) {
    const key = `${warning.message}:${warning.source?.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(warning);
  }
  return result;
}

export function summarizeZustandSetState(
  call: CallSite,
  _ctx: M0Ctx,
): EffectIR | "unsupported" {
  if (!call.callee.endsWith(".setState")) return "unsupported";
  const partial = call.arguments[0];
  if (!partial || typeof partial !== "object" || partial === null) {
    return "unsupported";
  }
  if (Array.isArray(partial)) return "unsupported";
  const storeName = call.callee.replace(/\.setState$/, "");
  const effects: EffectIR[] = [];
  for (const [field, value] of Object.entries(partial)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      effects.push({
        kind: "assign",
        var: storeVarId(storeName, field),
        expr: { kind: "lit", value: value as Value },
      });
    }
  }
  if (effects.length === 0) return "unsupported";
  if (effects.length === 1) {
    const only = effects[0];
    return only ?? "unsupported";
  }
  return { kind: "seq", effects };
}

export function summarizeZustandSetStateFromCall(
  call: ts.CallExpression,
  storeName: string,
  fieldVarIds: ReadonlyMap<string, string>,
  fieldInitials: ReadonlyMap<string, Value>,
  immer: boolean,
): EffectIR | "unsupported" {
  return (
    lowerSetCall(call, {
      storeName,
      fieldVarIds,
      fieldInitials,
      immer,
    }) ?? "unsupported"
  );
}
