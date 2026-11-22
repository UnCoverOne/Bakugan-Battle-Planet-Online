import type { Metadata } from "next";
import { MatchRuntime } from "../../../../components/routes/MatchRuntime";

export const metadata: Metadata = { title: "Match" };
export default function MatchPage() { return <MatchRuntime />; }
