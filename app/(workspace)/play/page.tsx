import type { Metadata } from "next";
import { Suspense } from "react";
import { MatchCreationScreen } from "../../../components/routes/MatchCreationScreen";
import styles from "./presentation-fix.module.css";

export const metadata: Metadata = { title: "Play" };

export default function PlayPage() {
  return <div className={styles.creationScope}><Suspense fallback={null}><MatchCreationScreen /></Suspense></div>;
}
