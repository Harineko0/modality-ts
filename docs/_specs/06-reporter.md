# Reporter Layer

The CLI uses a pluggable Reporter layer (`src/cli/reporter/`) that decouples
output mechanics from feature logic.

## Reporter interface

```ts
interface Reporter {
  runTasks<T>(meta: RunMeta, tasks: ReporterTask<T>[]): Promise<TargetOutcome<T>[]>;
  task<T>(title: string, fn: () => Promise<T>): Promise<T>;
  log(lines: readonly string[], opts?: { truncate?: boolean }): void;
  setFooter(lines: readonly string[]): void;
  clearFooter(): void;
}
```

`runTasks` drives a list of labeled tasks with live progress and resolves with
all outcomes in order. `task` runs a single labeled task (for single-shot
commands). `log` is the persistent output surface; `setFooter`/`clearFooter`
manage the dynamic footer region (watch infra, not yet wired to a command).

## Built-in reporters

| Name | Description |
| --- | --- |
| `default` | listr2 task list for multi-target runs, ora spinner for single tasks, picocolors color, cli-truncate for narrow terminals. Auto-degrades on non-TTY. |
| `basic` | Plain sequential output, no color, no dynamic redraw. CI-safe. |
| `json` | Emits a single JSON document to stdout with per-target results after all tasks complete. `log` calls are suppressed. |

Select with `--reporter <name>` (defaults to `default`).

## DRY orchestrator: `runReport`

`src/cli/reporter/run-session.ts` exports `runReport<TEntry>` which:

1. Builds a `ReporterTask[]` and calls `reporter.runTasks` (live tree).
2. After the tree clears, calls `reporter.log(outcome.lines)` for each target.
3. Calls `reporter.log(renderSummary(...))`.

All three multi-target commands (`check`, `extract`, `generate`) use this.

## Design rules

- The reporter module never imports feature slices (`src/cli/features/*`).
  Feature `output.ts` modules own *what* content looks like; reporter owns
  *how/where* it is emitted.
- Two output surfaces must never fight for the terminal simultaneously:
  persistent log (`console.log`) and dynamic region (`log-update`).
- Non-TTY: no color, no dynamic redraw. listr2 auto-falls back to simple
  renderer; ora disables animation; footer is a no-op.

## Color

`src/cli/output.ts` uses `picocolors` via `createColors(true/false)` instances
chosen by `useColor(options)`. The `ANSI` constants and `colorize` function
remain exported for backward compatibility with deprecated render helpers.
