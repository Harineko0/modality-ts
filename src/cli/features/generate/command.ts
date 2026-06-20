import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emitComponentModalModules } from "../../codegen/component-state.js";
import { defaultAppModelPath, defaultModelPath } from "../../defaults.js";
import {
  buildExtractionModel,
  createExtractDiagnosticsClock,
} from "../../extraction/build-model.js";
import type { GenerateArtifactEntry } from "./output.js";

export interface GenerateCommandOptions {
  sourcePath?: string;
  sourcePaths?: readonly string[];
  appModelPath?: string;
  modelPath?: string;
  configPath?: string;
  packageJsonPath?: string;
  disabledPlugins?: readonly string[];
  effectApis?: readonly string[];
  now?: Date;
}

export interface GenerateTargetResult {
  targetLabel: string;
  moduleCount: number;
  varCount: number;
  transitionCount: number;
  pluginLabels: readonly string[];
  artifacts: readonly GenerateArtifactEntry[];
}

export async function runGenerateCommand(
  options: GenerateCommandOptions,
): Promise<GenerateTargetResult> {
  const clock = createExtractDiagnosticsClock();
  const modelPath = options.modelPath ?? defaultModelPath;
  const appModelPath = options.appModelPath ?? defaultAppModelPath;
  const build = await buildExtractionModel(
    { ...options, modelPath, appModelPath },
    clock,
  );
  const componentModalModules = emitComponentModalModules(
    build.model,
    build.appModelPath,
  );
  for (const modalModule of componentModalModules) {
    await mkdir(dirname(modalModule.path), { recursive: true });
    await writeFile(modalModule.path, modalModule.source, "utf8");
  }
  return {
    targetLabel: build.targetLabel,
    moduleCount: componentModalModules.length,
    varCount: build.varCount,
    transitionCount: build.transitionCount,
    pluginLabels: build.pluginLabels,
    artifacts: componentModalModules.map((modalModule) => ({
      kind: "componentVars" as const,
      path: modalModule.path,
    })),
  };
}
