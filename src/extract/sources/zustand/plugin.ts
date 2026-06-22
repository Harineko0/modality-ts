import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import { createStateSourcePlugin } from "modality-ts/extract/plugins";
import type {
  ChannelCtxWithTypes,
  DiscoverCtxWithTypes,
} from "../../engine/ts/plugin-context.js";
import { discoverZustandStoresDetailed } from "./discover.js";
import * as harness from "./harness.js";
import {
  discoverZustandSafetyWarnings,
  discoverZustandWriteChannels,
  summarizeZustandSetState,
} from "./writes.js";

export function zustandSource(): StateSourcePlugin {
  return createStateSourcePlugin({
    id: "zustand",
    version: "0.1.0",
    packageNames: ["zustand"],
    discover: (ctx) => {
      const typed = ctx as DiscoverCtxWithTypes;
      return discoverZustandStoresDetailed(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
        ctx.typePlugins,
      ).decls;
    },
    writeChannels: (ctx) => {
      const typed = ctx as ChannelCtxWithTypes;
      return discoverZustandWriteChannels(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
      );
    },
    safetyWarnings: (ctx) =>
      discoverZustandSafetyWarnings(ctx.sourceText, ctx.fileName),
    summarizeWrite: summarizeZustandSetState,
    harness,
    conformance: {
      testedVersions: "zustand>=4",
    },
  });
}

export default zustandSource;
