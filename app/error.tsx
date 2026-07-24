"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(JSON.stringify({ event: "route_error", digest: error.digest, message: error.message }));
  }, [error]);
  return (
    <main className="empty-page" role="alert">
      <img src="/assets/logo.png" alt="" width="150" height="130" />
      <h1>THIS SCREEN COULD NOT LOAD</h1>
      <p>Your saved browser data has not been cleared. Retry the screen or return to the dashboard.</p>
      <div className="hero-actions">
        <button className="hex-button red" onClick={reset}>TRY AGAIN</button>
        <Link className="hex-button ghost" href="/dashboard">DASHBOARD</Link>
      </div>
      {error.digest && <small>Support reference: {error.digest}</small>}
    </main>
  );
}
