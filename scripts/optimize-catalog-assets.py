from pathlib import Path
from PIL import Image
import re

from card_asset_processing import save_card_variants

card_source = Path("/tmp/bbp_cards/Card Images")
seen = set()
for source in sorted(card_source.glob("*.png")):
    match = re.search(r"_ENG_(\d+)_", source.name)
    if not match or int(match.group(1)) in seen:
        continue
    number = int(match.group(1)); seen.add(number)
    with Image.open(source) as image:
        save_card_variants(
            image,
            Path("public/assets/cards/full") / f"{number}.webp",
            Path("public/assets/cards/thumb") / f"{number}.webp",
            flip=138 <= number <= 186,
        )

core_source = Path("/tmp/bbp_cores_v2/Bakucores")
core_output = Path("public/assets/cores/full")
core_output.mkdir(parents=True, exist_ok=True)
for source in sorted(core_source.glob("*.png")):
    number = int(re.search(r"_(\d+)\.png$", source.name).group(1))
    image = Image.open(source).convert("RGBA")
    image.thumbnail((240, 210), Image.Resampling.LANCZOS)
    image.save(core_output / f"{number}.webp", "WEBP", quality=82, method=6)

print(f"Optimized {len(seen)} card scans and 52 BakuCores.")
