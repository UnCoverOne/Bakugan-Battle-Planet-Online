import type { Metadata } from "next";
import { PersistentResultRoute } from "../../../../components/routes/ManagedSeriesResult";
import { ResultScreen } from "../../../../components/routes/ResultScreen";

export const metadata: Metadata = { title: "Match Result" };
export default function ResultPage() { return <PersistentResultRoute legacy={<ResultScreen />} />; }
