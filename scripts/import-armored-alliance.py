#!/usr/bin/env python3
"""Import the supplied Armored Alliance-era card spreadsheets and scans.

The source PDFs are Google Sheets printouts scaled onto a single page.  PyMuPDF
retains their text coordinates, so each record can be reconstructed by using
the collector-number cell as the vertical centre of a row and clipping the
known spreadsheet columns.  This script emits the compact TypeScript tuples
consumed by lib/content/card-set-extensions.ts and repository-sized WebP art.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
import unicodedata
import zipfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import fitz
from PIL import Image

from card_asset_processing import save_card_variants


FACTIONS = {"Aquos", "Pyrus", "Darkus", "Haos", "Ventus", "Aurelus"}
TYPES = {"Action", "Flip", "Flip Hero", "Hero", "Baku-Gear", "Evo", "Character"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


@dataclass(frozen=True)
class Source:
    code: str
    pdf: Path | None
    archives: tuple[Path, ...]
    columns: tuple[float, ...]


def clean(value: str) -> str:
    value = value.replace("\u00a0", " ").replace("\r", "")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    return value.strip()


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value))


def normalized_name(value: str) -> str:
    value = value.replace("&", "x")
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower())


def integer(value: str) -> int | None:
    match = re.search(r"-?\d+", value.replace(",", ""))
    return int(match.group()) if match else None


def collector_from_filename(filename: str, code: str) -> tuple[str, str] | None:
    base = Path(filename).name
    patterns = (
        rf"_ENG_(\d+[ab]?)_([A-Z]+)_{code}(?:_Rev\d+|_PROMO)?(?:\(\d+\))?(?:\.png)?\.[^.]+$",
        rf"_(\d+[ab]?)_([A-Z]+)_{code}(?:\(\d+\))?\.[^.]+$",
        rf"_ENG_(\d+[ab]?)_{code}(?:\(\d+\))?\.[^.]+$",
    )
    for pattern in patterns:
        match = re.search(pattern, base, re.I)
        if match:
            return match.group(1).lower(), (match.group(2).upper() if match.lastindex and match.lastindex > 1 else "CC")
    return None


def image_name(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"(?:_ENG)?_\d+[ab]?(?:_[A-Z]+)?_[A-Z]+(?:_Rev\d+|_PROMO)?(?:\(\d+\))?$", "", stem, flags=re.I)
    stem = re.sub(r"_\((Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus|Diamond)_Card\)$", "", stem, flags=re.I)
    return clean(stem.replace("_", " ").replace(" x ", " & "))


def archive_images(source: Source) -> list[dict[str, str]]:
    images: list[dict[str, str]] = []
    for archive in source.archives:
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.namelist():
                if Path(member).suffix.lower() not in IMAGE_SUFFIXES:
                    continue
                collector = collector_from_filename(member, source.code)
                if not collector:
                    continue
                token, rarity = collector
                images.append({
                    "archive": str(archive),
                    "member": member,
                    "filename": Path(member).name,
                    "collector": token,
                    "rarity": rarity,
                    "name": image_name(member),
                })
    return images


def row_centres(page: fitz.Page) -> list[tuple[str, float]]:
    candidates: list[tuple[str, float]] = []
    for word in page.get_text("words"):
        x0, top, x1, bottom, text = word[:5]
        if 35.8 <= x0 < 39.5 and x1 < 40.1 and 41 < top < 700 and re.fullmatch(r"\d+[ab]?", text, re.I):
            candidates.append((text.lower(), (top + bottom) / 2))
    candidates.sort(key=lambda item: item[1])
    return candidates


def cell_text(words: list[tuple], x0: float, y0: float, x1: float, y1: float) -> str:
    selected = [word for word in words if x0 <= (word[0] + word[2]) / 2 < x1 and y0 <= (word[1] + word[3]) / 2 < y1]
    selected.sort(key=lambda word: (round(word[1], 1), word[0]))
    lines: list[list[str]] = []
    line_tops: list[float] = []
    for word in selected:
        if not lines or abs(word[1] - line_tops[-1]) > 0.45:
            lines.append([word[4]])
            line_tops.append(word[1])
        else:
            lines[-1].append(word[4])
    return clean("\n".join(" ".join(line) for line in lines))


def parse_pdf(source: Source) -> list[dict[str, object]]:
    assert source.pdf
    document = fitz.open(source.pdf)
    page = document[0]
    centres = row_centres(page)
    words = page.get_text("words")
    rows: list[dict[str, object]] = []
    for index, (collector, centre) in enumerate(centres):
        y0 = 41.9 if index == 0 else (centres[index - 1][1] + centre) / 2
        y1 = 700 if index + 1 == len(centres) else (centre + centres[index + 1][1]) / 2
        values = [cell_text(words, source.columns[i], y0, source.columns[i + 1], y1) for i in range(len(source.columns) - 1)]
        number, rarity, name, faction, faction_two, card_type, cost, effect, power, damage, armor, core_one, core_two, evolves = values
        number = clean(number).splitlines()[0] if number else collector
        if number.lower() != collector:
            number = collector
        faction = next((item for item in faction.split() if item in FACTIONS), faction)
        faction_two = next((item for item in faction_two.split() if item in FACTIONS), "")
        card_type = card_type.replace("Baku- Gear", "Baku-Gear").replace("Flip\nHero", "Flip Hero").replace("\n", " ")
        if card_type == "Gear":
            card_type = "Baku-Gear"
        elif not card_type:
            card_type = "Character"
        card_type = next((item for item in TYPES if item.lower() == clean(card_type).lower()), clean(card_type))
        rows.append({
            "collector": collector,
            "number": int(re.match(r"\d+", collector).group()),
            "rarity": clean(rarity).splitlines()[0],
            "name": clean(name).replace("\n", " "),
            "faction": faction,
            "factionTwo": faction_two,
            "type": card_type,
            "cost": "X" if clean(cost).upper() == "X" else (integer(cost) if integer(cost) is not None else 0),
            "effect": effect,
            "power": integer(power),
            "damage": integer(damage),
            "armor": integer(armor),
            "coreOne": clean(core_one).splitlines()[0] if core_one else "",
            "coreTwo": clean(core_two).splitlines()[0] if core_two else "",
            "evolves": clean(evolves).replace("\n", " "),
        })
    return rows


def choose_scan(row: dict[str, object], candidates: list[dict[str, str]], used: set[tuple[str, str]]) -> dict[str, str] | None:
    target = normalized_name(str(row["name"]))
    faction = str(row["faction"]).lower()
    rarity = str(row["rarity"]).upper()
    ranked: list[tuple[int, dict[str, str]]] = []
    for candidate in candidates:
        key = (candidate["archive"], candidate["member"])
        if key in used or candidate["collector"] != row["collector"]:
            continue
        name = normalized_name(candidate["name"])
        score = 0
        if target and (target in name or name in target):
            score += 100
        if candidate["rarity"] == rarity:
            score += 20
        if faction in candidate["filename"].lower():
            score += 10
        if not re.search(r"\(\d+\)|_Rev\d+", candidate["filename"], re.I):
            score += 3
        ranked.append((score, candidate))
    if not ranked:
        # Duplicate catalogue rows (notably the two AV Silent Spears entries)
        # can legitimately share one supplied scan.
        ranked = []
        for candidate in candidates:
            if candidate["collector"] != row["collector"]:
                continue
            name = normalized_name(candidate["name"])
            if target and (target in name or name in target):
                ranked.append((100 + (20 if candidate["rarity"] == rarity else 0), candidate))
        if not ranked:
            return None
    ranked.sort(key=lambda item: (item[0], item[1]["filename"]), reverse=True)
    selected = ranked[0][1]
    used.add((selected["archive"], selected["member"]))
    return selected


def dedupe_unmatched(images: list[dict[str, str]], used: set[tuple[str, str]]) -> list[dict[str, str]]:
    best: dict[tuple[str, str, str], dict[str, str]] = {}
    used_semantic = {
        (image["collector"], image["rarity"], normalized_name(image["name"]))
        for image in images
        if (image["archive"], image["member"]) in used
    }
    for image in images:
        if (image["archive"], image["member"]) in used:
            continue
        key = (image["collector"], image["rarity"], normalized_name(image["name"]))
        if key in used_semantic:
            continue
        current = best.get(key)
        if current is None or ("(" in current["filename"] and "(" not in image["filename"]) or ("_Rev" in current["filename"] and "_Rev" not in image["filename"]):
            best[key] = image
    return list(best.values())


def scan_only_row(code: str, image: dict[str, str]) -> dict[str, object]:
    name = image["name"]
    faction_matches = re.findall(r"Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus", image["filename"], re.I)
    faction = faction_matches[-1].title() if faction_matches else "Aurelus"
    collector = image["collector"]
    card_type = "Character" if code in {"FF", "SV", "CP"} else "Baku-Gear"
    if code in {"FF", "SV"} and (
        re.match(r"^(?:\[Diamond\]|Diamond|Hyper|Titan|Maximus)\b", name, re.I)
        or "Diamond_Card" in image["filename"]
    ):
        card_type = "Evo"
    return {
        "collector": collector,
        "number": int(re.match(r"\d+", collector).group()),
        "rarity": image["rarity"],
        "name": name,
        "faction": faction,
        "factionTwo": "",
        "type": card_type,
        "cost": 0,
        "effect": "",
        "power": 0 if card_type == "Character" else None,
        "damage": 0 if card_type == "Character" else None,
        "armor": 0 if card_type == "Baku-Gear" else None,
        "coreOne": "",
        "coreTwo": "",
        "evolves": "",
        "scan": image,
    }


def assign_ids(code: str, rows: list[dict[str, object]]) -> None:
    counts = Counter(str(row["collector"]) for row in rows)
    seen: defaultdict[str, int] = defaultdict(int)
    for row in rows:
        collector = str(row["collector"])
        base = f"{code.lower()}-{collector}"
        if counts[collector] == 1:
            row["id"] = base
            continue
        suffix = slugify(str(row["name"])) or str(row["rarity"]).lower()
        candidate = f"{base}-{suffix}"
        seen[candidate] += 1
        if seen[candidate] > 1:
            candidate += f"-{str(row['rarity']).lower()}"
        row["id"] = candidate


def apply_known_scan_overrides(code: str, rows: list[dict[str, object]]) -> None:
    """Fill records that exist only as scans rather than spreadsheet rows."""
    overrides: dict[str, dict[str, object]] = {}
    if code == "AV":
        overrides = {
            "157": {"faction": "Ventus", "cost": 6, "power": 1000, "damage": 7, "effect": "When you play this, destroy a Baku-Gear.", "evolves": "Ventus Howlkor Ultra [AV]"},
        }
    elif code == "CP":
        overrides = {
            "1": {"faction": "Pyrus", "power": 600, "damage": 8, "coreOne": "FF", "coreTwo": "FF"},
            "2": {"faction": "Aquos", "power": 400, "damage": 4, "coreOne": "FF", "coreTwo": "FF", "effect": "[SD]: +4 [Damage]."},
            "3": {"faction": "Aurelus", "power": 300, "damage": 6, "coreOne": "FF", "coreTwo": "FF", "effect": "[HE]: +500 [B] and -5 [Damage]."},
            "4": {"faction": "Darkus", "power": 700, "damage": 2, "coreOne": "SD", "coreTwo": "SD", "effect": "[FT]: +3 [Damage] and [ShadowStrike]."},
            "5": {"faction": "Haos", "power": 300, "damage": 6, "coreOne": "MS", "coreTwo": "MS", "effect": "[FF]: +500 [B]."},
            "6": {"faction": "Ventus", "power": 500, "damage": 5, "coreOne": "SD", "coreTwo": "SD", "effect": "[FT]: +300 [B] and [ShadowStrike]."},
        }
    elif code == "DI":
        overrides = {
            "1": {"faction": "Aquos", "factionTwo": "Aurelus", "cost": 3, "power": 200, "damage": 1, "effect": "[Victor]: +1 Armor."},
            "2": {"faction": "Ventus", "factionTwo": "Aurelus", "cost": 4, "power": 500, "damage": 3},
            "3": {"faction": "Darkus", "factionTwo": "Aurelus", "cost": 3, "power": 200, "damage": 2, "effect": "[ShadowStrike]."},
            "5": {"faction": "Pyrus", "factionTwo": "Aurelus", "cost": 7, "power": 900, "damage": 9, "effect": "[Victor]: +1 Armor.\n+2 [FrostStrike] and [ShadowStrike]."},
        }
    elif code == "FF":
        overrides = {
            "155a": {"name": "Hydorous & Trhyno Ultra", "faction": "Aquos", "factionTwo": "Aurelus", "cost": 2, "power": 500, "damage": 2, "coreOne": "MS", "coreTwo": "FT"},
            "183a": {"name": "Pegatrix & Goreene", "faction": "Haos", "factionTwo": "Aurelus", "cost": 5, "power": 500, "damage": 4, "coreOne": "MS", "coreTwo": "FF"},
            "183b": {"name": "Pegatrix & Goreene", "faction": "Haos", "factionTwo": "Aurelus", "cost": 5, "power": 1000, "damage": 6, "coreOne": "MS", "coreTwo": "FF"},
            "203a": {"name": "Trox & Nobilious Ultra", "faction": "Ventus", "factionTwo": "Aurelus", "power": 500, "damage": 3, "coreOne": "MS", "coreTwo": "HE", "effect": "8 [Energy]: <Fusion>."},
            "206a": {"name": "Howlkor & Ramparian", "faction": "Haos", "factionTwo": "Pyrus", "cost": 5, "power": 600, "damage": 1, "coreOne": "HE", "coreTwo": "FT", "effect": "+1 [FrostStrike]."},
            "206b": {"name": "Howlkor & Ramparian", "faction": "Haos", "factionTwo": "Pyrus", "cost": 5, "power": 900, "damage": 3, "coreOne": "HE", "coreTwo": "FT"},
            "207a": {"name": "Pegatrix & Gillator", "faction": "Aquos", "factionTwo": "Ventus", "cost": 8, "power": 200, "damage": 7, "coreOne": "SD", "coreTwo": "SD"},
            "207b": {"name": "Pegatrix & Gillator", "faction": "Aquos", "factionTwo": "Ventus", "cost": 8, "power": 1000, "damage": 20, "coreOne": "SD", "coreTwo": "SD"},
            "210a": {"name": "Howlkor & Ramparian", "faction": "Aquos", "factionTwo": "Aurelus", "power": 100, "damage": 5, "coreOne": "HE", "coreTwo": "HE", "effect": "3 [Energy]: <Fusion>."},
            "211a": {"name": "Pegatrix & Gillator", "faction": "Pyrus", "factionTwo": "Aurelus", "cost": 4, "power": 200, "damage": 4, "coreOne": "MS", "coreTwo": "SD"},
            "211b": {"name": "Pegatrix & Gillator", "faction": "Pyrus", "factionTwo": "Aurelus", "cost": 4, "power": 1000, "damage": 5, "coreOne": "MS", "coreTwo": "SD"},
            "240": {"name": "Pharol", "faction": "Ventus", "power": 500, "damage": 5, "coreOne": "HE", "coreTwo": "FT", "effect": "Boost: If you have seven or more Energy cards in play, +5 [Damage]."},
            "241": {"name": "Tretorous Ultra", "faction": "Ventus", "power": 700, "damage": 2, "coreOne": "MS", "coreTwo": "SD", "effect": "While this has a Baku-Gear attached to it, +6 [Damage] and +1 [ShadowStrike]."},
        }
    elif code == "SV":
        overrides = {
            "141": {"faction": "Pyrus", "cost": 5, "power": 1500, "damage": 3, "effect": "This gets +[ShadowStrike] if you have a <Fusion> Bakugan on your team."},
            "149": {"faction": "Pyrus", "factionTwo": "Aurelus", "cost": 5, "power": 1600, "damage": 4, "evolves": "Pyrus Aurelus Pharol & Gillator Ultra [SV]"},
        }
    for row in rows:
        override = overrides.get(str(row["collector"]))
        if override:
            row.update(override)


def emit_typescript(repo: Path, code: str, rows: list[dict[str, object]], chunk_size: int = 55) -> None:
    generated = repo / "lib/content/generated"
    generated.mkdir(parents=True, exist_ok=True)
    chunks = [rows[i:i + chunk_size] for i in range(0, len(rows), chunk_size)]
    for index, chunk in enumerate(chunks, 1):
        constant = f"{code}_ROWS" if len(chunks) == 1 else f"{code}_ROWS_{index}"
        tuples = []
        for row in chunk:
            collector = str(row["collector"])
            fusion_face = collector[-1] if collector.endswith(("a", "b")) else ""
            fusion_pair = f"{code.lower()}-{collector[:-1]}" if fusion_face else ""
            scan = row.get("scan")
            filename = scan["filename"] if isinstance(scan, dict) else ""
            values = [
                row["id"], row["number"], row["rarity"], row["name"], row["faction"], row["type"], row["cost"],
                row["effect"], row["power"], row["damage"], row["coreOne"], row["coreTwo"], row["evolves"], filename,
                row["factionTwo"], row["armor"], collector, fusion_pair, fusion_face,
            ]
            tuples.append(json.dumps(values, ensure_ascii=False, separators=(",", ":")))
        body = 'import type { ExtensionCardRow } from "../card-set-extensions";\n\n'
        body += f"export const {constant} = [\n  " + ",\n  ".join(tuples) + "\n] as const satisfies readonly ExtensionCardRow[];\n"
        target = generated / (f"{code.lower()}.ts" if len(chunks) == 1 else f"{code.lower()}-{index}.ts")
        target.write_text(body)


def convert_scans(repo: Path, code: str, rows: list[dict[str, object]]) -> None:
    root = repo / "public/assets/cards/sets" / code.lower()
    full = root / "full"
    thumb = root / "thumb"
    full.mkdir(parents=True, exist_ok=True)
    thumb.mkdir(parents=True, exist_ok=True)
    by_archive: defaultdict[str, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        scan = row.get("scan")
        if isinstance(scan, dict):
            by_archive[scan["archive"]].append(row)
    jobs: list[tuple[Path, Path, Path, bool]] = []
    with tempfile.TemporaryDirectory(prefix=f"bakugan-{code.lower()}-") as temporary:
        temporary_path = Path(temporary)
        for archive, archive_rows in by_archive.items():
            with zipfile.ZipFile(archive) as bundle:
                for row in archive_rows:
                    scan = row["scan"]
                    extracted = temporary_path / f"{row['id']}{Path(scan['member']).suffix.lower()}"
                    with bundle.open(scan["member"]) as source_file, extracted.open("wb") as target_file:
                        shutil.copyfileobj(source_file, target_file)
                    jobs.append((
                        extracted,
                        full / f"{row['id']}.webp",
                        thumb / f"{row['id']}.webp",
                        row.get("type") in {"Flip", "Flip Hero"},
                    ))
        def convert(job: tuple[Path, Path, Path, bool]) -> None:
            extracted, full_target, thumb_target, flip = job
            with Image.open(extracted) as image:
                save_card_variants(image, full_target, thumb_target, flip=flip)
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(convert, jobs))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--recovered", type=Path, required=True)
    parser.add_argument("--skip-images", action="store_true")
    args = parser.parse_args()
    upload = args.sources
    recovered = args.recovered
    sources = (
        Source("AV", upload / "Bakugan Armored Elite Cards and Descriptions(1).pdf", (upload / "Armored Elite Card Images(1).zip",), (36, 39, 45, 58, 64.3, 70.5, 75.5, 79.15, 115.5, 119.55, 124.5, 124.5, 129, 133, 149)),
        Source("FF", upload / "Bakugan Fusion Force Cards and Descriptions(1).pdf", (upload / "Fusion Force Card Images(2).zip",), (36, 39.4, 46, 59.5, 65.3, 71.5, 77, 80.25, 116.55, 120.65, 125.65, 125.65, 130.2, 134.2, 150)),
        Source("SV", upload / "Bakugan Shields of Vestoria Cards and Descriptions(1).pdf", (recovered / "Shields of Vestroia Card Images 1.zip", recovered / "Shields of Vestroia Card Images 2.zip"), (36, 39, 44.3, 56.9, 62, 67.7, 72.6, 75.55, 108.9, 112.6, 117.3, 121.5, 125.6, 129.2, 144)),
        Source("PS1", upload / "Bakugan Blind Box 1 (PS1) Cards and Descriptions(1).pdf", (recovered / "PS1 Card Images(1).zip",), (36, 39, 46, 59.5, 66.7, 66.7, 71.8, 75.1, 111.3, 115.5, 120.4, 120.4, 125, 129, 145)),
        Source("CP", None, (upload / "CP Card Images(2).zip",), ()),
        Source("DI", None, (upload / "DI Card Images(2).zip",), ()),
    )
    for source in sources:
        images = archive_images(source)
        rows = parse_pdf(source) if source.pdf else []
        used: set[tuple[str, str]] = set()
        for row in rows:
            scan = choose_scan(row, images, used)
            if scan:
                row["scan"] = scan
        unmatched = dedupe_unmatched(images, used)
        if not source.pdf:
            rows.extend(scan_only_row(source.code, image) for image in unmatched)
        elif source.code in {"FF", "SV"}:
            rows.extend(scan_only_row(source.code, image) for image in unmatched)
        apply_known_scan_overrides(source.code, rows)
        assign_ids(source.code, rows)
        emit_typescript(args.repo, source.code, rows)
        if not args.skip_images:
            scan_count = sum(1 for row in rows if "scan" in row)
            print(f"{source.code}: converting {scan_count} scans...", flush=True)
            convert_scans(args.repo, source.code, rows)
        missing = sum(1 for row in rows if "scan" not in row)
        print(f"{source.code}: {len(rows)} rows, {len(rows) - missing} scans, {missing} without scans, {len(unmatched)} unmatched source scans")


if __name__ == "__main__":
    main()
