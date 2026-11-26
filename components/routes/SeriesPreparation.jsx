"use client";

import { useRef, useState } from "react";
import { lobbyCanStart, roomOwnerId } from "../../lib/lobby";
import { eligibleRankedDecks, rankedSeries } from "../../lib/ranked-lobby";
import { apiActionToCommand } from "../../lib/engine/commands";
import { dispatchLocalGameCommand } from "../../lib/engine/local-command-dispatcher";
import {
  matchCommandHeaders, publishMatch, readMatchStore, useMatchSelector, useMatchTransport,
} from "../game-screen-v2/matchStore";
import { useAppFields } from "../application/AppProvider";
import { useLobbySession } from "../application/LobbySessionProvider";
import { LucideIcon } from "../design-system/LucideIcon";
import { LobbyDeckArtwork, LobbyDeckDetails } from "./LobbyDeckPicker";
import { LobbyWorkspace } from "./LobbyWorkspace";
import styles from "./ManagedLobby.module.css";

export function SeriesPreparation() {
  useMatchTransport();
  const { match, playerId, online } = useMatchSelector(state => ({
    match: state.match, playerId: state.playerId, online: state.online,
  }));
  const ranked = match && rankedSeries(match);
  if (!match || !playerId || match.phase !== "lobby") return null;
  return (
    <PreparationStage key={`${match.id}:${match.gameNumber}:${ranked?.stage ?? "ready"}`}
      match={match} playerId={playerId} online={online} ranked={ranked} />
  );
}

function PreparationStage({ match, playerId, online, ranked }) {
  const { authUser } = useAppFields(["authUser"]);
  const { returnToLobby } = useLobbySession();
  const [choice, setChoice] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  const ban = ranked?.stage === "ban";
  const select = ranked?.stage === "select";
  const choosing = ban || select;
  const mine = ranked?.players[playerId];
  const opponent = ranked && Object.entries(ranked.players).find(([id]) => id !== playerId)?.[1];
  const locked = ban ? mine?.bannedDeckId : mine?.selectedDeckId;
  const decks = ban ? opponent?.decks ?? [] : mine?.decks ?? [];
  const eligible = select ? new Set(eligibleRankedDecks(match, playerId).map(deck => deck.id)) : null;
  const localPlayer = match.players.find(player => player.id === playerId);
  const ready = Boolean(localPlayer?.ready);
  const host = roomOwnerId(match) === playerId;

  const send = async (action, payload = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const sameStage = (state) => state?.id === match.id
        && state.phase === "lobby" && state.gameNumber === match.gameNumber
        && rankedSeries(state)?.stage === ranked?.stage;
      const current = readMatchStore();
      if (current.playerId !== playerId || !sameStage(current.match)) {
        throw new Error("The series changed. Review the current choices and try again.");
      }
      if (!current.online) {
        const command = apiActionToCommand(action, payload);
        publishMatch(dispatchLocalGameCommand(current.match, playerId, command, authUser?.id ?? playerId));
        return;
      }
      const request = async (snapshot) => {
        const response = await fetch("/api/game", {
          method: "POST",
          headers: matchCommandHeaders(snapshot),
          signal: AbortSignal.timeout(12_000),
          body: JSON.stringify({
            action, payload, code: match.code, playerId, expectedVersion: snapshot.match.version,
          }),
        });
        const result = await response.json();
        const active = readMatchStore();
        if (result.state && active.match?.id === match.id && active.playerId === playerId) {
          publishMatch(result.state);
        }
        return { response, result };
      };
      let attempt = await request(current);
      if (attempt.response.status === 409 && action !== "start-match") {
        // The other seat may have committed a simultaneous choice. Retry
        // once only while this seat can still submit the same intent.
        const latest = readMatchStore();
        if (latest.playerId === playerId && sameStage(latest.match) && latest.match.version > current.match.version) {
          const latestPlayer = rankedSeries(latest.match)?.players[playerId];
          const canRetry = ban ? !latestPlayer?.bannedDeckId : select
            ? !latestPlayer?.selectedDeckId && eligibleRankedDecks(latest.match, playerId).some(deck => deck.id === payload.deckId)
            : latest.match.players.find(player => player.id === playerId)?.ready !== payload.ready;
          if (canRetry) attempt = await request(latest);
        }
      }
      if (!attempt.response.ok) throw new Error(attempt.result.error || "Game command failed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Game command failed.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const gameNumber = match.gameNumber + Number(select && Object.values(match.series).some(wins => wins > 0));
  const title = ban ? "Ban a deck" : select ? "Select your deck" : "Ready check";
  const action = choosing ? (
    <button className={styles.start} type="button"
      disabled={pending || Boolean(locked) || !decks.some(deck => deck.id === choice && (!eligible || eligible.has(deck.id)))}
      onClick={() => void send(ban ? "ranked-ban" : "ranked-select", { deckId: choice })}>
      {locked ? (ban ? "Ban confirmed" : "Deck locked") : (ban ? "Confirm Ban" : "Lock Deck")}
    </button>
  ) : host ? (
    <button className={styles.start} type="button" disabled={pending || !lobbyCanStart(match)}
      onClick={() => void send("start-match")}>Start Game</button>
  ) : <span className={styles.guestAction}>Waiting for host</span>;

  return (
    <section className={`${styles.lobby} ${styles.series}`} aria-labelledby="series-preparation-title">
      <header className={styles.heading}>
        <div>
          <h1 id="series-preparation-title" aria-live="polite">{title}</h1>
          <p className={styles.gameLabel}>{ranked ? "Ranked · " : ""}Game {gameNumber}</p>
        </div>
        <button className={styles.leave} type="button" onClick={() => void returnToLobby()}>
          <LucideIcon name="arrow-left" size={16} /> Return to Lobby
        </button>
      </header>
      <LobbyWorkspace actions={action} systemOnly={!online}>
        <ul className={styles.seriesScore} aria-label="Series score">
          {match.players.map(player => (
            <li key={player.id}>
              <span title={player.name}>{player.name}</span>
              <strong>{match.series[player.id] ?? 0}</strong>
            </li>
          ))}
        </ul>
        {choosing ? (
          <fieldset className={styles.seriesChoices}>
            <legend>{ban ? "Opponent decks" : "Your decks"}</legend>
            {decks.map(deck => {
              const unavailable = eligible && !eligible.has(deck.id);
              const reason = unavailable ? (mine.wonDeckIds.includes(deck.id) ? "Already won" : "Banned") : "";
              return (
                <label className={styles.choice} key={deck.id}>
                  <LobbyDeckArtwork deck={deck} />
                  <LobbyDeckDetails deck={deck} problem={reason} />
                  <input type="radio" name="series-deck" value={deck.id} aria-label={deck.name}
                    checked={(locked || choice) === deck.id}
                    disabled={pending || Boolean(locked) || Boolean(unavailable)}
                    onChange={() => setChoice(deck.id)} />
                </label>
              );
            })}
          </fieldset>
        ) : (
          <div className={styles.roundReadiness}>
            {match.players.map(player => (
              <div className={styles.seat} key={player.id}>
                <h2>{player.name}</h2>
                {player.id === playerId ? (
                  <button className={styles.readyButton} data-ready={String(ready)} disabled={pending || !localPlayer?.connected}
                    type="button" onClick={() => void send("lobby-ready", { ready: !ready })}>
                    {ready ? "Unready" : "Ready"}
                  </button>
                ) : <span className={styles.status} data-ready={String(player.connected && player.ready)}>{!player.connected ? "Disconnected" : player.ready ? "Ready" : "Not ready"}</span>}
              </div>
            ))}
          </div>
        )}
        <p className={styles.feedback} role="status">{error || (locked && choosing ? "Waiting for opponent." : "")}</p>
      </LobbyWorkspace>
    </section>
  );
}
