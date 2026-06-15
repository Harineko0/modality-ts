import {
  formatMs,
  formatStatusSymbol,
  type OutputOptions,
} from "../../output.js";
import type { InitCommandResult } from "./command.js";

export function renderHumanInitResult(
  result: InitCommandResult,
  durationMs: number,
  options: OutputOptions = {},
): string[] {
  const configName =
    result.configPath.split(/[/\\]/).pop() ?? result.configPath;
  return [
    ` ${formatStatusSymbol("pass", options)} ${configName} ${formatMs(durationMs)}`,
    "  - config created",
  ];
}
