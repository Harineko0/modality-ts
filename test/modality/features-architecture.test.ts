import { describe, expect, it } from "vitest";
import { runCheckCommand } from "../../src/modality/features/check/index.js";
import { runCiCommand } from "../../src/modality/features/ci/index.js";
import { runConformCommand } from "../../src/modality/features/conform/index.js";
import { runExportTlaCommand } from "../../src/modality/features/export/index.js";
import { runExtractCommand } from "../../src/modality/features/extract/index.js";
import { runReplayCommand } from "../../src/modality/features/replay/index.js";

describe("modality feature slices", () => {
  it("publish command entry points from feature directories", () => {
    expect(runCheckCommand).toBeTypeOf("function");
    expect(runCiCommand).toBeTypeOf("function");
    expect(runConformCommand).toBeTypeOf("function");
    expect(runExportTlaCommand).toBeTypeOf("function");
    expect(runExtractCommand).toBeTypeOf("function");
    expect(runReplayCommand).toBeTypeOf("function");
  });
});
