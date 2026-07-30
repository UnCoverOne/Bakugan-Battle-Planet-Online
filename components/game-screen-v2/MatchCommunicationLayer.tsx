"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { addChatMessage, chatEntries, eventLogEntries, normalizeChatMessage } from "../../lib/chat";
import type { MatchState } from "../../lib/game";
import { writeCoordinatedMatch } from "./MatchStateCoordinator";
import { readMatchStore, useMatchSelector } from "./matchStore";
import styles from "./MatchCommunicationLayer.module.css";

type CommunicationState = {
  active: boolean;
  online: boolean;
  match: MatchState | null;
  playerId?: string;
};

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
  const communication = useMatchSelector((state): CommunicationState => ({
    active: state.route === "match",
    online: state.online,
    match: state.match,
    playerId: state.playerId,
  }));
  const [eventLogOpen, setEventLogOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [eventFilter, setEventFilter] = useState("all");
  const [chatFocused, setChatFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const eventScroll = useRef<HTMLDivElement | null>(null);
  const chatScroll = useRef<HTMLDivElement | null>(null);
  const eventDock = useRef<HTMLDivElement | null>(null);
  const chatDock = useRef<HTMLDivElement | null>(null);
  const communicationButtons = useRef<HTMLDivElement | null>(null);

  const events = useMemo(
    () => eventLogEntries(communication.match),
    [communication.match],
  );
  const filteredEvents = useMemo(() => eventFilter === "all" ? events : events.filter((entry) => entry.kind === eventFilter), [events, eventFilter]);
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

  useEffect(() => {
    if (!eventLogOpen && !chatOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        communicationButtons.current?.contains(target)
        || eventDock.current?.contains(target)
        || chatDock.current?.contains(target)
      ) return;
      setEventLogOpen(false);
      setChatOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [eventLogOpen, chatOpen]);

  const toggleEventLog = () => {
    setEventLogOpen((open) => {
      const next = !open;
      if (next) setChatOpen(false);
      return next;
    });
  };

  const toggleChat = () => {
    setChatOpen((open) => {
      const next = !open;
      if (next) setEventLogOpen(false);
      return next;
    });
  };

  const sendChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const message = normalizeChatMessage(draft);
    const stored = readMatchStore();
    const current: CommunicationState = { active: stored.route === "match", online: stored.online, match: stored.match, playerId: stored.playerId };
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
            headers: { "content-type": "application/json", ...(stored.capability ? { "x-match-capability": stored.capability } : {}) },
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
      <div
        ref={communicationButtons}
        className={styles.communicationButtons}
        aria-label="Match communication controls"
      >
        <button
          type="button"
          className={styles.communicationButton}
          data-active={eventLogOpen ? "true" : "false"}
          aria-controls="match-event-log-panel"
          aria-expanded={eventLogOpen}
          aria-label={eventLogOpen ? "Close Event Log" : "Open Event Log"}
          onClick={toggleEventLog}
        >
          <svg className={styles.buttonIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="4" cy="6" r="1" />
            <circle cx="4" cy="12" r="1" />
            <circle cx="4" cy="18" r="1" />
            <path d="M8 6h12M8 12h12M8 18h12" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.communicationButton}
          data-active={chatOpen ? "true" : "false"}
          aria-controls="match-chat-panel"
          aria-expanded={chatOpen}
          aria-label={chatOpen ? "Close match chat" : "Open match chat"}
          onClick={toggleChat}
        >
          <svg className={styles.buttonIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 5h16v11H9l-5 4V5Z" />
            <path d="M8 9h8M8 12h5" />
          </svg>
        </button>
      </div>

      <div ref={eventDock} className={styles.eventDock} data-open={eventLogOpen ? "true" : "false"}>
        <aside id="match-event-log-panel" className={styles.eventPanel} aria-label="Event Log" aria-hidden={!eventLogOpen}>
          <header>
            <div>
              <span>MATCH RECORD</span>
              <h2>EVENT LOG</h2>
            </div>
            <strong>{filteredEvents.length}</strong>
          </header>
          <nav className={styles.eventFilters} aria-label="Event filters">
            {["all", "game", "random", "system", "connection"].map((kind) => (
              <button type="button" key={kind} aria-pressed={eventFilter === kind} onClick={() => setEventFilter(kind)}>{kind}</button>
            ))}
          </nav>
          <div className={styles.eventEntries} ref={eventScroll}>
            {filteredEvents.length ? filteredEvents.map((entry) => (
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
          onClick={toggleEventLog}
        >
          <svg
            className={styles.handleIcon}
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="4" cy="6" r="1" />
            <circle cx="4" cy="12" r="1" />
            <circle cx="4" cy="18" r="1" />
            <path d="M8 6h12M8 12h12M8 18h12" />
          </svg>
          <svg
            className={styles.handleChevron}
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path d={eventLogOpen ? "M15 18l-6-6 6-6" : "m9 6 6 6-6 6"} />
          </svg>
        </button>
      </div>

      <div ref={chatDock} className={styles.chatDock} data-open={chatOpen ? "true" : "false"}>
        <button
          type="button"
          className={styles.chatHandle}
          aria-controls="match-chat-panel"
          aria-expanded={chatOpen}
          aria-label={chatOpen ? "Close match chat" : "Open match chat"}
          onClick={toggleChat}
        >
          <svg
            className={styles.handleIcon}
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M4 5h16v11H9l-5 4V5Z" />
            <path d="M8 9h8M8 12h5" />
          </svg>
          <svg
            className={styles.handleChevron}
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path d={chatOpen ? "m9 6 6 6-6 6" : "M15 18l-6-6 6-6"} />
          </svg>
        </button>
        <section
          id="match-chat-panel"
          className={styles.chatBox}
          aria-label="Match chat"
          data-chat-box="true"
          data-focused={chatFocused ? "true" : "false"}
          onFocusCapture={() => setChatFocused(true)}
          onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setChatFocused(false); }}
        >
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
      </div>
    </>
  );
}

