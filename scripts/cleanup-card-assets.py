#!/usr/bin/env python3
"""Report or remove card files that are not referenced by the application.

The default mode is a read-only report. Pass ``--apply`` to remove files under
``public/assets/cards`` that are not referenced by repository source files.
"""

from __future__ import annotations

import argparse
import bisect
import re
from pathlib import Path
from urllib.parse import unquote


ASSET_ROOT = Path("public/assets/cards")
TEXT_SUFFIXES = {
    ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".mts",
    ".svg", ".ts", ".tsx", ".txt", ".vue", ".yaml", ".yml",
}
ASSET_REFERENCE = re.compile(
    r"(?:/|\\)assets(?:/|\\)cards(?:/|\\)(?P<path>[A-Za-z0-9_@().%+\-/\\]+)",
    re.IGNORECASE,
)
PUBLIC_REFERENCE = re.compile(
    r"public(?:/|\\)assets(?:/|\\)cards(?:/|\\)(?P<path>[A-Za-z0-9_@().%+\-/\\]+)",
    re.IGNORECASE,
)
ROW_ID = re.compile(r'\["(?P<id>[a-z0-9-]+)",', re.IGNORECASE)
SCAN_FILENAME = re.compile(
    r'(?P<svg>@svg/)?(?P<scan>[A-Za-z0-9_!+\-(). ]+_ENG_\d+[ab]?_[A-Z0-9]+_[A-Z0-9]+'
    r'(?:\([^)]*\))?\.(?:png|jpe?g))',
    re.IGNORECASE,
)
DEFAULT_KEEP = {"card-missing.svg"}


def normalise_reference(raw: str) -> str:
    value = unquote(raw.replace("\\", "/")).split("?", 1)[0].split("#", 1)[0]
    return value.lstrip("/")


def referenced_assets(repo: Path) -> set[str]:
    references: set[str] = set()
    ignored = {".git", "node_modules", "dist", ".next", ".wrangler"}
    for path in repo.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if ignored.intersection(path.relative_to(repo).parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for pattern in (ASSET_REFERENCE, PUBLIC_REFERENCE):
            for match in pattern.finditer(text):
                reference = normalise_reference(match.group("path"))
                references.add(reference)
                # CardArt derives thumbnail URLs from the referenced full URL
                # with a runtime ``/full/`` -> ``/thumb/`` replacement.
                if reference.startswith("full/"):
                    references.add(reference.replace("full/", "thumb/", 1))
                elif "/full/" in reference:
                    references.add(reference.replace("/full/", "/thumb/", 1))

        # Extension-set records construct their URLs at runtime from the row
        # ID (for example ``aa-1``) and scan filename, so there is no literal
        # ``/assets/cards/...`` string for the text scanner to find. Pair each
        # generated row ID with its scan filename and mark both variants.
        if "lib/content/generated" in path.relative_to(repo).as_posix():
            row_positions = [(match.start(), match.group("id")) for match in ROW_ID.finditer(text)]
            for scan_match in SCAN_FILENAME.finditer(text):
                index = bisect.bisect_right([position for position, _ in row_positions], scan_match.start()) - 1
                if index < 0:
                    continue
                card_id = row_positions[index][1]
                set_code = card_id.split("-", 1)[0].lower()
                if set_code == "bb":
                    number_match = re.match(r"bb-(\d+)", card_id)
                    if number_match:
                        full = f"full/{number_match.group(1)}.webp"
                    else:
                        continue
                else:
                    extension = "svg" if scan_match.group("svg") else "webp"
                    full = f"sets/{set_code}/full/{card_id}.{extension}"
                references.add(full)
                references.add(full.replace("/full/", "/thumb/", 1) if "/full/" in full else full.replace("full/", "thumb/", 1))
    return references


def find_unused(repo: Path, keep: set[str]) -> tuple[list[Path], int, set[str]]:
    root = repo / ASSET_ROOT
    if not root.is_dir():
        raise SystemExit(f"Asset directory not found: {root}")
    references = referenced_assets(repo)
    unused: list[Path] = []
    total_bytes = 0
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        if relative in keep or path.name in keep:
            continue
        if relative not in references:
            unused.append(path)
            total_bytes += path.stat().st_size
    return sorted(unused), total_bytes, references


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--keep",
        action="append",
        default=[],
        help="Filename or relative card-asset path/glob to preserve (repeatable).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Delete the reported files. Without this flag the script is read-only.",
    )
    args = parser.parse_args()
    repo = args.repo.resolve()
    keep = DEFAULT_KEEP | set(args.keep)
    unused, total_bytes, references = find_unused(repo, keep)

    print(f"Referenced card assets: {len(references)}")
    print(f"Unused card assets: {len(unused)} ({total_bytes / 1024 / 1024:.2f} MiB)")
    if not unused:
        print("Nothing to clean.")
        return
    for path in unused:
        print(f"{'DELETE' if args.apply else 'would delete'} {path.relative_to(repo)}")
    if not args.apply:
        print("Preview only. Re-run with --apply after reviewing the list.")
        return
    for path in unused:
        path.unlink()
    print(f"Deleted {len(unused)} unused card assets ({total_bytes / 1024 / 1024:.2f} MiB).")


if __name__ == "__main__":
    main()

