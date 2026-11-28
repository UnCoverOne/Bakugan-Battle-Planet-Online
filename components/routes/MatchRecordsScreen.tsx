"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LucideIcon } from "../design-system/LucideIcon";
import { useAppFields } from "../application/AppProvider";
import { SystemState } from "../application/SystemState";
import { formatTimestamp } from "../application/ui";
import { ReplayTheatre } from "../replay/ReplayTheatre";
import { Field, StatusChip, Surface } from "../design-system/primitives";
import styles from "./MatchRecordsScreen.module.css";
const resultTone=(result:string)=>result==="Victor"?"success":result==="Defeat"?"danger":"neutral";
export function MatchRecordsScreen({recordId=""}:{recordId?:string}){
 const router=useRouter();
 const {history,replay,setReplay}=useAppFields(["history","replay","setReplay"]);
 const [filter,setFilter]=useState("all");
 const activeRecord=recordId?(history.find((item:any)=>item.id===recordId)??(replay?.id===recordId?replay:null)):null;
 useEffect(()=>{if(recordId){const record=history.find((item:any)=>item.id===recordId);if(record)setReplay(record);}},[history,recordId,setReplay]);
 return <div className={styles.route}>{!activeRecord&&<header className={styles.pageHeader}><Link href="/profile"><LucideIcon name="arrow-left" size={16}/> Brawler Profile</Link><h1>Match Records</h1></header>}<RecordsPanel history={history} activeRecord={activeRecord} filter={filter} setFilter={setFilter} router={router}/></div>;
}
function RecordsPanel({
  history,
  activeRecord,
  filter,
  setFilter,
  router,
}: any) {
  if (activeRecord) {
    return (
      <ReplayTheatre
        record={activeRecord}
        onBack={() => router.push("/profile/records")}
      />
    );
  }
  const visible = history.filter(
    (item: any) =>
      filter === "all" ||
      item.result.toLowerCase() === filter ||
      item.mode === filter ||
      item.format === filter,
  );
  return (
    <section className={styles.section}>
      <header className={styles.sectionToolbar}>
        <div>
          <span>Match archive</span>
          <h2>Recorded matches</h2>
        </div>
        <Field label="Filter">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All records</option>
            <option value="victor">Victories</option>
            <option value="defeat">Defeats</option>
            <option value="training">Training</option>
            <option value="casual">Casual</option>
            <option value="ranked">Ranked</option>
            <option value="bo1">Best of one</option>
            <option value="bo3">Best of three</option>
          </select>
        </Field>
      </header>
      {visible.length ? (
        <Surface className={styles.recordTable}>
          {visible.map((item: any) => (
            <button
              key={item.id}
              onClick={() =>
                router.push(`/profile/records/${encodeURIComponent(item.id)}`)
              }
            >
              <StatusChip tone={resultTone(item.result)}>
                {item.result}
              </StatusChip>
              <strong>{item.opponent}</strong>
              <span>{item.score}</span>
              <span>{item.mode ?? "legacy"}</span>
              <small>{formatTimestamp(item.at)}</small>
              <i>Open <LucideIcon name="arrow-right" size={16}/></i>
            </button>
          ))}
        </Surface>
      ) : (
        <SystemState
          compact
          tone="empty"
          title="No matching records"
          message="Complete a training or online match, or clear the current filter."
          actions={<Link href="/play">Play a match</Link>}
        />
      )}
    </section>
  );
}
