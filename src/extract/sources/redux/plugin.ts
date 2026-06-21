import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import * as harness from "./harness.js";
import { discoverReduxStoresDetailed } from "./store.js";
import {
  discoverReduxSafetyWarnings,
  discoverReduxWriteChannels,
  primeReduxDiscovery,
  summarizeReduxWrite,
} from "./writes.js";
import { templateForReduxDecl } from "./template.js";

export function reduxSource(): StateSourcePlugin {
  return {
    id: "redux",
    version: "0.1.0",
    packageNames: ["@reduxjs/toolkit", "react-redux", "redux"],
    discover: (ctx) =>
      discoverReduxStoresDetailed(
        ctx.sourceText,
        ctx.fileName,
        ctx.types,
        ctx.domainRefinements,
      ).decls,
    writeChannels: (ctx) => {
      primeReduxDiscovery(ctx.sourceText, ctx.fileName, ctx.types);
      return discoverReduxWriteChannels(ctx.sourceText, ctx.fileName, ctx.types);
    },
    safetyWarnings: (ctx) =>
      discoverReduxSafetyWarnings(ctx.sourceText, ctx.fileName, ctx.types),
    summarizeWrite: summarizeReduxWrite,
    template: (decl) => templateForReduxDecl(decl),
    harness,
    conformance: {
      templateProbes: [],
      testedVersions: "@reduxjs/toolkit>=2,react-redux>=9,redux>=5",
    },
  };
}

export default reduxSource;
