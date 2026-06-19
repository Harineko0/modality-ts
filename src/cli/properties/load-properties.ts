import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertSerializableProperty,
  type Model,
  type Property,
} from "modality-ts/core";
import {
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  transpileModule,
} from "typescript";
import { rewriteImportedSymbols } from "./resolve-symbols.js";
import { modelWithVarAnchors } from "./var-anchors.js";

const require = createRequire(import.meta.url);

type PropertiesModule = typeof import("modality-ts/properties");

let propertiesModulePromise: Promise<PropertiesModule> | undefined;

function loadPropertiesModule(): Promise<PropertiesModule> {
  propertiesModulePromise ??= import(
    pathToFileURL(require.resolve("modality-ts/properties")).href
  ) as Promise<PropertiesModule>;
  return propertiesModulePromise;
}

export async function loadProperties(
  model: Model,
  propsPaths: readonly string[],
): Promise<Property[]> {
  const { finalizeProperties, harvest, resetRegistry } =
    await loadPropertiesModule();
  const properties: Property[] = [];
  for (const propsPath of propsPaths) {
    resetRegistry();
    const anchoredModel = modelWithVarAnchors(model);
    const { source } = await rewriteImportedSymbols(propsPath, anchoredModel);
    const modulePath = await importableModulePath(propsPath, source);
    await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
    const specs = harvest();
    const finalized = finalizeProperties(anchoredModel, specs);
    properties.push(
      ...finalized.map((property, index) =>
        assertSerializableProperty(property, `${propsPath}[${index}]`),
      ),
    );
  }
  return properties;
}

function normalizedImportCacheKey(path: string, source: string): string {
  return `${resolve(path)}:${source}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function importCacheFileNameForSource(
  path: string,
  source: string,
  extension: string,
): string {
  return `props-${sha256(normalizedImportCacheKey(path, source))}.${process.pid}.${Date.now()}${extension}`;
}

async function importableModulePath(
  path: string,
  source?: string,
): Promise<string> {
  const extension = extname(path) || ".mjs";
  if (extension === ".ts") {
    return transpiledTypeScriptModule(
      path,
      source ?? (await readFile(path, "utf8")),
    );
  }
  if (!process.env.VITEST) return path;
  const rawSource = source ?? (await readFile(path, "utf8"));
  const cacheDir = join(process.cwd(), ".modality", "import-cache");
  await mkdir(cacheDir, { recursive: true });
  const copyPath = join(
    cacheDir,
    importCacheFileNameForSource(path, rawSource, extension),
  );
  await writeFile(copyPath, rewritePackageImports(rawSource), "utf8");
  return copyPath;
}

async function transpiledTypeScriptModule(
  path: string,
  source: string,
): Promise<string> {
  const cacheDir = join(process.cwd(), ".modality", "import-cache");
  await mkdir(cacheDir, { recursive: true });
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
  const transpiled = rewritePackageImports(
    rewriteRelativeImports(output.outputText, dirname(path)),
  );
  const copyPath = join(
    cacheDir,
    importCacheFileNameForSource(path, source, ".mjs"),
  );
  await writeFile(copyPath, transpiled, "utf8");
  return copyPath;
}

function rewritePackageImports(source: string): string {
  const propertiesUrl = pathToFileURL(
    require.resolve("modality-ts/properties"),
  ).href;
  const coreUrl = pathToFileURL(require.resolve("modality-ts/core")).href;
  const varsUrl = pathToFileURL(require.resolve("modality-ts/vars")).href;
  return source
    .replaceAll('"modality-ts/properties"', `"${propertiesUrl}"`)
    .replaceAll("'modality-ts/properties'", `'${propertiesUrl}'`)
    .replaceAll('"modality-ts/core"', `"${coreUrl}"`)
    .replaceAll("'modality-ts/core'", `'${coreUrl}'`)
    .replaceAll('"modality-ts/vars"', `"${varsUrl}"`)
    .replaceAll("'modality-ts/vars'", `'${varsUrl}'`);
}

function rewriteRelativeImports(source: string, baseDir: string): string {
  return source.replace(
    /from\s+["'](\.[^"']+)["']/g,
    (_match, specifier: string) => {
      const resolved = resolve(baseDir, specifier);
      const candidates = [
        resolved,
        `${resolved}.ts`,
        `${resolved}.tsx`,
        `${resolved}.js`,
        `${resolved}.mjs`,
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return `from ${JSON.stringify(pathToFileURL(candidate).href)}`;
        }
      }
      return `from ${JSON.stringify(pathToFileURL(resolved).href)}`;
    },
  );
}
