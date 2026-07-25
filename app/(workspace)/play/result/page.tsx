import type { Metadata } from "next";
import { MatchRuntime } from "../../../../components/routes/MatchRuntime";
import { ResultScreen } from "../../../../components/routes/PlayRoutes";

export const metadata: Metadata = { title: "Match Result" };
export default function ResultPage() { return <><ResultScreen /><MatchRuntime /></>; }
