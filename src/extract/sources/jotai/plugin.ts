import type {
  CallSite,
  M0Ctx,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import type { EffectIR } from "modality-ts/core";
import * as harness from "./harness.js";
import { discoverJotaiAtomsDetailed } from "./discover.js";
import {
  discoverJotaiSafetyWarnings,
  discoverJotaiWriteChannels,
} from "./writes.js";
import { decodeJotaiBinding } from "./decode-binding.js";

export function jotaiSource(): StateSourcePlugin {
  return {
    id: "jotai",
    version: "0.1.0",
    packageNames: ["jotai"],
    discover: (ctx) =>
      discoverJotaiAtomsDetailed(
        ctx.sourceText,
        ctx.fileName,
        ctx.types,
        ctx.domainRefinements,
        ctx.relatedFragments,
      ).decls,
    writeChannels: (ctx) =>
      discoverJotaiWriteChannels(ctx.sourceText, ctx.fileName, ctx.types),
    safetyWarnings: (ctx) =>
      discoverJotaiSafetyWarnings(ctx.sourceText, ctx.fileName, ctx.types),
    decodeBinding: decodeJotaiBinding,
    summarizeWrite: summarizeJotaiWrite,
    harness,
    conformance: {
      testedVersions: "jotai>=2",
    },
  };
}

function summarizeJotaiWrite(
  call: CallSite,
  _ctx: M0Ctx,
): EffectIR | "unsupported" {
  if (call.callee.endsWith(".setShouldRemove")) {
    return { kind: "seq", effects: [] };
  }
  return "unsupported";
}

export default jotaiSource;
