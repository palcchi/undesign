# UI/UX implementation plan

Owner approval: all six findings from audit 001.
Working branch: `work/ui-ux-implementation-2026-11-04`
Base: restored `origin/main` as of 2026-11-04.
No push, merge, or deployment without separate approval.

## Approved direction
- Preserve the Figma-familiar Design / Motion / Developer Mode switcher.
- Selecting Motion keeps the editor shell and canvas preview, activates the Motion inspector, and opens the bottom timeline dock.
- Make the timeline feel familiar to After Effects users through composition controls, timecode, transport, layer/property tracks, keyframes, zoom, and later Graph Editor/easing tools. Do not copy Adobe visual assets or clone its exact UI.
- Improve Home information hierarchy, original icon consistency, and review the existing U logo/wordmark before any replacement.
- Unify general team chat and anchored design comments into a single project discussion model. This needs persistent team identity and transport; do not ship fake persistence.

## Work order

### UI-A: Motion interaction and visual system
1. Keep the mode switcher and bottom dock behaviour.
2. Give the dock a clearer composition header, timecode/transport grouping, and timeline-specific controls.
3. Improve layer/property row hierarchy, frozen label column, ruler, keyframe selection, and contextual keyframe editing.
4. Add Graph Editor only after the document model and command API support curve editing. Existing keyframes already carry Step, Linear, and CubicBezier interpolation; inspect command coverage before exposing controls.
5. Add regression tests for the Motion mode/dock relationship and any changed timeline interactions.

### UI-B: Home and navigation
1. Audit existing rail, sidebar, cards, recents and online states.
2. Improve hierarchy and compact spacing without inventing Projects, Shared, Favorites or Trash destinations.
3. Map future sections to actual data and commands before enabling them.

### UI-C: Discussion and collaboration
1. Preserve local anchored comments, replies, mentions, reactions and resolve state.
2. Preserve live presence/cursor chat as a distinct ephemeral transport.
3. Design a unified conversation model and UI with explicit message kinds and canvas anchors.
4. Before enabling persistent group chat, implement or identify supported account/team identity, message persistence, delivery, access control and synchronization. Existing local comments are not cross-user shared; do not claim otherwise.

### UI-D: Icons and logo
1. Inventory every icon renderer and the app glyph compatibility mapping.
2. Audit at actual 12/16/20/24 px sizes for optical weight, alignment, contrast and semantic clarity.
3. Consolidate duplicates only when behaviour and compatibility are preserved.
4. Keep the current logo/app icon during this pass; propose any new logo separately with concept and small-size tests.

### UI-E: verification
1. Restore enough disk headroom safely before compiling.
2. Run focused UI tests first, then full workspace tests and wasm/clippy checks.
3. Capture screenshots in light/dark themes and click through the Motion switcher, timeline dock, Home actions and Discussion controls.
4. Record exact results; do not claim unperformed visual checks.

## Anonymous first-run UI (added 2026-11-04)

- Browser starts with a local anonymous profile, no sign-in wall.
- Welcome step: concise intro, display-name field, optional avatar treatment, Continue.
- Profile is per browser storage scope; no cross-browser identity, cloud recovery, or permissions are implied.
- Reuse existing preference/display-name infrastructure where possible. Do not add Supabase Auth or mutate schema/RLS for this UI pass.
- Keep this work behind Home visual alignment; do not let onboarding displace the approved editor layout priorities.

## Backend safety findings (read-only audit)

- `showcase/supabase/migrations/0001_usage_counters.sql` enables RLS, revokes table/function access from public/anon/authenticated, and grants the quota RPC only to `service_role`.
- Showcase uses `SUPABASE_SECRET_KEY` only in server-side API code. No Supabase client SDK or Supabase Realtime document sync was found in the editor/browser app.
- `showcase/vercel.json` and deployment instructions are scoped to the `showcase` root directory. `showcase/README.md` explicitly says the relay has not been deployed and real production environment/deployment behavior is unverified.
- No backend, database, environment, or deployment changes made during this audit.
