import { BAKUGAN } from "../../lib/data";
import type { BrawlerProfile } from "../../lib/persistence";
import { cardArtSource } from "../../lib/content/card-art";

const PRESET_FACTIONS = ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus"];

export const PROFILE_AVATAR_PRESETS = PRESET_FACTIONS.map((faction) =>
  BAKUGAN.find((item) => item.faction === faction),
).filter(
  (item): item is NonNullable<(typeof BAKUGAN)[number]> => Boolean(item),
);

export function profileAvatarSource(avatar?: string) {
  if (!avatar) return null;
  if (avatar.startsWith("data:image/")) return avatar;
  if (!avatar.startsWith("preset:")) return null;
  const id = avatar.slice("preset:".length);
  const character = BAKUGAN.find((item) => item.id === id)?.character;
  return character ? cardArtSource(character, "full") : null;
}

export function ProfileAvatar({
  profile,
  className,
}: {
  profile: Pick<BrawlerProfile, "name" | "avatar">;
  className?: string;
}) {
  const source = profileAvatarSource(profile.avatar);
  if (source) {
    return (
      <img
        className={className}
        src={source}
        alt=""
        decoding="async"
      />
    );
  }
  return (
    <span className={className}>
      {profile.name.slice(0, 2).toUpperCase()}
    </span>
  );
}
