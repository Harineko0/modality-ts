import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import {
  formatCountValue,
  formatDurationValue,
  formatSummaryRow,
  formatTimeValue,
} from "./output.js";

describe("summary formatting helpers", () => {
  it("formatSummaryRow colorizes the label when color is enabled", () => {
    const plain = formatSummaryRow("Test Files", "2 passed (2)", {
      color: false,
    });
    const colored = formatSummaryRow("Test Files", "2 passed (2)", {
      color: true,
    });
    expect(plain).toBe(" Test Files  2 passed (2)");
    expect(stripAnsi(colored)).toBe(" Test Files  2 passed (2)");
    expect(colored).not.toBe(stripAnsi(colored));
    expect(colored).toContain("2 passed (2)");
  });

  it("formatCountValue preserves plain strings when color is disabled", () => {
    expect(
      formatCountValue({ passed: 2 }, 2, { color: false, leadFailed: true }),
    ).toBe("2 passed (2)");
    expect(
      formatCountValue({ passed: 1, failed: 1 }, 2, {
        color: false,
        leadFailed: true,
      }),
    ).toBe("1 failed | 1 passed (2)");
    expect(
      formatCountValue({ passed: 1, failed: 1, errors: 1, warnings: 1 }, 4, {
        color: false,
      }),
    ).toBe("1 passed, 1 failed, 1 errors, 1 warnings, (4)");
  });

  it("formatCountValue colorizes count segments when color is enabled", () => {
    const colored = formatCountValue(
      { passed: 1, failed: 1, errors: 1, warnings: 1 },
      4,
      { color: true },
    );
    expect(stripAnsi(colored)).toContain("1 passed");
    expect(stripAnsi(colored)).toContain("1 failed");
    expect(stripAnsi(colored)).toContain("1 errors");
    expect(stripAnsi(colored)).toContain("1 warnings");
    expect(stripAnsi(colored)).toContain("(4)");
    expect(colored).not.toBe(stripAnsi(colored));
  });

  it("formatTimeValue colorizes time text when color is enabled", () => {
    const plain = formatTimeValue("19:15:14", { color: false });
    const colored = formatTimeValue("19:15:14", { color: true });
    expect(plain).toBe("19:15:14");
    expect(stripAnsi(colored)).toBe("19:15:14");
    expect(colored).not.toBe("19:15:14");
  });

  it("formatDurationValue colorizes duration and parenthetical breakdown", () => {
    const plain = formatDurationValue("99.82s", "transform 11.87s", {
      color: false,
    });
    const colored = formatDurationValue("99.82s", "transform 11.87s", {
      color: true,
    });
    expect(plain).toBe("99.82s (transform 11.87s)");
    expect(stripAnsi(colored)).toBe("99.82s (transform 11.87s)");
    expect(colored).not.toBe(plain);
  });
});
