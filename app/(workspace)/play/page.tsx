import type { Metadata } from "next";
import { Suspense } from "react";
import { MatchCreationScreen } from "../../../components/routes/MatchCreationScreen";

export const metadata: Metadata = { title: "Play" };

export default function PlayPage() {
  return <Suspense fallback={null}><MatchCreationScreen /></Suspense>;
}
