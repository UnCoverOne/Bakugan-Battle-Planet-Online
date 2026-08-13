"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { validateDeck, type DeckRecord } from "../../lib/data";
import type { DeckRestriction } from "../../lib/deck-validation";
import { normalizeRoomCode } from "../../lib/play-setup-machine";
import { initializeLocalReplayJournal } from "../../lib/replay-journal";
import { createTrainingLobbyState } from "../../lib/training-lobby";
import { primeMatchStore } from "../game-screen-v2/matchStore";
import { useApp } from "../application/AppProvider";
import styles from "./MatchCreationScreen.module.css";

type MatchModeChoice = "training" | "casual" | "ranked";
type LobbyAction = "create" | "join";

type PendingLaunch = {
  action: Exclude<LobbyAction, never>;
  deckId: string;
  structure: "bo1" | "bo3";
  roomCode: string;
  mode: MatchModeChoice;
  rankedDeckIds: string[];
} | null;

function modeFromProvider(mode: string): MatchModeChoice {
  return mode === "solo" ? "training" : "casual";
}

function ChevronArrow() {
  return <svg className={styles.buttonArrow} viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 8 8-8 8" /></svg>;
}

export function MatchCreationScreen() {
  const router = useRouter();
  const {
    format,
    setFormat,
    matchMode,
    setMatchMode,
    decks,
    selectedDeck,
    selectedDeckId,
    setSelectedDeckId,
    joinCode: storedJoinCode,
    setJoinCode,
    createOnline,
    joinOnline,
    setMatch,
    setOnline,
    profile,
    playerId,
    authUser,
  } = useApp();
  const [mode, setMode] = useState<MatchModeChoice>(() => modeFromProvider(matchMode));
  const [structure, setStructure] = useState<"bo1" | "bo3">(format === "bo3" ? "bo3" : "bo1");
  const [action, setAction] = useState<LobbyAction>(matchMode === "join" ? "join" : "create");
  const [roomCode, setRoomCode] = useState(() => normalizeRoomCode(storedJoinCode));
  const [pending, setPending] = useState<PendingLaunch>(null);
  const [trainingPending, setTrainingPending] = useState(false);
  const [error, setError] = useState("");
  const [rankedDeckIds, setRankedDeckIds] = useState<string[]>([]);
  const [rankedRestrictions, setRankedRestrictions] = useState<DeckRestriction[]>([]);

  const legalDecks = useMemo(
    () => (decks as DeckRecord[]).filter((deck) => validateDeck(deck).isLegal),
    [decks],
  );
  const preferredDeck = useMemo(() => {
    const current = selectedDeck as DeckRecord | null;
    if (current && validateDeck(current).isLegal) return current;
    return legalDecks.find((deck) => deck.id === selectedDeckId) ?? legalDecks[0] ?? null;
  }, [legalDecks, selectedDeck, selectedDeckId]);
  const competitiveDecks = useMemo(
    () => (decks as DeckRecord[]).filter((deck) => deck.format === "competitive" && validateDeck(deck, rankedRestrictions).isLegal),
    [decks, rankedRestrictions],
  );
  const rankedDecks = competitiveDecks.filter((deck) => rankedDeckIds.includes(deck.id));

  useEffect(() => {
    if (mode === "training" && action !== "create") setAction("create");
  }, [action, mode]);

  useEffect(() => {
    if (mode !== "ranked") return;
    let active = true;
    fetch("/api/ranked?action=rules", { cache: "no-store" })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Ranked rules are unavailable."); if (active) setRankedRestrictions(result.ruleset?.restrictions ?? []); })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : "Ranked rules are unavailable."));
    return () => { active = false; };
  }, [mode]);

  useEffect(() => {
    if (!pending || !preferredDeck) return;
    const targetMode = pending.action === "join" ? "join" : "online";
    if (selectedDeckId !== pending.deckId) return;
    if (format !== pending.structure) return;
    if (matchMode !== targetMode) return;
    if (pending.action === "join" && normalizeRoomCode(storedJoinCode) !== pending.roomCode) return;

    let cancelled = false;
    const run = async () => {
      const openLobby = pending.action === "join" ? joinOnline : createOnline;
      const options = pending.mode === "ranked" ? { mode: "ranked", decks: (decks as DeckRecord[]).filter((deck) => pending.rankedDeckIds.includes(deck.id)) } : undefined;
      const result = await openLobby(options);
      if (cancelled) return;
      setPending(null);
      if (result?.ok === false) setError(result.error ?? "The lobby could not be opened.");
    };
    void run();
    return () => { cancelled = true; };
  }, [createOnline, decks, format, joinOnline, matchMode, pending, preferredDeck, selectedDeckId, storedJoinCode]);

  const chooseMode = (next: MatchModeChoice) => {
    setMode(next);
    if (next === "training") setAction("create");
    if (next === "ranked") {
      setStructure("bo3");
      setRankedDeckIds((current) => current.length ? current : competitiveDecks.slice(0, 3).map((deck) => deck.id));
    }
    setError("");
  };

  const resetPreviousSession = () => {
    setMatch(null);
    setOnline(false);
    primeMatchStore({ route: "play", match: null, online: false, playerId, capability: "" });
  };

  const launch = async () => {
    if (mode === "ranked" && !authUser) {
      setError("Sign in before creating or joining a Ranked lobby.");
      return;
    }
    if (mode === "ranked" && rankedDecks.length !== 3) {
      setError("Select exactly three legal Competitive decks.");
      return;
    }
    const launchDeck = mode === "ranked" ? rankedDecks[0] : preferredDeck;
    if (!launchDeck) {
      setError("Create a legal deck before entering a lobby.");
      return;
    }
    const normalizedCode = normalizeRoomCode(roomCode);
    if (action === "join" && normalizedCode.length !== 6) {
      setError("Enter the complete six-character lobby code.");
      return;
    }
    setError("");
    setFormat(structure);
    setSelectedDeckId(launchDeck.id);
    resetPreviousSession();

    if (mode === "training") {
      setTrainingPending(true);
      setMatchMode("solo");
      setJoinCode("");
      try {
        const response = await fetch("/api/ai-decks", { cache: "no-store" });
        const result = await response.json().catch(() => ({})) as { deck?: DeckRecord; error?: string };
        if (!response.ok || !result.deck) throw new Error(result.error ?? "No Training AI deck is available.");
        if (!validateDeck(result.deck).isLegal) throw new Error("The selected Training AI deck is no longer legal.");
        const code = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
        const state = createTrainingLobbyState(code, structure, playerId, profile.name, launchDeck, result.deck);
        initializeLocalReplayJournal(state, authUser?.id ?? playerId);
        setOnline(false);
        setMatch(state);
        primeMatchStore({ route: "lobby", match: state, online: false, playerId, capability: "" });
        router.push("/play/lobby");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Training lobby could not be opened.");
      } finally {
        setTrainingPending(false);
      }
      return;
    }

    const providerMode = action === "join" ? "join" : "online";
    setMatchMode(providerMode);
    setJoinCode(action === "join" ? normalizedCode : "");
    setPending({ action, deckId: launchDeck.id, structure: mode === "ranked" ? "bo3" : structure, roomCode: normalizedCode, mode, rankedDeckIds });
  };

  const busy = Boolean(pending) || trainingPending;
  const actionLabel = mode === "training" || action === "create" ? "CREATE LOBBY" : "JOIN LOBBY";

  return (
    <div className={styles.route}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>MATCH CREATION</p>
          <h1><span>BRAWL</span><strong>SETUP</strong></h1>
          <p>Choose your battle mode, match structure, and lobby action. Final deck selection and ready checks happen inside the lobby.</p>
        </div>
      </header>

      <main className={styles.shell}>
        <section className={styles.panel}>
          <section className={styles.section} aria-labelledby="match-mode-heading">
            <div className={styles.heading}>
              <span className={styles.step}>01</span>
              <div><p>MODE</p><h2 id="match-mode-heading">Choose how you want to play</h2></div>
            </div>
            <div className={styles.modeGrid}>
              <button className={mode === "training" ? styles.selected : ""} aria-pressed={mode === "training"} onClick={() => chooseMode("training")}>
                <span className={styles.optionIndex}>TRAINING</span>
                <strong>Training</strong>
                <span>Practice against Mira Nova in a private local lobby.</span>
              </button>
              <button className={mode === "casual" ? styles.selected : ""} aria-pressed={mode === "casual"} onClick={() => chooseMode("casual")}>
                <span className={styles.optionIndex}>CASUAL</span>
                <strong>Casual</strong>
                <span>Create or join a private online lobby.</span>
              </button>
              <button className={mode === "ranked" ? styles.selected : ""} aria-pressed={mode === "ranked"} onClick={() => chooseMode("ranked")}>
                <span className={styles.optionIndex}>RANKED</span>
                <strong>Ranked</strong>
                <span>Competitive hosted lobbies with Brawler Points.</span>
                <small>Best of Three · three decks · ban one · Conquest wins.</small>
              </button>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="structure-heading">
            <div className={styles.heading}>
              <span className={styles.step}>02</span>
              <div><p>STRUCTURE</p><h2 id="structure-heading">Set the series length</h2></div>
            </div>
            <div className={styles.segmented}>
              <button disabled={mode === "ranked"} className={structure === "bo1" ? styles.selected : ""} aria-pressed={structure === "bo1"} onClick={() => setStructure("bo1")}>
                <b>BO1</b><span>Best of One</span>
              </button>
              <button className={structure === "bo3" ? styles.selected : ""} aria-pressed={structure === "bo3"} onClick={() => setStructure("bo3")}>
                <b>BO3</b><span>Best of Three</span>
              </button>
            </div>
          </section>

          {mode === "ranked" ? <section className={styles.section} aria-labelledby="ranked-decks-heading">
            <div className={styles.heading}><span className={styles.step}>03</span><div><p>RANKED DECKS</p><h2 id="ranked-decks-heading">Lock three Competitive decks</h2></div></div>
            <div className={styles.rankedDeckGrid}>
              {competitiveDecks.map((deck) => {
                const checked = rankedDeckIds.includes(deck.id);
                return <label className={checked ? styles.selected : ""} key={deck.id}>
                  <input type="checkbox" checked={checked} disabled={!checked && rankedDeckIds.length >= 3} onChange={() => setRankedDeckIds((current) => checked ? current.filter((id) => id !== deck.id) : [...current, deck.id])} />
                  <strong>{deck.name}</strong><span>{deck.cardIds.length} cards · {deck.factions.join(" • ")}</span>
                </label>;
              })}
              {!competitiveDecks.length ? <p>No legal Competitive decks yet. Create three 50-card Competitive decks in Deck Builder.</p> : null}
            </div>
          </section> : null}

          <section className={styles.section} aria-labelledby="lobby-action-heading">
            <div className={styles.heading}>
              <span className={styles.step}>{mode === "ranked" ? "04" : "03"}</span>
              <div><p>LOBBY</p><h2 id="lobby-action-heading">Create or join</h2></div>
            </div>
            <div className={styles.actionGrid}>
              <button className={action === "create" ? styles.selected : ""} aria-pressed={action === "create"} onClick={() => setAction("create")}>
                <span className={styles.optionIndex}>HOST</span>
                <strong>Create Lobby</strong>
                <span>{mode === "training" ? "Training always creates a new lobby." : "Become the lobby owner and configure the match."}</span>
              </button>
              <button
                className={action === "join" ? styles.selected : ""}
                aria-pressed={action === "join"}
                disabled={mode === "training"}
                onClick={() => setAction("join")}
              >
                <span className={styles.optionIndex}>CONNECT</span>
                <strong>Join Lobby</strong>
                <span>{mode === "training" ? "Unavailable in Training." : "Enter an existing lobby code."}</span>
              </button>
            </div>
            {mode !== "training" && action === "join" ? (
              <label className={styles.codeField}>
                <span>LOBBY CODE</span>
                <input
                  value={roomCode}
                  onChange={(event) => setRoomCode(normalizeRoomCode(event.target.value))}
                  placeholder="BP7K3M"
                  maxLength={6}
                  autoComplete="off"
                  inputMode="text"
                />
              </label>
            ) : null}
          </section>

          <footer className={styles.launchArea}>
            <div className={styles.selectionSummary} aria-label="Selected match settings">
              <div><span>MODE</span><strong>{mode.toUpperCase()}</strong></div>
              <div><span>STRUCTURE</span><strong>{structure === "bo3" ? "BEST OF THREE" : "BEST OF ONE"}</strong></div>
              <div><span>ACTION</span><strong>{mode === "training" || action === "create" ? "CREATE" : "JOIN"}</strong></div>
            </div>
            <button className={styles.launchButton} disabled={busy || (mode === "ranked" ? rankedDecks.length !== 3 || !authUser : !preferredDeck)} onClick={() => void launch()}>
              <span>{busy ? "OPENING LOBBY…" : actionLabel}</span><ChevronArrow />
            </button>
          </footer>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </section>
      </main>
    </div>
  );
}
