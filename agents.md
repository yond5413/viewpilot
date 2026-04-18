# Agents

## UI Direction

When iterating on the frontend in this repository, prefer the shadcn-style primitives in `components/ui/` before introducing new custom wrappers.

Use these primitives first:

- `Button`
- `Badge`
- `Card`
- `Input`
- `DropdownMenu`
- `ScrollArea`
- `Separator`
- `Skeleton`
- `Tooltip`

## How To Apply Them

- Use primitives for interaction surfaces, menus, loading states, form controls, and scrollable regions.
- Keep the higher-level upload and dashboard shells custom so the product keeps its own visual identity.
- Extend primitives with `className` rather than replacing them with one-off div trees.
- Prefer composition over new abstractions when the UI can be built from an existing primitive plus a small helper.

## Product Rules

- Keep the analytics shell session-driven and fetch-based.
- Do not touch `lib/` or `app/api/` unless explicitly asked.
- Preserve the current app structure under `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `app/dashboard/[sessionId]/page.tsx`, and `components/`.
- Match the warm neutral palette and blue accent already defined in `app/globals.css`.
- Favor accessible, legible states over extra decoration.

## Iteration Notes

- Dashboard cards should use `Card` and `DropdownMenu` for actions.
- Copilot conversations should use `ScrollArea` for the message stream and `Separator` for structural breaks.
- Loading states should use `Skeleton`.
- CTA rows and top-bar actions should use `Button`.
- Session and status chips should use `Badge`.
