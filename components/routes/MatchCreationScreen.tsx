"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeRoomCode } from "../../lib/room-code";
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
  const { format, authUser } = useAppFields(["format", "authUser"]);
  const [mode, setMode] = useState<MatchModeChoice>("casual");
  const [structure, setStructure] = useState<"bo1" | "bo3">(format === "bo3" ? "bo3" : "bo1");
  const inviteCode=searchParams?.get("join") ?? "";
  const [roomCode, setRoomCode] = useState(() => normalizeRoomCode(inviteCode));
  useEffect(()=>{if(inviteCode)setRoomCode(normalizeRoomCode(inviteCode));},[inviteCode]);
  const [busyAction, setBusyAction] = useState<"create" | "join" | "">("");
  const [joinError, setJoinError] = useState("");
  const [error, setError] = useState("");
  const busy = Boolean(busyAction) || lobbySession.unavailable || lobbySession.busy;
  const selectedMode = MODES.find((candidate) => candidate.id === mode)!;
  const chooseMode = (next: MatchModeChoice) => {
    if (next === mode) return;
    setMode(next);
    setError("");
  };

  const createLobby = async () => {
    if (busy) return;
    setError("");
    if (mode === "ranked" && !authUser) {
      setError("Sign in before creating a Ranked lobby.");
      return;
    }
    setBusyAction("create");
    try {
      await lobbySession.command({
        action: "create",
        commandId: crypto.randomUUID(),
        mode,
        structure: mode === "ranked" ? "bo3" : structure,
      });
      router.push("/play/lobby");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create lobby.");
    } finally {
      setBusyAction("");
    }
  };

  const joinLobby = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const code = normalizeRoomCode(roomCode);
    setJoinError("");
    if (code.length !== 6) { setJoinError("Enter the complete six-character lobby code."); return; }
    setBusyAction("join");
    try {
      await lobbySession.command({ action: "join", commandId: crypto.randomUUID(), code });
      router.push("/play/lobby");
    } catch (cause) {
      setJoinError(cause instanceof Error ? cause.message : "The lobby could not be joined.");
    } finally { setBusyAction(""); }
  };

  const eligibilityMessage = mode === "ranked" && !authUser ? "Sign in to play Ranked." : "";

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
              disabled={busy} onClick={() => void createLobby()}>
              <span>{busyAction === "create" ? "Opening Lobby…" : "Create Lobby"}</span><LucideIcon name="chevron-right" size={22} />
            </button>
            {eligibilityMessage && !error ? <p className={styles.hint} role="status">{eligibilityMessage}</p> : null}
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
