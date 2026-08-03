"use client";

const decodedImages = new Map<string, Promise<void>>();
const VIEWPORT_STABLE_EVENT = "bbp-viewport-stable";

function decodeImage(source: string) {
  if (!source || typeof Image === "undefined") return Promise.resolve();
  const cached = decodedImages.get(source);
  if (cached) return cached;

  const pending = new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    const finish = () => {
      if (typeof image.decode === "function") {
        void image.decode().catch(() => undefined).finally(resolve);
      } else {
        resolve();
      }
    };
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
    image.src = source;
    if (image.complete && image.naturalWidth > 0) finish();
  });
  decodedImages.set(source, pending);
  return pending;
}

export function waitForStableViewport(maximumWaitMs = 520) {
  if (typeof document === "undefined" || document.documentElement.dataset.viewportChanging !== "true") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let finished = false;
    const complete = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      window.removeEventListener(VIEWPORT_STABLE_EVENT, complete);
      resolve();
    };
    const timeout = window.setTimeout(complete, maximumWaitMs);
    window.addEventListener(VIEWPORT_STABLE_EVENT, complete, { once: true });
  });
}

/** Decode the exact assets used by a flight and wait for unstable viewport work
 * to finish before committing its first visible frame. */
export async function prepareAnimationAssets(sources: readonly (string | null | undefined)[]) {
  await Promise.all([
    ...[...new Set(sources.filter((source): source is string => Boolean(source)))].map(decodeImage),
    waitForStableViewport(),
  ]);
}
