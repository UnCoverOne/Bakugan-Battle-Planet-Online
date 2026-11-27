import type {SVGProps} from "react";
import {basicGlyphs} from "./lucide/basic";
import {menuGlyphs} from "./lucide/menu";
import {featureGlyphs} from "./lucide/features";
import {utilityGlyphs} from "./lucide/utilities";
import {extraGlyphs} from "./lucide/extra";

/** Official Lucide v0.468.0 geometry, vendored from the tagged upstream SVGs.
 * See THIRD-PARTY-NOTICES.md for license and source. */
const glyphs={...basicGlyphs,...menuGlyphs,...featureGlyphs,...utilityGlyphs,...extraGlyphs};
export type LucideIconName=keyof typeof glyphs;
export function LucideIcon({name,size=20,className,...props}:Omit<SVGProps<SVGSVGElement>,"children">&{name:LucideIconName;size?:number}){
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size}
    fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false" className={className?"bb-lucide "+className:"bb-lucide"} {...props}>{glyphs[name]}</svg>;
}
