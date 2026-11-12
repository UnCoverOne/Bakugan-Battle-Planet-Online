import type { Metadata } from "next";
import Link from "next/link";
import { WEBSITE_UPDATE } from "../../../lib/content/website-updates";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Website Updates" };

export default function WebsiteUpdatesPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.back} href="/">← Back to Home</Link>
      <header className={styles.heading}>
        <p>Battle Planet Online</p>
        <h1>Website Updates</h1>
        <div className={styles.metadata}>
          <span className={styles.version}>v{WEBSITE_UPDATE.version}</span>
          <span>{WEBSITE_UPDATE.status}</span>
        </div>
      </header>
      <article className={styles.article}>
        <h2>{WEBSITE_UPDATE.title}</h2>
        <p className={styles.notice}>Development notes for the current redesign. A release date has not been announced; these are not published release notes.</p>
        <ul>
          {WEBSITE_UPDATE.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </article>
    </main>
  );
}
