import type { Metadata } from "next";
import { PersistentLobbyRoute } from "../../../../components/routes/PersistentPlayRoutes";
import { LobbyRoomScreen } from "../../../../components/routes/StreamlinedLobbyRoomScreen";
import styles from "../presentation-fix.module.css";

export const metadata: Metadata = { title: "Match Lobby" };
export default function LobbyPage() { return <PersistentLobbyRoute legacy={<div className={styles.lobbyScope}><LobbyRoomScreen /></div>} />; }
