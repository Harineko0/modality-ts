import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertSerializableProperty,
  type Model,
  type Property,
  type PropertyArtifact,
  type PropertyExport,
  type PropertyFactory,
} from "modality-ts/core";
import {
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  transpileModule,
} from "typescript";

export async function loadProperties(
  model: Model,
  propsPaths: readonly string[],
): Promise<Property[]> {
  const properties = await Promise.all(
    propsPaths.map(async (propsPath) => {
      const modulePath = await importableModulePath(propsPath);
      const module = (await import(
        /* @vite-ignore */ pathToFileURL(modulePath).href
      )) as {
        properties?: PropertyExport;
        propertiesFor?: PropertyFactory;
        default?: readonly Property[] | PropertyArtifact;
      };
      let loaded: readonly Property[];
      if (typeof module.propertiesFor === "function") {
        loaded = module.propertiesFor(model);
      } else if (typeof module.properties === "function") {
        loaded = module.properties(model);
      } else if (module.properties !== undefined) {
        loaded = module.properties;
      } else if (
        module.default &&
        typeof module.default === "object" &&
        !Array.isArray(module.default) &&
        "schemaVersion" in module.default &&
        "properties" in module.default
      ) {
        loaded = [...module.default.properties];
      } else if (Array.isArray(module.default)) {
        loaded = module.default;
      } else {
        loaded = [];
      }
      return loaded.map((property, index) =>
        assertSerializableProperty(property, `${propsPath}[${index}]`),
      );
    }),
  );
  return properties.flat();
}

function normalizedImportCacheKey(path: string): string {
  return resolve(path);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function importCacheFileName(path: string, extension: string): string {
  return `props-${sha256(normalizedImportCacheKey(path))}.${process.pid}.${Date.now()}${extension}`;
}

async function importableModulePath(path: string): Promise<string> {
  const extension = extname(path) || ".mjs";
  if (extension === ".ts") return transpiledTypeScriptModule(path);
  if (!process.env.VITEST) return path;
  const cacheDir = join(process.cwd(), ".modality", "import-cache");
  await mkdir(cacheDir, { recursive: true });
  const copyPath = join(cacheDir, importCacheFileName(path, extension));
  await copyFile(path, copyPath);
  return copyPath;
}

async function transpiledTypeScriptModule(path: string): Promise<string> {
  const cacheDir = join(process.cwd(), ".modality", "import-cache");
  await mkdir(cacheDir, { recursive: true });
  const source = await readFile(path, "utf8");
  const output = transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ScriptTarget.ES2022,
      module: ModuleKind.ES2022,
      moduleResolution: ModuleResolutionKind.NodeNext,
      sourceMap: false,
      verbatimModuleSyntax: true,
    },
  });
  const copyPath = join(cacheDir, importCacheFileName(path, ".mjs"));
  await writeFile(copyPath, output.outputText, "utf8");
  return copyPath;
}
