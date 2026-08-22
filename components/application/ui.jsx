"use client";

import { OriginalImage } from "@/components/media/OriginalImage";
export function AppButton({ children, onClick = undefined, tone = "blue", disabled = false, type = "button", title = undefined }) {
    return <button className={`hex-button ${tone}`} onClick={onClick} disabled={disabled} type={type} title={title}>{children}</button>;
}
export function Badge({ children, tone = "blue" }) {
    return <span className={`badge ${tone}`}>{children}</span>;
}
export function Metric({ icon = undefined, label, value }) {
    return <div className="metric">{icon && <OriginalImage src={icon} alt=""/>}<div><span>{label}</span><strong>{value}</strong></div></div>;
}
export function PageHeader({ eyebrow, title, copy, art, actions }) {
    return <section className="page-hero"><div className="page-hero-copy"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{copy && <p>{copy}</p>}<div className="hero-actions">{actions}</div></div>{art && <OriginalImage className="page-hero-art" src={art} alt=""/>}</section>;
}
export function Toggle({ label, copy, checked, onChange }) {
    return <label className="toggle-row"><div><strong>{label}</strong><small>{copy}</small></div><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span /></label>;
}
export const factionClass = (name) => `faction-${name.toLowerCase()}`;
export const deckLooksComplete = (deck) => Boolean(deck && deck.bakuganIds.length === 3 && new Set(deck.bakuganIds).size === 3 && deck.coreIds.length === 6 && deck.cardIds.length === 40);
export const formatTimestamp = (value) => {
    const time = Date.parse(value);
    if (!Number.isFinite(time))
        return "Unknown";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(time);
};
export async function copyText(value) {
    if (!navigator.clipboard)
        throw new Error("Clipboard access is unavailable in this browser.");
    await navigator.clipboard.writeText(value);
}
export function downloadTextFile(filename, value, type = "text/plain") {
    const url = URL.createObjectURL(new Blob([value], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
