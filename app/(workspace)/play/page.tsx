import type { Metadata } from "next";
import { Suspense } from "react";
import { PlayScreen } from "../../../components/routes/PlayRoutes";

export const metadata: Metadata = { title: "Play" };

export default function PlayPage() {
  return <Suspense fallback={null}><PlayScreen /></Suspense>;
}
