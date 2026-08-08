import type { BrawlerProfile } from "../../lib/persistence";
import { PROFILE_AVATARS } from "../../lib/profile-customization";

export const PROFILE_AVATAR_PRESETS = PROFILE_AVATARS.map((item) => ({
  id: item.id,
  name: item.label,
  src: item.src,
}));

function profileAvatarPreset(avatar?: string) {
  if (!avatar?.startsWith("preset:")) return null;
  const id = avatar.slice("preset:".length);
  return PROFILE_AVATARS.find((item) => item.id === id) ?? null;
}

export function profileAvatarSource(avatar?: string) {
  return profileAvatarPreset(avatar)?.src ?? null;
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
    return <img className={className} src={source} alt="" decoding="async" />;
  }

  return (
    <span className={className}>
      {profile.name.slice(0, 2).toUpperCase()}
    </span>
  );
}
