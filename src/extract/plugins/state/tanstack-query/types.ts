import type { AbstractDomain, ExprIR, Value } from "modality-ts/core";

export type QueryStatus = "pending" | "success" | "error";
export type FetchStatus = "idle" | "fetching" | "paused";
export type MutationStatus = "idle" | "pending" | "success" | "error";

export interface ResolvedQueryKey {
  display: string;
  id: string;
  activeWhen?: ExprIR;
  dynamic?: boolean;
}

export interface QueryOptionsMetadata {
  queryKey: ResolvedQueryKey;
  enabled?: boolean;
  staleTime?: "static" | "infinity" | "default";
  gcTime?: "default" | "infinity";
  retry?: boolean | number;
  refetchOnMount?: boolean;
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
  refetchInterval?: boolean;
  hasInitialData?: boolean;
  hasPlaceholderData?: boolean;
  payloadDomain: AbstractDomain;
  op: string;
  hookKind:
    | "useQuery"
    | "useSuspenseQuery"
    | "useInfiniteQuery"
    | "useSuspenseInfiniteQuery";
  infinite?: boolean;
  selectProjection?: string;
}

export interface MutationOptionsMetadata {
  mutationId: string;
  payloadDomain: AbstractDomain;
  variablesDomain: AbstractDomain;
  op: string;
}

export interface QueryFilterMetadata {
  id: string;
  queryKey?: readonly string[];
  exact?: boolean;
  type?: "active" | "inactive" | "all";
  stale?: boolean;
  fetchStatus?: FetchStatus;
  hasPredicate?: boolean;
}

export interface MutationFilterMetadata {
  id: string;
  mutationKey?: readonly string[];
  status?: MutationStatus;
  hasPredicate?: boolean;
}

export function metadataToRecord(
  metadata: QueryOptionsMetadata | MutationOptionsMetadata,
): Record<string, Value> {
  return metadata as unknown as Record<string, Value>;
}

export function queryMetadataFromRecord(
  metadata: Record<string, Value> | undefined,
): QueryOptionsMetadata | undefined {
  if (
    !metadata ||
    typeof metadata.queryKey !== "object" ||
    metadata.queryKey === null
  ) {
    return undefined;
  }
  return metadata as unknown as QueryOptionsMetadata;
}

export function mutationMetadataFromRecord(
  metadata: Record<string, Value> | undefined,
): MutationOptionsMetadata | undefined {
  if (!metadata || typeof metadata.mutationId !== "string") return undefined;
  return metadata as unknown as MutationOptionsMetadata;
}
