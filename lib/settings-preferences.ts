import type {AppSettings} from "./persistence";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  reducedMotion: false,
  highContrast: false,
  sound: true,
  cardScale: 100,
  textScale: 100,
  challenges: "Everyone",
  gameSoundsEnabled: true,
  gameSoundVolume: 55,
  uiSoundsEnabled: true,
  uiSoundVolume: 70,
  musicEnabled: true,
  musicVolume: 55,
  masterVolume: 100,
  automaticDraw: false,
  automaticPass: false,
  logDetail: "Cards",
  replayLinks: true,
};

export const LOG_DETAIL_OPTIONS=[
  {label:"Cards",filter:"cards"},
  {label:"All events",filter:"all"},
  {label:"Gameplay only",filter:"game"},
  {label:"Random results",filter:"random"},
  {label:"System",filter:"system"},
  {label:"Connection",filter:"connection"},
] as const;
export type EventLogFilter=typeof LOG_DETAIL_OPTIONS[number]["filter"];
export function normalizeLogDetail(value:unknown){
  return LOG_DETAIL_OPTIONS.find(option=>option.label===value)?.label??"Cards";
}
export function eventLogFilter(value:unknown):EventLogFilter{
  return LOG_DETAIL_OPTIONS.find(option=>option.label===normalizeLogDetail(value))?.filter??"cards";
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const candidate: Record<string, unknown> = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const boolean = (key: keyof AppSettings, fallback: boolean) =>
    typeof candidate[key] === "boolean" ? candidate[key] as boolean : fallback;
  const text = (key: keyof AppSettings, fallback: string) =>
    typeof candidate[key] === "string" ? candidate[key] as string : fallback;
  const number = (key: keyof AppSettings, fallback: number) =>
    Number.isFinite(candidate[key]) ? Number(candidate[key]) : fallback;
  const percent = (key: keyof AppSettings, fallback: number) =>
    Math.round(Math.min(100, Math.max(0, number(key, fallback))));
  const scale = (key: keyof AppSettings, fallback: number) =>
    Math.round(Math.min(140, Math.max(80, number(key, fallback))));

  const legacyGameSoundsEnabled = typeof candidate.soundEnabled === "boolean"
    ? candidate.soundEnabled
    : boolean("sound", DEFAULT_APP_SETTINGS.sound);
  const gameSoundsEnabled = boolean("gameSoundsEnabled", legacyGameSoundsEnabled);
  const legacySoundVolume = Number.isFinite(candidate.soundVolume)
    ? Number(candidate.soundVolume)
    : (DEFAULT_APP_SETTINGS.gameSoundVolume ?? 55) / 100;
  const legacyGameSoundPercent = legacySoundVolume <= 1
    ? legacySoundVolume * 100
    : legacySoundVolume;
  const gameSoundVolume = Math.round(Math.min(
    100,
    Math.max(0, Number.isFinite(candidate.gameSoundVolume)
      ? Number(candidate.gameSoundVolume)
      : legacyGameSoundPercent),
  ));

  return {
    ...DEFAULT_APP_SETTINGS,
    reducedMotion: boolean("reducedMotion", DEFAULT_APP_SETTINGS.reducedMotion),
    highContrast: boolean("highContrast", DEFAULT_APP_SETTINGS.highContrast),
    sound: gameSoundsEnabled,
    cardScale: scale("cardScale", DEFAULT_APP_SETTINGS.cardScale),
    textScale: scale("textScale", DEFAULT_APP_SETTINGS.textScale ?? 100),
    challenges: text("challenges", DEFAULT_APP_SETTINGS.challenges),
    gameSoundsEnabled,
    gameSoundVolume,
    uiSoundsEnabled: boolean("uiSoundsEnabled", DEFAULT_APP_SETTINGS.uiSoundsEnabled ?? true),
    uiSoundVolume: percent("uiSoundVolume", DEFAULT_APP_SETTINGS.uiSoundVolume ?? 70),
    musicEnabled: boolean("musicEnabled", DEFAULT_APP_SETTINGS.musicEnabled ?? true),
    musicVolume: percent("musicVolume", DEFAULT_APP_SETTINGS.musicVolume ?? 55),
    masterVolume: percent("masterVolume", DEFAULT_APP_SETTINGS.masterVolume ?? 100),
    replayLinks: boolean("replayLinks", DEFAULT_APP_SETTINGS.replayLinks ?? true),
    automaticDraw: boolean("automaticDraw", false),
    automaticPass: boolean("automaticPass", false),
    logDetail: normalizeLogDetail(candidate.logDetail),
    soundEnabled: gameSoundsEnabled,
    soundVolume: gameSoundVolume / 100,
  };
}


export const PREFERENCE_KEYS={
  Gameplay:["automaticDraw","automaticPass","logDetail"],
  Display:["cardScale","textScale","reducedMotion","highContrast"],
  Audio:["masterVolume","musicEnabled","musicVolume","uiSoundsEnabled","uiSoundVolume","gameSoundsEnabled","gameSoundVolume"],
} as const;
export type PreferenceCategory=keyof typeof PREFERENCE_KEYS;

/** Update the canonical preferences and mirror legacy audio keys only for snapshot compatibility. */
export function patchPreferences(current:AppSettings,patch:Partial<AppSettings>):AppSettings{
  return normalizeAppSettings({...normalizeAppSettings(current),...patch});
}
export function restorePreferenceCategory(current:AppSettings,category:PreferenceCategory):AppSettings{
  const patch=Object.fromEntries(PREFERENCE_KEYS[category].map(key=>[key,DEFAULT_APP_SETTINGS[key]])) as Partial<AppSettings>;
  return patchPreferences(current,patch);
}
export function hasCustomPreferences(settings:unknown){
  const normalized=normalizeAppSettings(settings),defaults=normalizeAppSettings(DEFAULT_APP_SETTINGS);
  return Object.values(PREFERENCE_KEYS).flat().some(key=>normalized[key]!==defaults[key])||
    normalized.challenges!==defaults.challenges||normalized.replayLinks!==defaults.replayLinks;
}
