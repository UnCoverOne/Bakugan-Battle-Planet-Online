import type { Metadata } from "next";
import { ResultScreen } from "../../../../components/routes/PlayRoutes";

export const metadata: Metadata = { title: "Match Result" };
export default function ResultPage() { return <ResultScreen />; }
