import type { Value } from "modality-ts/core";
import type { RouteKind } from "modality-ts/extract/engine/spi";

export type TanstackDiscoveryMode = "file" | "generated" | "code";

export type TanstackSegmentKind =
  | "static"
  | "dynamic"
  | "splat"
  | "pathless"
  | "index";

export interface TanstackRouteTreeNode {
  routeId: string;
  fullPath: string;
  filePath?: string;
  parentId?: string;
  segmentKind: TanstackSegmentKind;
  routeKind: RouteKind;
  pathless?: boolean;
  fromGeneratedTree?: boolean;
  discoveryMode: TanstackDiscoveryMode;
  component?: string;
}

export function tanstackRouteTreeToMetadata(
  node: TanstackRouteTreeNode,
): Record<string, Value> {
  const record: Record<string, Value> = {
    routeId: node.routeId,
    fullPath: node.fullPath,
    segmentKind: node.segmentKind,
    routeKind: node.routeKind,
    discoveryMode: node.discoveryMode,
  };
  if (node.filePath) record.filePath = node.filePath;
  if (node.parentId) record.parentId = node.parentId;
  if (node.pathless) record.pathless = true;
  if (node.fromGeneratedTree) record.fromGeneratedTree = true;
  if (node.component) record.component = node.component;
  return record;
}
