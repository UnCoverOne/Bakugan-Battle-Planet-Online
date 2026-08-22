import { OriginalImage } from "@/components/media/OriginalImage";
import Link from "next/link";

export const metadata = {
  title: "Offline | Bakugan Battle Planet Online",
  description: "Reconnect or continue with device-local Bakugan Battle Planet data.",
};

export default function OfflinePage() {
  return (
    <main className="empty-page">
      <OriginalImage src="/assets/logo.png" alt="" width="150" height="130" />
      <h1>YOU ARE OFFLINE</h1>
      <p>Saved decks and drafts remain available when this browser permits device storage. Account sync and ruling submissions will resume after reconnecting.</p>
      <div className="hero-actions">
        <Link className="hex-button red" href="/dashboard">TRY AGAIN</Link>
        <Link className="hex-button ghost" href="/decks">OPEN LOCAL DECKS</Link>
      </div>
    </main>
  );
}
