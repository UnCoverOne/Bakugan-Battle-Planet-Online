import type { Metadata } from "next";
import { LobbyRoomScreen } from "../../../../components/routes/StreamlinedLobbyRoomScreen";

export const metadata: Metadata = { title: "Match Lobby" };
export default function LobbyPage() { return <LobbyRoomScreen />; }
