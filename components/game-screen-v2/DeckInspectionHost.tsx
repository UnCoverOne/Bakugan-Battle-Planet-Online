"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const DeckInspectionLayer = dynamic(
  () => import("./DeckInspectionLayer").then((module) => module.DeckInspectionLayer),
  { ssr: false },
);

/** Keep deck/card rules out of non-match route bundles. */
export function DeckInspectionHost() {
  const pathname = usePathname();
  return pathname === "/play/match" ? <DeckInspectionLayer /> : null;
}
