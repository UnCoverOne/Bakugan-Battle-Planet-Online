import { BAKUGAN, CORES, type DeckRecord } from "./data";
import { fingerprintedAsset } from "./assets";
import { cardArtSource, isFlipCardType } from "./content/card-art";
import { deckExportFilename, groupedDeckCards } from "./deck-presentation";

const WIDTH = 1600;
const OUTER = 72;
const CARD_RATIO = 359 / 500;

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
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  if (readableFlip) {
    context.save();
    context.translate(x + width / 2, y + height / 2);
    context.rotate(-Math.PI / 2);
    context.scale(5 / 7, 5 / 7);
    context.translate(-(x + width / 2), -(y + height / 2));
  }
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  if (readableFlip) context.restore();
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

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The deck image could not be created.")), "image/png");
  });
}

export async function exportDeckImage(deck: DeckRecord) {
  const team = deck.bakuganIds.map((id) => BAKUGAN.find((candidate) => candidate.id === id)).filter(Boolean);
  const cores = deck.coreIds.map((id) => CORES.find((candidate) => candidate.id === id)).filter(Boolean);
  const cards = groupedDeckCards(deck);
  const columns = 8;
  const cardGap = 20;
  const cardWidth = (WIDTH - OUTER * 2 - cardGap * (columns - 1)) / columns;
  const cardImageHeight = cardWidth / CARD_RATIO;
  const cardCellHeight = cardImageHeight + 64;
  const rows = Math.max(1, Math.ceil(cards.length / columns));
  const mainDeckTop = 760;
  const height = mainDeckTop + 90 + rows * cardCellHeight + 100;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable in this browser.");

  const [teamImages, coreImages, cardImages] = await Promise.all([
    Promise.all(team.map((item) => loadImage(cardArtSource(item!.character, "full")))),
    Promise.all(cores.map((core) => loadImage(core!.art))),
    Promise.all(cards.map(({ card }) => loadImage(cardArtSource(card, "full")))),
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

  context.fillStyle = "#5bdcff";
  context.font = "italic 700 24px Arial, sans-serif";
  context.fillText("BAKUGAN BATTLE PLANET · DECK PROFILE", OUTER, 78);
  context.fillStyle = "#ffffff";
  context.font = "italic 900 72px Arial, sans-serif";
  context.fillText(fitText(context, deck.name.toUpperCase(), WIDTH - OUTER * 2), OUTER, 160);
  context.fillStyle = "#b8ccd4";
  context.font = "30px Arial, sans-serif";
  context.fillText(`Created by ${deck.creator ?? "Community Brawler"}`, OUTER, 210);
  context.fillText(`${deck.factions.join(" · ") || "No factions"}   •   ${deck.cardIds.length} Main Deck cards`, OUTER, 254);

  context.fillStyle = "#5bdcff";
  context.font = "italic 800 23px Arial, sans-serif";
  context.fillText("CHARACTER CARDS", OUTER, 318);
  const characterWidth = 188;
  const characterHeight = characterWidth / CARD_RATIO;
  team.forEach((item, index) => {
    const x = OUTER + index * (characterWidth + 34);
    drawContainedImage(context, teamImages[index], x, 340, characterWidth, characterHeight);
    context.fillStyle = "#ffffff";
    context.font = "700 21px Arial, sans-serif";
    context.fillText(fitText(context, item!.name, characterWidth), x, 340 + characterHeight + 30);
  });

  context.fillStyle = "#5bdcff";
  context.font = "italic 800 23px Arial, sans-serif";
  context.fillText("BAKUCORES", 780, 318);
  cores.forEach((core, index) => {
    const x = 780 + (index % 3) * 242;
    const y = 340 + Math.floor(index / 3) * 156;
    drawContainedImage(context, coreImages[index], x, y, 112, 112);
    context.fillStyle = "#ffffff";
    context.font = "700 18px Arial, sans-serif";
    context.fillText(fitText(context, core!.type, 118), x + 124, y + 42);
    context.fillStyle = "#9fb7c0";
    context.font = "16px Arial, sans-serif";
    context.fillText(fitText(context, core!.name, 118), x + 124, y + 70);
  });

  context.strokeStyle = "rgba(91, 220, 255, .35)";
  context.beginPath();
  context.moveTo(OUTER, 712);
  context.lineTo(WIDTH - OUTER, 712);
  context.stroke();
  context.fillStyle = "#5bdcff";
  context.font = "italic 800 23px Arial, sans-serif";
  context.fillText("MAIN DECK", OUTER, 770);
  context.fillStyle = "#9fb7c0";
  context.font = "18px Arial, sans-serif";
  context.fillText("Multiple copies are grouped into a single card.", OUTER + 180, 770);

  cards.forEach(({ card, count }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = OUTER + column * (cardWidth + cardGap);
    const y = mainDeckTop + 44 + row * cardCellHeight;
    drawContainedImage(context, cardImages[index], x, y, cardWidth, cardImageHeight, isFlipCardType(card.type));
    if (count > 1) {
      const badgeSize = 48;
      roundedRect(context, x + cardWidth - badgeSize - 8, y + cardImageHeight - badgeSize - 8, badgeSize, badgeSize, 8);
      context.fillStyle = "#df1f2d";
      context.fill();
      context.strokeStyle = "#ff7b84";
      context.stroke();
      context.fillStyle = "#ffffff";
      context.font = "900 22px Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(`×${count}`, x + cardWidth - badgeSize / 2 - 8, y + cardImageHeight - badgeSize / 2 - 8);
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
    }
    context.fillStyle = "#ffffff";
    context.font = "700 17px Arial, sans-serif";
    context.fillText(fitText(context, card.displayName, cardWidth), x, y + cardImageHeight + 25);
    context.fillStyle = "#8ca6af";
    context.font = "15px Arial, sans-serif";
    context.fillText(`${card.type} · ${card.cost} Energy`, x, y + cardImageHeight + 49);
  });

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
