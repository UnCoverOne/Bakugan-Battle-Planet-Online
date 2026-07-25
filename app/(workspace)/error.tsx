"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="empty-page" role="alert"><img src="/assets/logo.png" alt="" /><h1>THIS ROUTE COULD NOT LOAD</h1><p>{error.message || "An unexpected client or route error interrupted this screen."}</p><button className="hex-button red" onClick={reset}>TRY AGAIN</button><Link className="hex-button ghost" href="/dashboard">RETURN TO DASHBOARD</Link></main>;
}
