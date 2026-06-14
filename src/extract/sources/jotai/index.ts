import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import * as harness from "./harness.js";
import { discoverJotaiAtoms } from "./discover.js";
import {
  discoverJotaiSafetyWarnings,
  discoverJotaiWriteChannels,
} from "./writes.js";

export function jotaiSource(): StateSourcePlugin {
  return {
    id: "jotai",
    version: "0.1.0",
    packageNames: ["jotai"],
    discover: (ctx) => discoverJotaiAtoms(ctx.sourceText, ctx.fileName),
    writeChannels: (ctx) =>
      discoverJotaiWriteChannels(ctx.sourceText, ctx.fileName),
    safetyWarnings: (ctx) =>
      discoverJotaiSafetyWarnings(ctx.sourceText, ctx.fileName),
    harness,
    conformance: {
      testedVersions: "jotai>=2",
    },
  };
}

export default jotaiSource;
