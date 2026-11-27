import type {SVGProps} from "react";
import type {AchievementCategory} from "../../lib/achievements";
import {LucideIcon,type LucideIconName} from "../design-system/LucideIcon";
const categoryIcons:Record<AchievementCategory,LucideIconName>={Arsenal:"layers",Arena:"swords","Brawler Network":"waypoints",Compendium:"book-open-text"};
export function AchievementCategoryIcon({category,...props}:{category:AchievementCategory}&SVGProps<SVGSVGElement>){return <LucideIcon size={24} {...props} name={categoryIcons[category]}/>;}
