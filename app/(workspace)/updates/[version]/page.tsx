import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicWebsitePatches } from "../../../../lib/patch-notes-public";
import styles from "../page.module.css";

type Props={params:Promise<{version:string}>};
export const dynamic="force-dynamic";

export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {version}=await params;
  const patch=(await publicWebsitePatches()).find(x=>x.version===version);
  return {title:patch?`v${patch.version} — ${patch.title}`:"Patch Not Found"};
}

function dateText(value:string|null) {
  if(!value) return "Development update";
  const stamp=Date.parse(value);
  return Number.isFinite(stamp)
    ? new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(stamp))
    : "Development update";
}

export default async function WebsitePatchDetailPage({params}:Props) {
  const {version}=await params;
  const patch=(await publicWebsitePatches()).find(x=>x.version===version);
  if(!patch) notFound();
  return (
    <main className={styles.page}>
      <Link className={styles.back} href="/updates">← All Updates</Link>
      <header className={styles.heading}>
        <p>Battle Planet Online · Patch Notes</p>
        <h1>{patch.title}</h1>
        <div className={styles.metadata}>
          <span className={styles.version}>v{patch.version}</span>
          <span>{dateText(patch.publishedAt)}</span>
        </div>
      </header>
      <article className={styles.article}>
        <p className={styles.summary}>{patch.summary}</p>
        {!patch.publishedAt?<p className={styles.notice}>These are development notes; an official release date has not been announced.</p>:null}
        <nav className={styles.contents} aria-label="Patch note sections">
          <strong>Contents</strong>
          {patch.sections.map(s=><a key={s.id} href={`#section-${encodeURIComponent(s.id)}`}>{s.title}</a>)}
        </nav>
        {patch.sections.map(s=>(
          <section className={styles.notesSection} id={`section-${s.id}`} key={s.id}>
            <h2>{s.title}</h2>
            {s.changes.map(c=>(
              <div className={styles.change} id={`change-${c.id}`} key={c.id}>
                <div className={styles.changeHeading}><h3>{c.title}</h3><span className={styles.changeTag}>{c.classification}</span></div>
                {c.elementId?<Link className={styles.elementRef} href={c.type==="core"?`/compendium/cores?core=${encodeURIComponent(c.elementId)}`:`/compendium?card=${encodeURIComponent(c.elementId)}`}>View affected {c.type} in the Compendium ↗</Link>:null}
                {(c.before||c.after)?<div className={styles.comparison}>
                  <div><small>Before</small><p>{c.before||"—"}</p></div>
                  <div><small>After</small><p>{c.after||"—"}</p></div>
                </div>:null}
                {c.explanation?<p className={styles.explanation}>{c.explanation}</p>:null}
              </div>
            ))}
          </section>
        ))}
      </article>
      <Link className={styles.backBottom} href="/updates">View all updates</Link>
    </main>
  );
}
