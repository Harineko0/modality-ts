import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import * as harness from "./harness.js";
import { discoverZustandStoresDetailed } from "./discover.js";
import {
  discoverZustandSafetyWarnings,
  discoverZustandWriteChannels,
  summarizeZustandSetState,
} from "./writes.js";

export function zustandSource(): StateSourcePlugin {
  return {
    id: "zustand",
    version: "0.1.0",
    packageNames: ["zustand"],
    discover: (ctx) =>
      discoverZustandStoresDetailed(ctx.sourceText, ctx.fileName).decls,
    writeChannels: (ctx) =>
      discoverZustandWriteChannels(ctx.sourceText, ctx.fileName),
    safetyWarnings: (ctx) =>
      discoverZustandSafetyWarnings(ctx.sourceText, ctx.fileName),
    summarizeWrite: summarizeZustandSetState,
    harness,
    conformance: {
      testedVersions: "zustand>=4",
    },
  };
}

export default zustandSource;
