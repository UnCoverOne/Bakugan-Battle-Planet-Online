"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, Metric, PageHeader, copyText, formatTimestamp } from "../application/ui";

export function HistoryScreen({ recordId: id }: { recordId?: string }) {
  const router = useRouter();
  const { history, replay, setReplay, replayIndex, setReplayIndex } = useApp();
  const [formatFilter, setFormatFilter] = useState<"all" | "bo1" | "bo3">("all");
  const visibleHistory = history.filter((item: any) => formatFilter === "all" || item.format === formatFilter);

  useEffect(() => {
    if (!id) return;
    const record = history.find((item: any) => item.id === id);
    if (!record) return;
    setReplay(record);
    setReplayIndex(Math.max(0, record.log.length - 1));
  }, [history, id, setReplay, setReplayIndex]);

  const activeReplay = id ? history.find((item: any) => item.id === id) ?? replay : replay;
  const openReplay = (recordId: string) => {
    const record = history.find((item: any) => item.id === recordId);
    if (!record) return;
    setReplay(record);
    setReplayIndex(Math.max(0, record.log.length - 1));
    router.push(`/history/${encodeURIComponent(record.id)}`);
  };

  return <>
    <PageHeader eyebrow="MATCH ARCHIVE" title="HISTORY & REPLAY" copy="Inspect locally retained result records, event order, and published random outcomes." art="/assets/darkus.png" />
    {!activeReplay ? <section className="history-layout"><div className="panel history-list"><div className="panel-heading"><div><span className="eyebrow">RECENT MATCHES</span><h2>{visibleHistory.length} RECORDED</h2></div><label><span className="sr-only">Filter history by format</span><select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as typeof formatFilter)}><option value="all">All formats</option><option value="bo1">Best of one</option><option value="bo3">Best of three</option></select></label></div>{visibleHistory.length ? visibleHistory.map((item: any) => <button className="history-row" key={item.id} onClick={() => openReplay(item.id)}><Badge tone={item.result === "Victor" ? "gold" : "red"}>{item.result}</Badge><strong>vs {item.opponent}</strong><span>{item.score}</span><span>{item.reason}</span><small>{formatTimestamp(item.at)} • {(item.format ?? "unknown").toUpperCase()} • {item.mode ?? "legacy"}</small><i>OPEN RECORD →</i></button>) : <div className="empty-state"><strong>{history.length ? "NO MATCHES IN THIS FORMAT" : "NO MATCHES YET"}</strong><p>{history.length ? "Choose another format or show all records." : "Complete a training or online match to create a record."}</p>{history.length ? <AppButton tone="ghost" onClick={() => setFormatFilter("all")}>SHOW ALL FORMATS</AppButton> : <Link className="hex-button red" href="/play">START A TRAINING MATCH</Link>}</div>}</div><aside className="panel archive-stats"><h2>ARCHIVE SUMMARY</h2><Metric label="Matches" value={history.length} /><Metric label="Victories" value={history.filter((item: any) => item.result === "Victor").length} /><Metric label="Replays" value={history.length} /></aside></section>
      : <section className="replay-page"><header><button onClick={() => { setReplay(null); router.push("/history"); }}>← HISTORY</button><div><span className="eyebrow">RECORD {activeReplay.id}</span><h2>{activeReplay.result} vs {activeReplay.opponent}</h2></div><AppButton tone="ghost" onClick={() => void copyText(window.location.href)}>COPY RECORD LINK</AppButton></header><div className="replay-theatre"><div className="replay-event"><Badge tone={activeReplay.log[replayIndex]?.kind === "random" ? "gold" : "blue"}>{activeReplay.log[replayIndex]?.kind.toUpperCase()}</Badge><h2>{activeReplay.log[replayIndex]?.message}</h2><small>{new Date(activeReplay.log[replayIndex]?.at ?? 0).toLocaleTimeString()}</small></div><div className="replay-board"><img src="/assets/playmat.webp" alt="Static battlefield reference; this record replays the event log rather than reconstructing game state" loading="lazy" decoding="async" width="1200" height="720" /></div><aside aria-label="Replay events">{activeReplay.log.map((event: any, index: number) => <button className={index === replayIndex ? "active" : ""} aria-current={index === replayIndex ? "step" : undefined} key={event.id} onClick={() => setReplayIndex(index)}><span>{index + 1}</span>{event.message}</button>)}</aside></div><div className="replay-controls"><button onClick={() => setReplayIndex(Math.max(0, replayIndex - 1))}>◀ STEP</button><input aria-label="Replay event" type="range" min="0" max={Math.max(0, activeReplay.log.length - 1)} value={replayIndex} onChange={(event) => setReplayIndex(Number(event.target.value))} /><button onClick={() => setReplayIndex(Math.min(activeReplay.log.length - 1, replayIndex + 1))}>STEP ▶</button><Badge>{replayIndex + 1} / {activeReplay.log.length}</Badge></div></section>}
  </>;
}
