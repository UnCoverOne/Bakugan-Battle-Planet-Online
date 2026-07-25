import type { Metadata } from "next";
import { MatchRuntime } from "../../../../components/routes/MatchRuntime";
import { LobbyScreen } from "../../../../components/routes/PlayRoutes";

export const metadata: Metadata = { title: "Match Lobby" };
export default function LobbyPage() { return <><LobbyScreen /><MatchRuntime /></>; }
