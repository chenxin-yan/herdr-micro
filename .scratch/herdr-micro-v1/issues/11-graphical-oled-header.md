# 11 — Graphical OLED header: fleet box row (device displayio rewrite)

**What to build:** Replace the text counts line with a graphical header the Device draws; Host stays the data owner (pure peripheral: Device renders exactly what it's told).

Protocol (ADR-0003 extension):

- `render` gains `hdr: { boxes: string[], sel: number|null, page: number, pages: number }`.
  - `boxes`: one entry per fleet agent (whole fleet, not just the page), values `"w"|"i"|"b"|"d"|"u"`. Cap at what fits (~16); Host truncates and that's fine.
  - `sel`: index into `boxes` of the selected agent, or null.
  - `page`/`pages`: for page dots; Device omits dots when `pages <= 1` (keeps issue's earlier "no page label on single page" behavior).
- `text` shrinks to the remaining 3 lines (workspace/context, selected, detail).

Device (`device/code.py`):

- Drop `SimpleTextDisplay`; build a displayio Group: a header row (approx 12px tall) + 3 `bitmap_label` text lines below.
- Header: one small box per `boxes` entry (~6px wide + 1px gap): working = filled, idle = hollow, blocked = filled with hollow center (donut), done = hollow with center dot, unknown = single center pixel. Selected agent (`sel`) gets a 1px underline. Page dots right-aligned: filled dot = current page.
- Draw via a small header `displayio.Bitmap` + `Palette` repainted on render (no per-frame animation here; header changes only when a render arrives).
- `waiting`/`mismatch` screens keep working (plain text on the same 3 lines or full group swap — implementer's choice, keep it simple).

**Blocked by:** 10 — text line contents (detail line) land there.

**Status:** ready-for-human

- [ ] Header shows one box per agent with distinct shapes per state, selection underline, page dots only when multi-page
- [ ] Host tests cover hdr construction (boxes/sel/page truncation); `bun test`, `bun run check`, and `python3 -m py_compile device/code.py` pass
- [ ] ADR-0003 documents `hdr` and the 3-line `text`

## Comments

- 2026-08-15: Implemented (normal polarity — user rejected the inverted-bar variant mid-flight, spec reverted and worker steered). Device dropped SimpleTextDisplay for a displayio group: header bitmap with per-state shapes, selection underline, page dots; 3 text lines below. ADR-0003 documents hdr. Gates green incl. py_compile. Awaiting desk verification.
