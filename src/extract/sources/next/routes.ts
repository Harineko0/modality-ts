import type {
  LocationLowering,
  NavIntent,
  ResolvedOptions,
  RouteInventory,
  RouteNode,
} from "modality-ts/extract/engine/spi";
import type {
  AbstractDomain,
  EffectIR,
  ExprIR,
  StateVarDecl,
  Value,
} from "modality-ts/core";
import {
  normalizeRouteTarget,
  routeMountScope,
} from "../../engine/ts/routes.js";
import { locationEffect } from "../../engine/ts/transition/navigation.js";
import {
  nextRouteTreeToMetadata,
  type NextInterceptInfo,
  type NextParam,
  type NextRouteTreeNode,
  type NextRouterKind,
} from "./types.js";

export const NEXT_SLOT_NONE = "__none";

export const NEXT_PHASE_DOMAIN = [
  "ready",
  "loading",
  "error",
  "not-found",
  "forbidden",
  "unauthorized",
] as const;

export const NEXT_CACHE_DOMAIN = [
  "empty",
  "fresh",
  "stale",
  "refreshing",
  "error",
] as const;

export function nextSlotVarId(slotKey: string): string {
  return `sys:next:slot:${slotKey}`;
}

export function nextPhaseVarId(boundaryId: string): string {
  return `sys:next:phase:${boundaryId}`;
}

export function nextCacheVarId(key: string): string {
  return `sys:next:cache:${key}`;
}

export function locationVars(
  inventory: RouteInventory,
  options: ResolvedOptions,
  lowering: LocationLowering,
): readonly StateVarDecl[] {
  const uiPatterns = inventory.routes
    .filter((node) => node.kind === "page" || node.kind === "index")
    .map((node) => node.pattern);
  const routeValues = uniqueRoutes([
    options.route,
    ...uiPatterns,
    ...lowering.pushTargets,
  ]);
  const routeDomain: AbstractDomain = { kind: "enum", values: routeValues };

  const historyRoutes = clampToRouteDomain(
    lowering.hasUnboundPush
      ? routeValues
      : uniqueRoutes([
          options.route,
          ...lowering.pushTargets,
          ...lowering.pushOrigins,
        ]),
    routeValues,
  );

  return [
    {
      id: "sys:route",
      domain: routeDomain,
      origin: "system",
      scope: { kind: "global" },
      initial: options.route,
    },
    {
      id: "sys:history",
      domain: {
        kind: "boundedList",
        inner: { kind: "enum", values: historyRoutes },
        maxLen: options.bounds?.maxHistory ?? 4,
      },
      origin: "system",
      scope: { kind: "global" },
      initial: [],
    },
  ];
}

function clampToRouteDomain(
  historyRoutes: readonly string[],
  routeValues: readonly string[],
): string[] {
  const allowed = new Set(routeValues);
  return uniqueRoutes(historyRoutes.filter((route) => allowed.has(route)));
}

function uniqueRoutes(routes: readonly string[]): string[] {
  return [...new Set(routes)];
}

export function encodeNextTreeMetadata(
  node: NextRouteTreeNode,
): Record<string, Value> {
  return {
    nextRouteTree: nextRouteTreeToMetadata(node),
  };
}

export function nextTreeNodeFromRoute(
  route: RouteNode,
): NextRouteTreeNode | undefined {
  const raw = route.metadata?.nextRouteTree;
  if (raw === undefined || !isRecord(raw)) return undefined;
  return decodeNextTreeNode(raw, route);
}

export function nextTreeNodes(
  inventory: RouteInventory,
): readonly NextRouteTreeNode[] {
  return inventory.routes.flatMap((route) => {
    const node = nextTreeNodeFromRoute(route);
    return node ? [node] : [];
  });
}

export function routeTreeVars(
  inventory: RouteInventory,
  options: ResolvedOptions,
): readonly StateVarDecl[] {
  const nodes = nextTreeNodes(inventory);
  const vars: StateVarDecl[] = [];
  const routePatterns = nodes
    .filter((node) => node.kind === "page" || node.kind === "index")
    .map((node) => node.pattern);
  const initialAssignments = initialSlotAssignments(
    nodes,
    options.route,
    routePatterns,
  );

  for (const slotKey of collectSlotKeys(nodes)) {
    const slotNodes = nodes.filter(
      (node) => (node.slot ?? defaultSlotForRouter(node.router)) === slotKey,
    );
    const values = uniqueStrings([
      NEXT_SLOT_NONE,
      ...slotNodes.map((node) => node.id),
    ]);
    vars.push({
      id: nextSlotVarId(slotKey),
      domain: { kind: "enum", values },
      origin: "system",
      scope: { kind: "global" },
      initial: initialAssignments.get(slotKey) ?? NEXT_SLOT_NONE,
    });
  }

  for (const boundary of collectPhaseBoundaries(nodes)) {
    vars.push({
      id: nextPhaseVarId(boundary.id),
      domain: { kind: "enum", values: [...NEXT_PHASE_DOMAIN] },
      origin: "system",
      scope: { kind: "global" },
      initial: "ready",
    });
  }

  return vars;
}

export function lowerNextNavigation(
  intent: NavIntent,
  ctx: {
    inventory: RouteInventory;
    routePatterns: readonly string[];
  },
): {
  effect: EffectIR;
  reads: readonly string[];
  writes: readonly string[];
  confidence: "exact" | "over-approx";
  warnings?: readonly string[];
} {
  const nodes = nextTreeNodes(ctx.inventory);
  const slotKeys = collectSlotKeys(nodes);
  const phaseBoundaries = collectPhaseBoundaries(nodes);
  const baseReads =
    intent.mode === "push" || intent.mode === "back"
      ? (["sys:route", "sys:history"] as const)
      : (["sys:history"] as const);
  const writes = new Set<string>(["sys:route", "sys:history"]);
  const warnings: string[] = [];
  const routeValues = ctx.routePatterns;
  const location = locationEffect({
    currentVar: "sys:route",
    historyVar: "sys:history",
    mode: intent.mode,
    to: intent.to
      ? {
          kind: "lit",
          value: normalizeRouteTarget(intent.to, ctx.routePatterns),
        }
      : undefined,
    routeValues,
  });
  const effects: EffectIR[] = [location.effect];

  if (intent.mode === "back" || !intent.to) {
    return {
      effect: effects.length === 1 ? effects[0]! : { kind: "seq", effects },
      reads: [...baseReads],
      writes: [...writes],
      confidence: "exact",
    };
  }

  const normalizedTarget = normalizeRouteTarget(intent.to, ctx.routePatterns);
  const targetLeaves = findLeafNodesForPattern(nodes, normalizedTarget);
  const targetKnown = ctx.routePatterns.includes(normalizedTarget);

  if (!targetKnown || targetLeaves.length === 0) {
    warnings.push(
      `Dynamic or unknown navigation target "${intent.to}" over-approximates route-tree slot assignments`,
    );
    for (const slotKey of slotKeys) {
      const slotVar = nextSlotVarId(slotKey);
      const domain = routeTreeVars(ctx.inventory, { route: "/" }).find(
        (decl) => decl.id === slotVar,
      )?.domain;
      const values =
        domain?.kind === "enum"
          ? domain.values.filter((value) => value !== NEXT_SLOT_NONE)
          : [];
      writes.add(slotVar);
      effects.push(
        values.length > 0
          ? {
              kind: "choose",
              var: slotVar,
              among: values.map((value) => ({ kind: "lit", value })),
            }
          : { kind: "havoc", var: slotVar },
      );
    }
    for (const boundary of phaseBoundaries) {
      const phaseVar = nextPhaseVarId(boundary.id);
      writes.add(phaseVar);
      effects.push({ kind: "havoc", var: phaseVar });
    }
    return {
      effect: { kind: "seq", effects },
      reads: [...baseReads, ...slotKeys.map(nextSlotVarId)],
      writes: [...writes],
      confidence: "over-approx",
      warnings,
    };
  }

  const primaryLeaf = targetLeaves[0]!;
  const path = ancestorPath(nodes, primaryLeaf.id);
  const assignments = new Map<string, string>();

  for (const node of path) {
    const slotKey = node.slot ?? defaultSlotForRouter(node.router);
    assignments.set(slotKey, node.id);
  }

  for (const [slotKey, nodeId] of assignments) {
    const slotVar = nextSlotVarId(slotKey);
    writes.add(slotVar);
    effects.push(assignLit(slotVar, nodeId));
  }

  for (const boundary of phaseBoundaries) {
    const onPath = path.some((node) => node.id === boundary.id);
    if (!onPath) continue;
    const phaseVar = nextPhaseVarId(boundary.id);
    writes.add(phaseVar);
    const phase = boundary.loadingFile ? "loading" : "ready";
    effects.push(assignLit(phaseVar, phase));
  }

  const interceptNode = primaryLeaf.intercept;
  if (interceptNode && intent.mode === "push") {
    const interceptSlot = primaryLeaf.slot ?? "@modal";
    const slotVar = nextSlotVarId(interceptSlot);
    writes.add(slotVar);
    effects.push(assignLit(slotVar, primaryLeaf.id));
  }

  return {
    effect: { kind: "seq", effects },
    reads: [...baseReads, ...[...assignments.keys()].map(nextSlotVarId)],
    writes: [...writes],
    confidence: "exact",
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export function mountScopeForComponent(
  componentName: string,
  inventory: RouteInventory,
): StateVarDecl["scope"] | undefined {
  const nodes = nextTreeNodes(inventory);
  if (nodes.length === 0) return undefined;

  const normalized = normalizeComponentName(componentName);

  const layoutNode = nodes.find(
    (node) =>
      node.layoutFile !== undefined &&
      fileNameMatchesComponent(normalized, node.layoutFile),
  );
  if (layoutNode) {
    const slotKey = layoutNode.slot ?? defaultSlotForRouter(layoutNode.router);
    const slotVar = nextSlotVarId(slotKey);
    const layoutScopeId =
      layoutNode.layoutFile && !layoutNode.file
        ? layoutNode.id
        : (layoutNode.parentId ?? layoutNode.id);
    const descendantIds = descendantNodeIds(nodes, layoutScopeId);
    return {
      kind: "mount-local",
      id: `next:layout:${layoutScopeId}`,
      when: or(
        eq(readExpr(slotVar), lit(layoutScopeId)),
        ...descendantIds.map((id) => eq(readExpr(slotVar), lit(id))),
      ),
    };
  }

  const templateNode = nodes.find(
    (node) =>
      node.templateFile !== undefined &&
      fileNameMatchesComponent(normalized, node.templateFile),
  );
  if (templateNode) {
    const slotKey =
      templateNode.slot ?? defaultSlotForRouter(templateNode.router);
    const slotVar = nextSlotVarId(slotKey);
    return {
      kind: "mount-local",
      id: `next:template:${templateNode.id}`,
      when: eq(readExpr(slotVar), lit(templateNode.id)),
    };
  }

  const pageMatches = nodes.filter(
    (node) =>
      (node.kind === "page" || node.kind === "index") &&
      node.file !== undefined &&
      fileNameMatchesComponent(normalized, node.file),
  );
  if (pageMatches.length === 1) {
    return mountScopeForNode(pageMatches[0]!, nodes);
  }

  const matches = nodes.filter((node) => {
    const files = [
      node.file,
      node.layoutFile,
      node.templateFile,
      node.defaultFile,
    ].filter((file): file is string => file !== undefined);
    return files.some((file) => fileNameMatchesComponent(normalized, file));
  });
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    const pages = matches.filter(
      (node) => node.kind === "page" || node.kind === "index",
    );
    if (pages.length === 1) return mountScopeForNode(pages[0]!, nodes);
    return undefined;
  }
  return mountScopeForNode(matches[0]!, nodes);
}

function mountScopeForNode(
  node: NextRouteTreeNode,
  allNodes: readonly NextRouteTreeNode[],
): StateVarDecl["scope"] {
  const slotKey = node.slot ?? defaultSlotForRouter(node.router);
  const slotVar = nextSlotVarId(slotKey);

  if (node.templateFile) {
    return {
      kind: "mount-local",
      id: `next:template:${node.id}`,
      when: eq(readExpr(slotVar), lit(node.id)),
    };
  }

  if (node.layoutFile && !node.file) {
    const descendantIds = descendantNodeIds(allNodes, node.id);
    return {
      kind: "mount-local",
      id: `next:layout:${node.id}`,
      when: or(
        eq(readExpr(slotVar), lit(node.id)),
        ...descendantIds.map((id) => eq(readExpr(slotVar), lit(id))),
      ),
    };
  }

  if (node.segmentKind === "parallel-slot" || node.slot?.startsWith("@")) {
    return {
      kind: "mount-local",
      id: `next:slot:${node.id}`,
      when: eq(readExpr(slotVar), lit(node.id)),
    };
  }

  if (node.intercept) {
    const interceptSlot = node.slot ?? "@modal";
    return {
      kind: "mount-local",
      id: `next:intercept:${node.id}`,
      when: eq(readExpr(nextSlotVarId(interceptSlot)), lit(node.id)),
    };
  }

  if (node.kind === "page" || node.kind === "index") {
    return {
      kind: "mount-local",
      id: `next:page:${node.id}`,
      when: and(
        eq(readExpr("sys:route"), lit(node.pattern)),
        eq(readExpr(slotVar), lit(node.id)),
      ),
    };
  }

  return routeMountScope(node.pattern);
}

function collectSlotKeys(nodes: readonly NextRouteTreeNode[]): string[] {
  if (nodes.length === 0) return ["children"];
  return uniqueStrings(
    nodes.map((node) => node.slot ?? defaultSlotForRouter(node.router)),
  );
}

function initialSlotAssignments(
  nodes: readonly NextRouteTreeNode[],
  route: string,
  routePatterns: readonly string[],
): Map<string, string> {
  const assignments = new Map<string, string>();
  const normalizedTarget = normalizeRouteTarget(route, routePatterns);
  const targetLeaves = findLeafNodesForPattern(nodes, normalizedTarget);
  if (!routePatterns.includes(normalizedTarget) || targetLeaves.length === 0) {
    return assignments;
  }
  const primaryLeaf = targetLeaves[0]!;
  const path = ancestorPath(nodes, primaryLeaf.id);
  for (const node of path) {
    const slotKey = node.slot ?? defaultSlotForRouter(node.router);
    assignments.set(slotKey, node.id);
  }
  return assignments;
}

function defaultSlotForRouter(router: NextRouterKind): string {
  return router === "app" ? "children" : "children";
}

function collectPhaseBoundaries(
  nodes: readonly NextRouteTreeNode[],
): NextRouteTreeNode[] {
  return nodes.filter(
    (node) =>
      node.loadingFile !== undefined ||
      node.errorFile !== undefined ||
      node.notFoundFile !== undefined,
  );
}

function findLeafNodesForPattern(
  nodes: readonly NextRouteTreeNode[],
  pattern: string,
): NextRouteTreeNode[] {
  return nodes.filter(
    (node) =>
      (node.kind === "page" || node.kind === "index") &&
      node.pattern === pattern,
  );
}

function ancestorPath(
  nodes: readonly NextRouteTreeNode[],
  leafId: string,
): NextRouteTreeNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: NextRouteTreeNode[] = [];
  let current = byId.get(leafId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function descendantNodeIds(
  nodes: readonly NextRouteTreeNode[],
  rootId: string,
): string[] {
  const childrenByParent = new Map<string, NextRouteTreeNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }
  const ids: string[] = [];
  const visit = (parentId: string): void => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      ids.push(child.id);
      visit(child.id);
    }
  };
  visit(rootId);
  return ids;
}

function decodeNextTreeNode(
  raw: Record<string, Value>,
  route: RouteNode,
): NextRouteTreeNode | undefined {
  const id = stringField(raw, "id");
  const router = stringField(raw, "router");
  const segmentValue = stringField(raw, "segment");
  const segment = segmentValue ?? "";
  const segmentKind = stringField(raw, "segmentKind");
  const kind = stringField(raw, "kind");
  if (!id || !router || segment === undefined || !segmentKind || !kind)
    return undefined;
  if (router !== "app" && router !== "pages") return undefined;

  const params = arrayField(raw, "params")
    .filter(isRecord)
    .flatMap((param) => {
      const name = stringField(param, "name");
      const paramKind = stringField(param, "kind");
      if (!name || !paramKind) return [];
      if (
        paramKind !== "dynamic" &&
        paramKind !== "catch-all" &&
        paramKind !== "optional-catch-all"
      ) {
        return [];
      }
      return [{ name, kind: paramKind as NextParam["kind"] }];
    });

  const interceptRaw = raw.intercept;
  const intercept = isRecord(interceptRaw)
    ? (() => {
        const marker = stringField(interceptRaw, "marker");
        const targetPattern = stringField(interceptRaw, "targetPattern");
        if (
          !marker ||
          !targetPattern ||
          (marker !== "(.)" &&
            marker !== "(..)" &&
            marker !== "(...)" &&
            marker !== "(..)(..)")
        ) {
          return undefined;
        }
        return {
          marker: marker as NextInterceptInfo["marker"],
          targetPattern,
        };
      })()
    : undefined;

  return {
    id,
    router,
    pattern: stringField(raw, "pattern") ?? route.pattern,
    segment,
    segmentKind: segmentKind as NextRouteTreeNode["segmentKind"],
    parentId: stringField(raw, "parentId"),
    slot: stringField(raw, "slot"),
    file: stringField(raw, "file") ?? route.file,
    layoutFile: stringField(raw, "layoutFile"),
    templateFile: stringField(raw, "templateFile"),
    loadingFile: stringField(raw, "loadingFile"),
    errorFile: stringField(raw, "errorFile"),
    defaultFile: stringField(raw, "defaultFile"),
    notFoundFile: stringField(raw, "notFoundFile"),
    routeFile: stringField(raw, "routeFile"),
    apiFile: stringField(raw, "apiFile"),
    groupNames: arrayField(raw, "groupNames").filter(
      (value): value is string => typeof value === "string",
    ),
    params,
    intercept,
    kind: kind as NextRouteTreeNode["kind"],
  };
}

function assignLit(varId: string, value: string): EffectIR {
  return {
    kind: "assign",
    var: varId,
    expr: { kind: "lit", value },
  };
}

function readExpr(varId: string): ExprIR {
  return { kind: "read", var: varId };
}

function lit(value: string): ExprIR {
  return { kind: "lit", value };
}

function eq(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "eq", args: [left, right] };
}

function and(...args: ExprIR[]): ExprIR {
  return args.length === 1 ? args[0]! : { kind: "and", args };
}

function or(...args: ExprIR[]): ExprIR {
  return args.length === 1 ? args[0]! : { kind: "or", args };
}

function normalizeComponentName(component: string): string {
  return component.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function componentRouteKey(componentName: string): string {
  const normalized = normalizeComponentName(componentName);
  return normalized.endsWith("page")
    ? normalized.slice(0, -"page".length)
    : normalized;
}

function fileNameMatchesComponent(normalized: string, file: string): boolean {
  const componentKey = componentRouteKey(normalized);
  const normalizedPath = file.replace(/\\/g, "/");
  const baseKey = normalizeComponentName(
    normalizedPath
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "",
  );
  if (
    componentKey === baseKey ||
    baseKey.endsWith(componentKey) ||
    componentKey.endsWith(baseKey)
  ) {
    return true;
  }

  const pageParentKey = pageRouteParentKey(normalizedPath);
  if (pageParentKey) {
    return (
      componentKey === pageParentKey ||
      componentKey.endsWith(pageParentKey) ||
      pageParentKey.endsWith(componentKey)
    );
  }

  const directoryKey = routeDirectoryKey(normalizedPath);
  if (directoryKey) {
    return (
      componentKey === directoryKey ||
      componentKey.endsWith(directoryKey) ||
      directoryKey.endsWith(componentKey)
    );
  }

  return false;
}

function pageRouteParentKey(file: string): string | undefined {
  if (!/\/page\.(?:tsx|ts|jsx|js|mdx)$/.test(file)) return undefined;
  const parent = file.split("/").slice(-2, -1)[0];
  if (!parent) return undefined;
  const key = normalizeComponentName(parent);
  return key.length > 0 ? key : undefined;
}

function routeDirectoryKey(file: string): string | undefined {
  const parent = file.split("/").slice(-2, -1)[0];
  if (!parent) return undefined;
  const key = normalizeComponentName(parent.replace(/\[.*?\]/g, ""));
  return key.length > 0 ? key : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: Value): value is Record<string, Value> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  record: Record<string, Value>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function arrayField(record: Record<string, Value>, key: string): Value[] {
  const value = record[key];
  return Array.isArray(value) ? [...value] : [];
}
