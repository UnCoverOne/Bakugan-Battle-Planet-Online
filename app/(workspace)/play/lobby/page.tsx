import type { Metadata } from "next";
import { PersistentPlayGuard } from "../../../../components/routes/PersistentPlayRoutes";

import { ManagedLobby } from "../../../../components/routes/ManagedLobby";

export const metadata: Metadata = { title: "Match Lobby" };
export default function LobbyPage() { return <PersistentPlayGuard><ManagedLobby /></PersistentPlayGuard>; }
