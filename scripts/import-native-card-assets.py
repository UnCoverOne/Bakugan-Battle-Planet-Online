#!/usr/bin/env python3
"""Rebuild native-resolution card faces from the supplied scan archives."""

from __future__ import annotations

import argparse
import io
import re
import zipfile
from pathlib import Path

from PIL import Image

from card_asset_processing import save_card_variants


PATTERN = re.compile(r"(?:_ENG_)?(?P<number>\d+)(?P<printing>[ab]?)_[A-Z]+_(?P<set>BB|BR|AA|EX)(?:\([^)]*\))?\.(?:png|jpe?g)$", re.I)


def target(repo: Path, set_code: str, number: int, printing: str, name: str) -> tuple[Path, Path]:
    code = set_code.lower()
    if set_code == "BB":
        stem = str(number)
        root = repo / "public/assets/cards"
    elif set_code == "BR" and number == 221:
        stem = "br-221-pyravian-ultra" if "Pyravian" in name else "br-221-artulean-ultra"
        root = repo / "public/assets/cards/sets/br"
    else:
        stem = f"{code}-{number}{printing}"
        root = repo / "public/assets/cards/sets" / code
    return root / "full" / f"{stem}.webp", root / "thumb" / f"{stem}.webp"


def import_archives(repo: Path, archives: list[Path]) -> int:
    seen: set[tuple[str, str]] = set()
    imported = 0
    for archive in archives:
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.namelist():
                match = PATTERN.search(Path(member).name)
                if not match:
                    continue
                set_code = match.group("set").upper()
                number = int(match.group("number"))
                printing = match.group("printing").lower()
                key = (set_code, f"{number}{printing}")
                if key in seen:
                    continue
                full, thumb = target(repo, set_code, number, printing, Path(member).name)
                flip = (set_code == "BB" and 138 <= number <= 186) or (
                    set_code == "BR" and 60 <= number <= 76
                ) or (set_code == "AA" and 51 <= number <= 66)
                with bundle.open(member) as source_file, Image.open(io.BytesIO(source_file.read())) as source:
                    save_card_variants(source, full, thumb, flip=flip)
                seen.add(key)
                imported += 1
    print(f"Imported {imported} native card assets")
    return imported


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--archive", type=Path, action="append", required=True)
    args = parser.parse_args()
    import_archives(args.repo.resolve(), [path.resolve() for path in args.archive])


if __name__ == "__main__":
    main()
