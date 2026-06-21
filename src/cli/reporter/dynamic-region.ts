import cliTruncate from "cli-truncate";
import logUpdate from "log-update";

export interface DynamicRegion {
  update(lines: readonly string[]): void;
  clear(): void;
}

export function createDynamicRegion(): DynamicRegion {
  if (!process.stdout.isTTY) {
    return { update() {}, clear() {} };
  }
  return {
    update(lines: readonly string[]) {
      const cols = process.stdout.columns ?? 80;
      logUpdate(lines.map((l) => cliTruncate(l, cols)).join("\n"));
    },
    clear() {
      logUpdate.clear();
    },
  };
}
