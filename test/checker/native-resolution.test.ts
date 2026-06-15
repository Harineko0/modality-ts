import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  candidateNativeFilenames,
  resolveNativeBinaryInDirs,
  type NativeRuntime,
} from "../../src/check/native.js";
import { describe, expect, it } from "vitest";

function touch(dir: string, filename: string): void {
  writeFileSync(join(dir, filename), "");
}

function runtime(
  platform: NodeJS.Platform,
  arch: string,
  libcKind?: "gnu" | "musl",
): NativeRuntime {
  return { platform, arch, libcKind };
}

describe("native binary resolution", () => {
  it("macOS arm64 chooses darwin-arm64 over a Linux file when both exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "modality-native-"));
    touch(dir, "modality-checker.linux-x64-gnu.node");
    touch(dir, "modality-checker.darwin-arm64.node");

    const resolved = resolveNativeBinaryInDirs(
      [dir],
      runtime("darwin", "arm64"),
    );

    expect(resolved).toBe(join(dir, "modality-checker.darwin-arm64.node"));
  });

  it("macOS arm64 does not choose a Linux-only suffixed file", () => {
    const dir = mkdtempSync(join(tmpdir(), "modality-native-"));
    touch(dir, "modality-checker.linux-x64-gnu.node");

    const resolved = resolveNativeBinaryInDirs(
      [dir],
      runtime("darwin", "arm64"),
    );

    expect(resolved).toBeUndefined();
  });

  it("Linux x64 glibc chooses linux-x64-gnu", () => {
    const dir = mkdtempSync(join(tmpdir(), "modality-native-"));
    touch(dir, "modality-checker.linux-x64-gnu.node");

    const resolved = resolveNativeBinaryInDirs(
      [dir],
      runtime("linux", "x64", "gnu"),
    );

    expect(resolved).toBe(join(dir, "modality-checker.linux-x64-gnu.node"));
  });

  it("Windows x64 chooses win32-x64-msvc", () => {
    const dir = mkdtempSync(join(tmpdir(), "modality-native-"));
    touch(dir, "modality-checker.win32-x64-msvc.node");

    const resolved = resolveNativeBinaryInDirs([dir], runtime("win32", "x64"));

    expect(resolved).toBe(join(dir, "modality-checker.win32-x64-msvc.node"));
  });

  it("accepts modality-checker.node as a last fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "modality-native-"));
    touch(dir, "modality-checker.node");

    const resolved = resolveNativeBinaryInDirs(
      [dir],
      runtime("darwin", "arm64"),
    );

    expect(resolved).toBe(join(dir, "modality-checker.node"));
  });

  it("orders exact triple candidates before the unsuffixed fallback", () => {
    const filenames = candidateNativeFilenames(runtime("darwin", "arm64"));
    const darwinArm64 = filenames.indexOf("modality-checker.darwin-arm64.node");
    const unsuffixed = filenames.indexOf("modality-checker.node");
    expect(darwinArm64).toBeGreaterThanOrEqual(0);
    expect(unsuffixed).toBeGreaterThan(darwinArm64);
  });
});
