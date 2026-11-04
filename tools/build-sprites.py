"""Convert the Clawd pixel-art SVG pack into app/assets/poses.json.

Every SVG in the pack is a 2000x2000 canvas of 43.55-unit <rect> "pixels" on a
~42.8-unit grid (some rects are rotated 180deg about their own centre). We snap
each rect back to its grid cell, crop every pose, and pre-compute the metadata
the renderer needs to animate it: which pixels are body / eyes / mouth / legs,
where the head is (for hats) and where the feet are (the ground anchor).

usage: python tools/build-sprites.py <svg-pack-dir> [out.json]
"""
import json
import re
import sys
from collections import deque
from pathlib import Path

BODY = "#d97757"
EYE = "#2f2f38"
MOUTH = "#fff1e6"
CELL = 2000 / 46.73

ROLE_PROP, ROLE_BODY, ROLE_EYE, ROLE_MOUTH, ROLE_LEG, ROLE_HAT, ROLE_EXTRA = range(7)

RECT = re.compile(
    r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"'
    r'(?: transform="translate\(([\d.-]+),([\d.-]+)\) rotate\(-180\)")? fill="(#[0-9a-fA-F]{6})"'
)


def parse(svg_text):
    px = {}
    for m in RECT.finditer(svg_text):
        x, y, w, h = map(float, m.group(1, 2, 3, 4))
        if m[5]:
            x, y = float(m[5]) - x - w, float(m[6]) - y - h
        px[(int((x + 1) / CELL), int((y + 1) / CELL))] = m[7].lower()
    return px


def components(cells):
    cells, seen, out = set(cells), set(), []
    for start in cells:
        if start in seen:
            continue
        comp, q = [], deque([start])
        seen.add(start)
        while q:
            c, r = q.popleft()
            comp.append((c, r))
            for dc in (-1, 0, 1):
                for dr in (-1, 0, 1):
                    n = (c + dc, r + dr)
                    if n in cells and n not in seen:
                        seen.add(n)
                        q.append(n)
        out.append(comp)
    return out


def analyse(px):
    body = max(components([p for p, col in px.items() if col == BODY]), key=len)
    bset = set(body)
    x0, x1 = min(c for c, _ in body), max(c for c, _ in body)
    y0, y1 = min(r for _, r in body), max(r for _, r in body)

    # Mouth: transparent cells inside the body box that the outside can't reach.
    outside, q = set(), deque()
    for c in range(x0 - 1, x1 + 2):
        for r in (y0 - 1, y1 + 1):
            q.append((c, r))
    for r in range(y0 - 1, y1 + 2):
        for c in (x0 - 1, x1 + 1):
            q.append((c, r))
    while q:
        c, r = q.popleft()
        if (c, r) in outside or (c, r) in px or not (x0 - 1 <= c <= x1 + 1 and y0 - 1 <= r <= y1 + 1):
            continue
        outside.add((c, r))
        q.extend([(c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)])
    holes = [(c, r) for c in range(x0, x1 + 1) for r in range(y0, y1 + 1)
             if (c, r) not in px and (c, r) not in outside]
    holes = [h for h in holes if len(holes) <= 8]  # big enclosed gaps are props, not mouths

    # Measure the head with eyes and mouth filled in, so they don't split the rows.
    face = [p for p, col in px.items() if col == EYE and x0 <= p[0] <= x1 and y0 <= p[1] <= y1]
    rows = {}
    for c, r in body + face + holes:
        rows.setdefault(r, []).append(c)

    def longest_run(cols):
        cols = sorted(cols)
        best, cur = (0, 0), [cols[0]]
        for a, b in zip(cols, cols[1:] + [None]):
            if b == a + 1:
                cur.append(b)
                continue
            if len(cur) > best[1] - best[0]:
                best = (cur[0], cur[-1] + 1)
            cur = [b]
        return best

    widths = {r: longest_run(cols)[1] - longest_run(cols)[0] for r, cols in rows.items()}
    min_w = min(10, max(widths.values()))  # tiny Clawds (e.g. inside a screen) have narrower heads
    head_top = min(r for r, w in widths.items() if w >= min_w)
    # A raised arm can merge into the top row, so take the most common run over the head rows.
    runs = [longest_run(rows[r]) for r in range(head_top, head_top + 5) if r in rows]
    head_like = [run for run in runs if 12 <= run[1] - run[0] <= 16] or runs
    hl, hr = max(head_like, key=lambda run: (head_like.count(run), -(run[1] - run[0])))
    # A prop overlapping the head's top row (a Zzz, a sparkle) splits that row's
    # run; walk up while most of the head's columns are still body-coloured.
    while sum(1 for c in range(hl, hr) if px.get((c, head_top - 1)) == BODY) >= 0.6 * (hr - hl):
        head_top -= 1

    body_rows = {}
    for c, r in body:
        body_rows.setdefault(r, []).append(c)
    leg_rows = set()
    for r in range(y1, y0, -1):
        if len(body_rows.get(r, [])) > 8:
            break
        leg_rows.add(r)

    roles = {}
    for p, col in px.items():
        role = ROLE_PROP
        if col == BODY and p not in bset:
            role = ROLE_EXTRA  # raised arms, mini Clawds
        elif col == BODY:
            role = ROLE_LEG if p[1] in leg_rows else ROLE_BODY
        elif col == EYE and x0 <= p[0] <= x1 and y0 <= p[1] <= y1:
            role = ROLE_EYE
        roles[p] = role
    for h in holes:
        px[h] = MOUTH
        roles[h] = ROLE_MOUTH

    feet = max(r for p, col in px.items() for r in [p[1]] if col == BODY)  # minis can stand in front
    return {
        "ax": (hl + hr - 1) / 2, "ay": feet + 1,
        "headTop": head_top, "headL": hl, "headR": hr,
        "body": [x0, y0, x1 + 1, y1 + 1],
    }, roles


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "app" / "assets" / "poses.json"
    palette, poses = [], {}
    for f in sorted(src.glob("*.svg")):
        px = parse(f.read_text(encoding="utf-8"))
        if not any(col == BODY for col in px.values()):
            continue
        meta, roles = analyse(px)
        ox, oy = min(c for c, _ in px), min(r for _, r in px)
        flat = []
        for (c, r), col in sorted(px.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            if col not in palette:
                palette.append(col)
            flat += [c - ox, r - oy, palette.index(col), roles[(c, r)]]
        meta = {
            "w": max(c for c, _ in px) - ox + 1, "h": max(r for _, r in px) - oy + 1,
            "ax": meta["ax"] - ox, "ay": meta["ay"] - oy,
            "headTop": meta["headTop"] - oy, "headL": meta["headL"] - ox, "headR": meta["headR"] - ox,
            "body": [meta["body"][0] - ox, meta["body"][1] - oy, meta["body"][2] - ox, meta["body"][3] - oy],
            "px": flat,
        }
        poses[f.stem] = meta
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"palette": palette, "poses": poses}, separators=(",", ":")))
    print(f"{len(poses)} poses, {len(palette)} colours -> {out}")


if __name__ == "__main__":
    main()
