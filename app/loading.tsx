export default function Loading() {
  return (
    <main className="boot-screen" aria-busy="true" aria-live="polite">
      <img src="/assets/logo.png" alt="Bakugan Battle Planet" width="150" height="130" />
      <span className="pulse" aria-hidden="true" />
      <h1>LOADING BRAWLER DATA</h1>
      <p>Preparing this screen and restoring its saved state…</p>
    </main>
  );
}
