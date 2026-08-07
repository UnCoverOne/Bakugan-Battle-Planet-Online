import type { Metadata } from "next";
import { LobbyRoomScreen } from "../../../../components/routes/LobbyRoomScreen";

export const metadata: Metadata = { title: "Match Lobby" };
export default function LobbyPage() { return <LobbyRoomScreen />; }
