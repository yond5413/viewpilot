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

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
