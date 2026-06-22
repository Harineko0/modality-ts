import type {
  ComponentRole,
  SurfaceDecl,
} from "modality-ts/extract/engine/spi";

function startsUppercase(value: string): boolean {
  return /^[A-Z]/.test(value);
}

export function componentNameFromSurfaceDecl(
  decl: SurfaceDecl,
): string | undefined {
  if (
    decl.kind === "function" ||
    decl.kind === "component" ||
    decl.kind === "hook"
  ) {
    const name = decl.fn.name;
    return name && startsUppercase(name) ? name : undefined;
  }
  if (decl.kind === "var") {
    for (const binding of decl.bindings) {
      if (startsUppercase(binding.name)) return binding.name;
    }
  }
  return undefined;
}

export function isCustomHookSurfaceDecl(decl: SurfaceDecl): boolean {
  if (decl.kind === "hook") return true;
  const name = componentNameFromSurfaceDecl(decl);
  return name !== undefined && /^use[A-Z]/.test(name);
}

export function classifySurfaceComponent(
  decl: SurfaceDecl,
): ComponentRole | undefined {
  if (isCustomHookSurfaceDecl(decl)) return "custom-hook";
  const name = componentNameFromSurfaceDecl(decl);
  if (name && startsUppercase(name)) return "component";
  return undefined;
}
