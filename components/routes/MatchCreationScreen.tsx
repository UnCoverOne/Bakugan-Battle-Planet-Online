"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { validateDeck, type DeckRecord } from "../../lib/data";
import { normalizeRoomCode } from "../../lib/play-setup-machine";
import { createTrainingLobbyState } from "../../lib/training-lobby";
import { useApp } from "../application/AppProvider";
import { RouteHero, Surface } from "../design-system/primitives";
import styles from "./MatchCreationScreen.module.css";

type MatchModeChoice = "training" | "casual" | "ranked";
type LobbyAction = "create" | "join";

type PendingLaunch = {
  action: Exclude<LobbyAction, never>;
  deckId: string;
  structure: "bo1" | "bo3";
  roomCode: string;
} | null;

function modeFromProvider(mode: string): MatchModeChoice {
  return mode === "solo" ? "training" : "casual";
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
    matchError,
  } = useApp();
  const [mode, setMode] = useState<MatchModeChoice>(() => modeFromProvider(matchMode));
  const [structure, setStructure] = useState<"bo1" | "bo3">(format === "bo3" ? "bo3" : "bo1");
  const [action, setAction] = useState<LobbyAction>(matchMode === "join" ? "join" : "create");
  const [roomCode, setRoomCode] = useState(() => normalizeRoomCode(storedJoinCode));
  const [pending, setPending] = useState<PendingLaunch>(null);
  const [error, setError] = useState("");

  const legalDecks = useMemo(
    () => (decks as DeckRecord[]).filter((deck) => validateDeck(deck).isLegal),
    [decks],
  );
  const preferredDeck = useMemo(() => {
    const current = selectedDeck as DeckRecord | null;
    if (current && validateDeck(current).isLegal) return current;
    return legalDecks.find((deck) => deck.id === selectedDeckId) ?? legalDecks[0] ?? null;
  }, [legalDecks, selectedDeck, selectedDeckId]);

  useEffect(() => {
    if (mode === "training" && action !== "create") setAction("create");
  }, [action, mode]);

  useEffect(() => {
    if (!pending || !preferredDeck) return;
    const targetMode = pending.action === "join" ? "join" : "online";
    if (selectedDeckId !== pending.deckId) return;
    if (format !== pending.structure) return;
    if (matchMode !== targetMode) return;
    if (pending.action === "join" && normalizeRoomCode(storedJoinCode) !== pending.roomCode) return;

    let cancelled = false;
    const run = async () => {
      const launch = pending.action === "join" ? joinOnline : createOnline;
      const result = await launch();
      if (cancelled) return;
      setPending(null);
      if (result?.ok === false) setError(result.error ?? "The lobby could not be opened.");
    };
    void run();
    return () => { cancelled = true; };
  }, [createOnline, format, joinOnline, matchMode, pending, preferredDeck, selectedDeckId, storedJoinCode]);

  useEffect(() => {
    if (matchError) setError(matchError);
  }, [matchError]);

  const chooseMode = (next: MatchModeChoice) => {
    if (next === "ranked") return;
    setMode(next);
    if (next === "training") setAction("create");
    setError("");
  };

  const launch = () => {
    if (!preferredDeck) {
      setError("Create a legal deck before entering a lobby.");
      return;
    }
    if (mode === "ranked") return;
    const normalizedCode = normalizeRoomCode(roomCode);
    if (action === "join" && normalizedCode.length !== 6) {
      setError("Enter the complete six-character lobby code.");
      return;
    }
    setError("");
    setFormat(structure);
    setSelectedDeckId(preferredDeck.id);

    if (mode === "training") {
      setMatchMode("solo");
      setJoinCode("");
      const code = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
      const state = createTrainingLobbyState(code, structure, playerId, profile.name, preferredDeck);
      setOnline(false);
      setMatch(state);
      router.push("/play/lobby");
      return;
    }

    const providerMode = action === "join" ? "join" : "online";
    setMatchMode(providerMode);
    setJoinCode(action === "join" ? normalizedCode : "");
    setPending({ action, deckId: preferredDeck.id, structure, roomCode: normalizedCode });
  };

  const busy = Boolean(pending);
  const actionLabel = mode === "training" || action === "create" ? "CREATE LOBBY" : "JOIN LOBBY";

  return (
    <div className={styles.route}>
      <RouteHero
        eyebrow="MATCH CREATION"
        title="Enter the arena"
        description="Choose the mode, match structure, and lobby action on one screen. Decks, format, meta, ready state, and chat are handled inside the lobby."
      />

      <main className={styles.shell}>
        <Surface className={styles.panel} elevation="raised">
          <section className={styles.section} aria-labelledby="match-mode-heading">
            <div className={styles.heading}>
              <span>01</span>
              <div><p>MODE</p><h2 id="match-mode-heading">Choose how you want to play</h2></div>
            </div>
            <div className={styles.modeGrid}>
              <button className={mode === "training" ? styles.selected : ""} aria-pressed={mode === "training"} onClick={() => chooseMode("training")}>
                <strong>Training</strong>
                <span>Practice against Mira Nova in a private local lobby.</span>
              </button>
              <button className={mode === "casual" ? styles.selected : ""} aria-pressed={mode === "casual"} onClick={() => chooseMode("casual")}>
                <strong>Casual</strong>
                <span>Create or join a private online lobby.</span>
              </button>
              <button className={styles.disabled} disabled aria-disabled="true">
                <strong>Ranked</strong>
                <span>Under development</span>
                <small>Competitive format will be locked here when Ranked launches.</small>
              </button>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="structure-heading">
            <div className={styles.heading}>
              <span>02</span>
              <div><p>STRUCTURE</p><h2 id="structure-heading">Set the series length</h2></div>
            </div>
            <div className={styles.segmented}>
              <button className={structure === "bo1" ? styles.selected : ""} aria-pressed={structure === "bo1"} onClick={() => setStructure("bo1")}>
                <b>BO1</b><span>Best of One</span>
              </button>
              <button className={structure === "bo3" ? styles.selected : ""} aria-pressed={structure === "bo3"} onClick={() => setStructure("bo3")}>
                <b>BO3</b><span>Best of Three</span>
              </button>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="lobby-action-heading">
            <div className={styles.heading}>
              <span>03</span>
              <div><p>LOBBY</p><h2 id="lobby-action-heading">Create or join</h2></div>
            </div>
            <div className={styles.actionGrid}>
              <button className={action === "create" ? styles.selected : ""} aria-pressed={action === "create"} onClick={() => setAction("create")}>
                <strong>Create Lobby</strong>
                <span>{mode === "training" ? "Training always creates a new lobby." : "Become the lobby owner and configure the match."}</span>
              </button>
              <button
                className={action === "join" ? styles.selected : ""}
                aria-pressed={action === "join"}
                disabled={mode === "training"}
                onClick={() => setAction("join")}
              >
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
            <div className={styles.preflight}>
              <span>DECK SELECTION MOVED TO LOBBY</span>
              <p>{preferredDeck
                ? `Your current legal deck (${preferredDeck.name}) will provision the seat; you can change it before readying.`
                : "You need at least one legal deck to provision a lobby seat."}</p>
              {!preferredDeck ? <Link href="/decks">OPEN MY DECKS</Link> : null}
            </div>
            <button className={styles.launchButton} disabled={busy || !preferredDeck || mode === "ranked"} onClick={launch}>
              {busy ? "OPENING LOBBY…" : actionLabel}
            </button>
          </footer>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </Surface>
      </main>
    </div>
  );
}
