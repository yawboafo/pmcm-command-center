"""
Scripted food, packaging and hand-held props for the twin's live layer and carried items.

    blender -b --factory-startup --python blender/build_props.py -- [--only pizza,crate] [--no-render]

Output
    blender/out/raw/props/<name>.glb   a single BODY node on the shared `vcol` material (1 draw call)
    blender/out/stats.json             merged entries (kind "props")
    blender/renders/<name>.png         EEVEE QA render

Contract: metres, +Y up, front +Z, origin at the bottom centre of the item (resting surface),
<= 600 triangles each, no textures (vertex colours only), so the app can instance them freely and
tint them (e.g. raw -> baked) through the material colour.
"""

from __future__ import annotations

import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402
from lib import Asset  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
RENDERS = os.path.join(HERE, "renders")
BUDGET = 600

# food palette
CRUST = "#c98a3e"
CRUST_DARK = "#a8692b"
BASE = "#e0ae62"
CHEESE = "#f3c24f"
CHEESE_HI = "#f8dc84"
SAUCE = "#b5311d"
PEPPERONI = "#9e2a1c"
PEPPER = "#3c9a3a"
ONION = "#e9dbe6"
DOUGH = "#f1dcae"
CHICKEN = "#b8691f"
CHICKEN_HI = "#cf8a35"
BREADED = "#d9b77a"
BONE = "#efe6d2"
JOLLOF = "#d4572a"
JOLLOF_HI = "#e2733a"
PLANTAIN = "#e8952c"
STEEL = "#b9bec4"
STEEL_DARK = "#6e747b"
TRAY = "#2b2d31"
WHITE = "#f6f4ee"
KRAFT = "#c49a64"
RED = "#EE1D25"
YELLOW = "#FFD400"
GREEN = "#5AB350"
CRATE = "#2f6fd0"
CRATE_DARK = "#1f4f9e"


# ---------------------------------------------------------------------------
# pizza family
# ---------------------------------------------------------------------------


def pizza_top(a: Asset, y0: float, R: float, *, baked=True, toppings=True, cut=False, n_pep=6, n_veg=5):
    """Crust ring, base, cheese and toppings on a pizza of radius R resting at y0."""
    a.lathe((0, y0, 0), [(0.0, 0.0), (R * 0.99, 0.0), (R, 0.01), (R * 0.93, 0.02), (R * 0.85, 0.015), (R * 0.84, 0.011)],
            "", "BODY", seg=18, vcol=CRUST if baked else DOUGH)
    ch = CHEESE if baked else "#f6e6a8"
    a.lathe((0, y0 + 0.009, 0), [(R * 0.84, 0.0), (R * 0.84, 0.002), (R * 0.6, 0.0055), (0.0, 0.0065)], "", "BODY", seg=14,
            vcol=ch)
    if not baked:
        a.lathe((0, y0 + 0.0075, 0), [(R * 0.86, 0.0), (R * 0.86, 0.0012), (0.0, 0.0016)], "", "BODY", seg=14, vcol=SAUCE)
    if toppings:
        rnd = a.rng
        for i in range(n_pep):
            ang = i * 2.39996 + 0.4
            rr = R * (0.18 + 0.55 * ((i * 0.618) % 1))
            a.cyl((math.cos(ang) * rr, y0 + 0.0165, math.sin(ang) * rr), R * 0.12, 0.004, "", "BODY", seg=6, vcol=PEPPERONI)
        for i in range(n_veg):
            ang = i * 1.7 + 1.1
            rr = R * (0.25 + 0.45 * ((i * 0.37) % 1))
            a.box((math.cos(ang) * rr, y0 + 0.017, math.sin(ang) * rr), (R * 0.16, 0.004, R * 0.05), "", "BODY", bevel=0,
                  r=(0, rnd.uniform(0, 3), 0), vcol=PEPPER if i % 2 == 0 else ONION)
    if cut:
        for k in range(4):
            a.box((0, y0 + 0.0185, 0), (R * 1.9, 0.0015, 0.004), "", "BODY", bevel=0, r=(0, k * math.pi / 4, 0), vcol="#8a5a24")


def pizza(a: Asset):
    """Baked 12" pizza (conveyor oven belt, QC pass)."""
    pizza_top(a, 0.0, 0.15)


def pizza_raw(a: Asset):
    """Topped, unbaked pizza on the make-line board."""
    pizza_top(a, 0.0, 0.15, baked=False)


def pizza_tray(a: Asset):
    """Cut pizza on a round black serving / cutting tray."""
    a.lathe((0, 0, 0), [(0.0, 0.0), (0.17, 0.0), (0.17, 0.01), (0.16, 0.008), (0.0, 0.008)], "", "BODY", seg=14, vcol=TRAY)
    pizza_top(a, 0.008, 0.15, cut=True, n_pep=5, n_veg=3)


def pizza_box(a: Asset, open_=False):
    w, h = 0.35, 0.045
    if not open_:
        a.box((0, h / 2, 0), (w, h, w), "", "BODY", bevel=0.003, vcol=WHITE)
        # printed lid: red frame band and a yellow corner flash (generic, no logo)
        a.box((0, h + 0.0006, 0), (w - 0.03, 0.0012, w - 0.03), "", "BODY", bevel=0, vcol=RED)
        a.box((0, h + 0.0012, 0), (w - 0.07, 0.0012, w - 0.07), "", "BODY", bevel=0, vcol=WHITE)
        a.box((-w * 0.18, h + 0.0018, w * 0.18), (0.12, 0.0012, 0.05), "", "BODY", bevel=0, r=(0, 0.785, 0), vcol=YELLOW)
        a.box((0, h * 0.5, w / 2 + 0.0006), (w * 0.9, 0.01, 0.0012), "", "BODY", bevel=0, vcol=RED)
    else:
        # base tray (open top) + pizza + lid hinged at the back, open ~100 degrees
        t = 0.004
        a.box((0, t / 2, 0), (w, t, w), "", "BODY", bevel=0, vcol=KRAFT)
        for sx in (-1, 1):
            a.box((sx * (w / 2 - t / 2), h / 2, 0), (t, h, w), "", "BODY", bevel=0, vcol=WHITE)
            a.box((0, h / 2, sx * (w / 2 - t / 2)), (w, h, t), "", "BODY", bevel=0, vcol=WHITE)
        pizza_top(a, t, 0.15, toppings=True, cut=True, n_pep=4, n_veg=2)
        lid_y, lid_z = h, -w / 2
        ang = math.radians(100)
        cy, cz = lid_y + math.sin(ang) * w / 2, lid_z + math.cos(ang) * w / 2
        a.box((0, cy, cz), (w, t, w), "", "BODY", bevel=0, r=(ang, 0, 0), vcol=WHITE)
        a.box((0, cy + math.cos(ang) * 0.003, cz - math.sin(ang) * 0.003), (w - 0.03, 0.0012, w - 0.03), "", "BODY", bevel=0,
              r=(ang, 0, 0), vcol=RED)


# ---------------------------------------------------------------------------
# chicken
# ---------------------------------------------------------------------------


def drumstick(a: Asset, p, yaw=0.0, *, scale=1.0, col=CHICKEN, seg=7, bone=True):
    """Fried drumstick lying on its side, meat end at -x, bone end at +x (local)."""
    s = scale
    x, y, z = p
    c, sn = math.cos(yaw), math.sin(yaw)

    def T(dx, dz):
        return (x + dx * c - dz * sn, z + dx * sn + dz * c)

    mx, mz = T(-0.012 * s, 0)
    a.sphere((mx, y + 0.026 * s, mz), 0.03 * s, "", "BODY", seg=seg, rings=5, scale=(1.35, 0.85, 0.95), r=(0, -yaw, 0), vcol=col)
    if bone:
        bx, bz = T(0.045 * s, 0)
        a.cyl((bx, y + 0.022 * s, bz), 0.007 * s, 0.03 * s, "", "BODY", seg=5, axis="x", r=(0, -yaw, 0), vcol=BONE)
        kx, kz = T(0.062 * s, 0)
        a.sphere((kx, y + 0.022 * s, kz), 0.011 * s, "", "BODY", seg=5, rings=3, vcol=BONE)


def chicken_drum(a: Asset):
    """One fried drumstick (instanced in the hot-holding cabinet)."""
    drumstick(a, (0, 0, 0), 0.0, col=CHICKEN)
    a.sphere((-0.025, 0.04, 0.008), 0.012, "", "BODY", seg=5, rings=3, vcol=CHICKEN_HI)


def chicken_basket(a: Asset):
    """Fryer basket (wire, front handle) with fried chicken; sized for the catalogue fryer
    (0.36w x 0.14 x 0.5d of a 0.9 x 1.1 x 0.8 fryer). Origin = bottom centre of the basket."""
    w, h, d = 0.324, 0.14, 0.40
    r = 0.004
    # frame: top rim + bottom rim + corner posts (thin bars), wire bottom
    for y in (0.003, h - 0.003):
        for sz in (-1, 1):
            a.box((0, y, sz * d / 2), (w, r * 1.6, r * 1.6), "", "BODY", bevel=0, vcol=STEEL)
        for sx in (-1, 1):
            a.box((sx * w / 2, y, 0), (r * 1.6, r * 1.6, d), "", "BODY", bevel=0, vcol=STEEL)
    for sx in (-1, 1):
        for sz in (-1, 1):
            a.box((sx * w / 2, h / 2, sz * d / 2), (r * 1.6, h, r * 1.6), "", "BODY", bevel=0, vcol=STEEL)
    # side mesh: a few horizontal wires per side
    for y in (h * 0.55,):
        for sz in (-1, 1):
            a.box((0, y, sz * d / 2), (w, r, r), "", "BODY", bevel=0, vcol=STEEL_DARK)
        for sx in (-1, 1):
            a.box((sx * w / 2, y, 0), (r, r, d), "", "BODY", bevel=0, vcol=STEEL_DARK)
    a.box((0, 0.002, 0), (w - 0.01, 0.003, d - 0.01), "", "BODY", bevel=0, vcol=STEEL_DARK)
    # handle forward (+z) with a black grip
    a.box((0, h - 0.01, d / 2 + 0.05), (0.012, 0.012, 0.1), "", "BODY", bevel=0, vcol=STEEL)
    a.box((0, h + 0.0, d / 2 + 0.16), (0.03, 0.03, 0.14), "", "BODY", bevel=0.004, vcol="#1b1c1f")
    for i in range(4):
        drumstick(a, ((-0.07 + (i % 2) * 0.14), 0.004 + (i // 4) * 0.03, (-0.12 + (i % 3) * 0.12)), i * 1.3, scale=1.15,
                  col=CHICKEN if i % 2 else CHICKEN_HI, seg=6, bone=i % 2 == 0)


def chicken_bucket(a: Asset):
    """Paper chicken bucket (red with white band) heaped with pieces."""
    a.lathe((0, 0, 0), [(0.0, 0.0), (0.075, 0.0), (0.077, 0.004), (0.1, 0.16), (0.104, 0.165), (0.098, 0.165), (0.0, 0.15)],
            "", "BODY", seg=12, vcol=RED)
    a.lathe((0, 0.07, 0), [(0.0866, 0.0), (0.0928, 0.05), (0.0928, 0.051), (0.0866, 0.001)], "", "BODY", seg=12, vcol=WHITE)
    for i in range(4):
        ang = i * 1.5708
        drumstick(a, (math.cos(ang) * 0.045, 0.15, math.sin(ang) * 0.045), ang + 1.2, scale=1.0, seg=6,
                  col=CHICKEN if i % 2 else CHICKEN_HI, bone=i % 2 == 0)
    drumstick(a, (0.0, 0.175, 0.0), 0.6, scale=1.0, seg=6)


def chicken_tray(a: Asset):
    """Gastronorm tray of breaded raw chicken (breading / prep station)."""
    w, h, d = 0.30, 0.05, 0.2
    a.tub((0, h / 2, 0), (w, h, d), 0.004, "", "BODY", bevel=0, vcol=STEEL)
    for i in range(6):
        drumstick(a, ((-0.09 + (i % 3) * 0.09), 0.008, (-0.045 + (i // 3) * 0.09)), (i % 2) * math.pi + 0.2, scale=0.95,
                  col=BREADED, seg=6, bone=True)


# ---------------------------------------------------------------------------
# rice, sides, drinks
# ---------------------------------------------------------------------------


def rice_pack(a: Asset):
    """Open jollof takeaway pack: white clamshell, jollof heap with a chicken piece, lid hinged back."""
    w, h, d = 0.2, 0.055, 0.15
    a.tub((0, h / 2, 0), (w, h, d), 0.004, "", "BODY", bevel=0, vcol=WHITE)
    a.lathe((0, h * 0.55, 0), [(0.0, 0.03), (0.06, 0.022), (0.075, 0.0), (0.0, 0.0)], "", "BODY", seg=10, vcol=JOLLOF)
    a.box((0, h * 0.55, 0), (w - 0.012, 0.012, d - 0.012), "", "BODY", bevel=0, vcol=JOLLOF)
    for i in range(5):
        a.sphere((-0.06 + i * 0.03, h * 0.55 + 0.012 + (i % 2) * 0.006, 0.03 - (i % 3) * 0.02), 0.012, "", "BODY", seg=5, rings=3,
                 vcol=JOLLOF_HI)
    drumstick(a, (0.035, h * 0.55 + 0.01, -0.01), 2.4, scale=0.9, seg=6)
    a.box((-0.07, h * 0.55 + 0.016, 0.04), (0.035, 0.012, 0.02), "", "BODY", bevel=0, r=(0, 0.4, 0), vcol=PLANTAIN)
    ang = math.radians(105)
    cy, cz = h + math.sin(ang) * d / 2, -d / 2 + math.cos(ang) * d / 2
    a.box((0, cy, cz), (w, 0.004, d), "", "BODY", bevel=0, r=(ang, 0, 0), vcol=WHITE)
    a.box((0, cy + 0.0025 * math.cos(ang), cz - 0.0025 * math.sin(ang)), (w * 0.8, 0.0012, 0.03), "", "BODY", bevel=0, r=(ang, 0, 0),
          vcol=RED)


def side_cup(a: Asset):
    """Side cup (kelewele / plantain): white paper cup, red band, heaped plantain cubes."""
    a.lathe((0, 0, 0), [(0.0, 0.0), (0.035, 0.0), (0.046, 0.075), (0.048, 0.078), (0.044, 0.078), (0.0, 0.07)], "", "BODY", seg=12,
            vcol=WHITE)
    a.lathe((0, 0.028, 0), [(0.0386, 0.0), (0.0431, 0.03), (0.0431, 0.031), (0.0386, 0.001)], "", "BODY", seg=12, vcol=RED)
    for i in range(7):
        ang = i * 2.4
        rr = 0.012 + (i % 3) * 0.008
        a.box((math.cos(ang) * rr, 0.078 + (i % 2) * 0.008, math.sin(ang) * rr), (0.018, 0.016, 0.018), "", "BODY", bevel=0,
              r=(i * 0.7, i * 1.3, 0.3), vcol=PLANTAIN)


def drink_can(a: Asset):
    a.lathe((0, 0, 0), [(0.0, 0.002), (0.026, 0.0), (0.033, 0.008), (0.033, 0.106), (0.028, 0.115), (0.026, 0.116), (0.0, 0.114)],
            "", "BODY", seg=14, vcol=RED)
    a.lathe((0, 0.045, 0), [(0.0332, 0.0), (0.0332, 0.025)], "", "BODY", seg=14, vcol=WHITE)
    a.cyl((0, 0.1158, 0), 0.024, 0.002, "", "BODY", seg=12, vcol=STEEL)


def drink_bottle(a: Asset):
    """500 ml PET soda bottle: dark cola body, red wrap label, red cap."""
    a.lathe((0, 0, 0), [(0.0, 0.004), (0.028, 0.0), (0.033, 0.012), (0.032, 0.11), (0.03, 0.135), (0.016, 0.17), (0.0125, 0.185),
                        (0.0125, 0.19), (0.0, 0.19)], "", "BODY", seg=12, vcol="#3b1f12")
    a.lathe((0, 0.06, 0), [(0.0328, 0.0), (0.0328, 0.045)], "", "BODY", seg=12, vcol=RED)
    a.cyl((0, 0.197, 0), 0.0145, 0.014, "", "BODY", seg=10, vcol=RED)


def takeaway_bag(a: Asset):
    """Paper takeaway bag: white body, red band, yellow stripe, twisted paper handles."""
    w, h, d = 0.26, 0.28, 0.15
    a.box((0, h / 2, 0), (w, h, d), "", "BODY", bevel=0.003, vcol=WHITE)
    a.box((0, h * 0.42, 0), (w + 0.002, 0.07, d + 0.002), "", "BODY", bevel=0, vcol=RED)
    a.box((0, h * 0.42 + 0.042, 0), (w + 0.002, 0.012, d + 0.002), "", "BODY", bevel=0, vcol=YELLOW)
    a.box((0, h - 0.004, 0), (w + 0.002, 0.008, d + 0.002), "", "BODY", bevel=0, vcol="#e6e1d6")  # folded rim
    for sz in (-1, 1):
        pts = lib.arc((0, h - 0.005, sz * d / 2), 0.055, 0.0, math.pi, n=6, plane="xy")
        a.pipe(pts, 0.004, "", "BODY", sides=5, vcol=KRAFT)


def crate(a: Asset):
    """Blue stacking crate (rice batches carried from the stove)."""
    w, h, d = 0.4, 0.22, 0.3
    a.tub((0, h / 2, 0), (w, h, d), 0.012, "", "BODY", bevel=0, vcol=CRATE)
    a.box((0, h - 0.008, 0), (w + 0.01, 0.016, d + 0.01), "", "BODY", bevel=0, vcol=CRATE_DARK)
    for sx in (-1, 1):  # handle slots
        a.box((sx * (w / 2 + 0.0015), h - 0.05, 0), (0.004, 0.025, 0.11), "", "BODY", bevel=0, vcol="#16386f")
    for k in range(3):  # side ribs
        x = -w / 2 + (k + 1) * w / 4
        for sz in (-1, 1):
            a.box((x, h * 0.45, sz * (d / 2 + 0.002)), (0.012, h * 0.7, 0.004), "", "BODY", bevel=0, vcol=CRATE_DARK)
    # lid of foil-covered rice showing at the top
    a.box((0, h - 0.03, 0), (w - 0.03, 0.01, d - 0.03), "", "BODY", bevel=0, vcol="#d9dcdf")


PROPS = {
    "pizza": ("Baked pizza (12\")", pizza),
    "pizza-raw": ("Topped pizza, unbaked", pizza_raw),
    "pizza-tray": ("Cut pizza on tray", pizza_tray),
    "pizza-box": ("Pizza box (closed)", lambda a: pizza_box(a, False)),
    "pizza-box-open": ("Pizza box (open, with pizza)", lambda a: pizza_box(a, True)),
    "chicken-drum": ("Fried drumstick", chicken_drum),
    "chicken-basket": ("Fryer basket with chicken", chicken_basket),
    "chicken-bucket": ("Chicken bucket", chicken_bucket),
    "chicken-tray": ("Tray of breaded chicken", chicken_tray),
    "rice-pack": ("Jollof pack (open)", rice_pack),
    "side-cup": ("Side cup (kelewele)", side_cup),
    "drink-can": ("Soft-drink can", drink_can),
    "drink-bottle": ("Soft-drink bottle", drink_bottle),
    "takeaway-bag": ("Takeaway bag", takeaway_bag),
    "crate": ("Rice crate", crate),
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    render = "--no-render" not in argv
    import json
    stats_path = os.path.join(OUT, "stats.json")
    stats = json.load(open(stats_path)) if os.path.exists(stats_path) else {}
    for name, (label, fn) in PROPS.items():
        if only and name not in only:
            continue
        t0 = time.time()
        lib.reset_scene()
        a = Asset(name, (0.3, 0.1, 0.3))
        fn(a)
        roles = a.finalize()
        tris = a.triangles()
        lo, hi = a.bounds()
        lib.export_glb(os.path.join(OUT, "raw", "props", f"{name}.glb"))
        size = [round(hi[i] - lo[i], 3) for i in range(3)]
        stats[name] = {
            "kind": "props",
            "label": label,
            "size": size,
            "origin": "bottom-centre",
            "triangles": tris,
            "budget": BUDGET,
            "bounds": {"min": lo, "max": hi},
            "roles": sorted(roles),
            "lod1": None,
        }
        flag = "  OVER BUDGET" if tris > BUDGET else ""
        print(f"[props] {name:16s} tris={tris:4d} size={size} ({time.time() - t0:.1f}s){flag}")
        if render:
            lib.render_preview(os.path.join(RENDERS, f"{name}.png"), name, res=(560, 440))
    lib.write_json(stats_path, stats)


if __name__ == "__main__":
    main()
