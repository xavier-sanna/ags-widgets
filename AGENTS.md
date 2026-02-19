# AGENTS.md

## Project
This repository is an AGS (Astal + TypeScript, GTK4) setup for a Hyprland top bar.
It is organized as independent modules/widgets in subfolders.

## Module Entry Points
- `superbar/superbar.tsx`: standalone top bar entrypoint
- Future modules should follow the same pattern: `<module>/<module>.tsx`

## Key Files
- `superbar/superbar.scss`: styles for the custom top bar
- `lib/theme.ts`: shared runtime theme state + request command handling
- `lib/theme.scss`: shared theme primitive classes based on CSS vars
- `themes/*.json`: runtime color/glow tokens loaded by `lib/theme.ts`
- `tsconfig.json`, `env.d.ts`: TypeScript + module declarations for AGS

## Dev Commands
- `ags run superbar/superbar.tsx`: run the top bar module directly
- `mise run agsdev superbar/superbar.tsx`: run with auto-reload
- `mise run types`: regenerate GI type definitions in `@girs/`
- `ags request superbar theme status`: inspect active theme state
- `ags request superbar theme synthwave`: switch theme preset
- `ags request superbar glow toggle`: toggle glow mode

## Notes
- Prefer AGS/GTK4 imports from `ags/gtk4/*`.
- Keep each module self-contained (TSX + nearby SCSS).
- Keep sizing/layout in SCSS and color tokens in `themes/*.json` (loaded in TS).
- Do not remove `@girs/` or `env.d.ts`; they are required for typing support.
