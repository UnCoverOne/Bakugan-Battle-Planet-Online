"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="empty-page" role="alert">
          <h1>BAKUGAN TCG ONLINE NEEDS TO RESTART</h1>
          <p>The application shell failed to load. Your saved browser data has not been cleared.</p>
          <button className="hex-button red" onClick={reset}>RESTART APPLICATION</button>
        </main>
      </body>
    </html>
  );
}
