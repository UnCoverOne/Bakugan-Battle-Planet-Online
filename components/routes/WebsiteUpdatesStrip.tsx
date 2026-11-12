"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WEBSITE_UPDATE, websitePatchHref } from "../../lib/content/website-updates";
import { APPLICATION_VERSION } from "../../lib/content/versions";
import styles from "./WebsiteUpdatesStrip.module.css";

export function WebsiteUpdatesStrip() {
  const [latest,setLatest]=useState<{version:string;title:string;status:string}|null>(null);
  useEffect(()=>{let active=true;fetch("/api/updates",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(x=>{if(active&&x?.latest)setLatest(x.latest);}).catch(()=>{});return ()=>{active=false;};},[]);
  const update=latest??WEBSITE_UPDATE;
  return (
    <section className={styles.strip} aria-labelledby="home-updates-title">
      <div className={styles.identity}>
        <span className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </span>
        <div className={styles.summary}>
          <h2 id="home-updates-title">Website Updates</h2>
          <p>{update.title} <span aria-hidden="true">·</span> {update.status}</p>
        </div>
      </div>
      <div className={styles.actions}>
        <span className={styles.version} aria-label={`Website version ${APPLICATION_VERSION}`}>v{APPLICATION_VERSION}</span>
        <Link href={websitePatchHref(update)}>Patch Notes <span aria-hidden="true">↗</span></Link>
      </div>
    </section>
  );
}
