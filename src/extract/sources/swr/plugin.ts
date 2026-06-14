import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import * as harness from "./harness.js";
import { discoverSwrHooks } from "./discover.js";
import { templateForSwrDecl } from "./template.js";
import { discoverSwrReadChannels } from "./writes.js";

export function swrSource(): StateSourcePlugin {
  return {
    id: "swr",
    version: "0.1.0",
    packageNames: ["swr"],
    discover: (ctx) => discoverSwrHooks(ctx.sourceText, ctx.fileName),
    writeChannels: (ctx) =>
      discoverSwrReadChannels(ctx.sourceText, ctx.fileName),
    template: (decl) => templateForSwrDecl(decl),
    harness,
    conformance: {
      templateProbes: [],
      testedVersions: "swr>=2",
    },
  };
}

export default swrSource;
