/** Pagination for each filtered and sorted Deck Builder gallery category. */
export const BUILDER_GALLERY_PAGE_SIZE = 24;

export function paginateBuilderGallery<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize = BUILDER_GALLERY_PAGE_SIZE,
) {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Number.isFinite(requestedPage) ? Math.min(pageCount, Math.max(1, Math.floor(requestedPage))) : 1;
  const start = (page - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    page,
    pageCount,
    start: items.length ? start + 1 : 0,
    end: Math.min(start + safePageSize, items.length),
  };
}
