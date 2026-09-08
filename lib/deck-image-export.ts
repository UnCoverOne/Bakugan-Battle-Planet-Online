import { BAKUGAN, CORES, type DeckRecord } from "./data";
import { fingerprintedAsset } from "./assets";
import { cardArtSource, isFlipCardType } from "./content/card-art";
import { deckExportFilename, groupedDeckCards } from "./deck-presentation";

const WIDTH = 2200;
const OUTER = 72;
const CARD_RATIO = 359 / 500;
const TEAM_RAIL_WIDTH = 460;
const CONTENT_GUTTER = 44;
const CONTENT_LEFT = OUTER + TEAM_RAIL_WIDTH + CONTENT_GUTTER;
const CONTENT_WIDTH = WIDTH - CONTENT_LEFT - OUTER;

type LoadedImage = HTMLImageElement | null;

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
) {
  context.fillStyle = "#061820";
  context.fillRect(x, y, width, height);
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

  const [teamImages, teamCoreImages, mainDeckImages, flipCardImages] = await Promise.all([
    Promise.all(team.map((item) => loadImage(cardArtSource(item!.character, "full")))),
    Promise.all(teamCores.map((pair) => Promise.all(pair.map((core) => core ? loadImage(core.art) : Promise.resolve(null))))),
    Promise.all(mainDeckCards.map(({ card }) => loadImage(cardArtSource(card, "full")))),
    Promise.all(flipCards.map(({ card }) => loadImage(cardArtSource(card, "full")))),
  ]);

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

  roundedRect(context, OUTER - 24, 42, TEAM_RAIL_WIDTH + 48, height - 112, 24);
  context.fillStyle = "rgba(0, 12, 18, .42)";
  context.fill();
  context.strokeStyle = "rgba(91, 220, 255, .18)";
  context.stroke();

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
      drawContainedImage(
        context,
        teamCoreImages[index]?.[coreIndex] ?? null,
        coreX,
        coreY,
        teamCoreSize,
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
  context.fillText(`Created by ${deck.creator ?? "Community Brawler"}`, CONTENT_LEFT, 210);
  context.fillText(`${deck.factions.join(" · ") || "No factions"}   •   ${deck.cardIds.length} Main Deck cards`, CONTENT_LEFT, 254);

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
