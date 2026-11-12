import type { Metadata } from "next";
import Link from "next/link";
import { publicWebsitePatches } from "../../../lib/patch-notes-public";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Website Updates" };
export const dynamic = "force-dynamic";

function releaseDate(value:string|null) {
  if (!value) return null;
  const stamp=Date.parse(value);
  return Number.isFinite(stamp)
    ? new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(stamp))
    : null;
}

export default async function WebsiteUpdatesPage() {
  const patches=await publicWebsitePatches();
  return (
    <main className={styles.page}>
      <Link className={styles.back} href="/">← Back to Home</Link>
      <header className={styles.heading}>
        <p>Battle Planet Online</p>
        <h1>Website Updates</h1>
        <p className={styles.intro}>Patch history and detailed notes for website changes.</p>
      </header>
      <section aria-labelledby="patch-history-title">
        <h2 className={styles.sectionTitle} id="patch-history-title">Patch History</h2>
        <div className={styles.patchList}>
          {patches.map(patch=>(
            <Link className={styles.patchEntry} href={`/updates/${encodeURIComponent(patch.version)}`} key={patch.version}>
              <span className={styles.version}>v{patch.version}</span>
              <span className={styles.patchText}>
                <strong>{patch.title}</strong>
                <span>{patch.summary}</span>
                <small>{releaseDate(patch.publishedAt)??"Development update"}</small>
              </span>
              <span className={styles.arrow} aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
