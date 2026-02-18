# AGENTS.md

## Project
This repository is an AGS (Astal + TypeScript, GTK4) setup for a Hyprland top bar.
It is organized as independent modules/widgets in subfolders.

## Module Entry Points
- `superbar/superbar.tsx`: standalone top bar entrypoint
- Future modules should follow the same pattern: `<module>/<module>.tsx`

## Key Files
- `superbar/superbar.scss`: styles for the custom top bar
- `tsconfig.json`, `env.d.ts`: TypeScript + module declarations for AGS

## Dev Commands
- `ags run superbar/superbar.tsx`: run the top bar module directly
- `mise run agsdev superbar/superbar.tsx`: run with auto-reload
- `mise run types`: regenerate GI type definitions in `@girs/`

## Notes
- Prefer AGS/GTK4 imports from `ags/gtk4/*`.
- Keep each module self-contained (TSX + nearby SCSS).
- Do not remove `@girs/` or `env.d.ts`; they are required for typing support.
