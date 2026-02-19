import GLib from "gi://GLib?version=2.0";
import { createMemo, createState, type Accessor } from "ags";

type ThemePalette = {
  name: string;
  panel: {
    background: string;
    border: string;
    text: string;
  };
  button: {
    background: string;
    border: string;
    text: string;
    activeBackground: string;
    activeBorder: string;
  };
  chip: {
    background: string;
    border: string;
    text: string;
    iconActive: string;
  };
  text: {
    muted: string;
  };
  glow: {
    shadow: string;
  };
};

const FALLBACK_THEME: ThemePalette = {
  name: "synthwave",
  panel: {
    background: "rgba(40, 18, 72, 0.8)",
    border: "rgba(253, 104, 255, 0.5)",
    text: "#f8ecff",
  },
  button: {
    background: "rgba(30, 15, 56, 0.85)",
    border: "rgba(117, 247, 255, 0.42)",
    text: "#f8ecff",
    activeBackground: "rgba(255, 60, 205, 0.24)",
    activeBorder: "rgba(108, 246, 255, 0.86)",
  },
  chip: {
    background: "rgba(248, 237, 255, 0.92)",
    border: "rgba(112, 47, 225, 0.5)",
    text: "#1b0f2a",
    iconActive: "#ff2fbe",
  },
  text: {
    muted: "rgba(246, 227, 255, 0.9)",
  },
  glow: {
    shadow: "0 0 11px rgba(250, 73, 255, 0.28), 0 0 19px rgba(76, 234, 255, 0.18)",
  },
};

function readTextFile(path: string): string | null {
  try {
    const [ok, content] = GLib.file_get_contents(path);
    if (!ok || !content) {
      return null;
    }
    return new TextDecoder().decode(content);
  } catch {
    return null;
  }
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseTheme(value: unknown): ThemePalette | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const obj = value as Record<string, unknown>;
  const name = getString(obj.name).toLowerCase();
  if (!/^[a-z0-9-]+$/.test(name)) {
    return null;
  }

  const panel = (obj.panel || {}) as Record<string, unknown>;
  const button = (obj.button || {}) as Record<string, unknown>;
  const chip = (obj.chip || {}) as Record<string, unknown>;
  const text = (obj.text || {}) as Record<string, unknown>;
  const glow = (obj.glow || {}) as Record<string, unknown>;

  const theme: ThemePalette = {
    name,
    panel: {
      background: getString(panel.background),
      border: getString(panel.border),
      text: getString(panel.text),
    },
    button: {
      background: getString(button.background),
      border: getString(button.border),
      text: getString(button.text),
      activeBackground: getString(button.activeBackground),
      activeBorder: getString(button.activeBorder),
    },
    chip: {
      background: getString(chip.background),
      border: getString(chip.border),
      text: getString(chip.text),
      iconActive: getString(chip.iconActive),
    },
    text: {
      muted: getString(text.muted),
    },
    glow: {
      shadow: getString(glow.shadow),
    },
  };

  const missing = [
    theme.panel.background,
    theme.panel.border,
    theme.panel.text,
    theme.button.background,
    theme.button.border,
    theme.button.text,
    theme.button.activeBackground,
    theme.button.activeBorder,
    theme.chip.background,
    theme.chip.border,
    theme.chip.text,
    theme.chip.iconActive,
    theme.text.muted,
    theme.glow.shadow,
  ].some((entry) => entry.length === 0);

  return missing ? null : theme;
}

function resolveThemesDir(): string | null {
  const srcValue = typeof SRC === "string" ? SRC : "";
  const candidates = [
    GLib.build_filenamev([GLib.get_current_dir(), "themes"]),
    srcValue ? GLib.build_filenamev([srcValue, "themes"]) : "",
    srcValue ? GLib.build_filenamev([GLib.path_get_dirname(srcValue), "themes"]) : "",
  ]
    .filter(Boolean)
    .filter((path) => GLib.file_test(path, GLib.FileTest.IS_DIR));

  return candidates[0] || null;
}

function loadThemesFromJson(): ThemePalette[] {
  const dir = resolveThemesDir();
  if (!dir) {
    return [FALLBACK_THEME];
  }

  const files: string[] = [];
  try {
    const handle = GLib.Dir.open(dir, 0);
    for (let name = handle.read_name(); name !== null; name = handle.read_name()) {
      if (name.endsWith(".json")) {
        files.push(name);
      }
    }
    handle.close();
  } catch {
    return [FALLBACK_THEME];
  }

  files.sort();
  const map = new Map<string, ThemePalette>();

  for (const file of files) {
    const filepath = GLib.build_filenamev([dir, file]);
    const raw = readTextFile(filepath);
    if (!raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      const theme = parseTheme(parsed);
      if (theme) {
        map.set(theme.name, theme);
      }
    } catch {
      // ignore malformed theme file and continue
    }
  }

  if (map.size === 0) {
    return [FALLBACK_THEME];
  }

  return [...map.values()];
}

const THEMES = loadThemesFromJson();
const THEME_MAP = new Map(THEMES.map((theme) => [theme.name, theme]));
export const THEME_NAMES = THEMES.map((theme) => theme.name);
export type ThemeName = string;

const defaultTheme = THEME_MAP.has("synthwave") ? "synthwave" : THEME_NAMES[0];
const [themeName, setThemeName] = createState<ThemeName>(defaultTheme);
const [glowEnabled, setGlowEnabled] = createState(true);

function isThemeName(value: string): value is ThemeName {
  return THEME_MAP.has(value);
}

function normalizeArgs(argv: string[]): string[] {
  return argv
    .filter(Boolean)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function buildThemeVariablesCss(theme: ThemePalette): string {
  return [
    `.theme-${theme.name} {`,
    `  --panel-bg: ${theme.panel.background};`,
    `  --panel-border: ${theme.panel.border};`,
    `  --panel-text: ${theme.panel.text};`,
    `  --button-bg: ${theme.button.background};`,
    `  --button-border: ${theme.button.border};`,
    `  --button-text: ${theme.button.text};`,
    `  --button-active-bg: ${theme.button.activeBackground};`,
    `  --button-active-border: ${theme.button.activeBorder};`,
    `  --chip-bg: ${theme.chip.background};`,
    `  --chip-border: ${theme.chip.border};`,
    `  --chip-text: ${theme.chip.text};`,
    `  --chip-icon-active: ${theme.chip.iconActive};`,
    `  --text-muted: ${theme.text.muted};`,
    `  --glow-shadow: ${theme.glow.shadow};`,
    `}`,
  ].join("\n");
}

const generatedThemeCss = [
  "/* Generated at runtime from themes/*.json */",
  ...THEMES.map(buildThemeVariablesCss),
].join("\n\n");

export function getThemeVariablesCss(): string {
  return generatedThemeCss;
}

export function createThemedWindowClass(baseClass: string): Accessor<string> {
  return createMemo(() => `${baseClass} theme-${themeName()} ${glowEnabled() ? "glow-on" : "glow-off"}`);
}

export function themeStatusLine(): string {
  return `theme=${themeName()} glow=${glowEnabled() ? "on" : "off"}`;
}

export function handleThemeRequest(argv: string[]): string | null {
  const args = normalizeArgs(argv);
  if (args.length === 0) {
    return null;
  }

  const command = args[0];
  if (command === "theme") {
    const next = args[1];
    if (!next || next === "status") {
      return `${themeStatusLine()} available=${THEME_NAMES.join(",")}`;
    }

    if (next === "list") {
      return THEME_NAMES.join(" ");
    }

    if (!isThemeName(next)) {
      return `unknown theme "${next}". available: ${THEME_NAMES.join(", ")}`;
    }

    setThemeName(next);
    return `theme set to ${next}`;
  }

  if (command === "glow") {
    const mode = args[1] || "toggle";
    switch (mode) {
      case "on":
        setGlowEnabled(true);
        return "glow on";
      case "off":
        setGlowEnabled(false);
        return "glow off";
      case "toggle": {
        const next = !glowEnabled();
        setGlowEnabled(next);
        return `glow ${next ? "on" : "off"}`;
      }
      case "status":
        return `glow ${glowEnabled() ? "on" : "off"}`;
      default:
        return `invalid glow mode "${mode}". use: on|off|toggle|status`;
    }
  }

  return null;
}
