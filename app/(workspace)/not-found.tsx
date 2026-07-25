import Link from "next/link";

export default function WorkspaceNotFound() {
  return <main className="empty-page"><img src="/assets/logo.png" alt="" /><h1>ROUTE NOT FOUND</h1><p>The requested deck, reference, replay, or workspace route is unavailable.</p><Link className="hex-button red" href="/dashboard">RETURN TO DASHBOARD</Link></main>;
}
