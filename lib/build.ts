declare const __BBP_BUILD_ID__: string;

export const BUILD_ID = typeof __BBP_BUILD_ID__ === "string"
  ? __BBP_BUILD_ID__
  : "development";
