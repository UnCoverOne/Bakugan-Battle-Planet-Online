import type { Metadata } from "next";
import { LobbyRoomScreen } from "../../../../components/routes/StreamlinedLobbyRoomScreen";
import styles from "../presentation-fix.module.css";

export const metadata: Metadata = { title: "Match Lobby" };
export default function LobbyPage() { return <div className={styles.lobbyScope}><LobbyRoomScreen /></div>; }
