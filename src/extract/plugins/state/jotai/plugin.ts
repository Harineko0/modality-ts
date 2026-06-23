import type { EffectIR } from "modality-ts/core";
import type {
  CallSite,
  M0Ctx,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { createStateSourcePlugin } from "modality-ts/extract/plugins";
import type {
  ChannelCtxWithTypes,
  DiscoverCtxWithTypes,
} from "../../../lang/ts/driver/plugin-context.js";
import { decodeJotaiBinding } from "./decode-binding.js";
import { discoverJotaiAtomsDetailed } from "./discover.js";
import * as harness from "./harness.js";
import {
  discoverJotaiSafetyWarnings,
  discoverJotaiWriteChannels,
} from "./writes.js";

export function jotaiSource(): StateSourcePlugin {
  return createStateSourcePlugin({
    id: "jotai",
    version: "0.1.0",
    packageNames: ["jotai"],
    discover: (ctx) => {
      const typed = ctx as DiscoverCtxWithTypes;
      return discoverJotaiAtomsDetailed(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
        ctx.typePlugins,
        ctx.relatedFragments,
      ).decls;
    },
    writeChannels: (ctx) => {
      const typed = ctx as ChannelCtxWithTypes;
      return discoverJotaiWriteChannels(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
      );
    },
    safetyWarnings: (ctx) => {
      const typed = ctx as ChannelCtxWithTypes;
      return discoverJotaiSafetyWarnings(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
      );
    },
    decodeBinding: decodeJotaiBinding,
    summarizeWrite: summarizeJotaiWrite,
    harness,
    conformance: {
      testedVersions: "jotai>=2",
    },
  });
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
