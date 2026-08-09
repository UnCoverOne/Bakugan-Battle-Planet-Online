import type { Metadata } from "next";
import { LeaderboardScreen } from "../../../components/routes/LeaderboardScreen";

export const metadata: Metadata = { title: "Ranked Leaderboard" };
export default function LeaderboardPage() { return <LeaderboardScreen />; }

