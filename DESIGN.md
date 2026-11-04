# Undesign Design Direction

Status: owner-approved direction, 2026-11-04
Product: Undesign, a professional interface design and motion tool.

## Identity
- A precise, editorial creative-tool identity. Quietly confident, crafted, technical without looking like a terminal.
- Neutral grayscale is the interface foundation. Keep color reserved for selection, semantic status, timeline/keyframe states, and user-authored artwork. Do not flood the app with blue, yellow, purple, gradients, glow, or glass effects.
- Keep the current U mark and wordmark as the baseline during the first visual pass. Review at small and large sizes before changing the symbol. A logo replacement is a separate approved design deliverable, not a side effect of icon cleanup.
- Typeface should prioritize legibility, compact panel density, and a clear hierarchy. Monospaced numerals/timecode only where precision benefits the task.
- Rounded geometry is restrained and consistent. Avoid pill-shaped controls everywhere and avoid excessive floating cards.

## Product interaction principles
- Undesign owns its visual identity and information architecture. Figma and Adobe After Effects are interaction references, not artwork or templates to copy.
- Keep the Figma-familiar editor shell: top menu and toolbar, canvas in the centre, layer/assets navigation on the left, contextual inspector on the right.
- Keep the workspace mode switcher with Design, Motion, and Developer Mode. Selecting Motion activates the Motion context and opens the bottom timeline dock. Do not replace this with a separate app or unrelated full-screen route.
- Motion must feel familiar to After Effects users: composition controls, preview canvas, layer/property hierarchy, time ruler, current-time indicator, transport, keyframe diamonds, track controls, timeline zoom, and eventually a Graph Editor/easing workspace. Keep the familiar interaction grammar but design Undesign-specific surfaces and icons.
- Preserve the central design canvas as the composition preview. The timeline belongs below it and expands vertically; inspector remains contextual on the right.
- Team discussion should unify persistent group messages and canvas-anchored comment threads in one project conversation. Messages need explicit types and anchors. Do not imply persistence, team identity, or cross-device delivery until the backend supports it.
- Navigation must map to real destinations and data. Never add dead Home sections or fake project/team content.
- Icons are original, semantically relevant, optically consistent, and drawn in the existing clean-room icon system. No copying, tracing, embedding, or imitating Figma/Adobe product artwork.

## Layout and density
- The editor is a dense professional workspace, not a marketing dashboard. Use compact controls, clear separators, aligned columns, stable panel widths, and visible focus/hover/pressed/disabled states.
- Home is a workspace/file launcher: prioritize new/open/import, recent files, online files, and later real project/shared/favorites/trash data when supported.
- Motion timeline should use a frozen layer-label column and horizontally navigable time lanes. Timecode and frame numbers must remain legible at practical zoom levels.
- Discussion should use a readable message stream, distinguish anchored design comments from general chat, and preserve thread context.

## Motion and accessibility
- Motion should be purposeful: playback, keyframe selection, playhead movement, and panel transitions only. Respect reduced-motion preferences.
- Keep keyboard operation, accessible names, visible focus, and useful tooltips for icon-only controls.
- Maintain contrast in light and dark themes. Avoid color-only state communication.
- All controls must have working actions. Unimplemented collaboration, project management, graph editor, and effect features must not be shown as if functional.

## Decisions and rationale
- Grayscale base: keeps the design artifact, not the chrome, visually dominant.
- Existing workspace switcher + bottom dock: preserves the Figma mental model the owner explicitly requested while giving Motion enough horizontal room.
- After Effects interaction grammar: reduces learning friction for keyframes, transport, track hierarchy, and time navigation without cloning Adobe's visual identity.
- Existing U mark retained during first pass: avoids an unreviewed identity change while the logo is being evaluated.
- Unified Discussion architecture: puts team conversation and design-specific review in one context without losing canvas anchors.

## First-run identity and anonymous browser experience

- The browser experience starts as an anonymous local profile; no sign-in wall or account form.
- First visit shows a welcome step with a short explanation, editable display name, optional avatar colour/initials, and a clear Continue action.
- The profile is scoped to that browser profile. A different browser or cleared site data starts independently; do not imply cross-device identity or recovery.
- Keep the first-run step visually lightweight and consistent with the Home reference. It must not block opening a local/new design.
- The display name feeds existing local presence/comment author labels. It is not an authorization identity.
- Do not connect this profile to Supabase Auth, create anonymous Auth users, or change database policies as part of the UI pass.
- Future cloud sync must be an explicit separate capability with a documented ownership/recovery model. Anonymous local identity alone is not permission to read or write another user's project.

## Backend boundaries during UI work

- The current editor collaboration path is the existing Undesign live-session/WebSocket protocol, not a verified Supabase Realtime document store.
- The Showcase Supabase integration is limited to server-side Agent usage counters. Keep its secret key server-only and its table/RPC private.
- The Showcase Vercel configuration is isolated under `showcase/`; the repository documentation currently describes that relay as not deployed. Do not change Vercel project settings, environment variables, or deployment state during UI work.
