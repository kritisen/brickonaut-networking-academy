# Mobile audit

Checked in headless Chromium with phone emulation (mobile viewport, touch, DPR 2) at four sizes: iPhone SE 375×667, iPhone 14/15 390×844, a large Android 412×915 and a landscape phone 844×390. Every screen was captured: title, galaxy map, briefing dialog, each question type (multiple choice, multi-select, numeric, sequence, diagram, multi-part scenario), answer feedback with the concept figure, debrief, Journeys player and library, Repair Bay, Captain's Log and Settings. The pass lives in `tests/mobile_checks.mjs`. Run it on its own with `node tests/smoke_browser.mjs --mobile-only`, or use `--mobile-audit` to report without failing.

## Findings (before the fix)

| # | Where | Problem |
|---|---|---|
| 1 | Top bar, 375–390 px | The nav overflows the right edge by ~35 px. The mute button sits off-screen and can't be tapped. Nav buttons are 44×40 and the settings/mute buttons are squeezed to 34×40. |
| 2 | Mission screen, all portrait phones | The ship strip (a fixed 190 px ship plus three meters) is wider than the screen, so the play area scrolls **sideways**. The question card loads shifted and its prompt is clipped at the left edge ("ne service on the launch…"). |
| 3 | Mission HUD, portrait | The HUD wraps to three rows (~150 px). With the 114 px ship strip under it, the question starts 300–400 px down, more than half of an iPhone SE screen. Pause and mute are 34×40. |
| 4 | Mission, landscape 844×390 | The HUD and ship take about 45% of the height, leaving roughly 200 px for the question. Lock in sits at the bottom edge. |
| 5 | Question hints | Keyboard-only hints ("Press 1–4 then Enter", `Enter` badges on every primary button, "Drag to reorder · or 1–5 pick, ↑↓ move") show on touch devices. |
| 6 | Sequence questions | The ▲/▼ buttons are 30×30. Rows are fixed at 54 px with a two-line clamp, so on phones most steps are truncated ("Server presents its…", "Client validates the chain again…"). Touch drag already uses pointer events and works. |
| 7 | Diagram questions | The SVG is scaled down to fit 340 px, so nodes are 25–29 px across and labels are about 5 px tall. Too small to tap reliably or read. |
| 8 | Concept figures (feedback) and Journeys | The same shrink-to-fit makes figure text about 6 px on portrait phones. In landscape the Journey stage is 438 px tall in a 390 px viewport, and the narration sits below it, off-screen. |
| 9 | Journeys controls | Progress dots are 20×26 and the close button is 40×40. |
| 10 | Numeric input | `inputmode="numeric"` and 40 px text are already right. Once focused, though, the field sits at 484–530 px, which is under the on-screen keyboard on an SE (667 px). The Nav computer table has four 14 px-padded columns that only just fit. |
| 11 | Title, landscape 844×390 | The ≤900 px rule stacks a 320 px planet above the logo. The screen doesn't scroll, so the logo and **Begin training** end up off-screen (`#btn-begin` is unreachable). On the SE, the footer line overlaps the button area. |
| 12 | Galaxy map, portrait | The map is a 1600×900 viewBox fitted to 390 px (about 220 px tall), so planet names are about 5 px. The mission card takes 44vh and the type chips wrap to three rows. In landscape the full-width card covers most of the map. |
| 13 | Journeys library and Captain's Log | Card grids use `minmax(320px / 330px, 1fr)`, which is wider than the content box at 375 px with the 24 px page padding. Page titles at 44 px wrap awkwardly. |
| 14 | Settings | The Keyboard section is shown on touch devices. The modal uses `90vh`, which is taller than the visible area behind Safari's toolbars. |
| 15 | Viewport / insets | `viewport-fit=cover` is set, but nothing uses `env(safe-area-inset-*)`, so the top bar, HUD and dialog sit under the notch and the home indicator. Full-screen layers use `100vh` rather than the dynamic viewport. |
| 16 | Hover affordances | Choice and button hover transforms stick after a tap on touch screens (a choice stays nudged 3 px to the right). No control is hover-only. |
| 17 | Starfield / fx canvases | DPR was already capped at 2. There was no pixel budget, so a large high-DPR screen allocates very large backing stores. The canvases are sized with `100vw/100vh`. |
| 18 | Audio on iOS Safari | Audio starts on the first `pointerdown`. In WebKit a touch `pointerdown` isn't a user activation (`touchend`/`click` are), so the context can stay suspended after the first tap. |

No page-level horizontal scroll was found at 412 px or in landscape. The 375/390 px overflow was the top bar (#1) plus the mission play area scrolling sideways (#2).

## What changed

| # | Fix |
|---|---|
| 1 | Below 600 px the top bar is icon-only: the brand is hidden, the stars stack, and all six controls are 44×44. It fits 360 px. |
| 2 | The closed feedback panel now slides up rather than in from the side, which was the cause of the sideways scroll. The ship strip fits the width. The checks fail on any unexpected sideways scroller. |
| 3 | The HUD is two rows (title, pause and mute; then shields, streak, XP, clock and fuel bar). The ship is a ~55 px strip (a 96 px ship plus hull and afterburner meters; damaged modules still show on the ship). |
| 4 | Landscape phones get a one-row HUD and the ship in a 132 px left column, so the question gets the full height. |
| 5 | On touch screens, question hints use tap wording. `Enter` badges, the title and map key hints, and the Settings keyboard section are hidden. |
| 6 | Sequence rows read their pitch from `--order-row`: 100 px on phones, with up to four lines of text and stacked 44×44 ▲/▼ buttons. Rows re-lay out when the phone rotates. |
| 7 | Diagram questions keep a 600 px minimum width and scroll sideways inside their frame, which makes nodes about 44 px. |
| 8 | Concept figures keep a 540 px minimum width and scroll sideways inside the figure frame. In portrait the Journey scanner tooltip docks along the bottom of the stage, with a "turn sideways" hint. In landscape the stage is sized from the remaining height, sitting next to the narration, with the controls on one row. |
| 9 | Every Journey dot is a full 44×44 target. In portrait, long journeys wrap onto a second row of dots (7 per row at 375 px). The close button is 44×44. |
| 10 | A focused numeric field scrolls into the part of the screen the keyboard leaves visible (tracked with `visualViewport` resize). A screen-tall spacer guarantees there's room to scroll. The viewport meta adds `interactive-widget=resizes-content`. The Nav computer table is compact and scrolls inside its box. |
| 11 | The title scrolls if it has to. The footer sits under the button in portrait. Landscape puts the planet beside the copy and drops the footer. |
| 12 | The map pans sideways on phones (height-fitted, 16:9) and centres the selected world. The mission card is compact and hides the type chips. Landscape docks the card on the right. |
| 13 | Grids use `minmax(min(320px, 100%), 1fr)`. Phone padding is tighter, with smaller page titles, KPIs and bars. |
| 14 | The modal and journey box use `100dvh` where supported. |
| 15 | `env(safe-area-inset-*)` is applied to the top bar, mission screen, dialog, modal, pages and journeys. On desktop it resolves to 0, so nothing changes there. |
| 16 | Hover styles only apply under `@media (hover: hover)`, so a tapped element doesn't stay nudged. The Concept toggle keeps a 44 px floor on touch screens and landscape phones. |
| 17 | The canvases are sized to 100% and use `ONA.util.canvasDpr`: 2× cap plus an ~8 MP budget. Phones and laptops are unchanged; 5K-class screens drop below 2×. |
| 18 | Every trusted `pointerup`, `touchend`, `click` or `keydown` unlocks audio synchronously: it resumes the context and starts a zero-gain buffer. Those listeners remove themselves once the context is `running`, and they re-arm when it drops out (iOS `interrupted`, a back/forward cache `pageshow`, or a hidden tab coming back). iOS gets a playback audio session so the silent switch doesn't mute it. On Safari 16.4+ that's `navigator.audioSession.type = 'playback'`, set at load and again before any context is constructed or resumed. Older iOS gets a looping silent `<audio>` that exists only while sound is wanted and the page is visible, and is rebuilt on the next tap if it's refused or paused. A 44 px **Tap for sound** chip shows if music is on but audio still isn't running ~1 s after a gesture. "Music on" is only shown once audio really runs. |

The desktop and iPad layouts are unchanged: the phone rules sit behind `max-width: 600px` or a `max-height: 500px` landscape query. A touch iPad picks up only the `(hover: none) and (pointer: coarse)` rules, which mean 44 px targets and no keyboard hints. The existing desktop and iPad screenshots were compared before and after.
