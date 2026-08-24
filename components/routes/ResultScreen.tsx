"use client";

import { OriginalImage } from "@/components/media/OriginalImage";
import { useRouter } from "next/navigation";
import { useApp } from "../application/AppProvider";
import { useMatchSelector } from "../game-screen-v2/matchStore";
import { AppButton, Badge, Metric } from "../application/ui";
import { MatchResultSocial } from "../social/MatchResultSocial";
import { completedMatchKey, isCompletedSeriesResult } from "../../lib/match-result-navigation";
import { matchRoundCount } from "../../lib/match-result-summary";

const MATCH_CAPABILITY_STORAGE_KEY = "bbp-match-capability-v2";
const MATCH_CONTROLLER_STORAGE_KEY = "bbp-match-controller-v1";

function clearCompletedMatchSession(setMatch: (match: null) => void, setOnline: (online: boolean) => void) {
  setMatch(null);
  setOnline(false);
  try {
    sessionStorage.removeItem(MATCH_CAPABILITY_STORAGE_KEY);
    sessionStorage.removeItem(MATCH_CONTROLLER_STORAGE_KEY);
  } catch {}
}

export function ResultScreen() {
  const router = useRouter();
  const {
    history,
    nextSeriesGame,
    leaveMatch,
    setReplay,
    setReplayIndex,
    setMatch,
    setOnline,
  } = useApp();
  const { match, playerId } = useMatchSelector((state) => ({
    match: state.match,
    playerId: state.playerId,
  }));

  if (!match || match.phase !== "result" || !match.winner || !match.players.some((player: any) => player.id === match.winner)) {
    return <ResultUnavailable />;
  }

  const won = match.winner === playerId;
  const complete = isCompletedSeriesResult(match);
  const recordId = completedMatchKey(match);
  const exactRecord = history.find((record: any) => record.id === recordId);
  const rounds = matchRoundCount(match);

  const openRecord = () => {
    if (!exactRecord) return;
    setReplay(exactRecord);
    setReplayIndex(Math.max(0, (exactRecord.log?.length ?? 1) - 1));
    clearCompletedMatchSession(setMatch, setOnline);
    router.replace(`/profile/records/${encodeURIComponent(exactRecord.id)}`);
  };

  return (
    <section className={`result-page ${won ? "victory" : "defeat"}`}>
      <OriginalImage className="result-art" src="/assets/winner.png" alt="" />
      <div className="result-content">
        <Badge tone={won ? "gold" : "red"}>{complete ? "MATCH COMPLETE" : "SERIES INTERMISSION"}</Badge>
        <h1>{won ? "VICTOR" : "DEFEAT"}</h1>
        <p>{match.resultReason}</p>
        <div className="series-score">
          {match.players.map((player: any) => (
            <div key={player.id}>
              {player.id === playerId
                ? <strong>{player.name}</strong>
                : <MatchResultSocial matchCode={match.code} opponentUserId={exactRecord?.opponentUserId} opponentName={player.name} />}
              <span>{match.series[player.id] ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="result-stats">
          <Metric label="Game" value={`${match.gameNumber}`} />
          <Metric label="Format" value={match.format.toUpperCase()} />
          <Metric label="Rounds" value={rounds} />
        </div>
        <div className="result-actions">
          {!complete && <AppButton tone="red" onClick={() => void nextSeriesGame()}>NEXT GAME • NEW MATRIX</AppButton>}
          <AppButton tone="gold" disabled={!exactRecord} onClick={openRecord}>VIEW MATCH RECORD</AppButton>
          <AppButton tone="ghost" onClick={leaveMatch}>DASHBOARD</AppButton>
        </div>
        <small>{exactRecord ? `Result stored in Match Records • ${exactRecord.at}` : "Saving result to Match Records…"}</small>
      </div>
    </section>
  );
}

function ResultUnavailable() {
  return (
    <section className="empty-page">
      <OriginalImage src="/assets/logo.png" alt="" />
      <h1>RESULT UNAVAILABLE</h1>
      <p>Return to the dashboard and start a new match.</p>
      <a className="hex-button ghost" href="/dashboard">DASHBOARD</a>
    </section>
  );
}
