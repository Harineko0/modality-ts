import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import { createStateSourcePlugin } from "modality-ts/extract/plugins";
import type {
  ChannelCtxWithTypes,
  DiscoverCtxWithTypes,
} from "../../engine/ts/plugin-context.js";
import * as harness from "./harness.js";
import { discoverReduxStoresDetailed } from "./store.js";
import { templateForReduxDecl } from "./template.js";
import {
  discoverReduxSafetyWarnings,
  discoverReduxWriteChannels,
  primeReduxDiscovery,
  summarizeReduxWrite,
} from "./writes.js";

export function reduxSource(): StateSourcePlugin {
  return createStateSourcePlugin({
    id: "redux",
    version: "0.1.0",
    packageNames: ["@reduxjs/toolkit", "react-redux", "redux"],
    discover: (ctx) => {
      const typed = ctx as DiscoverCtxWithTypes;
      return discoverReduxStoresDetailed(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
        ctx.typePlugins,
      ).decls;
    },
    writeChannels: (ctx) => {
      const typed = ctx as ChannelCtxWithTypes;
      primeReduxDiscovery(ctx.sourceText, ctx.fileName, typed.types);
      return discoverReduxWriteChannels(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
      );
    },
    safetyWarnings: (ctx) => {
      const typed = ctx as ChannelCtxWithTypes;
      return discoverReduxSafetyWarnings(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
      );
    },
    summarizeWrite: summarizeReduxWrite,
    template: (decl) => templateForReduxDecl(decl),
    harness,
    conformance: {
      templateProbes: [],
      testedVersions: "@reduxjs/toolkit>=2,react-redux>=9,redux>=5",
    },
  });
}

export default reduxSource;
