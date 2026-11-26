"use client";

import { useEffect, useState } from "react";
import { LobbyChatPanel } from "../application/LobbyChatPanel";
import { useLobbyChat } from "../application/LobbyChatProvider";
import { LucideIcon } from "../design-system/LucideIcon";
import { LobbyModal } from "./LobbyDeckPicker";
import styles from "./ManagedLobby.module.css";

export function LobbyWorkspace({ children, actions, systemOnly }) {
  const { unread } = useLobbyChat();
  const [wide, setWide] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1200px)");
    const update = () => {
      setWide(query.matches);
      if (query.matches) setChatOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <div className={styles.workspace}>
      <div className={styles.preparation}>
        {children}
        <div className={styles.actionBar}>
          {!wide && (
            <button type="button" className={styles.chatButton}
              aria-label={unread ? `Open chat, ${unread} unread` : "Open chat"}
              onClick={() => setChatOpen(true)}>
              <LucideIcon name="message-square" size={20} /> Chat
              {unread > 0 && <span className={styles.unreadDot} />}
            </button>
          )}
          {actions}
        </div>
      </div>
      {wide && <aside className={styles.chatColumn}><LobbyChatPanel systemOnly={systemOnly} /></aside>}
      {!wide && chatOpen && (
        <LobbyModal className={styles.chatModal} labelledBy="lobby-chat-title" onCancel={() => setChatOpen(false)}>
          <div className={styles.modalContent}>
            <header className={styles.modalHeader}>
              <h2 id="lobby-chat-title">Chat</h2>
              <button type="button" className={styles.iconButton} aria-label="Close chat" onClick={() => setChatOpen(false)}>
                <LucideIcon name="x" />
              </button>
            </header>
            <div className={styles.chatModalBody}><LobbyChatPanel systemOnly={systemOnly} showHeader={false} /></div>
          </div>
        </LobbyModal>
      )}
    </div>
  );
}
