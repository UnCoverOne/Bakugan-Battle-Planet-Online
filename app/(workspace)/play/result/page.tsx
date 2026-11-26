import type { Metadata } from "next";
import { ManagedSeriesResult } from "../../../../components/routes/ManagedSeriesResult";

export const metadata: Metadata = { title: "Match Result" };
export default function ResultPage() { return <ManagedSeriesResult />; }
