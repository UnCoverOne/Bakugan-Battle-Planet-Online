import { OriginalImage } from "@/components/media/OriginalImage";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="empty-page">
      <OriginalImage src="/assets/logo.png" alt="" width="150" height="130" />
      <h1>SCREEN NOT FOUND</h1>
      <p>The shared link may be incomplete, expired, or from an older build.</p>
      <Link className="hex-button red" href="/dashboard">OPEN DASHBOARD</Link>
    </main>
  );
}
