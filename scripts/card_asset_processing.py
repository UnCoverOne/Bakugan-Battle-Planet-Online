"""Shared deterministic card-image processing primitives."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps


# Full assets preserve the source scan's native dimensions.  The dimensions
# below are only the stable presentation contract for catalogue/tile assets.
THUMB_SIZE = (160, 224)


def _rounded_alpha(size: tuple[int, int]) -> Image.Image:
    mask = Image.new("L", size, 0)
    radius = max(1, round(size[0] * 0.046))
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255
    )
    return mask


def canonical_card(
    source: Image.Image,
    *,
    flip: bool,
    size: tuple[int, int] | None = None,
) -> Image.Image:
    """Return one RGBA portrait canvas representing the physical card.

    A full asset keeps the original scan resolution.  ``size`` remains an
    optional escape hatch for callers that explicitly need a fixed canvas.
    """
    image = ImageOps.exif_transpose(source).convert("RGBA")
    if flip and image.width > image.height:
        image = image.transpose(Image.Transpose.ROTATE_270)
    if size is None:
        size = image.size
    image = ImageOps.contain(image, size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    offset = ((size[0] - image.width) // 2, (size[1] - image.height) // 2)
    canvas.alpha_composite(image, offset)
    canvas.putalpha(ImageChops.multiply(canvas.getchannel("A"), _rounded_alpha(size)))
    return canvas


def save_webp(image: Image.Image, target: Path, quality: int, *, lossless: bool = False) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.unlink(missing_ok=True)
    image.save(temporary, "WEBP", quality=quality, method=0 if lossless else 4, exact=True, lossless=lossless)
    if not temporary.exists() or temporary.stat().st_size == 0:
        raise RuntimeError(f"WebP encoder produced an empty file: {target}")
    temporary.replace(target)


def save_card_variants(source: Image.Image, full: Path, thumb: Path, *, flip: bool) -> None:
    full_image = canonical_card(source, flip=flip)
    thumb_image = canonical_card(full_image, flip=False, size=THUMB_SIZE)
    save_webp(full_image, full, 100, lossless=True)
    save_webp(thumb_image, thumb, 84)
