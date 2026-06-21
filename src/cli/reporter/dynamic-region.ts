import cliTruncate from "cli-truncate";
import logUpdate from "log-update";

export interface DynamicRegion {
  update(lines: readonly string[]): void;
  commit(lines: readonly string[]): void;
  clear(): void;
}

export function createDynamicRegion(): DynamicRegion {
  if (!process.stdout.isTTY) {
    return {
      update() {},
      commit(lines: readonly string[]) {
        for (const line of lines) process.stdout.write(`${line}\n`);
      },
      clear() {},
    };
  }
  return {
    update(lines: readonly string[]) {
      const cols = process.stdout.columns ?? 80;
      logUpdate(lines.map((l) => cliTruncate(l, cols)).join("\n"));
    },
    commit(lines: readonly string[]) {
      logUpdate.clear();
      for (const line of lines) process.stdout.write(`${line}\n`);
    },
    clear() {
      logUpdate.clear();
    },
  };
}
