#!/usr/bin/env python3
"""Relocate built-in plugin implementations into src/extract/plugins/* and fix imports.

Three passes:
  A. git mv directories per DIR_MOVES.
  B. Recompute relative imports inside MOVED files (they gain one dir level / shared moves).
  C. Token-replace `extract/<old>` -> `extract/<new>` across all text files (package
     specifiers, package.json keys/dist paths, docs, and relative imports that embed
     the `extract/` segment in non-moved files).
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

REPO = Path("/Users/hari/proj/modality-ts")
SRC_EXTRACT = REPO / "src" / "extract"

# old extract-relative dir -> new extract-relative dir
DIR_MOVES = {
    "sources/use-state": "plugins/state/use-state",
    "sources/jotai": "plugins/state/jotai",
    "sources/swr": "plugins/state/swr",
    "sources/zustand": "plugins/state/zustand",
    "sources/tanstack-query": "plugins/state/tanstack-query",
    "sources/redux": "plugins/state/redux",
    "sources/router": "plugins/route/router",
    "sources/next": "plugins/route/next",
    "sources/tanstack-router": "plugins/route/tanstack-router",
    "sources/react-hook-form": "plugins/framework/react-hook-form",
    "sources/shared": "plugins/shared",
    "frameworks/react": "plugins/framework/react",
    "effect-models/timers": "plugins/effect/timers",
    "effect-models/websocket": "plugins/effect/websocket",
    "type-libraries/zod": "plugins/type/zod",
    "type-libraries/arktype": "plugins/type/arktype",
}

# single files to move (parent of which is otherwise emptied)
FILE_MOVES = {
    "effect-models/index.ts": "plugins/effect/index.ts",
}

# token-replace map (extract-relative path segments), longest-first
TOKEN_MOVES = dict(DIR_MOVES)
TOKEN_MOVES["effect-models"] = "plugins/effect"  # bare index ref


def run(*args: str) -> None:
    subprocess.run(args, cwd=REPO, check=True)


def collect_moved_files() -> dict[Path, Path]:
    """Return mapping of NEW abs path -> OLD abs path for every moved file."""
    mapping: dict[Path, Path] = {}
    for old_rel, new_rel in DIR_MOVES.items():
        old_dir = SRC_EXTRACT / old_rel
        new_dir = SRC_EXTRACT / new_rel
        for root, _dirs, files in os.walk(old_dir):
            for f in files:
                old_path = Path(root) / f
                rel = old_path.relative_to(old_dir)
                mapping[(new_dir / rel)] = old_path
    for old_rel, new_rel in FILE_MOVES.items():
        mapping[SRC_EXTRACT / new_rel] = SRC_EXTRACT / old_rel
    return mapping


def abs_dir_move_map() -> list[tuple[Path, Path]]:
    """Longest-first list of (old_abs_dir, new_abs_dir)."""
    pairs = [
        (SRC_EXTRACT / o, SRC_EXTRACT / n) for o, n in DIR_MOVES.items()
    ]
    pairs.sort(key=lambda p: len(str(p[0])), reverse=True)
    return pairs


def map_abs_path(target: Path, pairs: list[tuple[Path, Path]]) -> Path:
    s = str(target)
    for old_abs, new_abs in pairs:
        prefix = str(old_abs)
        if s == prefix or s.startswith(prefix + os.sep):
            return Path(new_abs / Path(s[len(prefix):].lstrip(os.sep)))
    return target


IMPORT_RE = re.compile(
    r'(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["\'])(\.[^"\']*)(["\'])'
)
# also handle `import("...")` inside type positions: import("../x.js")
DYNAMIC_RE = re.compile(r'(import\()(["\'])(\.[^"\']*)(["\'])')


def recompute_file(new_path: Path, old_path: Path,
                   pairs: list[tuple[Path, Path]]) -> None:
    text = new_path.read_text()
    old_dir = old_path.parent
    new_dir = new_path.parent

    def fix_spec(spec: str) -> str:
        # resolve against OLD dir
        target = Path(os.path.normpath(old_dir / spec))
        mapped = map_abs_path(target, pairs)
        rel = os.path.relpath(mapped, new_dir)
        if not rel.startswith("."):
            rel = "./" + rel
        return rel

    def repl(m: re.Match) -> str:
        spec = m.group(3)
        return f"{m.group(1)}{m.group(2)}{fix_spec(spec)}{m.group(4)}"

    new_text = IMPORT_RE.sub(repl, text)
    # also bare import("...") forms in type annotations
    new_text = DYNAMIC_RE.sub(repl, new_text)
    if new_text != text:
        new_path.write_text(new_text)


def token_replace_all() -> None:
    items = sorted(TOKEN_MOVES.items(), key=lambda kv: len(kv[0]), reverse=True)
    exts = {".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".html", ".mts", ".cts"}
    roots = [REPO / "src", REPO / "test", REPO / "docs", REPO / "examples"]
    files = [REPO / "package.json"]
    for r in roots:
        for root, _dirs, fs in os.walk(r):
            if "node_modules" in root or "/dist" in root or "/build" in root:
                continue
            for f in fs:
                if Path(f).suffix in exts:
                    files.append(Path(root) / f)
    for path in files:
        try:
            text = path.read_text()
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        orig = text
        for old, new in items:
            text = text.replace(f"extract/{old}", f"extract/{new}")
        if text != orig:
            path.write_text(text)


def main() -> None:
    moved = collect_moved_files()
    pairs = abs_dir_move_map()

    # Pass A: filesystem moves
    for old_rel, new_rel in DIR_MOVES.items():
        old_dir = SRC_EXTRACT / old_rel
        new_dir = SRC_EXTRACT / new_rel
        new_dir.parent.mkdir(parents=True, exist_ok=True)
        run("git", "mv", str(old_dir), str(new_dir))
    for old_rel, new_rel in FILE_MOVES.items():
        old_f = SRC_EXTRACT / old_rel
        new_f = SRC_EXTRACT / new_rel
        new_f.parent.mkdir(parents=True, exist_ok=True)
        run("git", "mv", str(old_f), str(new_f))

    # Pass B: recompute relative imports inside moved files
    for new_path, old_path in moved.items():
        if new_path.suffix in {".ts", ".tsx"}:
            recompute_file(new_path, old_path, pairs)

    # Pass C: token replace across repo
    token_replace_all()

    print("done")


if __name__ == "__main__":
    main()
