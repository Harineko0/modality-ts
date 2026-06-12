import { readFile } from "node:fs/promises";
import { applyOverlay, type Model, type OverlayMergeResult, type OverlaySpec } from "@modality/kernel";

export async function loadAndApplyOverlay(model: Model, overlayPath: string | undefined): Promise<OverlayMergeResult> {
  if (!overlayPath) return { model, warnings: [], errors: [] };
  const overlay = JSON.parse(await readFile(overlayPath, "utf8")) as OverlaySpec;
  return applyOverlay(model, overlay);
}
