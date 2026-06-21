import { BasicReporter } from "./basic.js";
import { DefaultReporter } from "./default.js";
import { JsonReporter } from "./json.js";
import type { Reporter } from "./types.js";

export type {
  Reporter,
  ReporterTask,
  RunMeta,
  StatusKind,
  TargetOutcome,
} from "./types.js";
export { runReport } from "./run-session.js";

export function createReporter(name: string): Reporter {
  switch (name) {
    case "basic":
      return new BasicReporter();
    case "json":
      return new JsonReporter();
    default:
      return new DefaultReporter();
  }
}
