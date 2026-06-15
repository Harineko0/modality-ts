import type { Property } from "modality-ts/core";

export type SerializedProperty = Property;

export function serializeProperties(
  properties: readonly Property[],
): SerializedProperty[] {
  return [...properties];
}
