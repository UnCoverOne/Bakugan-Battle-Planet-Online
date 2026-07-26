import { redirect } from "next/navigation";

export default async function HistoryRedirect({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { segments = [] } = await params;
  redirect(segments[0] ? `/profile/records/${encodeURIComponent(segments[0])}` : "/profile/records");
}
