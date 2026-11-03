# Style guide — camera centre (and the direction for the rest of the platform)

One deliberate look: a **dark control-room surface** in either app theme (the centre sets
`data-theme="dark"`), precise instrumentation, restraint. Sophistication lives in alignment
and hierarchy, not in decoration. If an element does not help the owner decide something in
the next 60 seconds, it is not on the screen.

## Scope

These rules now apply to the whole platform, not only the camera centre: the tokens live in
`src/app/globals.css` (`:root`), every status utility (`emerald`, `amber`, `red`) is mapped onto
the same three status colours, and every readout uses the `.num` display numerals.

## Colour

| Token | Value | Use |
|---|---|---|
| `--bg` / `--cam-bg` | `#070a10` / `#07090d` | Page, canvas background |
| `--panel` / `--cam-panel` | `rgba(12,16,22,.88)` / `#0c1016` | Panels, cards, glass surfaces (gradient highlight + soft shadow) |
| `--panel-border` / `--cam-line` | `rgba(255,255,255,.075)` | Hairlines, borders, neutral rings |
| text | `#eceef1` / 58 % / 36 % | Text in three strengths only |
| `--accent` | `#ee1d25` (brand red) | Primary action (gradient `btn-primary`), the active camera, recording dot, scrubber thumb. Sparingly. |
| `--ok` | `#3ccf8e` | Running right |
| `--watch` | `#f5b02e` | Watch |
| `--act` | `#f0483e` | Act now |
| `--viz` | `#7f9cc0` (steel) | The single information hue: chart series, map ramp, progress. Never a status. |

Rules: one neutral scale, one accent, three status colours, one information hue. **Status
colours are never decorative**: green/amber/red only ever mean healthy/watch/act. Multi-series
charts use steel, sand `#d1a86a`, mauve `#a98fc9`, teal `#6fb8b0` — muted, equal weight.

## Type

- **Numbers and readouts**: the brand display face (Montserrat) through `.num` — 700 weight,
  tabular lining figures, −2 % tracking — so values tick without jitter and read from 3 m.
- **Instrument plates and timestamps** (on feeds, timelines): Geist Mono, tabular.
- **Labels and sentences**: Inter with `cv11`/`ss01` alternates, antialiased.
- **Scale**: 11 px meta / 13 px body and buttons / 16 px titles / 20–24 px metrics; hero metric
  44 px (64 px on wall screens). Letter-spaced mono uppercase at 10–11 px for eyebrows only.

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
