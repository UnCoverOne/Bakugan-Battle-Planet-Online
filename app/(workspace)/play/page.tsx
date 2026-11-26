import type { Metadata } from "next";
import { Suspense } from "react";
import { PersistentPlayGuard } from "../../../components/routes/PersistentPlayRoutes";
import { MatchCreationScreen } from "../../../components/routes/MatchCreationScreen";

export const metadata: Metadata = { title: "Play" };

export default function PlayPage() {
  return <Suspense fallback={null}><PersistentPlayGuard><MatchCreationScreen /></PersistentPlayGuard></Suspense>;
}
