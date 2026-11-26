import type { Metadata } from "next";
import { PersistentMatchRoute } from "../../../../components/routes/PersistentPlayRoutes";
import { MatchRuntime } from "../../../../components/routes/MatchRuntime";

export const metadata: Metadata = { title: "Match" };
export default function MatchPage() { return <PersistentMatchRoute><MatchRuntime /></PersistentMatchRoute>; }
