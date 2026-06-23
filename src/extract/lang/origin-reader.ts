import type { NodeRef } from "./node-ref.js";

export interface OriginReader {
  nodeAt(ref: NodeRef): unknown | undefined;
}
