import type { CSSProperties } from "react";
import type { BrawlerProfile } from "../../lib/persistence";
import {
  PROFILE_AVATARS,
  PROFILE_AVATAR_SPRITE,
} from "../../lib/profile-customization";

export const PROFILE_AVATAR_PRESETS = PROFILE_AVATARS.map((item) => ({
  id: item.id,
  name: item.label,
  position: item.position,
}));

function profileAvatarPreset(avatar?: string) {
  const id = avatar?.startsWith("preset:")
    ? avatar.slice("preset:".length)
    : "";
  return PROFILE_AVATARS.find((item) => item.id === id) ?? PROFILE_AVATARS[0];
}

export function profileAvatarSource(avatar?: string) {
  const preset = profileAvatarPreset(avatar);
  return preset ? PROFILE_AVATAR_SPRITE : null;
}

export function profileAvatarStyle(avatar?: string): CSSProperties {
  const preset = profileAvatarPreset(avatar);
  const source = profileAvatarSource(avatar);
  return {
    backgroundImage: source ? `url("${source}")` : undefined,
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
  return (
    <span
      className={className}
      style={profileAvatarStyle(profile.avatar)}
      aria-hidden="true"
    />
  );
}
