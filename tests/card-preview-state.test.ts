import test from "node:test";
import assert from "node:assert/strict";
import {
  activateCardPreviewTarget,
  cardPreviewOrientation,
  cardPreviewRequestIsCurrent,
  cardPreviewSideForZone,
  cardPreviewZoneAllowed,
  clearCardPreviewTarget,
  EMPTY_CARD_PREVIEW_OWNERSHIP,
  releaseCardPreviewTarget,
} from "../components/game-screen-v2/cardPreviewState";
import {
  canonicalPreviewPath,
  corePreviewSourceIsRevealed,
} from "../components/game-screen-v2/cardPreviewController";

test("card previews accept only explicit card and revealed-Core zones", () => {
  for (const zone of [
    "character-card",
    "hand",
    "discard-pile",
    "discard-browser",
    "hero",
    "batch",
    "bakucore",
  ]) {
    assert.equal(cardPreviewZoneAllowed(zone), true, `${zone} should be previewable`);
  }
  assert.equal(cardPreviewZoneAllowed("deck"), false);
  assert.equal(cardPreviewZoneAllowed("energy"), false);
  assert.equal(cardPreviewZoneAllowed(""), false);
  assert.equal(cardPreviewZoneAllowed(undefined), false);
});

test("preview sides follow hard zone rules without geometry", () => {
  assert.equal(cardPreviewSideForZone("character-card", "player"), "right");
  assert.equal(cardPreviewSideForZone("hand", "player"), "left");
  assert.equal(cardPreviewSideForZone("discard-pile", "player"), "left");
  assert.equal(cardPreviewSideForZone("discard-browser", "player"), "left");
  assert.equal(cardPreviewSideForZone("hero", "player"), "left");

  assert.equal(cardPreviewSideForZone("character-card", "opponent"), "left");
  assert.equal(cardPreviewSideForZone("hand", "opponent"), "left");
  assert.equal(cardPreviewSideForZone("discard-pile", "opponent"), "right");
  assert.equal(cardPreviewSideForZone("discard-browser", "opponent"), "right");
  assert.equal(cardPreviewSideForZone("hero", "opponent"), "right");
  assert.equal(cardPreviewSideForZone("batch", "player"), "left");
  assert.equal(cardPreviewSideForZone("batch", "opponent"), "left");
  assert.equal(cardPreviewSideForZone("bakucore", "player"), "left");
  assert.equal(cardPreviewSideForZone("bakucore", "opponent"), "left");
});

test("all card previews retain the canonical physical-card footprint", () => {
  assert.equal(cardPreviewOrientation("Flip"), "vertical");
  assert.equal(cardPreviewOrientation("Flip Hero"), "vertical");
  assert.equal(cardPreviewOrientation("Action"), "vertical");
  assert.equal(cardPreviewOrientation("Character"), "vertical");
});

test("framework image proxies preserve the canonical artwork path used by Hero previews", () => {
  const artwork = "/assets/cards/full/77.webp";
  const fingerprinted = `${artwork}?v=preview-hash`;
  const encoded = encodeURIComponent(fingerprinted);

  assert.equal(canonicalPreviewPath(fingerprinted), artwork);
  assert.equal(
    canonicalPreviewPath(`/_vinext/image?url=${encoded}&w=128&q=82`),
    artwork,
  );
  assert.equal(
    canonicalPreviewPath(`https://example.test/_next/image?url=${encoded}&w=384&q=82`),
    artwork,
  );
});

test("BakuCore previews follow rendered front artwork rather than mutable choice labels", () => {
  const artwork = "/assets/cores/full/4.webp";

  assert.equal(
    corePreviewSourceIsRevealed("/assets/core-backs/fist.png", artwork),
    false,
    "A face-down Field Core must remain hidden while it is a legal choice target",
  );
  assert.equal(corePreviewSourceIsRevealed(artwork, artwork), true);
  assert.equal(corePreviewSourceIsRevealed(`${artwork}?v=preview`, artwork), true);
  assert.equal(
    corePreviewSourceIsRevealed("", artwork, true),
    true,
    "An attached Core remains public even when its matrix image has already left the field",
  );
});

test("stale preview requests cannot replace a newer target", () => {
  const first = activateCardPreviewTarget(EMPTY_CARD_PREVIEW_OWNERSHIP, "card-a");
  assert.equal(cardPreviewRequestIsCurrent(first, "card-a", first.generation), true);

  const second = activateCardPreviewTarget(first, "card-b");
  assert.equal(second.generation, first.generation + 1);
  assert.equal(cardPreviewRequestIsCurrent(second, "card-a", first.generation), false);
  assert.equal(cardPreviewRequestIsCurrent(second, "card-b", second.generation), true);

  const staleRelease = releaseCardPreviewTarget(second, "card-a");
  assert.equal(staleRelease, second);

  const released = releaseCardPreviewTarget(second, "card-b");
  assert.equal(released.targetId, "");
  assert.equal(released.generation, second.generation + 1);
  assert.equal(cardPreviewRequestIsCurrent(released, "card-b", second.generation), false);

  const cleared = clearCardPreviewTarget(released);
  assert.equal(cleared.generation, released.generation + 1);
});
