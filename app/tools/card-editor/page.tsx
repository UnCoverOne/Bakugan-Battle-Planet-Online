import type { Metadata } from "next";
import Link from "next/link";
import { CardEditor } from "../../../components/card-editor/CardEditor";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Card Editor | Bakugan Battle Planet Online",
  description: "Author and validate schema-controlled Battle Planet card records and typed rule previews.",
};

export default function CardEditorPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <img src="/assets/logo.png" alt="Bakugan Battle Planet" />
          <span>DEVELOPER TOOLS</span>
        </Link>
        <nav aria-label="Card editor navigation">
          <Link href="/compendium">COMPENDIUM</Link>
          <Link href="/">APPLICATION</Link>
          <a href="https://github.com/UnCoverOne/Bakugan-Battle-Planet-Online" target="_blank" rel="noreferrer">REPOSITORY</a>
        </nav>
      </header>
      <section className={styles.introduction}>
        <div>
          <span>STEP 28 • AUTHORING AND VALIDATION</span>
          <h1>CARD EDITOR</h1>
          <p>Edit canonical card characteristics, inspect the generated typed rules AST and provenance, and export a review bundle for source control. Production data is never modified from the browser.</p>
        </div>
        <aside>
          <strong>REVIEW-ONLY WORKFLOW</strong>
          <span>Live schema validation</span>
          <span>Typed-rule preview</span>
          <span>JSON patch and test scaffold</span>
        </aside>
      </section>
      <CardEditor />
      <footer className={styles.footer}>
        <span>Unofficial fan-made developer tool. Bakugan and related marks belong to their respective owners.</span>
        <Link href="/compendium/rules">Rules reference</Link>
      </footer>
    </main>
  );
}
