import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { applyOverlay, defineOverlay, type Model, type OverlayBuilder, type OverlayMergeResult, type OverlaySpec } from "modality-ts/kernel";

export async function loadAndApplyOverlay(model: Model, overlayPath: string | undefined): Promise<OverlayMergeResult> {
  if (!overlayPath) return { model, warnings: [], errors: [], ignoredVars: [] };
  const overlay = await loadOverlaySpec(model, overlayPath);
  return applyOverlay(model, overlay);
}

export async function loadOverlaySpec(model: Model, overlayPath: string): Promise<OverlaySpec> {
  if (extname(overlayPath) === ".json") {
    return JSON.parse(await readFile(overlayPath, "utf8")) as OverlaySpec;
  }
  const module = (await import(`${pathToFileURL(overlayPath).href}?t=${Date.now()}`)) as {
    default?: OverlaySpec | OverlayBuilder | ((model: Model) => OverlaySpec | OverlayBuilder | Promise<OverlaySpec | OverlayBuilder>);
    overlay?: OverlaySpec | OverlayBuilder | ((model: Model) => OverlaySpec | OverlayBuilder | Promise<OverlaySpec | OverlayBuilder>);
    spec?: OverlaySpec | OverlayBuilder;
  };
  const exported = module.default ?? module.overlay ?? module.spec ?? {};
  const value = typeof exported === "function" ? await exported(model) : exported;
  return defineOverlay(value);
}
