from pathlib import Path
from PIL import Image
import re

card_source = Path("/tmp/bbp_cards/Card Images")
card_output = Path("public/assets/cards/full")
card_output.mkdir(parents=True, exist_ok=True)
seen = set()
for source in sorted(card_source.glob("*.png")):
    match = re.search(r"_ENG_(\d+)_", source.name)
    if not match or int(match.group(1)) in seen:
        continue
    number = int(match.group(1)); seen.add(number)
    image = Image.open(source).convert("RGB")
    image.thumbnail((360, 505), Image.Resampling.LANCZOS)
    image.save(card_output / f"{number}.webp", "WEBP", quality=72, method=6)

core_source = Path("/tmp/bbp_cores_v2/Bakucores")
core_output = Path("public/assets/cores/full")
core_output.mkdir(parents=True, exist_ok=True)
for source in sorted(core_source.glob("*.png")):
    number = int(re.search(r"_(\d+)\.png$", source.name).group(1))
    image = Image.open(source).convert("RGBA")
    image.thumbnail((240, 210), Image.Resampling.LANCZOS)
    image.save(core_output / f"{number}.webp", "WEBP", quality=82, method=6)

print(f"Optimized {len(seen)} card scans and 52 BakuCores.")
