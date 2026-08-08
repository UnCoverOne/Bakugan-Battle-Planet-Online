import type { CSSProperties } from "react";
import type { BrawlerProfile } from "../../lib/persistence";
import {
  PROFILE_AVATARS,
  PROFILE_AVATAR_SPRITE,
} from "../../lib/profile-customization";
import artworkStyles from "./ProfileArtworkCorrections.module.css";

export const PROFILE_AVATAR_PRESETS = PROFILE_AVATARS.map((item) => ({
  id: item.id,
  name: item.label,
  position: item.position,
}));

function profileAvatarPreset(avatar?: string) {
  if (!avatar?.startsWith("preset:")) return null;
  const id = avatar.slice("preset:".length);
  return PROFILE_AVATARS.find((item) => item.id === id) ?? null;
}

export function profileAvatarSource(avatar?: string) {
  return profileAvatarPreset(avatar) ? PROFILE_AVATAR_SPRITE : null;
}

export function profileAvatarStyle(avatar?: string): CSSProperties {
  const preset = profileAvatarPreset(avatar);
  if (!preset) return {};
  return {
    backgroundImage: `url("${PROFILE_AVATAR_SPRITE}")`,
    backgroundSize: "500% 500%",
    backgroundPosition: preset.position,
    backgroundRepeat: "no-repeat",
    backgroundColor: "transparent",
  };
}

export function ProfileAvatar({
  profile,
  className,
}: {
  profile: Pick<BrawlerProfile, "name" | "avatar">;
  className?: string;
}) {
  const resolvedClassName = [className, artworkStyles.artworkScope]
    .filter(Boolean)
    .join(" ");

  if (!profileAvatarSource(profile.avatar)) {
    return (
      <span className={resolvedClassName}>
        {profile.name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <span
      className={resolvedClassName}
      style={profileAvatarStyle(profile.avatar)}
      aria-hidden="true"
    />
  );
}
