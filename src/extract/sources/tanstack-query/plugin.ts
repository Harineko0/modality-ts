import type { SourceDecl } from "modality-ts/extract/engine/spi";
import type { StateSourcePlugin } from "modality-ts/extract/engine/spi";
import type { TemplateFragment } from "modality-ts/core";
import * as harness from "./harness.js";
import { discoverTanstackQueryHooks } from "./discover.js";
import {
  createTanstackMutationTemplate,
  templateForTanstackQueryDecl,
} from "./template.js";
import {
  discoverTanstackQuerySafetyWarnings,
  discoverTanstackQueryWriteChannels,
  summarizeTanstackQueryWrite,
} from "./writes.js";
import { mutationMetadataFromRecord } from "./types.js";

export function tanstackQuerySource(): StateSourcePlugin {
  return {
    id: "tanstack-query",
    version: "0.1.0",
    packageNames: ["@tanstack/react-query"],
    discover: (ctx) =>
      discoverTanstackQueryHooks(
        ctx.sourceText,
        ctx.fileName,
        ctx.types,
        ctx.domainRefinements,
      ),
    writeChannels: (ctx) =>
      discoverTanstackQueryWriteChannels(
        ctx.sourceText,
        ctx.fileName,
        ctx.types,
      ),
    safetyWarnings: (ctx) =>
      discoverTanstackQuerySafetyWarnings(
        ctx.sourceText,
        ctx.fileName,
        ctx.types,
      ),
    summarizeWrite: summarizeTanstackQueryWrite,
    template: (decl) => templateForTanstackDecl(decl),
    harness,
    conformance: {
      templateProbes: [],
      testedVersions: "@tanstack/react-query>=5",
    },
  };
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
