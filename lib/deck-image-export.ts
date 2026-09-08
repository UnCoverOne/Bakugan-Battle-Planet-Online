import { BAKUGAN, CORES, type DeckRecord } from "./data";
import { fingerprintedAsset } from "./assets";
import { cardArtSource, isFlipCardType } from "./content/card-art";
import { deckExportFilename, groupedDeckCards } from "./deck-presentation";
import type { Core } from "./game";

const WIDTH = 2200;
const OUTER = 72;
const CARD_RATIO = 359 / 500;
const TEAM_RAIL_WIDTH = 460;
const CONTENT_GUTTER = 44;
const CONTENT_LEFT = OUTER + TEAM_RAIL_WIDTH + CONTENT_GUTTER;
const CONTENT_WIDTH = WIDTH - CONTENT_LEFT - OUTER;

const FACTION_SYMBOLS: Record<string, string> = {
  Aquos: "/assets/symbols/factions/aquos.png",
  Aurelus: "/assets/symbols/factions/aurelus.png",
  Darkus: "/assets/symbols/factions/darkus.png",
  Haos: "/assets/symbols/factions/haos.png",
  Pyrus: "/assets/symbols/factions/pyrus.png",
  Ventus: "/assets/symbols/factions/ventus.png",
};

const CORE_OVERLAY_ICONS = {
  power: "/assets/symbols/b-power.png",
  damage: "/assets/symbols/damage.png",
  energy: "/assets/symbols/energy.png",
  bakuGear: "/assets/symbols/baku-gear.svg",
  frost: "/assets/symbols/frost-strike.png",
  shadow: "/assets/symbols/shadow-strike.png",
} as const;

type LoadedImage = HTMLImageElement | null;
type CoreOverlayIcon = keyof typeof CORE_OVERLAY_ICONS;
type CoreOverlayItem = {
  leadingIcon?: CoreOverlayIcon;
  text: string;
  trailingIcon?: CoreOverlayIcon;
};

function loadImage(source: string): Promise<LoadedImage> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = fingerprintedAsset(source);
  });
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: LoadedImage,
  x: number,
  y: number,
  width: number,
  height: number,
  readableFlip = false,
  drawBackdrop = true,
) {
  if (drawBackdrop) {
    context.fillStyle = "#061820";
    context.fillRect(x, y, width, height);
  }
  if (!image) {
    context.strokeStyle = "rgba(117, 209, 236, .28)";
    context.strokeRect(x, y, width, height);
    return;
  }
  if (readableFlip) {
    const scale = Math.min(width / image.naturalHeight, height / image.naturalWidth);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.save();
    context.translate(x + width / 2, y + height / 2);
    context.rotate(-Math.PI / 2);
    context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    context.restore();
    return;
  }
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function fitText(context: CanvasRenderingContext2D, value: string, maximumWidth: number) {
  if (context.measureText(value).width <= maximumWidth) return value;
  let result = value;
  while (result.length > 1 && context.measureText(`${result}…`).width > maximumWidth) result = result.slice(0, -1);
  return `${result}…`;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function coreOverlayItems(core: Core): CoreOverlayItem[] {
  const items: CoreOverlayItem[] = [];
  if (core.bakuGearCostReduction) {
    items.push({
      leadingIcon: "bakuGear",
      text: `: -${core.bakuGearCostReduction}`,
      trailingIcon: "energy",
    });
  }
  if (core.frostStrike) items.push({ leadingIcon: "frost", text: `: +${core.frostStrike}` });
  if (core.shadowStrike) items.push({ leadingIcon: "shadow", text: ": ShadowStrike" });
  if (core.fusionBonus) items.push({ leadingIcon: "power", text: `: ${signed(core.fusionBonus)}` });
  if (core.fusionDamageBonus) items.push({ leadingIcon: "damage", text: `: ${signed(core.fusionDamageBonus)}` });
  if (core.fusionFrostStrike) items.push({ leadingIcon: "frost", text: `: +${core.fusionFrostStrike}` });
  if (core.conditionalFactions?.length) {
    const conditional = core.conditionalBonus
      ? `${signed(core.conditionalBonus)} B`
      : core.conditionalDamage
        ? `${signed(core.conditionalDamage)} D`
        : "conditional";
    items.push({ text: `${core.conditionalFactions.join(" / ")}: ${conditional}` });
  }
  return items;
}

function drawCoreOverlayIcon(
  context: CanvasRenderingContext2D,
  image: LoadedImage,
  source: CoreOverlayIcon,
  x: number,
  y: number,
  size: number,
) {
  if (!image) return;
  context.save();
  if (source === "bakuGear") context.filter = "invert(1)";
  context.drawImage(image, x, y, size, size);
  context.restore();
}

function drawCoreFallbackOverlay(
  context: CanvasRenderingContext2D,
  core: Core,
  icons: Record<CoreOverlayIcon, LoadedImage>,
  x: number,
  y: number,
  size: number,
) {
  if (core.set !== "Armored Alliance" || core.hasProvidedScan === true) return;
  const items = coreOverlayItems(core);
  if (!items.length) return;

  const maxChipWidth = size * .92;
  const paddingX = 6;
  const iconSize = 12;
  const iconGap = 3;
  const chipHeight = 20;
  const rowGap = 3;
  let rowBottom = y + size * .95;

  context.font = "900 9px Arial, sans-serif";
  context.textBaseline = "middle";

  [...items].reverse().forEach((item) => {
    const iconCount = Number(Boolean(item.leadingIcon)) + Number(Boolean(item.trailingIcon));
    const iconSpace = iconCount * iconSize + iconCount * iconGap;
    const text = fitText(context, item.text, maxChipWidth - paddingX * 2 - iconSpace);
    const textWidth = context.measureText(text).width;
    const chipWidth = Math.min(maxChipWidth, Math.max(28, paddingX * 2 + iconSpace + textWidth));
    const chipX = x + (size - chipWidth) / 2;
    const chipY = rowBottom - chipHeight;

    roundedRect(context, chipX, chipY, chipWidth, chipHeight, 3);
    context.fillStyle = "rgba(255, 255, 255, .96)";
    context.shadowColor = "rgba(0, 0, 0, .28)";
    context.shadowBlur = 2;
    context.shadowOffsetY = 1;
    context.fill();
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;

    const contentWidth = iconSpace + textWidth;
    let cursorX = chipX + (chipWidth - contentWidth) / 2;
    const iconY = chipY + (chipHeight - iconSize) / 2;
    if (item.leadingIcon) {
      drawCoreOverlayIcon(context, icons[item.leadingIcon], item.leadingIcon, cursorX, iconY, iconSize);
      cursorX += iconSize + iconGap;
    }
    context.fillStyle = "#111111";
    context.fillText(text, cursorX, chipY + chipHeight / 2);
    cursorX += textWidth;
    if (item.trailingIcon) {
      cursorX += iconGap;
      drawCoreOverlayIcon(context, icons[item.trailingIcon], item.trailingIcon, cursorX, iconY, iconSize);
    }

    rowBottom = chipY - rowGap;
  });

  context.textBaseline = "alphabetic";
}

function drawBakuCore(
  context: CanvasRenderingContext2D,
  image: LoadedImage,
  core: Core | undefined,
  icons: Record<CoreOverlayIcon, LoadedImage>,
  x: number,
  y: number,
  size: number,
) {
  context.save();
  if (core?.hasProvidedScan === true) {
    context.beginPath();
    context.moveTo(x + size * .24, y);
    context.lineTo(x + size * .76, y);
    context.lineTo(x + size, y + size * .5);
    context.lineTo(x + size * .76, y + size);
    context.lineTo(x + size * .24, y + size);
    context.lineTo(x, y + size * .5);
    context.closePath();
    context.clip();
  }
  drawContainedImage(context, image, x, y, size, size, false, false);
  context.restore();
  if (core) drawCoreFallbackOverlay(context, core, icons, x, y, size);
}

function resolveDeckCreator(deck: DeckRecord) {
  const renderedCreator = typeof document === "undefined"
    ? ""
    : document.querySelector<HTMLElement>('[data-deck-creator-identity="true"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return renderedCreator || deck.sourceCreator?.trim() || deck.creator?.trim() || "Community Brawler";
}

function drawCopyCountBadge(
  context: CanvasRenderingContext2D,
  count: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (count <= 1) return;
  const badgeWidth = 58;
  const badgeHeight = 32;
  const badgeX = x + (width - badgeWidth) / 2;
  const badgeY = y + height - badgeHeight / 2;
  roundedRect(context, badgeX, badgeY, badgeWidth, badgeHeight, 6);
  context.fillStyle = "rgba(0, 0, 0, .72)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, .32)";
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "900 22px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(`×${count}`, x + width / 2, y + height);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The deck image could not be created.")), "image/png");
  });
}

export async function exportDeckImage(deck: DeckRecord) {
  const team = deck.bakuganIds.map((id) => BAKUGAN.find((candidate) => candidate.id === id)).filter(Boolean);
  const cores = deck.coreIds.map((id) => CORES.find((candidate) => candidate.id === id)).filter(Boolean);
  const cards = groupedDeckCards(deck);
  const mainDeckCards = cards.filter(({ card }) => !isFlipCardType(card.type));
  const flipCards = cards.filter(({ card }) => isFlipCardType(card.type));

  const unusedCores = [...cores];
  const teamCores = team.map((item) => {
    const assigned = (item?.character.coreTypes ?? []).slice(0, 2).map((type) => {
      const coreIndex = unusedCores.findIndex((core) => core?.type === type);
      if (coreIndex < 0) return undefined;
      return unusedCores.splice(coreIndex, 1)[0];
    });
    while (assigned.length < 2) assigned.push(unusedCores.shift());
    return assigned;
  });

  const columns = 8;
  const cardGap = 18;
  const cardWidth = (CONTENT_WIDTH - cardGap * (columns - 1)) / columns;
  const cardImageHeight = cardWidth / CARD_RATIO;
  const cardCellHeight = cardImageHeight + 64;
  const mainDeckRows = Math.ceil(mainDeckCards.length / columns);
  const flipCardWidth = cardImageHeight;
  const flipCardHeight = cardWidth;
  const flipColumns = Math.max(1, Math.floor((CONTENT_WIDTH + cardGap) / (flipCardWidth + cardGap)));
  const flipCellHeight = flipCardHeight + 64;
  const flipRows = Math.ceil(flipCards.length / flipColumns);

  const teamCharacterWidth = 205;
  const teamCharacterHeight = teamCharacterWidth / CARD_RATIO;
  const teamCoreSize = 126;
  const teamCoreGap = 14;
  const teamImageGap = 20;
  const teamGroupWidth = teamCharacterWidth + teamImageGap + teamCoreSize;
  const teamGroupX = OUTER + (TEAM_RAIL_WIDTH - teamGroupWidth) / 2;
  const teamRowContentHeight = Math.max(teamCharacterHeight + 34, teamCoreSize * 2 + teamCoreGap);
  const teamRowHeight = teamRowContentHeight + 30;
  const teamCardsTop = 112;
  const teamBottom = teamCardsTop + team.length * teamRowHeight;

  const mainDeckTitleY = 306;
  const mainDeckCardsTop = 332;
  const mainDeckBottom = mainDeckCardsTop + mainDeckRows * cardCellHeight;
  const flipSectionTitleY = mainDeckBottom + 48;
  const flipCardsTop = flipSectionTitleY + 26;
  const deckBottom = flipCards.length > 0
    ? flipCardsTop + flipRows * flipCellHeight
    : mainDeckBottom;
  const height = Math.max(900, teamBottom + 100, deckBottom + 100);

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable in this browser.");

  const factionSources = [...new Set(deck.factions)]
    .map((faction) => FACTION_SYMBOLS[faction])
    .filter((source): source is string => Boolean(source));
  const overlayIconEntries = Object.entries(CORE_OVERLAY_ICONS) as [CoreOverlayIcon, string][];
  const [teamImages, teamCoreImages, mainDeckImages, flipCardImages, factionImages, coreOverlayIconPairs] = await Promise.all([
    Promise.all(team.map((item) => loadImage(cardArtSource(item!.character, "full")))),
    Promise.all(teamCores.map((pair) => Promise.all(pair.map((core) => core ? loadImage(core.art) : Promise.resolve(null))))),
    Promise.all(mainDeckCards.map(({ card }) => loadImage(cardArtSource(card, "full")))),
    Promise.all(flipCards.map(({ card }) => loadImage(cardArtSource(card, "full")))),
    Promise.all(factionSources.map((source) => loadImage(source))),
    Promise.all(overlayIconEntries.map(async ([key, source]) => [key, await loadImage(source)] as const)),
  ]);
  const coreOverlayIcons = Object.fromEntries(coreOverlayIconPairs) as Record<CoreOverlayIcon, LoadedImage>;

  const background = context.createLinearGradient(0, 0, WIDTH, height);
  background.addColorStop(0, "#020b10");
  background.addColorStop(.55, "#08202a");
  background.addColorStop(1, "#100a0b");
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, height);
  context.fillStyle = "rgba(0, 174, 239, .13)";
  context.beginPath();
  context.arc(160, 180, 430, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#18c7f4";
  context.fillRect(0, 0, WIDTH, 10);

  context.fillStyle = "#5bdcff";
  context.font = "italic 800 25px Arial, sans-serif";
  context.fillText("TEAM", OUTER, 78);

  team.forEach((item, index) => {
    const y = teamCardsTop + index * teamRowHeight;
    const characterX = teamGroupX;
    const coreX = characterX + teamCharacterWidth + teamImageGap;
    drawContainedImage(context, teamImages[index], characterX, y, teamCharacterWidth, teamCharacterHeight);
    context.fillStyle = "#ffffff";
    context.font = "700 19px Arial, sans-serif";
    context.fillText(fitText(context, item!.name, teamCharacterWidth), characterX, y + teamCharacterHeight + 27);

    teamCores[index]?.slice(0, 2).forEach((core, coreIndex) => {
      const coreY = y + coreIndex * (teamCoreSize + teamCoreGap);
      drawBakuCore(
        context,
        teamCoreImages[index]?.[coreIndex] ?? null,
        core,
        coreOverlayIcons,
        coreX,
        coreY,
        teamCoreSize,
      );
    });
  });

  context.strokeStyle = "rgba(91, 220, 255, .28)";
  context.beginPath();
  context.moveTo(CONTENT_LEFT - CONTENT_GUTTER / 2, 42);
  context.lineTo(CONTENT_LEFT - CONTENT_GUTTER / 2, height - 70);
  context.stroke();

  context.fillStyle = "#5bdcff";
  context.font = "italic 700 24px Arial, sans-serif";
  context.fillText("BAKUGAN BATTLE PLANET · DECK PROFILE", CONTENT_LEFT, 78);
  context.fillStyle = "#ffffff";
  context.font = "italic 900 72px Arial, sans-serif";
  context.fillText(fitText(context, deck.name.toUpperCase(), CONTENT_WIDTH), CONTENT_LEFT, 160);
  context.fillStyle = "#b8ccd4";
  context.font = "30px Arial, sans-serif";
  context.fillText(`Created by ${resolveDeckCreator(deck)}`, CONTENT_LEFT, 210);

  const factionIconSize = 34;
  const factionIconGap = 14;
  factionImages.forEach((image, index) => {
    drawContainedImage(
      context,
      image,
      CONTENT_LEFT + index * (factionIconSize + factionIconGap),
      226,
      factionIconSize,
      factionIconSize,
      false,
      false,
    );
  });

  context.strokeStyle = "rgba(91, 220, 255, .35)";
  context.beginPath();
  context.moveTo(CONTENT_LEFT, 278);
  context.lineTo(WIDTH - OUTER, 278);
  context.stroke();
  context.fillStyle = "#5bdcff";
  context.font = "italic 800 23px Arial, sans-serif";
  context.fillText("MAIN DECK", CONTENT_LEFT, mainDeckTitleY);

  mainDeckCards.forEach(({ card, count }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = CONTENT_LEFT + column * (cardWidth + cardGap);
    const y = mainDeckCardsTop + row * cardCellHeight;
    drawContainedImage(context, mainDeckImages[index], x, y, cardWidth, cardImageHeight);
    drawCopyCountBadge(context, count, x, y, cardWidth, cardImageHeight);
    context.fillStyle = "#ffffff";
    context.font = "700 17px Arial, sans-serif";
    context.fillText(fitText(context, card.displayName, cardWidth), x, y + cardImageHeight + 25);
    context.fillStyle = "#8ca6af";
    context.font = "15px Arial, sans-serif";
    context.fillText(`${card.type} · ${card.cost} Energy`, x, y + cardImageHeight + 49);
  });

  if (flipCards.length > 0) {
    context.strokeStyle = "rgba(91, 220, 255, .24)";
    context.beginPath();
    context.moveTo(CONTENT_LEFT, flipSectionTitleY - 22);
    context.lineTo(WIDTH - OUTER, flipSectionTitleY - 22);
    context.stroke();
    context.fillStyle = "#5bdcff";
    context.font = "italic 800 23px Arial, sans-serif";
    context.fillText("FLIP CARDS", CONTENT_LEFT, flipSectionTitleY);

    flipCards.forEach(({ card, count }, index) => {
      const column = index % flipColumns;
      const row = Math.floor(index / flipColumns);
      const x = CONTENT_LEFT + column * (flipCardWidth + cardGap);
      const y = flipCardsTop + row * flipCellHeight;
      drawContainedImage(context, flipCardImages[index], x, y, flipCardWidth, flipCardHeight, true);
      drawCopyCountBadge(context, count, x, y, flipCardWidth, flipCardHeight);
      context.fillStyle = "#ffffff";
      context.font = "700 17px Arial, sans-serif";
      context.fillText(fitText(context, card.displayName, flipCardWidth), x, y + flipCardHeight + 25);
      context.fillStyle = "#8ca6af";
      context.font = "15px Arial, sans-serif";
      context.fillText(`${card.type} · ${card.cost} Energy`, x, y + flipCardHeight + 49);
    });
  }

  context.fillStyle = "#708991";
  context.font = "16px Arial, sans-serif";
  context.fillText("Generated by Bakugan Battle Planet Online", OUTER, height - 42);

  const blob = await canvasBlob(canvas);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = deckExportFilename(deck.name, "png");
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
