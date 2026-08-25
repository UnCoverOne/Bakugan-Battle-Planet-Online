import { OriginalImage } from "@/components/media/OriginalImage";
import type { BrawlerProfile } from "../../lib/persistence";
import { PROFILE_AVATARS } from "../../lib/profile-customization";
import { runtimeProfileRewardUnlocked } from "../../lib/profile-reward-runtime";

const ALL_PROFILE_AVATAR_PRESETS = PROFILE_AVATARS.map((item) => ({
  id: item.id,
  name: item.label,
  src: item.src,
}));

export const PROFILE_AVATAR_PRESETS = new Proxy(ALL_PROFILE_AVATAR_PRESETS, {
  get(target, property, receiver) {
    if (property === "map") {
      return <T,>(
        callback: (item: (typeof target)[number], index: number, items: (typeof target)[number][]) => T,
        thisArg?: unknown,
      ) => {
        const available = target.filter((item) =>
          runtimeProfileRewardUnlocked("avatars", item.id),
        );
        return available.map(callback, thisArg);
      };
    }
    return Reflect.get(target, property, receiver);
  },
});

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
  const popoverStyle = className?.split(/\s+/).includes("profile-popover-avatar")
    ? { flexBasis: "16.8%", width: "16.8%" }
    : undefined;

  if (source) {
    return (
      <OriginalImage
        className={className}
        style={popoverStyle}
        src={source}
        alt=""
        decoding="async"
      />
    );
  }

  return (
    <span className={className} style={popoverStyle}>
      {profile.name.slice(0, 2).toUpperCase()}
    </span>
  );
}
