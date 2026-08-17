import "@fluentui/web-components/web-components.js";
import { setTheme } from "@fluentui/web-components";
import { webLightTheme, webDarkTheme } from "@fluentui/tokens";

const VERSION = "3.0.2";

globalThis.PINCON_FLUENT = Object.freeze({
  version: VERSION,
  setTheme,
  webLightTheme,
  webDarkTheme,
});

globalThis.PINCON_FLUENT_READY = Promise.resolve(VERSION);
