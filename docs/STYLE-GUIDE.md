# Style guide — camera centre (and the direction for the rest of the platform)

One deliberate look: a **dark control-room surface** in either app theme (the centre sets
`data-theme="dark"`), precise instrumentation, restraint. Sophistication lives in alignment
and hierarchy, not in decoration. If an element does not help the owner decide something in
the next 60 seconds, it is not on the screen.

## Colour

| Token | Value | Use |
|---|---|---|
| `--cam-bg` | `#07090d` | Page / canvas background (painted by the renderer) |
| `--cam-panel` | `#0d1117` | Panels, cards |
| `--cam-panel-2` | `#121821` | Raised controls |
| `--cam-line` | `rgba(255,255,255,.08)` | Hairlines, borders, neutral rings |
| `--cam-fg` / `--cam-muted` / `--cam-faint` | `#e8eaed` / 55 % / 35 % | Text in three strengths only |
| `--accent` | `#ee1d25` (brand red) | Primary action, the active camera, recording dot, scrubber thumb. Sparingly. |
| `--ok` | `#22c55e` | Running right |
| `--watch` | `#f59e0b` | Watch |
| `--act` | `#ef4444` | Act now |

Rules: one neutral scale, one accent, three status colours. **Status colours are never
decorative**: green/amber/red only ever mean healthy/watch/act. People boxes use neutral
white (customers) or the accent (staff) unless a timed state turns them amber/red. Heat map is
a single calibrated ramp (accent at low alpha → accent).

## Type

- **Numbers and readouts**: Geist Mono, tabular figures (`font-variant-numeric: tabular-nums`
  on every mono element), so values tick without jitter.
- **Labels and sentences**: Inter.
- **Scale** (max three sizes per screen plus the hero): 11 px meta / 13 px body and buttons /
  20–22 px metrics; hero metric 40 px (64 px on wall screens). Letter-spaced mono uppercase at
  10–11 px for section eyebrows only.

## Geometry

- 8-pt grid: paddings 8 / 12 / 16, gaps 8 / 12 / 16.
- Radius system: 12 px panels, 8 px controls, 6 px chips, 999 px pills. Feed tiles 12 px.
- Elevation: hairline borders; one soft shadow only for floating menus and the timeline hover card.
- Tap targets ≥ 44 px (all buttons `h-11`, scrubber thumb 22 px on a 44 px hit area).

## Icons

lucide, outline, 13–20 px, never mixed with filled sets. Icons accompany labels; they do not
replace them.

## Motion

- Camera switch: 450 ms crossfade from black (`.cam-crossfade`).
- Alert arrival: 300 ms slide-in; escalated alerts pulse twice (`.cam-pulse`), never flash.
- Acknowledge / resolve: the card's stripe calms red → amber → green through state, not animation.
- Scrubbing: scene and numbers move together every frame; the playhead is a plain bar.
- Live cues: ticking timestamp, recording dot (accent), faint scanlines and vignette on the feed.
- `prefers-reduced-motion` disables all of the above.

## Language

Plain words, no acronyms: "Longest wait", "Oldest order", "Riders waiting", "Act now". Each
alert is one line of cause and one line of action, two buttons maximum. Every number names what
it is (label), when it was measured (time chip) and what it is compared to (yesterday / last
weekday, marked modelled).

## Provenance

The feed carries one small **SIMULATED** chip (or **REPLAY**); it never dominates. LIVE
always shows when a physical source is connected. The metrics footer states the measurement
basis in one sentence.

## States (every feed and panel)

Loading ("Connecting", pulsing neutral dot) · live · stale ("No signal", amber dot) · absent
("No camera — this layout has no … zone") · empty alerts ("Nothing needs you here.") · empty
trend ("Trend after a few minutes") · replay.

## Layout

- Zone screen: feed ≥ 60 % of the width on desktop (`1fr / 360px`, `1fr / 460px` on walls);
  question above, layers and timeline below, numbers beside.
- Phone: feed first, then tabs Status / Alerts / Timeline / Actions; one DOM tree, no duplicates.
- Wall (≥ 1900 px): four-column grid, 64 px hero.
- Grid: equal 16:9 cards, worst first, status ring, hero number, alert badge, last event caption.

## Accessibility

Contrast ≥ 4.5:1 for text on panels (muted text 55 % on `#0d1117` ≈ 6.9:1), status dots always
paired with words, `aria-label` on feeds and icon buttons, keyboard: Esc / ← → / Space.
