import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findWebsitePatch, WEBSITE_PATCHES } from "../../../../lib/content/website-updates";
import styles from "../page.module.css";

type PageProps = { params: Promise<{ version: string }> };

export function generateStaticParams() {
  return WEBSITE_PATCHES.map(({ version }) => ({ version }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { version } = await params;
  const patch = findWebsitePatch(version);
  return { title: patch ? `v${patch.version} — ${patch.title}` : "Patch Not Found" };
}

function releaseDate(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(parsed))
    : null;
}

export default async function WebsitePatchDetailPage({ params }: PageProps) {
  const { version } = await params;
  const patch = findWebsitePatch(version);
  if (!patch) notFound();

  return (
    <main className={styles.page}>
      <Link className={styles.back} href="/updates">← All Updates</Link>
      <header className={styles.heading}>
        <p>Battle Planet Online · Patch Notes</p>
        <h1>{patch.title}</h1>
        <div className={styles.metadata}>
          <span className={styles.version}>v{patch.version}</span>
          <span>{releaseDate(patch.publishedAt) ?? patch.status}</span>
        </div>
      </header>
      <article className={styles.article}>
        <p className={styles.summary}>{patch.summary}</p>
        {!patch.publishedAt ? (
          <p className={styles.notice}>These are development notes for the redesign. No official release date has been announced.</p>
        ) : null}
        {patch.sections.map((section) => (
          <section className={styles.notesSection} key={section.title}>
            <h2>{section.title}</h2>
            <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        ))}
      </article>
      <Link className={styles.backBottom} href="/updates">View all updates</Link>
    </main>
  );
}
