"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, Metric, PageHeader, formatTimestamp } from "../application/ui";
import { ReplayTheatre } from "../replay/ReplayTheatre";

export function HistoryScreen({ recordId: id }: { recordId?: string }) {
  const router = useRouter();
  const { history, replay, setReplay } = useApp();
  const [formatFilter, setFormatFilter] = useState<"all" | "bo1" | "bo3">("all");
  const visibleHistory = history.filter((item: any) => formatFilter === "all" || item.format === formatFilter);

  useEffect(() => {
    if (!id) return;
    const record = history.find((item: any) => item.id === id);
    if (!record) return;
    setReplay(record);
  }, [history, id, setReplay]);

  const activeReplay = id
    ? history.find((item: any) => item.id === id) ?? (replay?.id === id ? replay : null)
    : null;
  const openReplay = (recordId: string) => {
    const record = history.find((item: any) => item.id === recordId);
    if (!record) return;
    setReplay(record);
    router.push(`/history/${encodeURIComponent(record.id)}`);
  };

  if (id && activeReplay) {
    return <ReplayTheatre record={activeReplay} onBack={() => {
      setReplay(null);
      router.push("/history");
    }} />;
  }

  return <>
    <PageHeader eyebrow="MATCH ARCHIVE" title="HISTORY & REPLAY" copy="Inspect locally retained result records, event order, and published random outcomes." art="/assets/darkus.png" />
    <section className="history-layout"><div className="panel history-list"><div className="panel-heading"><div><span className="eyebrow">RECENT MATCHES</span><h2>{visibleHistory.length} RECORDED</h2></div><label><span className="sr-only">Filter history by format</span><select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as typeof formatFilter)}><option value="all">All formats</option><option value="bo1">Best of one</option><option value="bo3">Best of three</option></select></label></div>{visibleHistory.length ? visibleHistory.map((item: any) => <button className="history-row" key={item.id} onClick={() => openReplay(item.id)}><Badge tone={item.result === "Victor" ? "gold" : "red"}>{item.result}</Badge><strong>vs {item.opponent}</strong><span>{item.score}</span><span>{item.reason}</span><small>{formatTimestamp(item.at)} • {(item.format ?? "unknown").toUpperCase()} • {item.mode ?? "legacy"}</small><i>OPEN RECORD →</i></button>) : <div className="empty-state"><strong>{history.length ? "NO MATCHES IN THIS FORMAT" : "NO MATCHES YET"}</strong><p>{history.length ? "Choose another format or show all records." : "Complete a training or online match to create a record."}</p>{history.length ? <AppButton tone="ghost" onClick={() => setFormatFilter("all")}>SHOW ALL FORMATS</AppButton> : <Link className="hex-button red" href="/play">START A TRAINING MATCH</Link>}</div>}</div><aside className="panel archive-stats"><h2>ARCHIVE SUMMARY</h2><Metric label="Matches" value={history.length} /><Metric label="Victories" value={history.filter((item: any) => item.result === "Victor").length} /><Metric label="Replays" value={history.filter((item: any) => item.replayAvailable !== false).length} /></aside></section>
  </>;
}
