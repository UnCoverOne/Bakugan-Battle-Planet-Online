"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useReducer } from "react";
import { useApp } from "../application/AppProvider";
import { BAKUGAN, CORES, validateDeck, type DeckRecord } from "../../lib/data";
import { deckSetName } from "../../lib/deck-set";
import { cardArtSource } from "../../lib/content/card-art";
import { AppButton, Badge, Metric, PageHeader } from "../application/ui";
import { ActionButton, Field, RouteHero, StatusChip, Surface } from "../design-system/primitives";
import {
  classifyPlaySetupFailure,
  createPlaySetupState,
  parsePlaySetupStep,
  playSetupReducer,
  playSetupStartBlockers,
  playSetupStepBlockers,
  restorePlaySetupState,
  transitionPlaySetup,
  type PlaySetupEnvironment,
  type PlaySetupEvent,
  type PlaySetupMode,
  type PlaySetupState,
  type PlaySetupStep,
} from "../../lib/play-setup-machine";
import styles from "./PlayRoutes.module.css";

const SETUP_STORAGE_KEY = "bbp-play-setup-machine-v1";
const STEP_LABELS: Record<PlaySetupStep, string> = {
  mode: "Mode",
  loadout: "Loadout",
  ready: "Ready",
};

function useOnlineStatus() {
  const [online, dispatch] = useReducer((_: boolean, value: boolean) => value, true);
  useEffect(() => {
    const update = () => dispatch(navigator.onLine);
    update();
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function PlayScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const online = useOnlineStatus();
  const {
    format,
    setFormat,
    matchMode,
    setMatchMode,
    decks,
    selectedDeck,
    selectedDeckId,
    setSelectedDeckId,
    joinCode,
    setJoinCode,
    startSolo,
    createOnline,
    joinOnline,
    matchError,
    authUser,
    authChecking,
    authError,
    profile,
  } = useApp();
  const initial = createPlaySetupState({
    mode: matchMode,
    format,
    selectedDeckId: selectedDeckId || selectedDeck?.id || "",
    joinCode,
  });
  const [setup, dispatch] = useReducer(playSetupReducer, initial);
  const chosenDeck = decks.find((deck: DeckRecord) => deck.id === setup.selectedDeckId) ?? null;
  const report = useMemo(() => chosenDeck ? validateDeck(chosenDeck) : null, [chosenDeck]);
  const environment = useMemo<PlaySetupEnvironment>(() => ({
    selectedDeck: chosenDeck && report
      ? { id: chosenDeck.id, isLegal: report.isLegal, issues: report.issues }
      : null,
    connection: online ? "online" : "offline",
    authentication: authChecking
      ? "checking"
      : authError && profile.signedIn && !authUser
        ? "failed"
        : authUser
          ? "authenticated"
          : "guest",
  }), [authChecking, authError, authUser, chosenDeck, online, profile.signedIn, report]);
  const requestedStep = parsePlaySetupStep(searchParams.get("step"));
  const stepBlockers = playSetupStepBlockers(setup, environment);
  const startBlockers = playSetupStartBlockers(setup, environment);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SETUP_STORAGE_KEY);
      if (saved) {
        const restored = restorePlaySetupState(JSON.parse(saved), initial);
        dispatch({ event: { type: "RESTORE", state: restored }, environment });
      }
    } catch {}
  // The machine hydrates exactly once; provider fields are synchronized below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(setup)); } catch {}
    if (setup.mode !== matchMode) setMatchMode(setup.mode);
    if (setup.format !== format) setFormat(setup.format);
    if (setup.selectedDeckId !== selectedDeckId) setSelectedDeckId(setup.selectedDeckId);
    if (setup.joinCode !== joinCode) setJoinCode(setup.joinCode);
  }, [format, joinCode, matchMode, selectedDeckId, setFormat, setJoinCode, setMatchMode, setSelectedDeckId, setup]);
  useEffect(() => {
    if (requestedStep && requestedStep !== setup.step) {
      const event = { type: "NAVIGATE", step: requestedStep } as const;
      const next = transitionPlaySetup(setup, event, environment);
      if (
        next.step !== setup.step
        || next.status !== setup.status
        || next.failure?.message !== setup.failure?.message
      ) dispatch({ event, environment });
      if (next.step !== requestedStep) router.replace(`/play?step=${next.step}`, { scroll: false });
    }
  }, [environment, requestedStep, router, setup]);
  useEffect(() => {
    if (setup.status === "launching" && matchError) {
      dispatch({
        event: { type: "LAUNCH_FAILURE", failure: classifyPlaySetupFailure(matchError) },
        environment,
      });
    }
  }, [environment, matchError, setup.status]);

  const send = (event: PlaySetupEvent) => dispatch({ event, environment });
  const navigate = (event: Extract<PlaySetupEvent, { type: "NEXT" | "BACK" | "NAVIGATE" }>) => {
    const next = transitionPlaySetup(setup, event, environment);
    dispatch({ event, environment });
    if (next.step !== setup.step) router.push(`/play?step=${next.step}`, { scroll: false });
  };
  const selectMode = (mode: PlaySetupMode) => send({ type: "SELECT_MODE", mode });
  const launch = async () => {
    const next = transitionPlaySetup(setup, { type: "LAUNCH" }, environment);
    dispatch({ event: { type: "LAUNCH" }, environment });
    if (next.status !== "launching") return;
    const result = await (
      setup.mode === "solo" ? startSolo()
        : setup.mode === "online" ? createOnline()
          : joinOnline()
    );
    if (result?.ok === false) {
      dispatch({
        event: { type: "LAUNCH_FAILURE", failure: classifyPlaySetupFailure(result.error) },
        environment,
      });
    }
  };

  return (
    <div className={styles.route}>
      <RouteHero
        eyebrow="MATCH SETUP"
        title="Prepare to brawl"
        description="Choose the battle, lock a complete legal loadout, then either start training or enter a private room."
        aside={<StepRail current={setup.step} onNavigate={(step) => navigate({ type: "NAVIGATE", step })} />}
      />
      <main className={styles.setup}>
        <Surface className={styles.stage} elevation="raised">
          <header className={styles.stageHeading}>
            <span>STEP {Object.keys(STEP_LABELS).indexOf(setup.step) + 1} OF 3</span>
            <div><h2>{STEP_LABELS[setup.step]}</h2><p>{stepDescription(setup.step)}</p></div>
          </header>
          {setup.step === "mode" && (
            <ModeStep
              setup={setup}
              online={online}
              authentication={environment.authentication}
              onMode={selectMode}
              onFormat={(nextFormat) => send({ type: "SELECT_FORMAT", format: nextFormat })}
              onCode={(code) => send({ type: "SET_JOIN_CODE", code })}
            />
          )}
          {setup.step === "loadout" && (
            <LoadoutStep
              decks={decks}
              selectedDeckId={setup.selectedDeckId}
              onSelect={(deckId) => send({ type: "SELECT_DECK", deckId })}
            />
          )}
          {setup.step === "ready" && (
            <ReadyStep
              setup={setup}
              deck={chosenDeck}
              environment={environment}
              blockers={startBlockers}
            />
          )}
          {setup.failure && (
            <div className={styles.failure} role="alert">
              <strong>{failureTitle(setup.failure.kind)}</strong>
              <span>{setup.failure.message}</span>
              <button onClick={() => send({ type: "CLEAR_FAILURE" })}>Dismiss</button>
            </div>
          )}
        </Surface>
        <SetupSummary setup={setup} deck={chosenDeck} environment={environment} />
      </main>
      <SetupLaunchBar
        setup={setup}
        blockers={stepBlockers}
        onBack={() => navigate({ type: "BACK" })}
        onNext={() => navigate({ type: "NEXT" })}
        onLaunch={() => void launch()}
      />
    </div>
  );
}

function stepDescription(step: PlaySetupStep) {
  if (step === "mode") return "Set the opponent path and series length.";
  if (step === "loadout") return "Choose one deck and inspect every Character card and BakuCore.";
  return "Resolve every preflight item before starting training or entering the room.";
}

function failureTitle(kind: string) {
  if (kind === "connection") return "Connection failed";
  if (kind === "authentication") return "Authentication failed";
  if (kind === "room") return "Room unavailable";
  if (kind === "validation") return "Setup blocked";
  return "Match launch failed";
}

function StepRail({ current, onNavigate }: { current: PlaySetupStep; onNavigate: (step: PlaySetupStep) => void }) {
  return (
    <nav className={styles.stepRail} aria-label="Match setup progress">
      {(Object.keys(STEP_LABELS) as PlaySetupStep[]).map((step, index) => (
        <button
          key={step}
          aria-current={current === step ? "step" : undefined}
          onClick={() => onNavigate(step)}
        >
          <span>{index + 1}</span><strong>{STEP_LABELS[step]}</strong>
        </button>
      ))}
    </nav>
  );
}

function ModeStep({
  setup,
  online,
  authentication,
  onMode,
  onFormat,
  onCode,
}: {
  setup: PlaySetupState;
  online: boolean;
  authentication: PlaySetupEnvironment["authentication"];
  onMode: (mode: PlaySetupMode) => void;
  onFormat: (format: "bo1" | "bo3") => void;
  onCode: (code: string) => void;
}) {
  const modes: Array<{ id: PlaySetupMode; title: string; copy: string; meta: string }> = [
    { id: "solo", title: "Training", copy: "A full rules match against Mira Nova.", meta: "Local · Match history · No network required" },
    { id: "online", title: "Create room", copy: "Open a private room and share its code.", meta: "Online · Private room · 30s reconnect" },
    { id: "join", title: "Join room", copy: "Enter another Brawler’s private room.", meta: "Online · Room code · 30s reconnect" },
  ];
  return (
    <div className={styles.modeStep}>
      <div className={styles.modeGrid}>
        {modes.map((mode) => (
          <button
            className={`${styles.modeCard} ${setup.mode === mode.id ? styles.selected : ""}`}
            aria-pressed={setup.mode === mode.id}
            key={mode.id}
            onClick={() => onMode(mode.id)}
          >
            <span className={styles.modeGlyph} aria-hidden="true">{mode.id === "solo" ? "AI" : mode.id === "online" ? "＋" : "→"}</span>
            <strong>{mode.title}</strong><p>{mode.copy}</p><small>{mode.meta}</small>
          </button>
        ))}
      </div>
      {setup.mode === "join" && (
        <Field
          className={styles.roomCode}
          label="Room code"
          hint="Six characters. Ambiguous letters and numbers are omitted."
        >
          <input
            autoComplete="off"
            inputMode="text"
            value={setup.joinCode}
            onChange={(event) => onCode(event.target.value)}
            maxLength={6}
            placeholder="BP7K3M"
          />
        </Field>
      )}
      <section className={styles.formatSection}>
        <div><span>Match structure</span><h3>Series format</h3></div>
        <div className={styles.formatGrid}>
          <button className={setup.format === "bo1" ? styles.selected : ""} aria-pressed={setup.format === "bo1"} onClick={() => onFormat("bo1")}><b>BO1</b><strong>Best of one</strong><span>One decisive game.</span></button>
          <button className={setup.format === "bo3" ? styles.selected : ""} aria-pressed={setup.format === "bo3"} onClick={() => onFormat("bo3")}><b>BO3</b><strong>Best of three</strong><span>First to two wins.</span></button>
        </div>
      </section>
      <div className={styles.modeHealth} role="status">
        <StatusChip tone={online ? "success" : "danger"}>{online ? "Connected" : "Offline"}</StatusChip>
        <StatusChip tone={authentication === "failed" ? "danger" : authentication === "checking" ? "warning" : "info"}>
          {authentication === "authenticated" ? "Account verified" : authentication === "guest" ? "Guest session" : authentication === "checking" ? "Checking account" : "Account issue"}
        </StatusChip>
      </div>
    </div>
  );
}

function LoadoutStep({
  decks,
  selectedDeckId,
  onSelect,
}: {
  decks: DeckRecord[];
  selectedDeckId: string;
  onSelect: (deckId: string) => void;
}) {
  if (!decks.length) {
    return (
      <div className={styles.emptyLoadout}>
        <strong>No decks available</strong>
        <p>Create a deck with three Character cards, six matching BakuCores, and 40 Main Deck cards.</p>
        <Link href="/decks">Open My Decks</Link>
      </div>
    );
  }
  return (
    <div className={styles.loadoutList}>
      {decks.map((deck) => {
        const report = validateDeck(deck);
        const selected = selectedDeckId === deck.id;
        return (
          <Surface
            as="article"
            className={`${styles.loadoutChoice} ${selected ? styles.loadoutChoiceSelected : ""}`}
            elevation={selected ? "overlay" : "flat"}
            key={deck.id}
          >
            <button className={styles.loadoutSelect} onClick={() => onSelect(deck.id)} aria-pressed={selected}>
              <LoadoutVisual deck={deck} />
            </button>
            <div className={styles.loadoutIdentity}>
              <div>
                <span>{selected ? "SELECTED LOADOUT" : "BATTLE DECK"}</span>
                <h3>{deck.name}</h3>
              </div>
              <StatusChip tone={report.isLegal ? "success" : "danger"}>
                {report.isLegal ? "Legal" : `${report.issues.length} issues`}
              </StatusChip>
              <p>{report.teamFactions.join(" · ") || "No team factions"}</p>
              <small>{report.counts.characters}/3 Character · {report.counts.cores}/6 BakuCores · {report.counts.cards}/40 cards · {deckSetName(deck)}</small>
              {!report.isLegal && (
                <div className={styles.deckIssues}>
                  <ul>{report.issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>
                  <Link href={`/builder/${encodeURIComponent(deck.id)}?returnTo=${encodeURIComponent("/play?step=loadout")}`}>Fix Deck</Link>
                </div>
              )}
            </div>
          </Surface>
        );
      })}
    </div>
  );
}

function LoadoutVisual({ deck }: { deck: DeckRecord }) {
  const characters = deck.bakuganIds.map((id) => BAKUGAN.find((item) => item.id === id));
  const cores = deck.coreIds.map((id) => CORES.find((item) => item.id === id));
  return (
    <div className={styles.loadoutVisual}>
      <div className={styles.characterCards}>
        {Array.from({ length: 3 }, (_, index) => {
          const character = characters[index];
          return character
            ? <img key={character.id} src={cardArtSource(character.character, "full")} loading="lazy" decoding="async" alt={character.name} />
            : <span key={index} aria-label="Empty Character slot">?</span>;
        })}
      </div>
      <div className={styles.coreRow} aria-label="Six BakuCores">
        {Array.from({ length: 6 }, (_, index) => {
          const core = cores[index];
          return core
            ? <span key={`${core.id}-${index}`}><img src={core.art} loading="lazy" alt="" /><small>{core.type}</small></span>
            : <span className={styles.emptyCore} key={index}>?</span>;
        })}
      </div>
    </div>
  );
}

function ReadyStep({
  setup,
  deck,
  environment,
  blockers,
}: {
  setup: PlaySetupState;
  deck: DeckRecord | null;
  environment: PlaySetupEnvironment;
  blockers: ReturnType<typeof playSetupStartBlockers>;
}) {
  const report = deck ? validateDeck(deck) : null;
  return (
    <div className={styles.readyStep}>
      {deck && (
        <Surface className={styles.readyLoadout} elevation="flat">
          <LoadoutVisual deck={deck} />
          <div><span>LOCKED LOADOUT</span><h3>{deck.name}</h3><p>{report?.teamFactions.join(" · ")}</p><small>{deckSetName(deck)} · 3 Character · 6 BakuCores · 40 cards</small></div>
        </Surface>
      )}
      <Surface className={styles.preflight} elevation="flat">
        <div className={styles.preflightHeading}><span>FINAL PREFLIGHT</span><h3>{blockers.length ? "Action required" : "All checks passed"}</h3></div>
        <ul>
          <PreflightItem label="Mode" value={setup.mode === "solo" ? "Training" : setup.mode === "online" ? "Create private room" : `Join ${setup.joinCode || "room"}`} ready={setup.mode !== "join" || setup.joinCode.length === 6} />
          <PreflightItem label="Format" value={setup.format === "bo1" ? "Best of one" : "Best of three"} ready />
          <PreflightItem label="Connection" value={setup.mode === "solo" ? "Not required" : environment.connection === "online" ? "Connected" : "Offline"} ready={setup.mode === "solo" || environment.connection === "online"} />
          <PreflightItem label="Account" value={environment.authentication === "authenticated" ? "Verified account" : environment.authentication === "guest" ? "Guest session" : environment.authentication === "checking" ? "Checking" : "Session failed"} ready={environment.authentication === "authenticated" || environment.authentication === "guest" || setup.mode === "solo"} />
          <PreflightItem label="Deck legality" value={report?.isLegal ? "Legal" : `${report?.issues.length ?? 1} blocking issues`} ready={Boolean(report?.isLegal)} />
        </ul>
        {blockers.length > 0 && <div className={styles.blockerList} role="alert"><strong>{setup.mode === "solo" ? "Start Match" : setup.mode === "online" ? "Create Room" : "Join Room"} is blocked:</strong><ul>{blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul></div>}
      </Surface>
    </div>
  );
}

function PreflightItem({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return <li><span aria-hidden="true">{ready ? "✓" : "!"}</span><div><small>{label}</small><strong>{value}</strong></div></li>;
}

function SetupSummary({
  setup,
  deck,
  environment,
}: {
  setup: PlaySetupState;
  deck: DeckRecord | null;
  environment: PlaySetupEnvironment;
}) {
  const report = deck ? validateDeck(deck) : null;
  return (
    <Surface as="aside" className={styles.summary} elevation="overlay">
      <span className={styles.eyebrow}>SETUP STATUS</span>
      <h2>{setup.status === "launching" ? launchingLabel(setup) : STEP_LABELS[setup.step]}</h2>
      <dl>
        <div><dt>Mode</dt><dd>{setup.mode === "solo" ? "Training" : setup.mode === "online" ? "Create room" : "Join room"}</dd></div>
        <div><dt>Format</dt><dd>{setup.format.toUpperCase()}</dd></div>
        <div><dt>Deck</dt><dd>{deck?.name ?? "Not selected"}</dd></div>
        <div><dt>Team</dt><dd>{report ? `${report.counts.characters}/3` : "—"}</dd></div>
        <div><dt>BakuCores</dt><dd>{report ? `${report.counts.cores}/6` : "—"}</dd></div>
        <div><dt>Legality</dt><dd>{report?.isLegal ? "Legal" : report ? `${report.issues.length} issues` : "Blocked"}</dd></div>
      </dl>
      <div className={styles.summaryHealth}>
        <StatusChip tone={environment.connection === "online" ? "success" : "danger"}>{environment.connection}</StatusChip>
        <StatusChip tone={report?.isLegal ? "success" : "danger"}>{report?.isLegal ? "Loadout ready" : "Loadout blocked"}</StatusChip>
      </div>
      <details><summary>Match rules</summary><ul><li>Original Battle Planet ruleset</li><li>Server-authoritative random outcomes</li><li>30-second reconnect grace online</li></ul></details>
    </Surface>
  );
}

function launchingLabel(setup: PlaySetupState) {
  if (setup.mode === "solo") return "Starting training match…";
  if (setup.mode === "online") return "Creating private room…";
  return `Joining room ${setup.joinCode}…`;
}

function SetupLaunchBar({
  setup,
  blockers,
  onBack,
  onNext,
  onLaunch,
}: {
  setup: PlaySetupState;
  blockers: ReturnType<typeof playSetupStepBlockers>;
  onBack: () => void;
  onNext: () => void;
  onLaunch: () => void;
}) {
  const blocked = blockers.length > 0;
  return (
    <div className={styles.launchDock}>
      <button className={styles.previous} disabled={setup.step === "mode" || setup.status === "launching"} onClick={onBack}>← Previous</button>
      <div className={blocked ? styles.launchBlocked : styles.launchReady} aria-live="polite" aria-atomic="true">
        <strong>{blocked ? `${blockers.length} blocking ${blockers.length === 1 ? "reason" : "reasons"}` : setup.status === "launching" ? launchingLabel(setup) : "Current step complete"}</strong>
        <span>{blocked ? blockers[0].message : setup.step === "ready" ? setup.mode === "solo" ? "Ready to start the training match." : setup.mode === "online" ? "Ready to create the room." : "Ready to join the room." : `Continue to ${setup.step === "mode" ? "Loadout" : "Ready"}.`}</span>
      </div>
      {setup.step === "ready"
        ? <ActionButton disabled={blocked || setup.status === "launching"} onClick={onLaunch}>{setup.status === "launching"
          ? setup.mode === "solo" ? "STARTING…" : setup.mode === "online" ? "CREATING…" : "JOINING…"
          : setup.mode === "solo" ? "START MATCH" : setup.mode === "online" ? "CREATE ROOM" : "JOIN ROOM"}</ActionButton>
        : <ActionButton tone="secondary" disabled={blocked} onClick={onNext}>Continue →</ActionButton>}
    </div>
  );
}

export function LobbyScreen() {
  const { match, playerId, matchError, readyMatch, leaveMatch } = useApp();
  if (!match) return <Empty title="NO ACTIVE ROOM" />;
  return <>
    <PageHeader eyebrow="PRIVATE MATCH ROOM" title={`ROOM ${match.code}`} copy={`${match.format.toUpperCase()} • Original Battle Planet • Server-authoritative`} art="/assets/brawlers-group.png" actions={<AppButton tone="ghost" onClick={() => navigator.clipboard?.writeText(match.code)}>COPY ROOM CODE</AppButton>} />
    <section className="lobby-grid">{[0, 1].map((index) => { const player = match.players[index]; return <article className={`player-seat panel ${player?.ready ? "ready" : ""}`} key={index}>{player ? <><Badge tone={player.id === playerId ? "gold" : "blue"}>{player.id === playerId ? "YOU" : "OPPONENT"}</Badge><div className="seat-avatar">{player.name.slice(0, 2).toUpperCase()}</div><h2>{player.name}</h2><p>{player.bakugan.map((bakugan: any) => bakugan.name).join(" • ")}</p><div className="ready-status"><span className={player.ready ? "online" : "waiting"} />{player.ready ? "DECK LOCKED • READY" : "VALIDATING DECK…"}</div>{player.id === playerId && !player.ready && <AppButton tone="red" onClick={() => void readyMatch()}>LOCK IN & READY</AppButton>}</> : <><div className="seat-avatar waiting">?</div><h2>WAITING FOR BRAWLER</h2><p>Share room code <strong>{match.code}</strong></p><div className="loading-bar" /></>}</article>; })}</section>
    <section className="lobby-rules panel"><div><span className="eyebrow">ROOM FORMAT</span><h2>{match.format === "bo3" ? "BEST OF THREE" : "BEST OF ONE"}</h2></div><div><span className="eyebrow">TIME PROFILE</span><h2>ADAPTIVE</h2><p>20–45 seconds by complexity</p></div><div><span className="eyebrow">RECONNECT</span><h2>00:30</h2><p>Then opponent wins</p></div><AppButton tone="ghost" onClick={leaveMatch}>LEAVE ROOM</AppButton></section>{matchError && <p className="error-message centered">{matchError}</p>}
  </>;
}

export function MatchHostScreen() {
  return <div className="gameplay-match-host" aria-label="Tabletop gameplay client" />;
}

export function ResultScreen() {
  const router = useRouter();
  const { match, playerId, history, nextSeriesGame, leaveMatch, replay, setReplay, setReplayIndex } = useApp();
  if (!match) return <Empty title="NO RESULT" />;
  const won = match.winner === playerId;
  const needed = match.format === "bo3" ? 2 : 1;
  const complete = Math.max(...Object.values(match.series).map(Number)) >= needed;
  const openReplay = () => {
    const item = replay ?? history.find((record: any) => record.id === `${match.id}-${match.gameNumber}`) ?? history[0];
    if (!item) return;
    setReplay(item);
    setReplayIndex(Math.max(0, item.log.length - 1));
    router.push(`/profile/records/${encodeURIComponent(item.id)}`);
  };
  return <section className={`result-page ${won ? "victory" : "defeat"}`}><img className="result-art" src="/assets/winner.png" alt="" /><div className="result-content"><Badge tone={won ? "gold" : "red"}>{complete ? "MATCH COMPLETE" : "SERIES INTERMISSION"}</Badge><h1>{won ? "VICTOR" : "DEFEAT"}</h1><p>{match.resultReason}</p><div className="series-score">{match.players.map((player: any) => <div key={player.id}><strong>{player.name}</strong><span>{match.series[player.id] ?? 0}</span></div>)}</div><div className="result-stats"><Metric label="Game" value={`${match.gameNumber}`} /><Metric label="Format" value={match.format.toUpperCase()} /><Metric label="Events" value={match.log.length} /><Metric label="Random results" value={match.log.filter((event: any) => event.kind === "random").length} /></div><div className="result-actions">{!complete && <AppButton tone="red" onClick={() => void nextSeriesGame()}>NEXT GAME • NEW MATRIX</AppButton>}<AppButton tone="gold" onClick={openReplay}>VIEW MATCH RECORD</AppButton><AppButton tone="ghost" onClick={leaveMatch}>DASHBOARD</AppButton></div><small>Result stored in Match Records • {history[0]?.at}</small></div></section>;
}

function Empty({ title }: { title: string }) {
  return <section className="empty-page"><img src="/assets/logo.png" alt="" /><h1>{title}</h1><p>Return to the dashboard and start a new match.</p><Link className="hex-button ghost" href="/dashboard">DASHBOARD</Link></section>;
}
