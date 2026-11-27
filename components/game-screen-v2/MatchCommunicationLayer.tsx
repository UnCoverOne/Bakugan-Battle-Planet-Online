"use client";

import { LucideIcon } from "../design-system/LucideIcon";
import { useLobbySession } from "../application/LobbySessionProvider";
import { useLobbyChat } from "../application/LobbyChatProvider";
import { LobbyChatPanel } from "../application/LobbyChatPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { cardEventLogEntries, eventLogEntries, matchTimeLabel } from "../../lib/chat";
import type { MatchState } from "../../lib/game";
import { CardArt } from "../cards/CardArt";
import { useMatchSelector } from "./matchStore";
import {eventLogFilter} from "../../lib/settings-preferences";
import batchStyles from "./BrawlExperienceLayer.module.css";
import styles from "./MatchCommunicationLayer.module.css";

const EVENT_FILTERS = ["cards", "all", "game", "random", "system", "connection"] as const;
type EventFilter = typeof EVENT_FILTERS[number];

type CommunicationState = {
  active: boolean;
  match: MatchState | null;
  playerId?: string;
};

function eventKindLabel(kind: string) {
  if (kind === "connection") return "CONNECTION";
  if (kind === "random") return "RANDOM";
  if (kind === "system") return "SYSTEM";
  return "GAME";
}

function cardEventActor(match: MatchState | null, playerId: string | undefined) {
  return match?.players.find((player) => player.id === playerId)?.name ?? "Unknown player";
}

export function MatchCommunicationLayer() {
  const lobby=useLobbySession(),lobbyChat=useLobbyChat();
  const systemOnly=lobby.recovery?.lobby?.mode==="training";
  const communication = useMatchSelector((state): CommunicationState => ({
    active: state.route === "match",
    match: state.match,
    playerId: state.playerId,
  }));
  const [eventLogOpen, setEventLogOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const preferredFilter=useMatchSelector(state=>eventLogFilter(state.settings.logDetail));
  const [eventFilter, setEventFilter] = useState<EventFilter>(preferredFilter);
  useEffect(()=>setEventFilter(preferredFilter),[preferredFilter]);
  const eventScroll = useRef<HTMLDivElement | null>(null);
  const eventDock = useRef<HTMLDivElement | null>(null);
  const chatDock = useRef<HTMLDivElement | null>(null);
  const communicationButtons = useRef<HTMLDivElement | null>(null);

  const events = useMemo(
    () => eventLogEntries(communication.match),
    [communication.match],
  );
  const filteredEvents = useMemo(
    () => eventFilter === "all" || eventFilter === "cards"
      ? events
      : events.filter((entry) => entry.kind === eventFilter),
    [events, eventFilter],
  );
  const cardEvents = useMemo(
    () => cardEventLogEntries(communication.match),
    [communication.match],
  );
  const actorId = communication.playerId ?? communication.match?.players[0]?.id;

  useEffect(() => {
    if (!eventLogOpen) return;
    const element = eventScroll.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [eventLogOpen, eventFilter, filteredEvents.length, cardEvents.length]);

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
    const next = !eventLogOpen;
    setEventLogOpen(next);
    if (next) setChatOpen(false);
  };

  const toggleChat = () => {
    const next = !chatOpen;
    setChatOpen(next);
    if (next) setEventLogOpen(false);
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
          <LucideIcon name="list" className={styles.buttonIcon}/>
        </button>
        <button
          type="button"
          className={styles.communicationButton}
          data-active={chatOpen ? "true" : "false"}
          aria-controls="match-chat-panel"
          aria-expanded={chatOpen}
          aria-label={chatOpen ? "Close chat" : lobbyChat.unread ? `Open lobby chat, ${lobbyChat.unread} unread messages` : "Open match chat"}
          onClick={toggleChat}
        >
          <LucideIcon name="message-square" className={styles.buttonIcon}/>
          {lobbyChat.unread>0&&<span className={styles.chatUnread} aria-hidden="true"/>}
        </button>
      </div>

      <div ref={eventDock} className={styles.eventDock} data-open={eventLogOpen ? "true" : "false"}>
        <aside id="match-event-log-panel" className={styles.eventPanel} aria-label="Event Log" aria-hidden={!eventLogOpen}>
          <header>
            <div>
              <span>MATCH RECORD</span>
              <h2>EVENT LOG</h2>
            </div>
            <strong>{eventFilter === "cards" ? cardEvents.length : filteredEvents.length}</strong>
          </header>
          <nav className={styles.eventFilters} aria-label="Event filters">
            {EVENT_FILTERS.map((kind) => (
              <button type="button" key={kind} aria-pressed={eventFilter === kind} onClick={() => setEventFilter(kind)}>{kind}</button>
            ))}
          </nav>
          {eventFilter === "cards" ? (
            <div className={styles.cardEntries} ref={eventScroll} aria-live="polite">
              {cardEvents.length ? cardEvents.map((entry) => (
                <figure
                  className={styles.cardEvent}
                  data-event={entry.cardEvent}
                  data-card-type={entry.card.type.toLowerCase()}
                  data-local={entry.playerId === actorId ? "true" : "false"}
                  key={entry.id}
                  title={`${cardEventActor(communication.match, entry.playerId)} • ${entry.card.displayName || entry.card.name} • ${entry.cardEvent === "played" ? "Played" : "Effect resolved"} • ${matchTimeLabel(communication.match, entry.at)}`}
                >
                  <div className={`${batchStyles.batchHex} ${styles.cardPreview}`}>
                    <span aria-hidden="true">{(entry.card.displayName || entry.card.name).slice(0, 1)}</span>
                    <CardArt
                      src={entry.card.art}
                      cardType={entry.card.type}
                      alt={entry.card.displayName || entry.card.name}
                      draggable={false}
                    />
                  </div>
                  <figcaption>
                    <small>{entry.cardEvent === "played" ? "PLAYED" : "EFFECT"}</small>
                    <strong>{entry.card.displayName || entry.card.name}</strong>
                    <span className={styles.cardActor}>
                      {cardEventActor(communication.match, entry.playerId)} {entry.cardEvent === "played" ? "PLAYED THIS CARD" : "USED THIS EFFECT"}
                    </span>
                    <time>{matchTimeLabel(communication.match, entry.at)}</time>
                  </figcaption>
                </figure>
              )) : <p className={styles.emptyState}>No cards or card effects have been played.</p>}
            </div>
          ) : (
            <div className={styles.eventEntries} ref={eventScroll}>
              {filteredEvents.length ? filteredEvents.map((entry) => (
                <article className={styles.eventEntry} data-kind={entry.kind} key={entry.id}>
                  <div>
                    <span>{eventKindLabel(entry.kind)}</span>
                    <time>{matchTimeLabel(communication.match, entry.at)}</time>
                  </div>
                  <p>{entry.message}</p>
                </article>
              )) : <p className={styles.emptyState}>No match events have been recorded.</p>}
            </div>
          )}
        </aside>
        <button
          type="button"
          className={styles.eventToggle}
          aria-expanded={eventLogOpen}
          aria-label={eventLogOpen ? "Close Event Log" : "Open Event Log"}
          onClick={toggleEventLog}
        >
          <LucideIcon name="list" className={styles.handleIcon}/>
          <LucideIcon name={eventLogOpen?"chevron-left":"chevron-right"} className={styles.handleChevron}/>
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
          <LucideIcon name="message-square" className={styles.handleIcon}/>
          <LucideIcon name={chatOpen?"chevron-right":"chevron-left"} className={styles.handleChevron}/>
        </button>
        <section
          id="match-chat-panel"
          className={styles.chatBox}
          aria-label="Match chat"
          data-chat-box="true"
          aria-hidden={!chatOpen?true:undefined}
        >
          {chatOpen && <LobbyChatPanel systemOnly={systemOnly} />}
        </section>
      </div>
    </>
  );
}
