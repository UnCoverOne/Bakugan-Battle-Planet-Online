import type { Metadata } from "next";
import { MatchRuntime } from "../../../../components/routes/MatchRuntime";
import { MatchHostScreen } from "../../../../components/routes/PlayRoutes";

export const metadata: Metadata = { title: "Match" };
export default function MatchPage() { return <><MatchHostScreen /><MatchRuntime /></>; }
