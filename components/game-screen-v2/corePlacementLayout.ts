export const CORE_PLACEMENT_MATRIX_BASE_WIDTH_REM = 38;
export const CORE_PLACEMENT_MATRIX_BASE_HEIGHT_REM = 42.6;
export const CORE_PLACEMENT_MATRIX_SAFE_INSET_PX = 10;

export function corePlacementMatrixScale({
  containerWidthPx,
  containerHeightPx,
  rootFontSizePx,
}: {
  containerWidthPx: number;
  containerHeightPx: number;
  rootFontSizePx: number;
}) {
  const availableWidth = containerWidthPx - CORE_PLACEMENT_MATRIX_SAFE_INSET_PX * 2;
  const availableHeight = containerHeightPx - CORE_PLACEMENT_MATRIX_SAFE_INSET_PX * 2;
  if (availableWidth <= 0 || availableHeight <= 0 || rootFontSizePx <= 0) return null;

  const next = Math.min(
    1,
    availableWidth / (CORE_PLACEMENT_MATRIX_BASE_WIDTH_REM * rootFontSizePx),
    availableHeight / (CORE_PLACEMENT_MATRIX_BASE_HEIGHT_REM * rootFontSizePx),
  );
  return Number.isFinite(next) && next > 0 ? next : null;
}
