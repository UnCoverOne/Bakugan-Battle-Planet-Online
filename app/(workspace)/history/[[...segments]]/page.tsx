import type { Metadata } from "next";
import { HistoryScreen } from "../../../../components/routes/HistoryScreen";

export const metadata: Metadata = { title: "History & Replay" };
export default async function HistoryPage({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { segments = [] } = await params;
  return <HistoryScreen recordId={segments[0] ? decodeURIComponent(segments[0]) : undefined} />;
}
