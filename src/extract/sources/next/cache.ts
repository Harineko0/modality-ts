import * as ts from "typescript";
import type {
  EffectIR,
  ExprIR,
  ExtractionCaveat,
  StateVarDecl,
  TemplateFragment,
  Transition,
} from "modality-ts/core";
import type { RouteInventory, RouteNode } from "modality-ts/extract/engine/spi";
import { cacheDynamicRequestCaveat } from "../../engine/ts/caveats.js";
import { PENDING_QUEUE_VAR } from "../../engine/ts/transition/statement-summary.js";
import { NEXT_CACHE_DOMAIN, nextCacheVarId, nextTreeNodes } from "./routes.js";

export type NextCacheKeyKind =
  | "tag"
  | "path"
  | "fetch"
  | "function"
  | "directive";

export interface NextCacheKey {
  id: string;
  kind: NextCacheKeyKind;
  routePattern?: string;
}

export type NextCacheRevalidationKind =
  | "updateTag"
  | "revalidateTag"
  | "revalidatePath";

export interface NextCacheRevalidation {
  kind: NextCacheRevalidationKind;
  target: string;
  profile?: string;
  source: { file: string; line: number; column: number };
  cacheKeys: readonly string[];
}

export interface NextCacheDiscovery {
  keys: NextCacheKey[];
  revalidations: NextCacheRevalidation[];
  dynamicRequest: boolean;
  warnings: string[];
  caveats: ExtractionCaveat[];
}

export interface NextCacheModelFragments {
  vars: StateVarDecl[];
  transitions: Transition[];
  warnings: string[];
  caveats: ExtractionCaveat[];
}

const CACHE_DIRECTIVES = new Set([
  "use cache",
  "use cache: private",
  "use cache: remote",
]);

function parseSource(sourceText: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function normalizedPath(fileName: string): string {
  return fileName.split("\\").join("/");
}

function positionOf(
  sourceFile: ts.SourceFile,
  fileName: string,
  node: ts.Node,
): { file: string; line: number; column: number } {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return {
    file: fileName,
    line: start.line + 1,
    column: start.character + 1,
  };
}

function stringLiteralValue(
  node: ts.Expression | undefined,
): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function normalizeCachePath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

function cacheKeyId(kind: NextCacheKeyKind, value: string): string {
  return `${kind}:${value}`;
}

function addKey(
  keys: Map<string, NextCacheKey>,
  kind: NextCacheKeyKind,
  value: string,
  routePattern?: string,
): void {
  const id = cacheKeyId(kind, value);
  if (keys.has(id)) return;
  keys.set(id, { id, kind, ...(routePattern ? { routePattern } : {}) });
}

function routePatternForFile(
  fileName: string,
  route: RouteNode | undefined,
  inventory: RouteInventory | undefined,
): string | undefined {
  if (route?.pattern) return route.pattern;
  if (!inventory) return undefined;
  const resolved = normalizedPath(fileName);
  return inventory.routes.find(
    (node) => node.file && normalizedPath(node.file) === resolved,
  )?.pattern;
}

function discoverCacheDirectives(
  sourceFile: ts.SourceFile,
  fileName: string,
  keys: Map<string, NextCacheKey>,
  routePattern: string | undefined,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (CACHE_DIRECTIVES.has(node.text)) {
        addKey(
          keys,
          "directive",
          `${normalizedPath(fileName)}#${node.text}`,
          routePattern,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function extractTagsFromExpression(node: ts.Expression | undefined): string[] {
  if (!node) return [];
  const literal = stringLiteralValue(node);
  if (literal) return [literal];
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) =>
      stringLiteralValue(element) ? [stringLiteralValue(element)!] : [],
    );
  }
  return [];
}

function discoverFetchCacheOptions(
  node: ts.CallExpression,
  keys: Map<string, NextCacheKey>,
  routePattern: string | undefined,
): boolean {
  const options = node.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  let dynamic = false;
  for (const prop of options.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (!name) continue;
    if (name === "cache") {
      const cacheMode = stringLiteralValue(prop.initializer);
      if (cacheMode === "no-store") dynamic = true;
      if (cacheMode === "force-cache") {
        const path = fetchPathValue(node.arguments[0]);
        if (path) addKey(keys, "fetch", path, routePattern);
      }
    }
    if (name === "next" && ts.isObjectLiteralExpression(prop.initializer)) {
      for (const nextProp of prop.initializer.properties) {
        if (!ts.isPropertyAssignment(nextProp)) continue;
        const nextName = ts.isIdentifier(nextProp.name)
          ? nextProp.name.text
          : ts.isStringLiteral(nextProp.name)
            ? nextProp.name.text
            : undefined;
        if (nextName === "tags") {
          for (const tag of extractTagsFromExpression(nextProp.initializer)) {
            addKey(keys, "tag", tag, routePattern);
          }
        }
        if (nextName === "revalidate" && nextProp.initializer) {
          const path = fetchPathValue(node.arguments[0]);
          if (path) addKey(keys, "fetch", path, routePattern);
        }
      }
    }
  }
  return dynamic;
}

function fetchPathValue(
  expression: ts.Expression | undefined,
): string | undefined {
  if (!expression) return undefined;
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return normalizeCachePath(expression.text);
  }
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans)
      value += `:id${span.literal.text}`;
    return normalizeCachePath(value);
  }
  return undefined;
}

function discoverCacheCalls(
  sourceFile: ts.SourceFile,
  fileName: string,
  keys: Map<string, NextCacheKey>,
  revalidations: NextCacheRevalidation[],
  routePattern: string | undefined,
): { dynamicRequest: boolean } {
  let dynamicRequest = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name === "fetch") {
        if (discoverFetchCacheOptions(node, keys, routePattern))
          dynamicRequest = true;
      }
      if (name === "cacheTag") {
        const tag = stringLiteralValue(node.arguments[0]);
        if (tag) addKey(keys, "tag", tag, routePattern);
      }
      if (name === "cacheLife") {
        const profile = stringLiteralValue(node.arguments[0]);
        if (profile) addKey(keys, "directive", `life:${profile}`, routePattern);
      }
      if (name === "updateTag") {
        const tag = stringLiteralValue(node.arguments[0]);
        if (tag) {
          addKey(keys, "tag", tag, routePattern);
          revalidations.push({
            kind: "updateTag",
            target: tag,
            source: positionOf(sourceFile, fileName, node),
            cacheKeys: [cacheKeyId("tag", tag)],
          });
        }
      }
      if (name === "revalidateTag") {
        const tag = stringLiteralValue(node.arguments[0]);
        const profile = stringLiteralValue(node.arguments[1]);
        if (tag) {
          addKey(keys, "tag", tag, routePattern);
          revalidations.push({
            kind: "revalidateTag",
            target: tag,
            ...(profile ? { profile } : {}),
            source: positionOf(sourceFile, fileName, node),
            cacheKeys: [cacheKeyId("tag", tag)],
          });
        }
      }
      if (name === "revalidatePath") {
        const path = stringLiteralValue(node.arguments[0]);
        if (path) {
          const normalized = normalizeCachePath(path);
          addKey(keys, "path", normalized, routePattern);
          revalidations.push({
            kind: "revalidatePath",
            target: normalized,
            source: positionOf(sourceFile, fileName, node),
            cacheKeys: pathAssociatedCacheKeys(keys, normalized),
          });
        }
      }
      if (name === "unstable_cache") {
        const keyParts = extractTagsFromExpression(node.arguments[1]);
        const fnKey =
          keyParts.length > 0 ? keyParts.join(":") : normalizedPath(fileName);
        addKey(keys, "function", fnKey, routePattern);
        const options = node.arguments[2];
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const prop of options.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const propName = ts.isIdentifier(prop.name)
              ? prop.name.text
              : undefined;
            if (propName === "tags") {
              for (const tag of extractTagsFromExpression(prop.initializer)) {
                addKey(keys, "tag", tag, routePattern);
              }
            }
          }
        }
      }
      if (name === "unstable_noStore" || name === "connection") {
        dynamicRequest = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { dynamicRequest };
}

function pathAssociatedCacheKeys(
  keys: Map<string, NextCacheKey>,
  path: string,
): string[] {
  const normalized = normalizeCachePath(path);
  const associated = [...keys.values()]
    .filter(
      (key) =>
        key.routePattern === normalized ||
        (key.kind === "path" && key.id === cacheKeyId("path", normalized)) ||
        (key.kind === "fetch" && key.id.endsWith(normalized)),
    )
    .map((key) => key.id);
  if (!associated.includes(cacheKeyId("path", normalized))) {
    associated.push(cacheKeyId("path", normalized));
  }
  return [...new Set(associated)];
}

export function discoverNextCacheUsage(ctx: {
  fileName: string;
  sourceText: string;
  route?: RouteNode;
  inventory?: RouteInventory;
}): NextCacheDiscovery {
  const sourceFile = parseSource(ctx.sourceText, ctx.fileName);
  const routePattern = routePatternForFile(
    ctx.fileName,
    ctx.route,
    ctx.inventory,
  );
  const keys = new Map<string, NextCacheKey>();
  const revalidations: NextCacheRevalidation[] = [];
  const warnings: string[] = [];
  const caveats: ExtractionCaveat[] = [];

  discoverCacheDirectives(sourceFile, ctx.fileName, keys, routePattern);
  const { dynamicRequest } = discoverCacheCalls(
    sourceFile,
    ctx.fileName,
    keys,
    revalidations,
    routePattern,
  );

  if (dynamicRequest && routePattern) {
    const caveat = cacheDynamicRequestCaveat(routePattern, {
      file: ctx.fileName,
      line: 1,
      column: 1,
    });
    warnings.push(caveat.reason);
    caveats.push(caveat);
  }

  return {
    keys: [...keys.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    revalidations,
    dynamicRequest,
    warnings,
    caveats,
  };
}

export function nextCacheVarDecls(
  keys: readonly NextCacheKey[],
  options: { dynamicRequest?: boolean } = {},
): StateVarDecl[] {
  if (options.dynamicRequest) return [];
  return keys.map((key) => ({
    id: nextCacheVarId(key.id),
    domain: { kind: "enum", values: [...NEXT_CACHE_DOMAIN] },
    origin: "system",
    scope: { kind: "global" },
    role: { kind: "cache-entry" },
    initial: key.kind === "directive" ? "fresh" : "empty",
  }));
}

function assignLit(varId: string, value: string): EffectIR {
  return {
    kind: "assign",
    var: varId,
    expr: { kind: "lit", value },
  };
}

function cacheIs(varId: string, state: string): ExprIR {
  return {
    kind: "eq",
    args: [
      { kind: "read", var: varId },
      { kind: "lit", value: state },
    ],
  };
}

function createCacheRefreshTransitions(
  key: NextCacheKey,
  source: Transition["source"],
): Transition[] {
  const varId = nextCacheVarId(key.id);
  const refreshOp = `CACHE ${key.id}`;
  return [
    {
      id: `next:cache:${key.id}:refresh`,
      cls: "library",
      label: { kind: "timer", key: `next:cache:${key.id}` },
      source,
      guard: cacheIs(varId, "stale"),
      effect: {
        kind: "seq",
        effects: [
          assignLit(varId, "refreshing"),
          {
            kind: "enqueue",
            op: refreshOp,
            continuation: `next:cache:${key.id}:resolve`,
            args: {},
          },
        ],
      },
      reads: [varId],
      writes: [varId, PENDING_QUEUE_VAR],
      confidence: "exact",
    },
    {
      id: `next:cache:${key.id}:resolve:success`,
      cls: "env",
      label: { kind: "resolve", op: refreshOp, outcome: "success" },
      source,
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: PENDING_QUEUE_VAR, path: ["0", "opId"] },
          { kind: "lit", value: refreshOp },
        ],
      },
      effect: {
        kind: "seq",
        effects: [{ kind: "dequeue", index: 0 }, assignLit(varId, "fresh")],
      },
      reads: [PENDING_QUEUE_VAR],
      writes: [PENDING_QUEUE_VAR, varId],
      confidence: "exact",
    },
    {
      id: `next:cache:${key.id}:resolve:error`,
      cls: "env",
      label: { kind: "resolve", op: refreshOp, outcome: "error" },
      source,
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: PENDING_QUEUE_VAR, path: ["0", "opId"] },
          { kind: "lit", value: refreshOp },
        ],
      },
      effect: {
        kind: "seq",
        effects: [{ kind: "dequeue", index: 0 }, assignLit(varId, "error")],
      },
      reads: [PENDING_QUEUE_VAR],
      writes: [PENDING_QUEUE_VAR, varId],
      confidence: "exact",
    },
  ];
}

function revalidationTransition(
  revalidation: NextCacheRevalidation,
): Transition[] {
  const source = [
    {
      file: revalidation.source.file,
      line: revalidation.source.line,
      column: revalidation.source.column,
    },
  ];
  const transitions: Transition[] = [];

  for (const cacheKey of revalidation.cacheKeys) {
    const varId = nextCacheVarId(cacheKey);
    const baseId = `next:cache:${cacheKey}:${revalidation.kind}:${revalidation.target}`;

    if (revalidation.kind === "updateTag") {
      transitions.push({
        id: `${baseId}:immediate`,
        cls: "internal",
        label: {
          kind: "internal",
          text: `updateTag ${revalidation.target}`,
        },
        source,
        guard: { kind: "lit", value: true },
        effect: assignLit(varId, "refreshing"),
        reads: [],
        writes: [varId],
        confidence: "exact",
      });
      transitions.push({
        id: `${baseId}:fresh`,
        cls: "internal",
        label: {
          kind: "internal",
          text: `updateTag ${revalidation.target} fresh`,
        },
        source,
        guard: cacheIs(varId, "refreshing"),
        effect: assignLit(varId, "fresh"),
        reads: [varId],
        writes: [varId],
        confidence: "exact",
      });
      continue;
    }

    if (revalidation.kind === "revalidateTag") {
      const profile = revalidation.profile ?? "default";
      transitions.push({
        id: `${baseId}:${profile}:stale`,
        cls: "internal",
        label: {
          kind: "internal",
          text: `revalidateTag ${revalidation.target} ${profile}`,
        },
        source,
        guard: {
          kind: "or",
          args: [cacheIs(varId, "fresh"), cacheIs(varId, "empty")],
        },
        effect: assignLit(varId, "stale"),
        reads: [varId],
        writes: [varId],
        confidence: "exact",
      });
      if (profile === "max") {
        transitions.push(
          ...createCacheRefreshTransitions(
            { id: cacheKey, kind: "tag" },
            source,
          ),
        );
      }
      continue;
    }

    if (revalidation.kind === "revalidatePath") {
      transitions.push({
        id: `${baseId}:stale`,
        cls: "internal",
        label: {
          kind: "internal",
          text: `revalidatePath ${revalidation.target}`,
        },
        source,
        guard: {
          kind: "or",
          args: [
            cacheIs(varId, "fresh"),
            cacheIs(varId, "empty"),
            cacheIs(varId, "stale"),
          ],
        },
        effect: assignLit(varId, "stale"),
        reads: [varId],
        writes: [varId],
        confidence: "over-approx",
      });
    }
  }

  return transitions;
}

export function createNextCacheTemplate(
  keys: readonly NextCacheKey[],
  revalidations: readonly NextCacheRevalidation[],
  options: { dynamicRequest?: boolean } = {},
): TemplateFragment {
  if (options.dynamicRequest) {
    return { vars: [], transitions: [] };
  }
  const vars = nextCacheVarDecls(keys, options);
  const transitionIds = new Set<string>();
  const transitions: Transition[] = [];
  const addTransition = (transition: Transition): void => {
    if (transitionIds.has(transition.id)) return;
    transitionIds.add(transition.id);
    transitions.push(transition);
  };
  for (const revalidation of revalidations) {
    for (const transition of revalidationTransition(revalidation)) {
      addTransition(transition);
    }
  }
  return {
    vars,
    transitions: transitions.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
}

export function aggregateNextCacheDiscoveries(
  discoveries: readonly NextCacheDiscovery[],
  inventory?: RouteInventory,
): NextCacheModelFragments {
  const keyMap = new Map<string, NextCacheKey>();
  const revalidations: NextCacheRevalidation[] = [];
  const warnings: string[] = [];
  const caveats: ExtractionCaveat[] = [];
  let skipCacheVars = false;

  for (const discovery of discoveries) {
    warnings.push(...discovery.warnings);
    caveats.push(...discovery.caveats);
    if (discovery.dynamicRequest) skipCacheVars = true;
    for (const key of discovery.keys) keyMap.set(key.id, key);
    revalidations.push(...discovery.revalidations);
  }

  if (inventory) {
    for (const node of nextTreeNodes(inventory)) {
      if (node.pattern) {
        addKey(keyMap, "path", node.pattern, node.pattern);
      }
    }
  }

  const keys = [...keyMap.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const fragment = createNextCacheTemplate(keys, revalidations, {
    dynamicRequest: skipCacheVars,
  });
  return {
    vars: [...fragment.vars],
    transitions: [...fragment.transitions],
    warnings: [...new Set(warnings)].sort(),
    caveats: [...caveats].sort(compareCacheCaveats),
  };
}

function compareCacheCaveats(
  left: ExtractionCaveat,
  right: ExtractionCaveat,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id) ||
    left.reason.localeCompare(right.reason)
  );
}

export function discoverNextCacheFromSources(
  sources: readonly { fileName: string; sourceText: string }[],
  inventory?: RouteInventory,
): NextCacheModelFragments {
  const discoveries = sources.map((source) =>
    discoverNextCacheUsage({
      fileName: source.fileName,
      sourceText: source.sourceText,
      inventory,
    }),
  );
  return aggregateNextCacheDiscoveries(discoveries, inventory);
}
