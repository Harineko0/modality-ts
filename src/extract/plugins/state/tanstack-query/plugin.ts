import type { TemplateFragment } from "modality-ts/core";
import type {
  SourceDecl,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { createStateSourcePlugin } from "modality-ts/extract/plugins";
import type {
  ChannelCtxWithTypes,
  DiscoverCtxWithTypes,
} from "../../../engine/ts/plugin-context.js";
import { discoverTanstackQueryHooks } from "./discover.js";
import * as harness from "./harness.js";
import {
  createTanstackMutationTemplate,
  templateForTanstackQueryDecl,
} from "./template.js";
import { mutationMetadataFromRecord } from "./types.js";
import {
  discoverTanstackQuerySafetyWarnings,
  discoverTanstackQueryWriteChannels,
  summarizeTanstackQueryWrite,
} from "./writes.js";

export function tanstackQuerySource(): StateSourcePlugin {
  return createStateSourcePlugin({
    id: "tanstack-query",
    version: "0.1.0",
    packageNames: ["@tanstack/react-query"],
    discover: (ctx) => {
      const typed = ctx as DiscoverCtxWithTypes;
      return discoverTanstackQueryHooks(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
        ctx.typePlugins,
      );
    },
    writeChannels: (ctx) => {
      const typed = ctx as ChannelCtxWithTypes;
      return discoverTanstackQueryWriteChannels(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
      );
    },
    safetyWarnings: (ctx) => {
      const typed = ctx as ChannelCtxWithTypes;
      return discoverTanstackQuerySafetyWarnings(
        ctx.sourceText,
        ctx.fileName,
        typed.types,
      );
    },
    summarizeWrite: summarizeTanstackQueryWrite,
    template: (decl) => templateForTanstackDecl(decl),
    harness,
    conformance: {
      templateProbes: [],
      testedVersions: "@tanstack/react-query>=5",
    },
  });
}

function templateForTanstackDecl(decl: SourceDecl): TemplateFragment {
  if (decl.kind === "tanstack-query/useMutation") {
    const metadata = mutationMetadataFromRecord(decl.metadata);
    if (!metadata) return { vars: [], transitions: [] };
    return createTanstackMutationTemplate(
      metadata.mutationId,
      metadata.payloadDomain,
      metadata.op,
      decl.origin !== "system" && decl.origin !== "library-template"
        ? decl.origin.file
        : undefined,
    );
  }
  return templateForTanstackQueryDecl(decl);
}

export default tanstackQuerySource;
