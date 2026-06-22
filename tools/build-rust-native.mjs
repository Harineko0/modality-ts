#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const rustTargets = new Map([
  ["darwin:x64", "x86_64-apple-darwin"],
  ["darwin:arm64", "aarch64-apple-darwin"],
  ["linux:x64", "x86_64-unknown-linux-gnu"],
  ["linux:arm64", "aarch64-unknown-linux-gnu"],
  ["win32:x64", "x86_64-pc-windows-msvc"],
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const target = rustTargets.get(`${process.platform}:${process.arch}`);
if (!target) {
  throw new Error(
    `Native modality-checker build is not configured for ${process.platform}/${process.arch}.`,
  );
}

const rustup = spawnSync("rustup", ["target", "add", target], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (rustup.error && rustup.error.code !== "ENOENT") {
  throw rustup.error;
}
if (rustup.status !== 0 && rustup.error?.code !== "ENOENT") {
  process.exit(rustup.status ?? 1);
}

run("napi", [
  "build",
  "--platform",
  "--release",
  "--cargo-cwd",
  "crates/checker",
  "native",
  "--target",
  target,
]);
