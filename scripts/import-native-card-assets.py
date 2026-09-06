#!/usr/bin/env python3
"""Import native card scans from one or more set archives.

The importer intentionally accepts every published set code instead of
maintaining a separate script per set.  Card files normally carry their set
code in the filename (``..._ENG_12_CO_FF.png``); when a source bundle omits
that suffix, the archive filename is used as a fallback.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

from PIL import Image

from card_asset_processing import save_card_variants


# Keep this list in one place.  Adding a set does not require changing the
# parser or the output layout.
SUPPORTED_SET_CODES = {
    "BB", "BR", "AA", "AV", "FF", "SV", "PS1", "CP", "DI", "EX", "GG",
}

ARCHIVE_SET_ALIASES = {
    "age of aurelus": "AA",
    "armored elite": "AV",
    "bakugan resurgence": "BR",
    "battle brawlers": "BB",
    "cp": "CP",
    "diamond ignition": "DI",
    "diamond": "DI",
    "di": "DI",
    "ex": "EX",
    "fusion force": "FF",
    "geogan generations": "GG",
    "ps1": "PS1",
    "shields of vestroia": "SV",
}

# Official Flip/Flip Hero collector-number ranges.  ``--flip-range`` can add
# or replace a range for a set without editing this script.
DEFAULT_FLIP_RANGES: dict[str, set[int]] = {
    "BB": set(range(138, 187)),
    "BR": set(range(60, 77)),
    "AA": set(range(51, 67)),
    "AV": set(range(61, 76)),
    "FF": set(range(67, 87)),
    "SV": set(range(77, 93)),
}

MEMBER_PATTERN = re.compile(
    r"(?:^|_)ENG_(?P<number>\d{1,3})(?P<printing>[ab]?)_"
    r"[A-Z0-9]+_(?P<set>BB|BR|AA|AV|FF|SV|PS1|CP|DI|EX|GG)"
    r"(?:\([^)]*\))?\.(?:png|jpe?g)$",
    re.IGNORECASE,
)
NUMBER_PATTERN = re.compile(
    r"(?:^|_)ENG_(?P<number>\d{1,3})(?P<printing>[ab]?)_"
    r"[A-Z0-9]+\.(?:png|jpe?g)$",
    re.IGNORECASE,
)


def archive_set_code(archive: Path) -> str | None:
    stem = re.sub(r"\s+card(?: images?)?$", "", archive.stem, flags=re.IGNORECASE)
    normalized = re.sub(r"[^a-z0-9]+", " ", stem.lower()).strip()
    for alias, code in sorted(ARCHIVE_SET_ALIASES.items(), key=lambda item: -len(item[0])):
        if alias in normalized:
            return code
    return None


def parse_member(member: str, archive_code: str | None) -> tuple[str, int, str] | None:
    name = Path(member).name
    match = MEMBER_PATTERN.search(name)
    if match:
        code = match.group("set").upper()
        if code in SUPPORTED_SET_CODES:
            return code, int(match.group("number")), match.group("printing").lower()
        return None
    # Some manually exported bundles omit the final ``_{SET}`` token.  Only
    # accept those files when the archive name identifies a known set.
    if archive_code:
        match = NUMBER_PATTERN.search(name)
        if match:
            return archive_code, int(match.group("number")), match.group("printing").lower()
    return None


def source_slug(name: str) -> str:
    """Turn the human-readable part of a scan filename into an asset slug."""
    stem = name.rsplit("_ENG_", 1)[0]
    stem = re.sub(r"\([^)]*\)", "", stem)
    stem = stem.replace("_", " ")
    return re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")


def target(
    repo: Path,
    set_code: str,
    number: int,
    printing: str,
    name: str,
    asset_stem: str | None = None,
) -> tuple[Path, Path]:
    code = set_code.lower()
    if set_code == "BB":
        stem = str(number)
        root = repo / "public/assets/cards"
    elif set_code == "BR" and number == 221:
        stem = "br-221-pyravian-ultra" if "Pyravian" in name else "br-221-artulean-ultra"
        root = repo / "public/assets/cards/sets/br"
    else:
        stem = asset_stem or f"{code}-{number}{printing}"
        root = repo / "public/assets/cards/sets" / code
    return root / "full" / f"{stem}.webp", root / "thumb" / f"{stem}.webp"


def parse_flip_ranges(values: list[str]) -> dict[str, set[int]]:
    ranges = {code: set(numbers) for code, numbers in DEFAULT_FLIP_RANGES.items()}
    for value in values:
        try:
            code, span = value.split(":", 1)
            start, end = (int(part) for part in span.split("-", 1))
        except ValueError as error:
            raise SystemExit(f"Invalid --flip-range {value!r}; expected CODE:START-END") from error
        code = code.upper()
        if code not in SUPPORTED_SET_CODES or start > end:
            raise SystemExit(f"Invalid --flip-range {value!r}")
        ranges[code] = set(range(start, end + 1))
    return ranges


def import_archives(repo: Path, archives: list[Path], flip_ranges: dict[str, set[int]]) -> int:
    seen: dict[tuple[str, str], tuple[str, str]] = {}
    imported = 0
    duplicates = 0
    counts: Counter[str] = Counter()

    for archive in archives:
        archive_code = archive_set_code(archive)
        with zipfile.ZipFile(archive) as bundle:
            entries: list[tuple[str, tuple[str, int, str]]] = []
            groups: Counter[tuple[str, str]] = Counter()
            for member in bundle.namelist():
                parsed = parse_member(member, archive_code)
                if parsed is None:
                    continue
                set_code, number, printing = parsed
                key = (set_code, f"{number}{printing}")
                entries.append((member, parsed))
                groups[key] += 1

            for member, parsed in entries:
                set_code, number, printing = parsed
                key = (set_code, f"{number}{printing}")
                with bundle.open(member) as source_file:
                    source_bytes = source_file.read()
                digest = hashlib.sha256(source_bytes).hexdigest()
                # Some sets legitimately reuse a collector number for two
                # different cards (for example FF-209). Their catalogue IDs
                # use a name suffix, so resolve the same suffix here.
                asset_stem = None
                if groups[key] > 1 and not (set_code == "BB"):
                    asset_stem = f"{set_code.lower()}-{number}{printing}-{source_slug(Path(member).name)}"
                identity = (set_code, asset_stem or f"{number}{printing}")
                previous = seen.get(identity)
                if previous:
                    duplicates += 1
                    if previous[0] != digest:
                        raise SystemExit(
                            f"Conflicting assets for {identity[0]}-{identity[1]}: "
                            f"{previous[1]} and {archive}:{member}"
                        )
                    continue

                full, thumb = target(repo, set_code, number, printing, Path(member).name, asset_stem)
                flip = number in flip_ranges.get(set_code, set()) or "flip" in Path(member).name.lower()
                with Image.open(io.BytesIO(source_bytes)) as source:
                    save_card_variants(source, full, thumb, flip=flip)
                seen[identity] = (digest, f"{archive}:{member}")
                counts[set_code] += 1
                imported += 1

    print(f"Imported {imported} native card assets across {len(counts)} sets: {dict(sorted(counts.items()))}")
    if duplicates:
        print(f"Skipped {duplicates} identical duplicate entries")
    return imported


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--archive", type=Path, action="append", required=True)
    parser.add_argument(
        "--flip-range",
        action="append",
        default=[],
        metavar="CODE:START-END",
        help="Override a set's Flip collector-number range (repeatable).",
    )
    args = parser.parse_args()
    archives = [path.resolve() for path in args.archive]
    missing = [str(path) for path in archives if not path.is_file()]
    if missing:
        raise SystemExit("Archive not found: " + ", ".join(missing))
    import_archives(args.repo.resolve(), archives, parse_flip_ranges(args.flip_range))


if __name__ == "__main__":
    main()

