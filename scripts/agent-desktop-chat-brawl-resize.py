from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1))


Path("components/game-screen-v2/brawlHudPosition.ts").write_text('''export type HudPosition = {
  left: number;
  dockedLeft: number;
  top: number;
  maxWidth: number;
};

export type BrawlHudAnchorRect = Pick<DOMRect, "left" | "top" | "width">;
export type BrawlHudViewport = { left: number; top: number; width: number };

export const BRAWL_PREVIEW_MAX_REM = 32;
const BRAWL_EDGE_GAP = 12;
const BRAWL_DOCK_HANDLE_WIDTH = 32;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * The Brawl Preview used to have two independent width systems: JavaScript
 * positioned an assumed width while CSS could silently cap the rendered box.
 * Dock offsets then used a different half-width than the browser, allowing the
 * entire preview and its restore handle to move beyond the viewport after a
 * resize. This calculation is now the single width source used for positioning
 * and the inline rendered width.
 */
export function calculateBrawlHudPosition(
  anchor: BrawlHudAnchorRect,
  viewport: BrawlHudViewport,
  rootFontSize = 16,
): HudPosition {
  const availableWidth = Math.max(
    1,
    viewport.width - BRAWL_EDGE_GAP * 2 - BRAWL_DOCK_HANDLE_WIDTH,
  );
  const desiredWidth = Math.max(430, anchor.width * 2.65);
  const cssWidthCap = Math.max(1, BRAWL_PREVIEW_MAX_REM * rootFontSize);
  const maxWidth = Math.min(availableWidth, desiredWidth, cssWidthCap);
  const halfWidth = maxWidth / 2;
  const minimumCenter = viewport.left
    + BRAWL_EDGE_GAP
    + BRAWL_DOCK_HANDLE_WIDTH
    + halfWidth;
  const maximumCenter = viewport.left
    + viewport.width
    - BRAWL_EDGE_GAP
    - halfWidth;

  return {
    left: clamp(
      anchor.left + anchor.width / 2,
      minimumCenter,
      maximumCenter,
    ),
    // With the same maxWidth applied inline, the preview's left edge lands
    // exactly on the viewport edge and the absolute handle remains visible.
    dockedLeft: viewport.left + viewport.width + halfWidth,
    top: Math.max(viewport.top + 10, anchor.top - 10),
    maxWidth,
  };
}
''')

replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
    '''import previewStyles from "./BrawlPreviewEnhancements.module.css";
import { useMatchSelector } from "./matchStore";
''',
    '''import previewStyles from "./BrawlPreviewEnhancements.module.css";
import { calculateBrawlHudPosition, type HudPosition } from "./brawlHudPosition";
import { useMatchSelector } from "./matchStore";
''',
)

replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
    '''type HudPosition = {
  left: number;
  dockedLeft: number;
  top: number;
  maxWidth: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

''',
    '''''',
)

replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
    '''        const rect = heroZone.getBoundingClientRect();
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft ?? 0;
        const viewportWidth = viewport?.width ?? window.innerWidth;
        const edgeGap = 12;
        const dockHandleWidth = 32;
        const maxWidth = Math.min(
          Math.max(1, viewportWidth - edgeGap * 2 - dockHandleWidth),
          Math.max(430, rect.width * 2.65),
        );
        const halfWidth = maxWidth / 2;
        const next = {
          left: clamp(
            rect.left + rect.width / 2,
            viewportLeft + edgeGap + dockHandleWidth + halfWidth,
            viewportLeft + viewportWidth - edgeGap - halfWidth,
          ),
          dockedLeft: viewportLeft + viewportWidth + halfWidth,
          top: Math.max(10, rect.top - 10),
          maxWidth,
        };
        setHudPosition((previous) => sameHudPosition(previous, next) ? previous : next);
''',
    '''        const rect = heroZone.getBoundingClientRect();
        const viewport = window.visualViewport;
        const rootFontSize = Number.parseFloat(
          window.getComputedStyle(document.documentElement).fontSize,
        ) || 16;
        const next = calculateBrawlHudPosition(
          rect,
          {
            left: viewport?.offsetLeft ?? 0,
            top: viewport?.offsetTop ?? 0,
            width: viewport?.width ?? window.innerWidth,
          },
          rootFontSize,
        );
        setHudPosition((previous) => sameHudPosition(previous, next) ? previous : next);
''',
)

replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
    '''    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
''',
    '''    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
''',
)

replace_once(
    "components/game-screen-v2/MatchCommunicationLayer.module.css",
    '''.chatBox[data-focused="false"] {
  border-color: transparent;
  background: linear-gradient(0deg, rgba(2,6,9,.78), rgba(2,6,9,.32) 62%, transparent);
  box-shadow: none;
}

.chatBox[data-focused="false"] > header,
.chatBox[data-focused="false"] .chatForm {
  opacity: .12;
}
''',
    '''.chatBox[data-focused="false"] {
  border-color: transparent;
  background: linear-gradient(0deg, rgba(2,6,9,.78), rgba(2,6,9,.32) 62%, transparent);
  box-shadow: none;
  pointer-events: none;
}

.chatBox[data-focused="false"] > header {
  opacity: .12;
}

.chatBox[data-focused="false"] .chatForm {
  border-top-color: transparent;
  background: transparent;
  opacity: 1;
  pointer-events: none;
}

.chatBox[data-focused="false"] .chatForm input {
  border-color: rgba(188, 200, 208, 0.42);
  background: rgba(2, 6, 9, 0.92);
  opacity: .78;
  pointer-events: auto;
}

.chatBox[data-focused="false"] .chatForm button {
  opacity: .12;
  pointer-events: none;
}
''',
)

vertical_stats = '''.brawlPreview article > div:nth-child(2) > div {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(1.9rem, 1fr) auto;
  align-items: stretch;
  min-height: 4.2rem;
}

.brawlPreview article > div:nth-child(2) > div > span {
  grid-column: 1;
  grid-row: 1;
  align-self: start;
  justify-self: start;
}

.brawlPreview article > div:nth-child(2) > div > strong {
  grid-column: 1;
  grid-row: 2;
  align-self: center;
  justify-self: end;
}

.brawlPreview article > div:nth-child(2) > div > small {
  grid-column: 1;
  grid-row: 3;
  align-self: end;
  justify-self: start;
}

.brawlPreview article > div:nth-child(2) > div[data-deciding="true"] {
  background: rgba(255, 255, 255, 0.045);
  box-shadow: none;
}

.brawlPreview article > div:nth-child(2) > div[data-deciding="true"]::after {
  content: none;
  display: none;
}

.brawlPreview article > div:nth-child(2) > div[data-deciding="true"] > span {
  color: rgba(215, 224, 229, 0.68);
  text-shadow: none;
}

.brawlPreview article > div:nth-child(2) > div[data-deciding="true"] > strong {
  color: #fff;
  text-shadow: none;
}

.brawlPreview article[data-owner="opponent"] > div:nth-child(2) > div[data-deciding="true"] > strong {
  color: #ff5a4d;
}

'''

replace_once(
    "components/game-screen-v2/BrawlPreviewEnhancements.module.css",
    '''.brawlPreview article > div:nth-child(2) strong {
  font-size: clamp(1rem, 1.35vw, 1.42rem);
}

/* Effects and Modifiers use an out-of-flow window so the Preview never changes shape. */
''',
    '''.brawlPreview article > div:nth-child(2) strong {
  font-size: clamp(1rem, 1.35vw, 1.42rem);
}

''' + vertical_stats + '''/* Effects and Modifiers use an out-of-flow window so the Preview never changes shape. */
''',
)

mobile_vertical_stats = ''.join(f"  {line}\n" if line else "\n" for line in vertical_stats.rstrip().split("\n"))
replace_once(
    "components/game-screen-v2/BrawlPreviewEnhancements.module.css",
    mobile_vertical_stats + "\n",
    "",
)

with Path("tests/match-communication.test.ts").open("a") as file:
    file.write('''

test("inactive desktop chat is click-through except for its more-visible input", () => {
  assert.match(
    css,
    /\.chatBox\[data-focused="false"\]\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    css,
    /\.chatBox\[data-focused="false"\]\s+\.chatForm input\s*\{[\s\S]*?opacity:\s*\.78;[\s\S]*?pointer-events:\s*auto;/,
  );
  assert.match(
    css,
    /\.chatBox\[data-focused="false"\]\s+\.chatForm button\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
});
''')

replace_once(
    "tests/brawl-presentation.test.ts",
    '''import { turnProgressSnapshot } from "../components/game-screen-v2/turnProgressState";
''',
    '''import { turnProgressSnapshot } from "../components/game-screen-v2/turnProgressState";
import { calculateBrawlHudPosition } from "../components/game-screen-v2/brawlHudPosition";
''',
)

with Path("tests/brawl-presentation.test.ts").open("a") as file:
    file.write('''

test("desktop Brawl Preview uses the mobile vertical stat treatment without gold victor decoration", async () => {
  const css = await readFile(
    new URL("../components/game-screen-v2/BrawlPreviewEnhancements.module.css", import.meta.url),
    "utf8",
  );
  const desktop = css.split("@media (max-width: 760px)")[0];
  assert.match(
    desktop,
    /article\s*>\s*div:nth-child\(2\)\s*>\s*div\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(1\.9rem, 1fr\) auto;/,
  );
  assert.match(
    desktop,
    /div\[data-deciding="true"\]::after\s*\{[\s\S]*?content:\s*none;/,
  );
  assert.match(
    desktop,
    /div\[data-deciding="true"\]\s*>\s*strong\s*\{[\s\S]*?color:\s*#fff;[\s\S]*?text-shadow:\s*none;/,
  );
  assert.match(
    desktop,
    /article\[data-owner="opponent"\][\s\S]*?div\[data-deciding="true"\]\s*>\s*strong\s*\{[\s\S]*?color:\s*#ff5a4d;/,
  );
});

test("Brawl Preview docking uses one capped width and keeps the handle at the viewport edge", () => {
  const viewport = { left: 36, top: 20, width: 1440 };
  const position = calculateBrawlHudPosition(
    { left: 1120, top: 700, width: 300 },
    viewport,
    16,
  );
  assert.equal(position.maxWidth, 512, "the 32rem CSS cap is part of the positioning calculation");
  assert.equal(
    position.dockedLeft - position.maxWidth / 2,
    viewport.left + viewport.width,
    "the rendered preview begins exactly outside the viewport while its left handle remains visible",
  );
  assert.ok(position.left - position.maxWidth / 2 >= viewport.left + 12 + 32);
  assert.ok(position.left + position.maxWidth / 2 <= viewport.left + viewport.width - 12);
  assert.equal(position.top, 690);
});
''')
