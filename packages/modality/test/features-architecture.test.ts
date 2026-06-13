import { describe, expect, it } from "vitest";
import { runCheckCommand } from "../src/features/check/index.js";
import { runCiCommand } from "../src/features/ci/index.js";
import { runConformCommand } from "../src/features/conform/index.js";
import { runExportTlaCommand } from "../src/features/export/index.js";
import { runExtractCommand } from "../src/features/extract/index.js";
import { runReplayCommand } from "../src/features/replay/index.js";

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
