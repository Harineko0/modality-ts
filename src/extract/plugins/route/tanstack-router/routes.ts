import type {
  AbstractDomain,
  EffectIR,
  ExprIR,
  StateVarDecl,
  Value,
} from "modality-ts/core";
import type {
  LocationLowering,
  NavIntent,
  ResolvedOptions,
  RouteInventory,
  RouteLoweringCtx,
  RouteNode,
} from "modality-ts/extract/engine/spi";
import {
  normalizeRouteTarget,
  routeMountScope,
} from "../../../lang/ts/driver/routes.js";
import { locationEffect } from "../../../lang/ts/driver/transition/navigation.js";
import { routeForComponent } from "./discover.js";

export const TANSTACK_BRANCH_NONE = "__none";

export function tanstackBranchVarId(): string {
  return "sys:tanstack:branch";
}

export function tanstackSearchVarId(routePattern: string, key: string): string {
  const safePattern = routePattern.replace(/[^a-zA-Z0-9]+/g, "_");
  return `sys:tanstack:search:${safePattern}:${key}`;
}

interface DecodedTanstackTreeNode {
  routeId: string;
  fullPath: string;
  parentId?: string;
  pathless: boolean;
  routeKind: RouteNode["kind"];
  filePath?: string;
  component?: string;
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
      role: { kind: "location-current", group: "default" },
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
      role: { kind: "location-history", group: "default" },
      initial: [],
    },
  ];
}

export function routeTreeVars(
  inventory: RouteInventory,
  options: ResolvedOptions,
): readonly StateVarDecl[] {
  const nodes = tanstackTreeNodes(inventory);
  if (nodes.length === 0) return [];

  const routeIds = uniqueStrings(nodes.map((node) => node.routeId));
  const routePatterns = nodes
    .filter((node) => node.routeKind === "page" || node.routeKind === "index")
    .map((node) => node.fullPath);
  const initialBranch = initialBranchForRoute(
    nodes,
    options.route,
    routePatterns,
  );

  const vars: StateVarDecl[] = [
    {
      id: tanstackBranchVarId(),
      domain: { kind: "enum", values: [TANSTACK_BRANCH_NONE, ...routeIds] },
      origin: "system",
      scope: { kind: "global" },
      role: { kind: "tree-slot" },
      initial: initialBranch,
    },
  ];

  for (const searchVar of boundedSearchVars(nodes)) {
    vars.push(searchVar);
  }

  return vars;
}

export function lowerNavigation(
  intent: NavIntent,
  ctx: RouteLoweringCtx,
): {
  effect: EffectIR;
  reads: readonly string[];
  writes: readonly string[];
  confidence: "exact" | "over-approx";
  warnings?: readonly string[];
} {
  const nodes = tanstackTreeNodes(ctx.inventory);
  const branchVar = tanstackBranchVarId();
  const routeValues = ctx.routePatterns;
  const baseReads =
    intent.mode === "push" || intent.mode === "back"
      ? (["sys:route", "sys:history"] as const)
      : (["sys:history"] as const);
  const writes = new Set<string>(["sys:route", "sys:history"]);
  const warnings: string[] = [];

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

  if (nodes.length === 0 || intent.mode === "back" || !intent.to) {
    return {
      effect: effects.length === 1 ? effects[0]! : { kind: "seq", effects },
      reads: [...baseReads],
      writes: [...writes],
      confidence: "exact",
    };
  }

  writes.add(branchVar);
  const normalizedTarget = normalizeRouteTarget(intent.to, ctx.routePatterns);
  const targetNode = findLeafNodeForPattern(nodes, normalizedTarget);
  const targetKnown = ctx.routePatterns.includes(normalizedTarget);

  if (!targetKnown || !targetNode) {
    warnings.push(
      `Dynamic or unknown TanStack navigation target "${intent.to}" over-approximates route-tree branch assignments`,
    );
    const branchDomain = routeTreeVars(ctx.inventory, { route: "/" }).find(
      (decl) => decl.id === branchVar,
    )?.domain;
    const values =
      branchDomain?.kind === "enum"
        ? branchDomain.values.filter((value) => value !== TANSTACK_BRANCH_NONE)
        : [];
    effects.push(
      values.length > 0
        ? {
            kind: "choose",
            var: branchVar,
            among: values.map((value) => ({ kind: "lit", value })),
          }
        : { kind: "havoc", var: branchVar },
    );
    return {
      effect: { kind: "seq", effects },
      reads: [...baseReads, branchVar],
      writes: [...writes],
      confidence: "over-approx",
      warnings,
    };
  }

  const path = ancestorPath(nodes, targetNode.routeId);
  const activeBranch = path.at(-1)?.routeId ?? targetNode.routeId;
  effects.push(assignLit(branchVar, activeBranch));

  return {
    effect: { kind: "seq", effects },
    reads: [...baseReads, branchVar],
    writes: [...writes],
    confidence: "exact",
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export function mountScopeForComponent(
  componentName: string,
  inventory: RouteInventory,
): StateVarDecl["scope"] | undefined {
  const nodes = tanstackTreeNodes(inventory);
  if (nodes.length === 0) return undefined;

  const normalized = normalizeComponentName(componentName);
  const branchVar = tanstackBranchVarId();

  const layoutMatches = nodes.filter(
    (node) =>
      node.routeKind === "layout" &&
      node.filePath !== undefined &&
      fileNameMatchesComponent(normalized, node.filePath),
  );
  if (layoutMatches.length === 1) {
    const layout = layoutMatches[0]!;
    const descendantIds = descendantRouteIds(nodes, layout.routeId);
    return {
      kind: "mount-local",
      id: `tanstack:layout:${layout.routeId}`,
      when: or(
        eq(readExpr(branchVar), lit(layout.routeId)),
        ...descendantIds.map((id) => eq(readExpr(branchVar), lit(id))),
      ),
    };
  }
  if (layoutMatches.length > 1) return undefined;

  const pageMatches = nodes.filter(
    (node) =>
      (node.routeKind === "page" || node.routeKind === "index") &&
      node.filePath !== undefined &&
      fileNameMatchesComponent(normalized, node.filePath),
  );
  if (pageMatches.length === 1) {
    const page = pageMatches[0]!;
    return {
      kind: "mount-local",
      id: `tanstack:page:${page.routeId}`,
      when: eq(readExpr("sys:route"), lit(page.fullPath)),
    };
  }

  const componentMatches = nodes.filter(
    (node) =>
      node.component !== undefined &&
      normalizeComponentName(node.component) === normalized,
  );
  if (componentMatches.length === 1) {
    const node = componentMatches[0]!;
    if (node.routeKind === "layout") {
      const descendantIds = descendantRouteIds(nodes, node.routeId);
      return {
        kind: "mount-local",
        id: `tanstack:layout:${node.routeId}`,
        when: or(
          eq(readExpr(branchVar), lit(node.routeId)),
          ...descendantIds.map((id) => eq(readExpr(branchVar), lit(id))),
        ),
      };
    }
    if (node.routeKind === "page" || node.routeKind === "index") {
      return {
        kind: "mount-local",
        id: `tanstack:page:${node.routeId}`,
        when: eq(readExpr("sys:route"), lit(node.fullPath)),
      };
    }
  }

  const pattern = routeForComponent(componentName, inventory);
  if (pattern) return routeMountScope(pattern);
  return undefined;
}

function tanstackTreeNodes(
  inventory: RouteInventory,
): readonly DecodedTanstackTreeNode[] {
  const nodes: DecodedTanstackTreeNode[] = [];
  for (const route of inventory.routes) {
    const raw = route.metadata?.tanstackRouteTree;
    if (raw === undefined || !isRecord(raw)) continue;
    const routeId = stringField(raw, "routeId") ?? route.pattern;
    nodes.push({
      routeId,
      fullPath: stringField(raw, "fullPath") ?? route.pattern,
      ...(stringField(raw, "parentId")
        ? { parentId: stringField(raw, "parentId") }
        : {}),
      pathless: raw.pathless === true,
      routeKind: route.kind,
      ...(route.file ? { filePath: route.file } : {}),
      ...(stringField(raw, "component")
        ? { component: stringField(raw, "component") }
        : {}),
    });
  }
  return inferParentIds(nodes);
}

function inferParentIds(
  nodes: DecodedTanstackTreeNode[],
): DecodedTanstackTreeNode[] {
  const layouts = nodes.filter(
    (node) => node.routeKind === "layout" && node.filePath,
  );
  return nodes.map((node) => {
    if (node.parentId || !node.filePath) return node;
    const fileName = node.filePath.split("/").pop() ?? "";
    const dotPrefix = fileName.includes(".")
      ? fileName.split(".")[0]
      : undefined;
    if (!dotPrefix?.startsWith("_")) return node;
    const parent = layouts.find((layout) => {
      const layoutFile = layout.filePath?.split("/").pop() ?? "";
      return layoutFile.replace(/\.[^.]+$/, "") === dotPrefix;
    });
    return parent ? { ...node, parentId: parent.routeId } : node;
  });
}

function boundedSearchVars(
  nodes: readonly DecodedTanstackTreeNode[],
): StateVarDecl[] {
  const vars: StateVarDecl[] = [];
  for (const node of nodes) {
    if (node.routeKind !== "page" && node.routeKind !== "index") continue;
    // Bounded search vars are added when static search keys are known from overlays.
    // Inventory-only discovery does not yet surface validateSearch schemas.
    void node;
  }
  return vars;
}

function initialBranchForRoute(
  nodes: readonly DecodedTanstackTreeNode[],
  route: string,
  routePatterns: readonly string[],
): string {
  const normalized = normalizeRouteTarget(route, routePatterns);
  const leaf = findLeafNodeForPattern(nodes, normalized);
  if (!leaf || !routePatterns.includes(normalized)) return TANSTACK_BRANCH_NONE;
  const path = ancestorPath(nodes, leaf.routeId);
  return path.at(-1)?.routeId ?? leaf.routeId;
}

function findLeafNodeForPattern(
  nodes: readonly DecodedTanstackTreeNode[],
  pattern: string,
): DecodedTanstackTreeNode | undefined {
  const matches = nodes.filter(
    (node) =>
      (node.routeKind === "page" || node.routeKind === "index") &&
      node.fullPath === pattern,
  );
  return matches.length === 1 ? matches[0] : matches[0];
}

function ancestorPath(
  nodes: readonly DecodedTanstackTreeNode[],
  leafId: string,
): DecodedTanstackTreeNode[] {
  const byId = new Map(nodes.map((node) => [node.routeId, node]));
  const path: DecodedTanstackTreeNode[] = [];
  const visiting = new Set<string>();
  let current = byId.get(leafId);
  while (current) {
    if (visiting.has(current.routeId)) break;
    visiting.add(current.routeId);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function descendantRouteIds(
  nodes: readonly DecodedTanstackTreeNode[],
  rootId: string,
): string[] {
  const childrenByParent = new Map<string, DecodedTanstackTreeNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }
  const ids: string[] = [];
  const visiting = new Set<string>();
  const visit = (parentId: string): void => {
    if (visiting.has(parentId)) return;
    visiting.add(parentId);
    for (const child of childrenByParent.get(parentId) ?? []) {
      ids.push(child.routeId);
      visit(child.routeId);
    }
    visiting.delete(parentId);
  };
  visit(rootId);
  return ids;
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

function or(...args: ExprIR[]): ExprIR {
  return args.length === 1 ? args[0]! : { kind: "or", args };
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeComponentName(component: string): string {
  return component.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function fileNameMatchesComponent(normalized: string, file: string): boolean {
  const base = normalizeComponentName(
    file
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "",
  );
  return (
    normalized === base ||
    base.endsWith(normalized) ||
    normalized.endsWith(base)
  );
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
