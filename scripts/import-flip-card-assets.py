#!/usr/bin/env python3
"""Import Flip-family scans using the canonical physical-card asset contract."""

from __future__ import annotations

import argparse
import io
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

from PIL import Image

from card_asset_processing import save_card_variants


MEMBER_PATTERN = re.compile(r"_ENG_(?P<number>\d+)_[A-Z]+_(?P<set>[A-Z0-9]+)\.png(?:\.png)?$", re.I)
EXPECTED = {
    "BB": set(range(138, 187)),
    "BR": set(range(60, 77)),
    "AA": set(range(51, 67)),
    "AV": set(range(61, 76)),  # Flip 61-70 and Flip Hero 71-75.
    "FF": set(range(67, 87)),
    "SV": set(range(77, 93)),
}


def target_paths(repo: Path, set_code: str, number: int) -> tuple[Path, Path]:
    if set_code == "BB":
        root = repo / "public/assets/cards"
        asset_id = str(number)
    else:
        root = repo / "public/assets/cards/sets" / set_code.lower()
        asset_id = f"{set_code.lower()}-{number}"
    return root / "full" / f"{asset_id}.webp", root / "thumb" / f"{asset_id}.webp"


def import_archives(archives: list[Path], repo: Path, allow_missing: bool) -> int:
    imported: dict[tuple[str, int], str] = {}
    for archive in archives:
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.namelist():
                match = MEMBER_PATTERN.search(Path(member).name)
                if not match:
                    continue
                set_code = match.group("set").upper()
                number = int(match.group("number"))
                key = (set_code, number)
                if number not in EXPECTED.get(set_code, set()):
                    continue
                previous = imported.get(key)
                if previous:
                    # Supplemental bundles may intentionally repeat a card.
                    # Accept only byte-identical duplicates.
                    with bundle.open(member) as duplicate_file:
                        duplicate = duplicate_file.read()
                    previous_archive, previous_member = previous.split("::", 1)
                    with zipfile.ZipFile(previous_archive) as previous_bundle:
                        if duplicate != previous_bundle.read(previous_member):
                            raise SystemExit(
                                f"Conflicting Flip assets for {set_code}-{number}: "
                                f"{previous_member} and {member}"
                            )
                    continue
                with bundle.open(member) as source_file, Image.open(io.BytesIO(source_file.read())) as source:
                    full_target, thumb_target = target_paths(repo, set_code, number)
                    save_card_variants(source, full_target, thumb_target, flip=True)
                imported[key] = f"{archive}::{member}"

    missing = {
        f"{set_code}-{number}"
        for set_code, numbers in EXPECTED.items()
        for number in numbers
        if (set_code, number) not in imported
    }
    counts = Counter(set_code for set_code, _ in imported)
    print(f"Imported {len(imported)} Flip-family assets: {dict(sorted(counts.items()))}")
    if missing:
        message = "Missing expected Flip-family scans: " + ", ".join(sorted(missing))
        if not allow_missing:
            raise SystemExit(message)
        print(f"WARNING: {message}", file=sys.stderr)
    return len(imported)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, action="append", required=True)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="Import the supplied subset while reporting every absent catalogue scan.",
    )
    args = parser.parse_args()
    import_archives(
        [archive.resolve() for archive in args.archive],
        args.repo.resolve(),
        args.allow_missing,
    )


if __name__ == "__main__":
    main()
