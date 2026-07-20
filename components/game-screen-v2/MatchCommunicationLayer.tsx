"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { addChatMessage, chatEntries, eventLogEntries, normalizeChatMessage } from "../../lib/chat";
import type { MatchState } from "../../lib/game";
import { MATCH_UPDATE_EVENT, writeCoordinatedMatch } from "./MatchStateCoordinator";
import styles from "./MatchCommunicationLayer.module.css";

const ROUTE_KEY = "bbp-route-v1";
const SETTINGS_KEY = "bbp-settings";
const MATCH_KEY = "bbp-active-match-v1";
const ONLINE_KEY = "bbp-active-match-online-v1";
const PLAYER_KEY = "bbp-player-id";

type CommunicationState = {
  active: boolean;
  online: boolean;
  match: MatchState | null;
  playerId?: string;
};

function parseValue<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function readCommunicationState(): CommunicationState {
  const settings = parseValue<Record<string, unknown>>(localStorage.getItem(SETTINGS_KEY), {});
  const route = parseValue(localStorage.getItem(ROUTE_KEY), "entry");
  return {
    active: Boolean(settings.useNewGameScreen) && route === "match",
    online: parseValue(localStorage.getItem(ONLINE_KEY), false),
    match: parseValue<MatchState | null>(localStorage.getItem(MATCH_KEY), null),
    playerId: parseValue<string | undefined>(localStorage.getItem(PLAYER_KEY), undefined),
  };
}

function timeLabel(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventKindLabel(kind: string) {
  if (kind === "connection") return "CONNECTION";
  if (kind === "random") return "RANDOM";
  if (kind === "system") return "SYSTEM";
  return "GAME";
}

export function MatchCommunicationLayer() {
  const [communication, setCommunication] = useState<CommunicationState>({
    active: false,
    online: false,
    match: null,
    playerId: undefined,
  });
  const [eventLogOpen, setEventLogOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const rawState = useRef("");
  const eventScroll = useRef<HTMLDivElement | null>(null);
  const chatScroll = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const update = () => {
      const raw = [
        localStorage.getItem(ROUTE_KEY),
        localStorage.getItem(SETTINGS_KEY),
        localStorage.getItem(MATCH_KEY),
        localStorage.getItem(ONLINE_KEY),
        localStorage.getItem(PLAYER_KEY),
      ].join("\u0000");
      if (raw === rawState.current) return;
      rawState.current = raw;
      setCommunication(readCommunicationState());
    };
    update();
    const interval = window.setInterval(update, 500);
    window.addEventListener("storage", update);
    window.addEventListener(MATCH_UPDATE_EVENT, update as EventListener);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", update);
      window.removeEventListener(MATCH_UPDATE_EVENT, update as EventListener);
    };
  }, []);

  const events = useMemo(
    () => eventLogEntries(communication.match),
    [communication.match],
  );
  const messages = useMemo(
    () => chatEntries(communication.match),
    [communication.match],
  );
  const actorId = communication.playerId ?? communication.match?.players[0]?.id;

  useEffect(() => {
    if (!eventLogOpen) return;
    const element = eventScroll.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [eventLogOpen, events.length]);

  useEffect(() => {
    const element = chatScroll.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  const sendChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const message = normalizeChatMessage(draft);
    const current = readCommunicationState();
    const currentMatch = current.match;
    const currentActorId = current.playerId ?? currentMatch?.players[0]?.id;
    if (!message || !currentMatch || !currentActorId) return;

    setSending(true);
    setError("");
    try {
      if (!current.online) {
        writeCoordinatedMatch(addChatMessage(currentMatch, currentActorId, message));
      } else {
        let expectedState = currentMatch;
        let delivered = false;
        for (let attempt = 0; attempt < 2 && !delivered; attempt += 1) {
          const response = await fetch("/api/game", {
            method: "POST",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "chat",
              code: expectedState.code,
              playerId: currentActorId,
              expectedVersion: expectedState.version,
              payload: { message },
            }),
          });
          const data = await response.json() as { state?: MatchState; error?: string };
          if (data.state) {
            writeCoordinatedMatch(data.state);
            expectedState = data.state;
          }
          if (response.ok) {
            delivered = true;
            break;
          }
          if (response.status !== 409 || !data.state || attempt === 1) {
            throw new Error(data.error ?? "The chat message could not be sent.");
          }
        }
      }
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The chat message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  if (!communication.active || !communication.match || !actorId) return null;

  return (
    <>
      <div className={styles.eventDock} data-open={eventLogOpen ? "true" : "false"}>
        <aside className={styles.eventPanel} aria-label="Event Log" aria-hidden={!eventLogOpen}>
          <header>
            <div>
              <span>MATCH RECORD</span>
              <h2>EVENT LOG</h2>
            </div>
            <strong>{events.length}</strong>
          </header>
          <div className={styles.eventEntries} ref={eventScroll}>
            {events.length ? events.map((entry) => (
              <article className={styles.eventEntry} data-kind={entry.kind} key={entry.id}>
                <div>
                  <span>{eventKindLabel(entry.kind)}</span>
                  <time dateTime={new Date(entry.at).toISOString()}>{timeLabel(entry.at)}</time>
                </div>
                <p>{entry.message}</p>
              </article>
            )) : <p className={styles.emptyState}>No match events have been recorded.</p>}
          </div>
        </aside>
        <button
          type="button"
          className={styles.eventToggle}
          aria-expanded={eventLogOpen}
          aria-label={eventLogOpen ? "Close Event Log" : "Open Event Log"}
          onClick={() => setEventLogOpen((open) => !open)}
        >
          <span>EVENT LOG</span>
          <strong>{eventLogOpen ? "‹" : "›"}</strong>
        </button>
      </div>

      <section className={styles.chatBox} aria-label="Match chat" data-chat-box="true">
        <header>
          <div>
            <span>PLAYER COMMS</span>
            <strong>CHAT</strong>
          </div>
          <small>{communication.online ? "ONLINE" : "LOCAL"}</small>
        </header>
        <div className={styles.chatMessages} ref={chatScroll} aria-live="polite">
          {messages.length ? messages.map((message) => {
            const local = message.playerId === actorId;
            return (
              <article className={styles.chatMessage} data-local={local ? "true" : "false"} key={message.id}>
                <div>
                  <strong>{message.author}</strong>
                  <time dateTime={new Date(message.at).toISOString()}>{timeLabel(message.at)}</time>
                </div>
                <p>{message.message}</p>
              </article>
            );
          }) : <p className={styles.emptyState}>No messages yet.</p>}
        </div>
        <form className={styles.chatForm} onSubmit={sendChat}>
          <input
            type="text"
            value={draft}
            maxLength={240}
            aria-label="Chat message"
            placeholder="Type a message…"
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={sending || !normalizeChatMessage(draft)}>
            {sending ? "…" : "SEND"}
          </button>
        </form>
        {error ? <p className={styles.chatError} role="alert">{error}</p> : null}
      </section>
    </>
  );
}
