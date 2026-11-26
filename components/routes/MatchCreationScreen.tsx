"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { deckIsLegalForFormat, validateDeck, type DeckRecord } from "../../lib/data";
import type { DeckRestriction } from "../../lib/deck-validation";
import { deckAllowedInMeta, isLobbyMeta } from "../../lib/meta-formats";
import { normalizeRoomCode } from "../../lib/room-code";
import { initializeLocalReplayJournal } from "../../lib/replay-journal";
import { createTrainingLobbyState } from "../../lib/training-lobby";
import { primeMatchStore } from "../game-screen-v2/matchStore";
import { useLobbySession } from "../application/LobbySessionProvider";
import { useAppFields } from "../application/AppProvider";
import { LucideIcon, type LucideIconName } from "../design-system/LucideIcon";
import styles from "./MatchCreationScreen.module.css";

type MatchModeChoice = "training" | "casual" | "ranked";
const MODES: readonly { id: MatchModeChoice; label: string; icon: LucideIconName; art: string; description: string }[] = [
  { id: "training", label: "Training", icon: "bot", art: "/assets/aquos.png", description: "Practise against Mira Nova and put your decks to the test." },
  { id: "casual", label: "Casual", icon: "swords", art: "/assets/pyrus.png", description: "Challenge another Brawler in a private online battle using your own decks and rules." },
  { id: "ranked", label: "Ranked", icon: "trophy", art: "/assets/darkus.png", description: "Compete for Brawler Points in a three-deck Competitive Conquest series." },
];

export function MatchCreationScreen() {
  const router = useRouter();
  const lobbySession=useLobbySession();
  const searchParams=useSearchParams();
  const {
    format,
    setFormat,
    setMatchMode,
    decks,
    joinCode: storedJoinCode,
    setJoinCode,
    createOnline,
    joinOnline,
    setMatch,
    setOnline,
    profile,
    playerId,
    authUser,
    catalogueRevision,
  } = useAppFields(["format", "setFormat", "setMatchMode", "decks", "joinCode", "setJoinCode", "createOnline", "joinOnline", "setMatch", "setOnline", "profile", "playerId", "authUser", "catalogueRevision"]);
  const [mode, setMode] = useState<MatchModeChoice>("casual");
  const [structure, setStructure] = useState<"bo1" | "bo3">(format === "bo3" ? "bo3" : "bo1");
  const inviteCode=lobbySession.enabled?searchParams?.get("join")??"":"";
  const [roomCode, setRoomCode] = useState(() => normalizeRoomCode(inviteCode||storedJoinCode));
  useEffect(()=>{if(inviteCode)setRoomCode(normalizeRoomCode(inviteCode));},[inviteCode]);
  const [busyAction, setBusyAction] = useState<"create" | "join" | "">("");
  const [joinError, setJoinError] = useState("");
  const [error, setError] = useState("");
  const [rankedRestrictions, setRankedRestrictions] = useState<DeckRestriction[]>([]);
  const [rankedDeckSize, setRankedDeckSize] = useState<number | null>(null);
  const [rankedRulesLoading, setRankedRulesLoading] = useState(false);
  const [rankedRulesError, setRankedRulesError] = useState("");
  const [rankedRulesAttempt, setRankedRulesAttempt] = useState(0);
  const rankedRulesReady = mode === "ranked" && !rankedRulesLoading && !rankedRulesError && rankedDeckSize !== null;

  // Card overrides mutate catalogue records in place, so their revision must
  // invalidate memoized legality checks even when the saved decks are unchanged.
  const legalDecks = useMemo(
    () => (decks as DeckRecord[]).filter((deck) => deckIsLegalForFormat(deck, "standard")),
    [decks, catalogueRevision],
  );
  const competitiveDecks = useMemo(
    () => rankedRulesReady
      ? (decks as DeckRecord[]).filter((deck) => deckIsLegalForFormat(deck, "competitive", rankedRestrictions, rankedDeckSize!) && deckAllowedInMeta("battle-brawlers", deck))
      : [],
    [decks, rankedRulesReady, rankedDeckSize, rankedRestrictions, catalogueRevision],
  );

  useEffect(() => {
    if (mode !== "ranked") return;
    let active = true;
    setRankedRulesLoading(true);
    setRankedRulesError("");
    setRankedDeckSize(null);
    fetch("/api/ranked?action=rules", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Ranked rules are unavailable.");
        const size = Number(result.ruleset?.deckSize);
        if (!Number.isInteger(size) || size <= 0 || !Array.isArray(result.ruleset?.restrictions)) {
          throw new Error("The published Ranked ruleset is invalid.");
        }
        if (active) {
          setRankedRestrictions(result.ruleset.restrictions);
          setRankedDeckSize(size);
          setRankedRulesLoading(false);
        }
      })
      .catch((cause) => {
        if (!active) return;
        setRankedDeckSize(null);
        setRankedRulesError(cause instanceof Error ? cause.message : "Ranked rules are unavailable.");
        setRankedRulesLoading(false);
      });
    return () => { active = false; };
  }, [mode, rankedRulesAttempt]);

  const busy = Boolean(busyAction);
  const selectedMode = MODES.find((candidate) => candidate.id === mode)!;
  const chooseMode = (next: MatchModeChoice) => {
    if (next === mode) return;
    setMode(next);
    setError("");
    if (next === "ranked") {
      setRankedRulesLoading(true);
      setRankedRulesError("");
      setRankedDeckSize(null);
    }
  };

  const resetPreviousSession = () => {
    setMatch(null);
    setOnline(false);
    primeMatchStore({ route: "play", match: null, online: false, playerId, capability: "", controllerId: "" });
  };

  const createLobby = async () => {
    if (busy) return;
    setError("");
    if (mode === "ranked" && !authUser) {
      setError("Sign in before creating a Ranked lobby.");
      return;
    }
    if(lobbySession.enabled){
      setBusyAction("create");
      try{await lobbySession.command({action:"create",commandId:crypto.randomUUID(),mode,structure:mode==="ranked"?"bo3":structure});router.push("/play/lobby");}
      catch(cause){setError(cause instanceof Error?cause.message:"Could not create lobby.");}
      finally{setBusyAction("");}
      return;
    }
    if (mode === "ranked" && !rankedRulesReady) {
      setError(rankedRulesError || "Wait for the published Ranked rules.");
      return;
    }
    if (mode === "ranked" && competitiveDecks.length < 3) {
      setError("Build three legal Competitive decks before entering a Ranked lobby. Choose your roster inside the lobby.");
      return;
    }
    const bootstrapDeck = mode === "ranked" ? competitiveDecks[0] : legalDecks[0];
    if (!bootstrapDeck) { setError("Create a legal deck before entering a lobby."); return; }
    const matchStructure = mode === "ranked" ? "bo3" : structure;
    setBusyAction("create");
    try {
      if (mode === "training") {
        const response = await fetch("/api/ai-decks", { cache: "no-store" });
        const result = await response.json().catch(() => ({})) as { deck?: DeckRecord; availableDecks?: DeckRecord[]; error?: string };
        if (!response.ok || !result.deck) throw new Error(result.error ?? "No Training AI deck is available.");
        if (!validateDeck(result.deck).isLegal) throw new Error("The selected Training AI deck is no longer legal.");
        const availableAiDecks = (result.availableDecks ?? [result.deck]).filter((deck) => validateDeck(deck).isLegal);
        if (!availableAiDecks.length) throw new Error("No legal Training AI deck is available.");
        const code = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
        const state = createTrainingLobbyState(code, matchStructure, playerId, profile.name, bootstrapDeck, result.deck, availableAiDecks);
        initializeLocalReplayJournal(state, authUser?.id ?? playerId);
        resetPreviousSession();
        setFormat(matchStructure);
        setMatchMode("solo");
        setJoinCode("");
        setMatch(state);
        primeMatchStore({ route: "lobby", match: state, online: false, playerId, capability: "", controllerId: "" });
        router.push("/play/lobby");
      } else {
        const result = await createOnline({ bootstrapDeck, structure: matchStructure, ...(mode === "ranked" ? { mode: "ranked" as const } : {}) });
        if (result?.ok === false) throw new Error(result.error ?? "The lobby could not be opened.");
        setFormat(matchStructure);
        setMatchMode("online");
        setJoinCode("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The lobby could not be opened.");
    } finally { setBusyAction(""); }
  };

  const joinLobby = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const code = normalizeRoomCode(roomCode);
    setJoinError("");
    if (code.length !== 6) { setJoinError("Enter the complete six-character lobby code."); return; }
    setBusyAction("join");
    try {
      if(lobbySession.enabled){
        await lobbySession.command({action:"join",commandId:crypto.randomUUID(),code});router.push("/play/lobby");return;
      }
      const response = await fetch(`/api/game?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The lobby could not be found.");
      if ((result.mode !== "casual" && result.mode !== "ranked") || (result.structure !== "bo1" && result.structure !== "bo3") || !isLobbyMeta(result.meta)) {
        throw new Error("The lobby returned invalid match settings.");
      }
      const ranked = result.mode === "ranked";
      let bootstrapDeck = legalDecks[0];
      if (ranked) {
        if (!authUser) throw new Error("Sign in before joining a Ranked lobby.");
        const size = Number(result.ruleset?.deckSize);
        if (!Number.isInteger(size) || size <= 0 || !Array.isArray(result.ruleset?.restrictions)) throw new Error("The lobby ruleset is invalid.");
        const candidates = (decks as DeckRecord[]).filter((deck) => deckIsLegalForFormat(deck, "competitive", result.ruleset.restrictions, size) && deckAllowedInMeta(result.meta, deck));
        if (candidates.length < 3) throw new Error("Build three legal Competitive decks before entering a Ranked lobby. Choose your roster inside the lobby.");
        bootstrapDeck = candidates[0];
      }
      if (!bootstrapDeck) throw new Error("Create a legal deck before entering a lobby.");
      const joined = await joinOnline({ bootstrapDeck, roomCode: code, structure: result.structure, ...(ranked ? { mode: "ranked" as const } : {}) });
      if (joined?.ok === false) throw new Error(joined.error ?? "The lobby could not be joined.");
      setFormat(result.structure);
      setMatchMode("join");
      setJoinCode(code);
    } catch (cause) {
      setJoinError(cause instanceof Error ? cause.message : "The lobby could not be joined.");
    } finally { setBusyAction(""); }
  };

  const eligibilityMessage = lobbySession.enabled ? (mode==="ranked"&&!authUser?"Sign in to play Ranked.":"") : mode === "ranked"
    ? !authUser ? "Sign in to play Ranked."
      : rankedRulesLoading ? "Loading Competitive rules…"
      : rankedRulesError ? rankedRulesError
      : rankedRulesReady && competitiveDecks.length < 3 ? "Three legal Competitive decks are required to enter."
      : ""
    : !legalDecks.length ? "A legal deck is required to enter." : "";

  return (
    <div className={styles.route}>
      <section className={styles.hero} aria-labelledby="match-mode-heading">
        <div className={styles.heroInner}>
          <div className={styles.artwork} aria-hidden="true">
            <img src={selectedMode.art} alt="" width={1100} height={837} />
          </div>
          <div className={styles.controls}>
            <h1 id="match-mode-heading">Choose Your Mode</h1>
            <div className={styles.modeSelector} role="group" aria-label="Battle mode">
              {MODES.map((candidate) => (
                <button key={candidate.id} type="button" className={`bb-button ${styles.modeButton}`}
                  aria-pressed={mode === candidate.id} disabled={busy} onClick={() => chooseMode(candidate.id)}>
                  <LucideIcon name={candidate.icon} size={28} />
                  <span>{candidate.label}</span>
                </button>
              ))}
            </div>
            <p className={styles.description} aria-live="polite">{selectedMode.description}</p>
            <div className={styles.structure}>
              <h2 id="match-structure-heading">Match Structure</h2>
              {mode === "ranked" ? (
                <div className={styles.fixedStructure}>
                  <span>Best of Three</span><LucideIcon name="lock" size={16} />
                </div>
              ) : (
                <div className={styles.segmented} role="group" aria-labelledby="match-structure-heading">
                  {([{ id: "bo1", label: "Best of One" }, { id: "bo3", label: "Best of Three" }] as const).map((choice) => (
                    <button key={choice.id} type="button" className={styles.structureButton} aria-pressed={structure === choice.id} disabled={busy} onClick={() => setStructure(choice.id)}>
                      {choice.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className={`bb-button bb-button--primary ${styles.createButton}`}
              disabled={busy || (lobbySession.enabled ? lobbySession.unavailable||lobbySession.busy : (mode === "ranked" && rankedRulesLoading))} onClick={() => void createLobby()}>
              <span>{busyAction === "create" ? "Opening Lobby…" : "Create Lobby"}</span><LucideIcon name="chevron-right" size={22} />
            </button>
            {eligibilityMessage && !error ? <p className={styles.hint} role="status">{eligibilityMessage}</p> : null}
            {mode === "ranked" && rankedRulesError ? <button type="button" className={styles.retry} disabled={busy} onClick={() => { setError(""); setRankedRulesAttempt((attempt) => attempt + 1); }}>Retry loading rules</button> : null}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </div>
        </div>
      </section>
      <section className={styles.joinSection} aria-labelledby="join-heading">
        <div className={styles.joinInner}>
          <div className={styles.joinCopy}>
            <h2 id="join-heading">Join a Lobby</h2>
            <p>Already have an invitation code?</p>
          </div>
          <form className={styles.joinForm} onSubmit={joinLobby}>
            <input className={`bb-field ${styles.codeField}`} aria-label="Lobby code" value={roomCode}
              onChange={(event) => { setRoomCode(normalizeRoomCode(event.target.value)); setJoinError(""); }}
              placeholder="Lobby code" maxLength={6} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} />
            <button type="submit" className={`bb-button ${styles.joinButton}`} disabled={busy || roomCode.length !== 6}>
              <span>{busyAction === "join" ? "Joining…" : "Join Lobby"}</span><LucideIcon name="chevron-right" size={18} />
            </button>
          </form>
          {joinError ? <p className={styles.error} role="alert">{joinError}</p> : null}
        </div>
      </section>
    </div>
  );
}
