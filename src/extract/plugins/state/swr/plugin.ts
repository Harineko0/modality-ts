import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import { createStateSourcePlugin } from "modality-ts/extract/plugins";
import type {
  ChannelCtxWithTypes,
  DiscoverCtxWithTypes,
} from "../../../engine/ts/plugin-context.js";
import { decodeSwrBinding } from "./decode-binding.js";
import { discoverSwrHooks } from "./discover.js";
import * as harness from "./harness.js";
import { templateForSwrDecl } from "./template.js";
import { discoverSwrReadChannels } from "./writes.js";

export function swrSource(): StateSourcePlugin {
  return createStateSourcePlugin({
    id: "swr",
    version: "0.1.0",
    packageNames: ["swr"],
    discover: (ctx) => {
      const typed = ctx as DiscoverCtxWithTypes;
      return discoverSwrHooks(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
        ctx.typePlugins,
      );
    },
    writeChannels: (ctx) => {
      const typed = ctx as ChannelCtxWithTypes;
      return discoverSwrReadChannels(ctx.sourceText, ctx.fileName, typed.types);
    },
    decodeBinding: decodeSwrBinding,
    template: (decl) => templateForSwrDecl(decl),
    harness,
    conformance: {
      templateProbes: [],
      testedVersions: "swr>=2",
    },
  });
}

export default swrSource;
