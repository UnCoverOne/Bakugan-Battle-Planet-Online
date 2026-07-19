/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function withCacheHeaders(response: Response, cacheControl: string) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", cacheControl);
  headers.set("cdn-cache-control", cacheControl);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isFingerprintedAsset(pathname: string) {
  return /(?:^|[._-])[a-f0-9]{8,}(?:[._-]|$)/i.test(pathname);
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (
      request.method === "GET"
      && (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.svg" || url.pathname === "/sw.js")
    ) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) {
        const immutable = isFingerprintedAsset(url.pathname) && url.pathname !== "/sw.js";
        return withCacheHeaders(
          asset,
          immutable
            ? "public, max-age=31536000, immutable"
            : "public, max-age=0, must-revalidate",
        );
      }
    }

    const response = await handler.fetch(request, env, ctx);
    const contentType = response.headers.get("content-type") ?? "";
    if (request.method === "GET" && (contentType.includes("text/html") || contentType.includes("text/x-component"))) {
      return withCacheHeaders(response, "no-cache, max-age=0, must-revalidate");
    }
    return response;
  },
};

export default worker;
