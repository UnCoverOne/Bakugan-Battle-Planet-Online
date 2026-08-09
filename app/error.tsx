"use client";

import { useEffect } from "react";
import Link from "next/link";

const STALE_ASSET_ERROR =
  /(?:error loading dynamically imported module|failed to fetch dynamically imported module|importing a module script failed|chunkloaderror|loading chunk .* failed)/i;

export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const staleAsset = STALE_ASSET_ERROR.test(error.message ?? "");

  useEffect(() => {
    console.error(
      JSON.stringify({
        event: "route_error",
        digest: error.digest,
        message: error.message,
        staleAsset,
      }),
    );
  }, [error, staleAsset]);

  if (staleAsset) {
    return (
      <main className="empty-page" role="alert">
        <img src="/assets/logo.png" alt="" width="150" height="130" />
        <h1>UPDATE REQUIRED</h1>
        <p>
          This tab is using route files from an older deployment. Refresh once to
          load the current application release. Your saved browser data will not
          be cleared.
        </p>
        <div className="hero-actions">
          <button
            className="hex-button red"
            onClick={() => window.location.reload()}
          >
            REFRESH AND UPDATE
          </button>
          <Link className="hex-button ghost" href="/dashboard">
            DASHBOARD
          </Link>
        </div>
        {error.digest && <small>Support reference: {error.digest}</small>}
      </main>
    );
  }

  return (
    <main className="empty-page" role="alert">
      <img src="/assets/logo.png" alt="" width="150" height="130" />
      <h1>THIS SCREEN COULD NOT LOAD</h1>
      <p>
        Your saved browser data has not been cleared. Retry the screen or return
        to the dashboard.
      </p>
      <div className="hero-actions">
        <button className="hex-button red" onClick={reset}>
          TRY AGAIN
        </button>
        <Link className="hex-button ghost" href="/dashboard">
          DASHBOARD
        </Link>
      </div>
      {error.digest && <small>Support reference: {error.digest}</small>}
    </main>
  );
}
