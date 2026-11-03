"""
Build every scripted equipment / furniture asset.

    blender -b --factory-startup --python blender/build_assets.py -- [--only fryer,fridge] [--no-render] [--no-lod]

Outputs (raw, un-optimised; see postprocess.py for the web-ready step):
    blender/out/raw/<kind>/<type>.glb        LOD0
    blender/out/raw/<kind>/<type>.lod1.glb   LOD1 for the 6 largest equipment items
    blender/out/stats.json                   triangles / bounds / roles per asset (merged across runs)
    blender/renders/<type>.png               EEVEE QA render, 3/4 view

All builders work in APP SPACE (x width, y up, z front +), match the
procedural models in src/components/twin/equipment.tsx and keep the fixed
anchor heights the live layer (src/components/twin/live.tsx) draws moving
parts at.  Comments marked LIVE: name those anchors.
"""

from __future__ import annotations

import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402
from lib import Asset, at, arc  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CATALOG = os.path.join(ROOT, "src", "lib", "floorplan", "catalog.ts")
OUT = os.path.join(HERE, "out")
RENDERS = os.path.join(HERE, "renders")

# --------------------------------------------------------------------------
# shared sub-assemblies
# --------------------------------------------------------------------------


def table_base(a: Asset, *, backsplash=0.0, undershelf=0.2, top="steel"):
    """Stainless work table: rolled-edge 40 mm top, tubular legs, bullet feet, undershelf."""
    w, h, d = a.w, a.h, a.d
    a.box((0, h - 0.02, 0), (w, 0.04, d), top, bevel=0.012, seg=3)
    # apron channel under the front edge (stiffener)
    a.box((0, h - 0.055, d / 2 - 0.03), (w - 0.12, 0.03, 0.012), "brushed", bevel=0.002)
    if backsplash:
        a.box((0, h + backsplash / 2, -d / 2 + 0.012), (w, backsplash, 0.024), top, bevel=0.008, seg=2)
    a.round_legs(w, d, h - 0.04, "steel", inset=0.035, radius=0.02)
    if undershelf:
        a.box((0, undershelf, 0), (w - 0.07, 0.03, d - 0.07), "brushed", bevel=0.008, seg=2)


def controller(a: Asset, x, y, z, *, w=0.2, h=0.09, status=True, mat="blackGloss"):
    """Digital controller plate: bezel, red LED digits, buttons, status LED (STATUS)."""
    a.box((x, y, z + 0.006), (w, h, 0.012), mat, bevel=0.004)
    a.box((x - w * 0.12, y + h * 0.15, z + 0.0125), (w * 0.42, h * 0.32, 0.003), "digits", bevel=0)
    if a.detail:
        for i in range(4):
            a.box((x - w * 0.3 + i * w * 0.2, y - h * 0.28, z + 0.0135), (w * 0.12, h * 0.16, 0.004), "steelDark", bevel=0.001)
    if status:
        a.box((x + w * 0.34, y + h * 0.15, z + 0.0135), (0.014, 0.014, 0.004), "status", "STATUS", bevel=0)


def gn_pan(a: Asset, x, y_top, z, sw, sd, depth, *, mat="steel", food=None, mound=0.012):
    """Gastronorm pan hanging from its rim at y_top, optional food fill (vertex coloured)."""
    a.tub((x, y_top - depth / 2, z), (sw, depth, sd), 0.004, mat, bevel=0.002)
    a.box((x, y_top + 0.002, z), (sw + 0.012, 0.004, sd + 0.012), mat, bevel=0.0015,
          cuts=[((x, y_top + 0.002, z), (sw - 0.008, 0.05, sd - 0.008))])
    if food:
        a.box((x, y_top - 0.02 + mound / 2, z), (sw - 0.012, 0.04 + mound, sd - 0.012), "", "FOOD",
              vcol=food, bevel=min(0.02, mound + 0.006), seg=2)


# --------------------------------------------------------------------------
# cooking
# --------------------------------------------------------------------------


def fryer(a: Asset):
    w, h, d = a.w, a.h, a.d
    top = h * 0.82  # LIVE: oil surface / basket anchors
    leg = 0.15
    # 6" adjustable legs
    for x in (-w / 2 + 0.07, w / 2 - 0.07):
        for z in (-d / 2 + 0.08, d / 2 - 0.1):
            a.cyl((x, 0.03 + (leg - 0.03) / 2, z), 0.022, leg - 0.03, "steel", seg=12)
            a.cyl((x, 0.015, z), 0.032, 0.03, "steelDark", seg=12, r_top=0.024)
    # cabinet shell (doors sit proud of its front)
    cab_top = top - 0.04
    a.box((0, (leg + cab_top) / 2, -0.012), (w, cab_top - leg, d - 0.024), "steel", bevel=0.01, seg=2)
    # two doors + handles
    door_y0, door_y1 = leg + 0.03, top - 0.2
    for sx in (-1, 1):
        x = sx * w / 4
        a.box((x, (door_y0 + door_y1) / 2, d / 2 - 0.012), (w / 2 - 0.014, door_y1 - door_y0, 0.022), "brushed", bevel=0.008, seg=2)
        a.cyl((x, door_y1 - 0.06, d / 2 + 0.03), 0.011, 0.26, "chrome", axis="x", seg=10)
        for hx in (-0.11, 0.11):
            a.cyl((x + hx, door_y1 - 0.06, d / 2 + 0.012), 0.008, 0.04, "chrome", axis="z", seg=8)
    a.box((0, (door_y0 + door_y1) / 2, d / 2 - 0.022), (0.012, door_y1 - door_y0, 0.006), "gasket", bevel=0)
    # control panel band with two controllers
    band_y = top - 0.11
    a.box((0, band_y, d / 2 - 0.012), (w - 0.006, 0.15, 0.024), "steel", bevel=0.006, seg=2)
    for sx in (-1, 1):
        controller(a, sx * 0.24 * w, band_y, d / 2, w=0.24, h=0.1)
    # top deck with two frypot openings
    xs = (-0.24 * w, 0.24 * w)
    well = (w * 0.42, d * 0.62)  # LIVE: wells at x = +-0.24w, z = 0.03
    a.box((0, top - 0.02, 0), (w, 0.04, d), "steel", bevel=0.006, seg=2,
          cuts=[((x, top - 0.02, 0.03), (well[0], 0.1, well[1])) for x in xs])
    for x in xs:
        # frypot rim, slightly proud of the deck, and the oil
        a.tub((x, top - 0.03, 0.03), (well[0], 0.072, well[1]), 0.01, "steelDark", bevel=0.002)
        a.box((x, top - 0.0085, 0.03), (well[0] - 0.02, 0.006, well[1] - 0.02), "oil", bevel=0)
    # backsplash + flue riser + basket hanger
    a.box((0, top + (h - top) / 2, -d / 2 + 0.04), (w, h - top, 0.08), "steel", bevel=0.008, seg=2)
    a.box((0, top + 0.04, -d / 2 + 0.12), (w * 0.9, 0.08, 0.08), "steelDark", bevel=0.006, seg=2)
    if a.detail:
        for i in range(8):
            a.box((-w * 0.38 + i * w * 0.108, top + 0.0805, -d / 2 + 0.12), (0.06, 0.002, 0.05), "black", bevel=0)
    a.cyl((0, h - 0.04, -d / 2 + 0.11), 0.009, w * 0.9, "chrome", axis="x", seg=10)
    for x in (-w * 0.44, w * 0.44):
        a.box((x, h - 0.04, -d / 2 + 0.095), (0.02, 0.03, 0.05), "steel", bevel=0.002)


def conveyor_oven(a: Asset):
    w, h, d = a.w, a.h, a.d
    body_w = w * 0.62
    stand_h = h * 0.32  # LIVE
    deck_h = (h - stand_h) / 2 - 0.02  # LIVE
    zc, dz = -0.03, d * 0.9
    front = zc + dz / 2
    # stand on casters
    for x in (-body_w / 2 + 0.06, body_w / 2 - 0.06):
        for z in (zc - dz / 2 + 0.07, front - 0.07):
            a.caster(x, z, 0.11)
            a.box((x, 0.11 + (stand_h - 0.11) / 2, z), (0.05, stand_h - 0.11, 0.05), "blackEnamel", bevel=0.005)
    a.box((0, stand_h * 0.35, zc), (body_w - 0.04, 0.03, dz - 0.08), "steelDark", bevel=0.005)
    a.box((0, stand_h - 0.035, zc), (body_w, 0.07, dz), "blackEnamel", bevel=0.006)
    for k in (0, 1):
        y0 = stand_h + k * (deck_h + 0.02)
        ty0, ty1 = y0 + deck_h * 0.27, y0 + deck_h * 0.57  # tunnel (LIVE: belt at 0.3, glow at 0.42)
        tz0, tz1 = 0.06 - d * 0.31, 0.06 + d * 0.31
        tyc, tzc = (ty0 + ty1) / 2, (tz0 + tz1) / 2
        win_y = y0 + deck_h * 0.42
        a.box((0, y0 + deck_h / 2, zc), (body_w, deck_h, dz), "steel", bevel=0.012, seg=2,
              cuts=[((0, tyc, tzc), (body_w + 0.3, ty1 - ty0, tz1 - tz0)),
                    ((-body_w * 0.06, win_y, front - 0.04), (body_w * 0.5, deck_h * 0.13, 0.14))])
        # dark tunnel liner (ceiling, back, floor) so the bake chamber reads as an opening
        a.box((0, ty1 - 0.003, tzc), (body_w - 0.004, 0.006, tz1 - tz0), "castIron", bevel=0)
        a.box((0, tyc, tz0 + 0.003), (body_w - 0.004, ty1 - ty0, 0.006), "castIron", bevel=0)
        a.box((0, ty0 + 0.003, tzc), (body_w - 0.004, 0.006, tz1 - tz0), "castIron", bevel=0)
        # viewing window (LIVE: the oven glow box sits behind it)
        a.box((-body_w * 0.06, win_y, front - 0.012), (body_w * 0.5, deck_h * 0.13, 0.006), "glass", "GLASS", bevel=0)
        a.box((-body_w * 0.06, win_y, front + 0.003), (body_w * 0.53, deck_h * 0.17, 0.006), "blackEnamel", bevel=0.002,
              cuts=[((-body_w * 0.06, win_y, front + 0.003), (body_w * 0.5, deck_h * 0.13, 0.05))])
        # end mouth frames
        for sx in (-1, 1):
            a.box((sx * (body_w / 2 + 0.006), tyc, tzc), (0.012, ty1 - ty0 + 0.05, tz1 - tz0 + 0.05), "blackEnamel", bevel=0.003,
                  cuts=[((sx * (body_w / 2 + 0.006), tyc, tzc), (0.06, ty1 - ty0, tz1 - tz0))])
        # conveyor belt (full width) + rods on the exposed run + rollers + rails
        by = y0 + deck_h * 0.3  # LIVE: pizzas ride at by + 0.025
        a.box((0, by, 0.06), (w - 0.03, 0.022, d * 0.6), "castIron", bevel=0)
        if a.detail:
            x = body_w / 2 + 0.03
            while x < w / 2 - 0.04:
                for sx in (-1, 1):
                    a.cyl((sx * x, by + 0.012, 0.06), 0.0035, d * 0.6, "chrome", axis="z", seg=6, caps=False)
                x += 0.035
        for sx in (-1, 1):
            a.cyl((sx * (w / 2 - 0.022), by, 0.06), 0.02, d * 0.62, "steelDark", axis="z", seg=12)
            ext = (w - body_w) / 2
            for sz in (-1, 1):
                a.box((sx * (body_w / 2 + ext / 2), by - 0.004, 0.06 + sz * (d * 0.3 + 0.008)), (ext, 0.045, 0.012), "steel", bevel=0.002)
            a.tub((sx * (w / 2 - 0.14), y0 + deck_h * 0.16, 0.06), (0.24, 0.035, d * 0.6), 0.004, "steel", bevel=0.002)
        # control panel (right) and louvres (left)
        cx = body_w * 0.36
        a.box((cx, y0 + deck_h * 0.52, front + 0.006), (body_w * 0.2, deck_h * 0.66, 0.012), "blackEnamel", bevel=0.004)
        a.box((cx, y0 + deck_h * 0.7, front + 0.0125), (body_w * 0.13, deck_h * 0.1, 0.003), "digits", bevel=0)
        a.box((cx - body_w * 0.065, y0 + deck_h * 0.32, front + 0.0135), (0.016, 0.016, 0.004), "status", "STATUS", bevel=0)
        if a.detail:
            a.cyl((cx + 0.02, y0 + deck_h * 0.45, front + 0.02), 0.028, 0.025, "steelDark", axis="z", seg=16)
            for i in range(3):
                a.box((cx - 0.05 + i * 0.05, y0 + deck_h * 0.32, front + 0.0135), (0.03, 0.016, 0.004), "steelDark", bevel=0.001)
            for i in range(7):
                a.box((-body_w * 0.36, y0 + deck_h * (0.68 + i * 0.035), front + 0.002), (body_w * 0.18, 0.007, 0.004), "steelDark", bevel=0)
    top_y = stand_h + 2 * deck_h + 0.02
    a.box((0, top_y + 0.012, zc - 0.05), (body_w * 0.82, 0.024, dz * 0.6), "steelDark", bevel=0.005)


def rice_warmer(a: Asset):
    w, h, d = a.w, a.h, a.d
    top = h * 0.82  # LIVE: wells at x = -0.33w, 0, +0.33w; steam from 0.85h
    leg = 0.1
    a.round_legs(w, d, leg + 0.02, "steel", inset=0.04, radius=0.02, gusset=False)
    a.box((0, leg + (top - 0.03 - leg) / 2, 0), (w, top - 0.03 - leg, d), "steel", bevel=0.01, seg=2)
    xs = [(-0.33 + i * 0.33) * w for i in range(3)]
    ww, wd = w * 0.3, d * 0.8
    a.box((0, top - 0.015, 0), (w, 0.03, d), "steel", bevel=0.006, seg=2,
          cuts=[((x, top - 0.015, 0), (ww, 0.1, wd)) for x in xs])
    foods = ["#d8642a", "#e2c27a", "#e3a33b"]  # jollof, fried rice, plain/waakye tone
    for x, col in zip(xs, foods):
        a.tub((x, top - 0.08, 0), (ww - 0.004, 0.16, wd - 0.004), 0.006, "steelDark", bevel=0.002)
        gn_pan(a, x, top + 0.002, 0, ww - 0.02, wd - 0.02, 0.1, food=col, mound=0.028)
        # control knob + pilot under each well
        a.cyl((x, top - 0.13, d / 2 + 0.012), 0.024, 0.025, "blackEnamel", axis="z", seg=14, bevel=0.004)
        if a.detail:
            a.box((x, top - 0.115, d / 2 + 0.026), (0.006, 0.02, 0.004), "white", bevel=0)
    a.box((w / 2 - 0.08, top - 0.13, d / 2 + 0.002), (0.016, 0.016, 0.006), "status", "STATUS", bevel=0)
    # serving spoon resting in the middle pan
    if a.detail:
        a.pipe([(0.05, top + 0.035, 0.08), (0.12, top + 0.09, 0.22), (0.16, top + 0.12, 0.3)], 0.007, "chrome", sides=6)
        a.sphere((0.04, top + 0.03, 0.05), 0.04, "chrome", scale=(1, 0.3, 1.3))
    # rear glass upstand (customer side) on two posts + top rail
    zg = -d / 2 + 0.03
    for sx in (-1, 1):
        a.cyl((sx * (w / 2 - 0.025), top + (h - top) / 2, zg), 0.012, h - top, "chrome", seg=10)
    a.box((0, top + (h - top) / 2 + 0.005, zg), (w - 0.07, h - top - 0.03, 0.008), "glass", "GLASS", bevel=0)
    a.cyl((0, h - 0.008, zg), 0.012, w - 0.03, "chrome", axis="x", seg=10)
    # front tray slide
    a.box((0, top - 0.03, d / 2 + 0.08), (w, 0.02, 0.16), "steel", bevel=0.004, seg=2)
    for sx in (-1, 1):
        a.box((sx * (w / 2 - 0.1), top - 0.07, d / 2 + 0.04), (0.02, 0.06, 0.08), "steelDark", bevel=0.002)


def hot_holding(a: Asset):
    w, h, d = a.w, a.h, a.d
    leg, top_h, wall = 0.12, 0.2, 0.05
    a.round_legs(w, d, leg + 0.02, "steel", inset=0.05, radius=0.022, gusset=False)
    a.box((0, leg + 0.025, 0), (w, 0.05, d), "steel", bevel=0.006, seg=2)
    body_y0, body_y1 = leg + 0.05, h - top_h
    mid = (body_y0 + body_y1) / 2
    for sx in (-1, 1):
        a.box((sx * (w / 2 - wall / 2), mid, 0), (wall, body_y1 - body_y0, d), "steel", bevel=0.006)
    a.box((0, mid, -d / 2 + 0.02), (w - 2 * wall, body_y1 - body_y0, 0.04), "steel", bevel=0)
    a.box((0, mid, -d / 2 + 0.0425), (w - 2 * wall, body_y1 - body_y0, 0.004), "warmGlow", "LIGHT", bevel=0)
    # top heater housing + controls
    a.box((0, h - top_h / 2, 0), (w, top_h, d), "steel", bevel=0.012, seg=2)
    controller(a, -w * 0.25, h - top_h / 2, d / 2, w=0.28, h=0.1)
    if a.detail:
        for i in range(10):
            a.box((w * 0.12 + i * 0.03, h - top_h / 2, d / 2 + 0.002), (0.012, top_h * 0.5, 0.004), "steelDark", bevel=0)
    for z in (-0.12 * d, 0.12 * d):
        a.box((0, body_y1 - 0.006, z), (w - 2 * wall - 0.08, 0.008, 0.05), "heatLamp", "LIGHT", bevel=0)
    # trays (LIVE: chicken rests at h * [0.33, 0.53, 0.73])
    for t in (0.33, 0.53, 0.73):
        ty = h * t
        a.tub((0, ty + 0.002, -0.02), (w - 2 * wall - 0.02, 0.02, d - 0.12), 0.003, "steelDark", bevel=0.001)
        if a.detail:
            for sx in (-1, 1):
                a.box((sx * (w / 2 - wall - 0.008), ty - 0.012, -0.02), (0.016, 0.008, d - 0.1), "steel", bevel=0)
    # glass door in a stainless frame
    fz = d / 2 - 0.012
    gy0, gy1 = body_y0 + 0.01, body_y1 - 0.01
    fw = 0.04
    a.box((0, gy0 + fw / 2, fz), (w - 0.01, fw, 0.024), "steel", bevel=0.004)
    a.box((0, gy1 - fw / 2, fz), (w - 0.01, fw, 0.024), "steel", bevel=0.004)
    for sx in (-1, 1):
        a.box((sx * (w / 2 - 0.005 - fw / 2), (gy0 + gy1) / 2, fz), (fw, gy1 - gy0, 0.024), "steel", bevel=0.004)
    a.box((0, (gy0 + gy1) / 2, fz), (w - 0.01 - 2 * fw, gy1 - gy0 - 2 * fw, 0.008), "glass", "GLASS", bevel=0)
    a.cyl((w / 2 - 0.09, (gy0 + gy1) / 2, d / 2 + 0.03), 0.012, 0.36, "chrome", seg=10)
    for dy in (-0.15, 0.15):
        a.cyl((w / 2 - 0.09, (gy0 + gy1) / 2 + dy, d / 2 + 0.012), 0.008, 0.04, "chrome", axis="z", seg=8)


# --------------------------------------------------------------------------
# preparation
# --------------------------------------------------------------------------


def pizza_makeline(a: Asset):
    w, h, d = a.w, a.h, a.d
    top = h * 0.88  # LIVE: pizzas assembled at top + 0.03, z = 0.18d
    ch = 0.13
    for x in (-w / 2 + 0.08, 0.0, w / 2 - 0.08):
        for z in (-d / 2 + 0.08, d / 2 - 0.1):
            a.caster(x, z, ch)
    a.box((0, ch + (top - 0.04 - ch) / 2, -0.014), (w, top - 0.04 - ch, d - 0.028), "steel", bevel=0.01, seg=2)
    a.box((0, top - 0.02, 0), (w, 0.04, d), "steel", bevel=0.008, seg=2)
    # three refrigerated doors
    dy0, dy1 = ch + 0.04, top - 0.1
    for x in (-0.33 * w, 0.0, 0.33 * w):
        a.box((x, (dy0 + dy1) / 2, d / 2 - 0.0125), (w * 0.318, dy1 - dy0, 0.025), "brushed", bevel=0.008, seg=2)
        a.box((x, (dy0 + dy1) / 2, d / 2 - 0.0265), (w * 0.318 + 0.01, dy1 - dy0 + 0.01, 0.004), "gasket", bevel=0)
        a.box((x, dy1 - 0.035, d / 2 + 0.006), (w * 0.22, 0.022, 0.014), "blackEnamel", bevel=0.004)
    # compressor grille under the doors
    a.box((0, ch + 0.02, d / 2 - 0.018), (w - 0.04, 0.035, 0.008), "blackEnamel", bevel=0.002)
    if a.detail:
        for i in range(24):
            a.box((-w * 0.46 + i * w * 0.04, ch + 0.02, d / 2 - 0.013), (0.01, 0.025, 0.003), "steelDark", bevel=0)
    # temperature display on the apron (STATUS)
    a.box((-w * 0.43, top - 0.065, d / 2 + 0.003), (0.1, 0.04, 0.008), "blackGloss", bevel=0.003)
    a.box((-w * 0.43, top - 0.065, d / 2 + 0.008), (0.05, 0.018, 0.003), "status", "STATUS", bevel=0)
    # poly cutting board (LIVE: top surface = top + 0.025)
    a.box((0, top + 0.0125, d * 0.18), (w * 0.96, 0.025, d * 0.42), "cuttingBoard", bevel=0.004, seg=2)
    # refrigerated pan rail with 8 x 1/6 GN pans (LIVE: pan surface ~ top + 0.095)
    rz, rd = -d * 0.27, d * 0.4
    a.box((0, top + 0.05, rz), (w, 0.1, rd), "steel", bevel=0.008, seg=2,
          cuts=[((0, top + 0.08, rz), (w * 0.93, 0.06, d * 0.31))])
    foods = ["#b5311d", "#f6d47a", "#3c9a3a", "#e7d7e8", "#f1c232", "#b8691f", "#5b2a1a", "#d9a3a3"]
    n = len(foods)
    cell = w * 0.92 / n
    for i, col in enumerate(foods):
        x = (-0.5 + (i + 0.5) / n) * w * 0.92
        gn_pan(a, x, top + 0.1, rz, cell - 0.012, d * 0.29, 0.08, food=col, mound=-0.005)
    # insulated lid, hinged at the back and standing open
    hinge_y, hinge_z, ang = top + 0.1, -d / 2 + 0.015, -0.26
    lid_l = rd
    a.box(at((0, hinge_y, hinge_z), (ang, 0, 0), (0, lid_l / 2, -0.012)), (w, lid_l, 0.025), "steel", bevel=0.008, seg=2, r=(ang, 0, 0))
    if a.detail:
        for x in (-w * 0.4, 0, w * 0.4):
            a.cyl((x, hinge_y, hinge_z - 0.005), 0.01, 0.1, "steelDark", axis="x", seg=8)


def prep_table(a: Asset):
    w, h, d = a.w, a.h, a.d
    table_base(a, backsplash=0.1)
    # dressing: poly cutting board, ingredient bin, GN pan with lid
    a.box((-w * 0.22, h + 0.01, 0.04), (0.5, 0.02, 0.35), "", "PROPS", vcol="#f1f1ee", bevel=0.004)
    a.box((w * 0.25, h + 0.05, -0.12), (0.32, 0.1, 0.22), "", "PROPS", vcol="#3c7dd9", bevel=0.012, seg=2)
    a.tub((w * 0.38, h + 0.06, 0.15), (0.17, 0.12, 0.17), 0.003, "steel", bevel=0.002)


def packaging_table(a: Asset):
    w, h, d = a.w, a.h, a.d
    table_base(a)
    # overshelf for flat-packed / assembled boxes (keeps LIVE work zone at z = 0.05 clear)
    shelf_y, sz, sd = h + 0.42, -d / 2 + 0.2, 0.38
    for sx in (-1, 1):
        a.cyl((sx * (w / 2 - 0.04), h + 0.21, -d / 2 + 0.04), 0.016, 0.42, "steel", seg=10)
    a.box((0, shelf_y, sz), (w, 0.025, sd), "steel", bevel=0.006, seg=2)
    rng = a.rng
    # pizza box stacks on the overshelf
    for i, x in enumerate((-w * 0.32, -w * 0.08, w * 0.16)):
        n = 5 + rng.randint(0, 4)
        for k in range(n if a.detail else 1):
            hh = 0.045 if a.detail else 0.045 * n
            a.box((x, shelf_y + 0.0125 + hh / 2 + k * 0.045, sz), (0.36, hh - 0.002, 0.36), "", "PROPS",
                  vcol="#f7f3ea" if k % 2 == 0 else "#efe8da", bevel=0.004)
        a.box((x, shelf_y + 0.0125 + n * 0.045 + 0.001, sz), (0.3, 0.002, 0.08), "", "PROPS", vcol="#EE1D25", bevel=0)
    # nested chicken buckets (red with white band)
    bx, bz = w * 0.4, -d * 0.28
    for k in range(4):
        a.cyl((bx, h + 0.08 + k * 0.03, bz), 0.085, 0.16, "", "PROPS", r_top=0.11, seg=16, vcol="#d8141c")
    a.cyl((bx, h + 0.2, bz), 0.104, 0.05, "", "PROPS", r_top=0.108, seg=16, vcol="#ffffff", caps=False)
    # kraft bags + label printer (with status LED)
    a.box((-w * 0.4, h + 0.03, -d * 0.25), (0.26, 0.06, 0.16), "", "PROPS", vcol="#b98a55", bevel=0.004)
    px, pz = w * 0.42, d * 0.18
    a.box((px, h + 0.05, pz), (0.13, 0.1, 0.17), "charcoal", bevel=0.018, seg=2)
    a.box((px, h + 0.075, pz + 0.086), (0.08, 0.004, 0.004), "black", bevel=0)
    a.box((px + 0.045, h + 0.097, pz + 0.05), (0.012, 0.004, 0.012), "status", "STATUS", bevel=0)
    # under-shelf flat cartons
    for k in range(4 if a.detail else 1):
        a.box((0, 0.24 + k * 0.012, 0), (w * 0.7, 0.01 if a.detail else 0.05, d * 0.6), "", "PROPS", vcol="#c49a64", bevel=0)


def qc_pass(a: Asset):
    w, h, d = a.w, a.h, a.d
    shelf = 1.0  # LIVE: items at y = 1.03
    a.round_legs(w, d, shelf - 0.02, "steel", inset=0.035, radius=0.02)
    a.box((0, 0.25, 0), (w - 0.07, 0.03, d - 0.07), "brushed", bevel=0.008, seg=2)
    a.box((0, shelf, 0), (w, 0.04, d), "steel", bevel=0.01, seg=2)
    a.box((0, shelf + 0.0205, 0.0), (w - 0.14, 0.002, d - 0.12), "blackGloss", bevel=0)  # heated ceramic plate
    # heat-lamp gantry
    for sx in (-1, 1):
        a.cyl((sx * (w / 2 - 0.04), shelf + (h - shelf) / 2, -d * 0.4), 0.02, h - shelf, "steel", seg=12)
    a.box((0, h - 0.035, -d * 0.1), (w, 0.07, d * 0.7), "steel", bevel=0.012, seg=2)
    for x in (-0.3, 0, 0.3):
        a.box((x * w, h - 0.072, -d * 0.1), (w * 0.25, 0.008, d * 0.36), "heatLamp", "LIGHT", bevel=0)
        if a.detail:
            a.box((x * w, h - 0.072, -d * 0.1), (w * 0.27, 0.006, d * 0.4), "steelDark", bevel=0)
    # ticket rail with order tickets
    a.box((0, h - 0.1, d * 0.27), (w * 0.9, 0.025, 0.015), "aluminium", bevel=0.003)
    for sx in (-1, 1):
        a.box((sx * w * 0.44, h - 0.08, d * 0.22), (0.015, 0.03, 0.09), "aluminium", bevel=0.002)
    for x in (-0.3, -0.1, 0.15):
        a.box((x * w, h - 0.17, d * 0.276), (0.075, 0.13, 0.002), "", "PROPS", vcol="#fbfbf5", bevel=0)
    # controller on the right post
    cx, cz = w / 2 - 0.04, -d * 0.4 + 0.035
    a.box((cx, shelf + 0.15, cz), (0.08, 0.12, 0.03), "blackEnamel", bevel=0.004)
    a.box((cx, shelf + 0.17, cz + 0.016), (0.05, 0.02, 0.003), "digits", bevel=0)
    a.box((cx, shelf + 0.12, cz + 0.016), (0.012, 0.012, 0.004), "status", "STATUS", bevel=0)
    a.box((w * 0.35, shelf + 0.03, d * 0.2), (0.05, 0.02, 0.12), "", "PROPS", vcol="#e8e8e8", bevel=0.004)


# --------------------------------------------------------------------------
# refrigeration
# --------------------------------------------------------------------------


def upright(a: Asset, freezer=False):
    w, h, d = a.w, a.h, a.d
    leg = 0.12
    a.round_legs(w - 0.04, d - 0.12, leg + 0.01, "steel", inset=0.04, radius=0.02, gusset=False)
    a.box((0, leg + (h - leg) / 2, -0.03), (w, h - leg, d - 0.06), "steel", bevel=0.012, seg=2)
    dy0, dy1 = leg + 0.02, h - 0.25
    dmid = (dy0 + dy1) / 2
    a.box((0, dmid, d / 2 - 0.03), (w - 0.016, dy1 - dy0, 0.05), "brushed", bevel=0.012, seg=2)
    a.box((0, dmid, d / 2 - 0.057), (w - 0.006, dy1 - dy0 + 0.01, 0.006), "gasket", bevel=0)
    hx = w / 2 - 0.07
    a.cyl((hx, dmid + 0.1, d / 2 + 0.035), 0.013, 0.5, "chrome", seg=12)
    for dy in (-0.13, 0.33):
        a.cyl((hx, dmid + dy, d / 2 + 0.012), 0.009, 0.045, "chrome", axis="z", seg=8)
    for y in (dy0 + 0.08, dy1 - 0.08):
        a.box((-w / 2 + 0.014, y, d / 2 - 0.03), (0.03, 0.09, 0.056), "steelDark", bevel=0.003)
    # header: louvred grille + digital thermometer (STATUS)
    hy = h - 0.125
    a.box((0, hy, d / 2 - 0.015), (w - 0.03, 0.2, 0.03), "blackEnamel", bevel=0.004)
    if a.detail:
        for i in range(6):
            a.box((w * 0.12, hy - 0.07 + i * 0.028, d / 2 + 0.002), (w * 0.55, 0.009, 0.006), "steelDark", bevel=0)
    a.box((-w * 0.3, hy, d / 2 + 0.002), (0.13, 0.06, 0.006), "blackGloss", bevel=0.003)
    a.box((-w * 0.3, hy, d / 2 + 0.006), (0.08, 0.026, 0.003), "statusCold" if freezer else "status", "STATUS", bevel=0)
    if freezer and a.detail:
        a.box((0, h - 0.004, -0.03), (w - 0.1, 0.004, d - 0.16), "frost", bevel=0)


def drinks_fridge(a: Asset):
    w, h, d = a.w, a.h, a.d
    base, head, wall = 0.12, 0.24, 0.04
    for sx in (-1, 1):
        a.box((sx * (w / 2 - wall / 2), h / 2, 0), (wall, h, d), "blackGloss", bevel=0.006, seg=2)
    a.box((0, h / 2, -d / 2 + 0.02), (w - 2 * wall, h, 0.04), "blackGloss", bevel=0)
    a.box((0, base / 2, 0), (w - 2 * wall, base, d), "blackEnamel", bevel=0.004)
    if a.detail:
        for i in range(10):
            a.box((-w * 0.32 + i * w * 0.07, base / 2, d / 2 + 0.002), (0.012, base * 0.5, 0.004), "steelDark", bevel=0)
    a.box((w * 0.36, base / 2, d / 2 + 0.003), (0.014, 0.014, 0.006), "status", "STATUS", bevel=0)
    # illuminated header (LIGHT) with a LABEL quad for brand text
    a.box((0, h - head / 2, 0), (w, head, d), "blackGloss", bevel=0.01, seg=2)
    a.box((0, h - head / 2, d / 2 + 0.006), (w - 0.03, head - 0.04, 0.012), "lightBoxRed", "LIGHT", bevel=0.004)
    a.label((0, h - head / 2, d / 2 + 0.0125), (w - 0.14, head * 0.42), "white")
    # interior light panel + wire shelves
    iy0, iy1 = base, h - head
    a.box((0, (iy0 + iy1) / 2, -d / 2 + 0.0425), (w - 2 * wall, iy1 - iy0, 0.004), "interiorLight", "LIGHT", bevel=0)
    ys = [base + 0.05 + i * 0.4 for i in range(4)]
    cols = ["#c0392b", "#f39c12", "#27ae60", "#2c3e50", "#8e44ad", "#e74c3c"]
    inner = w - 2 * wall - 0.01
    for s, y in enumerate(ys):
        a.wire_shelf(y, inner, d - 0.14, z=-0.01, mat="steelDark", pitch=0.04)
        if s % 2 == 0:
            n = 5
            for i in range(n):
                x = (-0.5 + (i + 0.5) / n) * (inner - 0.04)
                for z in ((0.06, -0.09) if a.detail else (0.06,)):
                    a.lathe((x, y + 0.015, z), [(0.0, 0.0), (0.03, 0.0), (0.032, 0.012), (0.032, 0.14), (0.02, 0.185), (0.012, 0.205), (0.013, 0.222), (0.0, 0.222)],
                            "", "STOCK", seg=8, vcol=cols[(i + s) % len(cols)])
        else:
            n = 7
            for i in range(n):
                x = (-0.5 + (i + 0.5) / n) * (inner - 0.04)
                for k in range(2 if a.detail else 1):
                    a.cyl((x, y + 0.015 + 0.061 + k * 0.122, 0.07), 0.033, 0.12, "", "STOCK", seg=10,
                          vcol=cols[(i * 2 + s) % len(cols)])
    # glass door
    fz = d / 2 - 0.015
    gy0, gy1 = base + 0.01, h - head - 0.01
    fw = 0.045
    a.box((0, gy0 + fw / 2, fz), (w - 0.01, fw, 0.03), "blackGloss", bevel=0.004)
    a.box((0, gy1 - fw / 2, fz), (w - 0.01, fw, 0.03), "blackGloss", bevel=0.004)
    for sx in (-1, 1):
        a.box((sx * (w / 2 - 0.005 - fw / 2), (gy0 + gy1) / 2, fz), (fw, gy1 - gy0, 0.03), "blackGloss", bevel=0.004)
    a.box((0, (gy0 + gy1) / 2, fz), (w - 0.01 - 2 * fw, gy1 - gy0 - 2 * fw, 0.008), "glass", "GLASS", bevel=0)
    hx = w / 2 - 0.06
    a.cyl((hx, (gy0 + gy1) / 2, d / 2 + 0.03), 0.012, 0.6, "chrome", seg=10)
    for dy in (-0.25, 0.25):
        a.cyl((hx, (gy0 + gy1) / 2 + dy, d / 2 + 0.01), 0.008, 0.04, "chrome", axis="z", seg=8)


# --------------------------------------------------------------------------
# service / front of house
# --------------------------------------------------------------------------


def counter_shell(a: Asset, front_mat: str, *, niche=True):
    """Shared counter carcass: plinth, white body, coloured front, wood top, staff-side niche."""
    w, h, d = a.w, a.h, a.d
    kick, top_t = 0.08, 0.05
    y_top = h - top_t
    cuts = [((0, kick + 0.33, -d / 2 + 0.18), (min(1.0, w * 0.4), 0.46, 0.4))] if niche else None
    a.box((0, kick + (y_top - kick) / 2, -0.015), (w, y_top - kick, d - 0.03), "white", bevel=0.006, cuts=cuts)
    if niche:
        a.box((0, kick + 0.33, -d / 2 + 0.2), (min(1.0, w * 0.4) - 0.01, 0.02, 0.36), "woodLight", bevel=0.002)
    a.box((0, kick / 2, -0.03), (w - 0.04, kick, d - 0.1), "blackEnamel", bevel=0.003)
    y1 = y_top * 0.82
    a.box((0, kick + (y1 - kick) / 2, d / 2 - 0.0125), (w, y1 - kick, 0.025), front_mat, bevel=0.006, seg=2)
    if a.detail:
        n = max(2, int(w / 0.5))
        for i in range(1, n):
            a.box((-w / 2 + i * w / n, kick + (y1 - kick) / 2, d / 2 + 0.0005), (0.008, y1 - kick - 0.04, 0.003), "charcoal" if front_mat != "charcoal" else "black", bevel=0)
    a.box((0, (y1 + y_top) / 2, d / 2 - 0.0125), (w, y_top - y1, 0.025), "whiteGloss", bevel=0.004)
    a.box((0, h - top_t / 2, 0.012), (w + 0.02, top_t, d + 0.024), "woodLight", bevel=0.01, seg=2)
    return y1, y_top


def pos_counter(a: Asset):
    w, h, d = a.w, a.h, a.d
    counter_shell(a, "redCladding")
    terminals = max(1, round(w / 1.4))
    for i in range(terminals):
        x = (-0.5 + (i + 0.5) / terminals) * w
        zt = -0.05
        # staff screen on a tilting stand (faces -z, tilted up toward staff)
        a.box((x, h + 0.008, zt), (0.2, 0.016, 0.16), "blackEnamel", bevel=0.005, seg=2)
        a.box((x, h + 0.08, zt + 0.01), (0.05, 0.15, 0.03), "blackEnamel", bevel=0.006, r=(-0.12, 0, 0))
        hp, hr = (x, h + 0.21, zt), (0.35, 0, 0)
        a.box(hp, (0.38, 0.25, 0.03), "blackEnamel", bevel=0.008, seg=2, r=hr)
        a.box(at(hp, hr, (0, 0, -0.0155)), (0.35, 0.22, 0.002), "screen", "SCREEN", bevel=0, r=hr)
        # customer-facing display on the back of the terminal
        cp, cr = (x, h + 0.17, zt + 0.06), (-0.3, 0, 0)
        a.box(cp, (0.18, 0.12, 0.02), "blackEnamel", bevel=0.005, r=cr)
        a.box(at(cp, cr, (0, 0, 0.0105)), (0.16, 0.1, 0.002), "screenRed", "SCREEN", bevel=0, r=cr)
        # card reader / PIN pad on a cradle at the customer edge
        pp, pr = (x + 0.3, h + 0.05, d / 2 - 0.12), (0.5, 0, 0)
        a.box((x + 0.3, h + 0.012, d / 2 - 0.12), (0.1, 0.024, 0.1), "blackEnamel", bevel=0.005)
        a.box(pp, (0.078, 0.02, 0.16), "charcoal", bevel=0.006, seg=2, r=pr)
        a.box(at(pp, pr, (0, 0.0105, -0.035)), (0.06, 0.002, 0.055), "screen", "SCREEN", bevel=0, r=pr)
        if a.detail:
            for kx in range(3):
                for kz in range(4):
                    a.box(at(pp, pr, (-0.02 + kx * 0.02, 0.011, 0.012 + kz * 0.014)), (0.014, 0.003, 0.009), "steelDark", bevel=0, r=pr)
        a.box(at(pp, pr, (0.028, 0.0105, -0.07)), (0.008, 0.003, 0.008), "status", "STATUS", bevel=0, r=pr)
        # receipt printer on the staff side + paper
        rx, rz = x - 0.3, -d / 2 + 0.14
        a.box((rx, h + 0.065, rz), (0.14, 0.13, 0.19), "charcoal", bevel=0.02, seg=2)
        a.box((rx, h + 0.12, rz - 0.07), (0.075, 0.03, 0.002), "", "PROPS", vcol="#fbfbf5", bevel=0, r=(0.3, 0, 0))
        # cash drawer under the counter (staff side)
        a.box((x, h - 0.12, -d / 2 - 0.004), (0.42, 0.11, 0.01), "blackEnamel", bevel=0.003)
        a.box((x, h - 0.12, -d / 2 - 0.012), (0.12, 0.012, 0.008), "steelDark", bevel=0)


def pickup_counter(a: Asset):
    w, h, d = a.w, a.h, a.d
    y1, _ = counter_shell(a, "charcoal")
    # LIVE: bags rest on the worktop at x = -0.4w .. 0.4w, z = -0.1d
    a.label((0, (h - 0.05) * 0.55, d / 2 + 0.0025), (w * 0.7, 0.16), "labelYellow")
    # order-ready screen on a pole (clear of the bag slots)
    px, pz = w * 0.4, -d / 2 + 0.05
    a.cyl((px, h + 0.3, pz), 0.02, 0.6, "chrome", seg=12)
    a.cyl((px, h + 0.004, pz), 0.06, 0.008, "chrome", seg=16)
    sp = (px, h + 0.62, pz + 0.03)
    a.box(sp, (0.52, 0.31, 0.035), "blackEnamel", bevel=0.008, seg=2)
    a.box((sp[0], sp[1], sp[2] + 0.0185), (0.49, 0.28, 0.002), "screenGreen", "SCREEN", bevel=0)
    a.box((-w / 2 + 0.1, h + 0.004, d / 2 - 0.08), (0.016, 0.008, 0.016), "status", "STATUS", bevel=0)


def dispatch_rack(a: Asset):
    w, h, d = a.w, a.h, a.d
    r = 0.0135
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * (w / 2 - r - 0.004), sz * (d / 2 - r - 0.004)
            a.cyl((x, h / 2, z), r, h, "chrome", seg=10)
            a.cyl((x, 0.008, z), r * 1.4, 0.016, "rubber", seg=10)
    for i in range(4):  # LIVE: shelves at 0.15 + i * (h - 0.2) / 3
        a.wire_shelf(0.15 + i * (h - 0.2) / 3, w - 0.02, d - 0.02, mat="chrome")
    a.box((0, h - 0.045, d / 2 + 0.012), (w, 0.09, 0.02), "red", bevel=0.004, seg=2)
    a.label((0, h - 0.045, d / 2 + 0.0225), (w * 0.8, 0.07), "white")
    if a.detail:  # numbered slot tags along the two used shelves
        for row in range(2):
            y = 0.15 + row * (h - 0.2) / 3
            for k in range(4):
                a.box(((-0.3 + k * 0.2) * w, y - 0.012, d / 2 - 0.004), (0.06, 0.03, 0.004), "", "PROPS", vcol="#FFD400", bevel=0)


def shelving(a: Asset):
    w, h, d = a.w, a.h, a.d
    r = 0.0135
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * (w / 2 - r - 0.004), sz * (d / 2 - r - 0.004)
            a.cyl((x, h / 2, z), r, h, "chrome", seg=10)
            a.cyl((x, 0.008, z), r * 1.4, 0.016, "rubber", seg=10)
    rng = a.rng
    tiers = [0.12 + i * ((h - 0.2) / 3) for i in range(4)]
    for t, y in enumerate(tiers):
        a.wire_shelf(y, w - 0.02, d - 0.02, mat="chrome")
        if t == 3 and rng.random() < 0.5:
            continue
        x = -w / 2 + 0.06
        while x < w / 2 - 0.12:
            kind = rng.choice(["box", "box", "sack", "tin", "jerry", "bucket"]) if t < 3 else rng.choice(["box", "box", "tin"])
            if t == 0:
                kind = rng.choice(["sack", "sack", "jerry", "bucket"])
            bw = {"box": 0.2 + rng.random() * 0.12, "sack": 0.36, "tin": 0.11, "jerry": 0.2, "bucket": 0.26}[kind]
            if x + bw > w / 2 - 0.04:
                break
            cx, by = x + bw / 2, y + 0.016
            if kind == "box":
                bh = 0.12 + rng.random() * 0.16
                a.box((cx, by + bh / 2, 0), (bw - 0.015, bh, d * (0.55 + rng.random() * 0.3)), "", "STOCK",
                      vcol=rng.choice(["#c49a64", "#b8895a", "#d3ad7c", "#f7f3ea"]), bevel=0.004)
            elif kind == "sack":
                a.box((cx, by + 0.08, 0), (bw - 0.02, 0.16, d * 0.72), "", "STOCK", vcol=rng.choice(["#d8c9a3", "#e9e2cf", "#c9b27c"]), bevel=0.05, seg=2)
            elif kind == "tin":
                for k in range(2 if a.detail else 1):
                    a.cyl((cx, by + 0.065, -0.1 + k * 0.17), 0.05, 0.13, "", "STOCK", seg=10, vcol=rng.choice(["#b5311d", "#d9a020", "#cfd4da"]))
            elif kind == "jerry":
                a.box((cx, by + 0.15, 0), (0.16, 0.3, 0.26), "", "STOCK", vcol="#e8b923", bevel=0.02, seg=2)
                a.cyl((cx + 0.04, by + 0.31, 0.08), 0.02, 0.03, "", "STOCK", seg=8, vcol="#c0392b")
            elif kind == "bucket":
                a.cyl((cx, by + 0.11, 0), 0.11, 0.22, "", "STOCK", seg=14, r_top=0.125, vcol=rng.choice(["#3c7dd9", "#f4f4f2"]))
            x += bw + 0.01


def sink(a: Asset):
    w, h, d = a.w, a.h, a.d
    apron = 0.25
    n = 3 if w > 1 else 2
    xs, zs = a.round_legs(w, d, h - apron + 0.01, "steel", inset=0.04, radius=0.02)
    # side + rear bracing
    for x in xs:
        a.cyl((x, 0.18, 0), 0.014, d - 0.12, "steel", axis="z", seg=8)
    a.cyl((0, 0.18, zs[0]), 0.014, w - 0.12, "steel", axis="x", seg=8)
    bx = [(-0.5 + (i + 0.5) / n) * w for i in range(n)]
    bw, bd = w / n - 0.06, d * 0.7
    a.box((0, h - apron / 2, 0), (w, apron, d), "steel", bevel=0.01, seg=2,
          cuts=[((x, h - 0.085, 0.03), (bw, 0.27, bd)) for x in bx])
    for x in bx:
        a.cyl((x, h - 0.218, 0.03), 0.03, 0.006, "steelDark", seg=14)
        a.box((x, h - 0.09, 0.03), (bw - 0.004, 0.004, bd - 0.004), "water", "GLASS", bevel=0)
        if a.detail:  # drain tailpiece + waste manifold
            a.cyl((x, h - apron - 0.07, 0.03), 0.02, 0.14, "steelDark", seg=8)
    if a.detail:
        a.cyl((0, h - apron - 0.14, 0.03), 0.022, w - 0.2, "steelDark", axis="x", seg=8)
    # backsplash
    a.box((0, h + 0.125, -d / 2 + 0.02), (w, 0.25, 0.04), "steel", bevel=0.008, seg=2)
    # two wall-mount mixing faucets with swing spouts
    for fx in (-w / 6, w / 6) if n == 3 else (0.0,):
        yb, zb = h + 0.14, -d / 2 + 0.06
        a.cyl((fx, yb, zb), 0.018, 0.22, "chrome", axis="x", seg=10)
        for sx in (-1, 1):
            a.cyl((fx + sx * 0.11, yb, zb + 0.015), 0.012, 0.04, "chrome", axis="z", seg=8)
            a.box((fx + sx * 0.11, yb + 0.03, zb + 0.03), (0.016, 0.06, 0.012), "chrome", bevel=0.003)
        a.pipe([(fx, yb, zb + 0.01), (fx, yb + 0.05, zb + 0.02), (fx, yb + 0.075, zb + 0.06), (fx, yb + 0.075, zb + 0.26),
                (fx, yb + 0.055, zb + 0.31), (fx, yb + 0.0, zb + 0.33)], 0.011, "chrome", sides=8)


def hood(a: Asset):
    w, h, d = a.w, a.h, a.d  # origin = bottom-centre of the canopy (elevated item)
    rim = 0.035
    ch = 0.16  # sloped top-front panel, like most wall canopies
    a.prism([(-d / 2, 0), (d / 2, 0), (d / 2, h - ch), (d / 2 - ch, h), (-d / 2, h)], w, "steel", axis="x",
            bevel=0.01, seg=2, cuts=[((0, h / 2 - 0.03, 0), (w - 2 * rim, h, d - 2 * rim))])
    if a.detail:  # standing seams on the canopy front
        for x in (-w / 6, w / 6):
            a.box((x, (h - ch) / 2, d / 2 + 0.002), (0.012, h - ch - 0.04, 0.004), "brushed", bevel=0)
    # perimeter grease gutter lip
    a.box((0, 0.015, d / 2 - rim / 2), (w - 0.01, 0.03, rim + 0.01), "steel", bevel=0.006)
    # sloped baffle filter bank at the back
    fc, fr = (0, h * 0.5, -d / 2 + 0.16), (-0.7, 0, 0)
    flen = 0.42
    nf = max(2, round(w / 0.5))
    fw = (w - 2 * rim - 0.02) / nf
    for i in range(nf):
        x = -((w - 2 * rim - 0.02) / 2) + (i + 0.5) * fw
        a.box(at(fc, fr, (x, 0, 0)), (fw - 0.012, flen, 0.03), "aluminium", bevel=0.003, r=fr)
        if a.detail:
            for k in range(6):
                a.box(at(fc, fr, (x - fw * 0.38 + k * fw * 0.152, 0, 0.018)), (0.012, flen - 0.03, 0.012), "steelDark", bevel=0, r=fr)
    bottom = at(fc, fr, (0, -flen / 2, 0))
    a.box((0, bottom[1] - 0.025, bottom[2] + 0.02), (w - 2 * rim, 0.04, 0.07), "steelDark", bevel=0.004,
          cuts=[((0, bottom[1] - 0.005, bottom[2] + 0.02), (w - 2 * rim - 0.02, 0.04, 0.05))])
    # recessed light fittings (LIGHT)
    for sx in (-1, 1):
        a.box((sx * w * 0.25, h - 0.036, d * 0.18), (0.5, 0.016, 0.14), "steelDark", bevel=0.003)
        a.box((sx * w * 0.25, h - 0.045, d * 0.18), (0.46, 0.004, 0.11), "lightPanel", "LIGHT", bevel=0)
    if a.detail:  # fire-suppression line + nozzles
        a.cyl((0, h - 0.07, d * 0.02), 0.012, w - 0.12, "chrome", axis="x", seg=8)
        for x in (-w * 0.3, 0, w * 0.3):
            a.cyl((x, h - 0.1, d * 0.02), 0.01, 0.05, "chrome", seg=8)
    # duct stub to the ceiling (DUCT: the app may hide / stretch it)
    a.box((0, h + 0.3, -d * 0.2), (0.45, 0.6, 0.4), "brushed", "DUCT", bevel=0.006)


# --------------------------------------------------------------------------
# extra equipment (cheap variants)
# --------------------------------------------------------------------------


def dough_table(a: Asset):
    table_base(a, top="woodLight")
    rng = a.rng
    for i in range(10):
        x = (-0.4 + (i % 5) * 0.2) * a.w * 0.9
        z = (-0.15 if i < 5 else 0.12) * a.d
        a.sphere((x + rng.uniform(-0.01, 0.01), a.h + 0.03, z), 0.07, "", "FOOD", seg=12, rings=6, scale=(1, 0.55, 1), vcol="#f1dcae")
    a.box((0, 0.27, 0), (a.w * 0.7, 0.08, a.d * 0.6), "", "PROPS", vcol="#e0e0e0", bevel=0.01, seg=2)


def breading_station(a: Asset):
    w, h, d = a.w, a.h, a.d
    table_base(a)
    for x, col in zip((-0.3 * w, 0.0, 0.3 * w), ("#c96f4a", "#f4f4f2", "#e7d9b0")):
        gn_pan(a, x, h + 0.1, 0, w * 0.26, d * 0.6, 0.1, food=col, mound=-0.01)


def menu_board(a: Asset):
    w, h, d = a.w, a.h, a.d  # origin = bottom-centre of the board (elevated)
    a.box((0, h / 2, 0), (w + 0.06, h + 0.06, d), "blackGloss", bevel=0.008, seg=2)
    a.label((0, h / 2, d / 2 + 0.002), (w, h), "screen", role="SCREEN")
    for x in (-0.4 * w, 0.4 * w):
        a.cyl((x, h + 0.43, 0), 0.008, 0.8, "steelDark", seg=8)


def handwash(a: Asset):
    w, h, d = a.w, a.h, a.d
    a.box((0, h - 0.11, 0), (w, 0.22, d), "steel", bevel=0.01, seg=2, cuts=[((0, h - 0.06, 0.02), (w * 0.75, 0.16, d * 0.6))])
    a.cyl((0, (h - 0.22) / 2, -d / 2 + 0.06), 0.03, h - 0.22, "steel", seg=12)
    a.box((0, h - 0.17, 0.02), (w * 0.75 - 0.004, 0.004, d * 0.6 - 0.004), "steelDark", bevel=0)
    zb = -d / 2 + 0.05
    a.pipe([(0, h, zb), (0, h + 0.2, zb), (0, h + 0.24, zb + 0.04), (0, h + 0.24, zb + 0.08), (0, h + 0.2, zb + 0.12), (0, h + 0.14, zb + 0.13)], 0.011, "chrome")
    a.box((-w * 0.3, h + 0.35, -d / 2 + 0.05), (0.1, 0.18, 0.08), "white", bevel=0.01, seg=2)
    a.box((w * 0.2, h + 0.45, -d / 2 + 0.06), (0.25, 0.3, 0.1), "white", bevel=0.012, seg=2)
    a.label((0, h + 0.85, -d / 2 + 0.012), (0.36, 0.09), "white")


def dishwasher(a: Asset):
    w, h, d = a.w, a.h, a.d
    a.box((0, h * 0.275, 0), (w, h * 0.55, d), "steel", bevel=0.01, seg=2)
    a.box((0, h * 0.775, 0), (w * 0.95, h * 0.45, d * 0.95), "brushed", bevel=0.01, seg=2)
    a.cyl((0, h * 0.78, d / 2 + 0.03), 0.014, w * 0.6, "chrome", axis="x", seg=10)
    a.box((0, h * 0.555, d / 2 - 0.01), (w * 0.97, 0.02, 0.04), "steel", bevel=0.004)
    for sx in (-1, 1):  # rack guide rails
        a.box((sx * w * 0.42, h * 0.6, 0), (0.02, 0.02, d * 0.9), "steelDark", bevel=0.002)
    controller(a, w * 0.2, h * 0.45, d / 2, w=0.2, h=0.08)


def evaporator(a: Asset, freezer=False):
    w, h, d = a.w, a.h, a.d  # elevated: origin = bottom-centre
    a.box((0, h / 2, 0), (w, h, d), "frost" if freezer else "white", bevel=0.015, seg=2)
    for x in (-0.25 * w, 0.25 * w):
        a.cyl((x, h / 2, d / 2 + 0.002), h * 0.36, 0.006, "black", axis="z", seg=24)
        a.torus((x, h / 2, d / 2 + 0.006), h * 0.33, 0.012, "steelDark", seg=24, r=(math.pi / 2, 0, 0))
        if a.detail:
            for k in range(4):
                a.box((x, h / 2, d / 2 + 0.008), (h * 0.66, 0.008, 0.004), "steelDark", bevel=0, r=(0, 0, k * math.pi / 4))
    a.box((w / 2 - 0.08, 0.06, d / 2 + 0.002), (0.05, 0.02, 0.004), "statusCold" if freezer else "status", "STATUS", bevel=0)


# --------------------------------------------------------------------------
# furniture
# --------------------------------------------------------------------------


def shell_chair(a: Asset, x, z):
    """Moulded shell chair on splayed wooden legs, facing the table (z -> 0)."""
    s = -1 if z < 0 else 1  # chair is on side s; it faces -s
    a.box((x, 0.45, z), (0.44, 0.035, 0.42), "lime", bevel=0.016, seg=2)
    bp, br = (x, 0.68, z + s * 0.21), (s * 0.2, 0, 0)
    a.box(bp, (0.44, 0.38, 0.03), "lime", bevel=0.013, seg=2, r=br)
    for lx in (-1, 1):
        for lz in (-1, 1):
            a.pipe([(x + lx * 0.14, 0.43, z + lz * 0.13), (x + lx * 0.2, 0.0, z + lz * 0.19)], 0.014, "woodLight", sides=8)
    if a.detail:
        a.pipe([(x - 0.17, 0.2, z - 0.16), (x + 0.17, 0.2, z + 0.16)], 0.004, "blackEnamel", sides=4)
        a.pipe([(x + 0.17, 0.2, z - 0.16), (x - 0.17, 0.2, z + 0.16)], 0.004, "blackEnamel", sides=4)


def cafe_table(a: Asset, top_w, top_d, seats):
    a.box((0, 0.74, 0), (top_w, 0.04, top_d), "tableRed", bevel=0.006, seg=2)
    a.box((0, 0.716, 0), (top_w + 0.012, 0.014, top_d + 0.012), "white", bevel=0.003)
    a.box((0, 0.7, 0), (min(top_w, top_d) * 0.6, 0.02, 0.05), "blackEnamel", bevel=0.002)
    a.box((0, 0.7, 0), (0.05, 0.02, min(top_w, top_d) * 0.6), "blackEnamel", bevel=0.002)
    a.cyl((0, 0.37, 0), 0.038, 0.68, "blackEnamel", seg=14)
    a.cyl((0, 0.016, 0), 0.3 if top_w > 1 else 0.26, 0.032, "castIron", seg=28, r_top=0.26 if top_w > 1 else 0.22, bevel=0.006)
    for x, z in seats:
        shell_chair(a, x, z)


def table_2(a: Asset):
    cafe_table(a, 0.7, 0.7, [(0, -0.55), (0, 0.55)])


def table_4(a: Asset):
    cafe_table(a, 1.15, 0.75, [(-0.35, -0.62), (0.35, -0.62), (-0.35, 0.62), (0.35, 0.62)])


def booth_4(a: Asset):
    for s in (-1, 1):
        a.box((0, 0.18, s * 0.64), (1.4, 0.34, 0.5), "wood", bevel=0.006, seg=2)
        a.box((0, 0.035, s * 0.6), (1.36, 0.07, 0.44), "blackEnamel", bevel=0.002)
        a.box((0, 0.4, s * 0.6), (1.38, 0.11, 0.52), "teal", bevel=0.035, seg=3)
        a.box((0, 0.75, s * 0.885), (1.4, 0.7, 0.09), "wood", bevel=0.008, seg=2)
        for i in range(3):
            a.box((-0.46 + i * 0.46, 0.77, s * 0.82), (0.44, 0.56, 0.07), "teal", bevel=0.03, seg=3, r=(s * 0.06, 0, 0))
        a.box((0, 1.085, s * 0.875), (1.42, 0.03, 0.15), "woodLight", bevel=0.006, seg=2)
    a.box((0, 0.74, 0), (1.2, 0.04, 0.62), "tableRed", bevel=0.006, seg=2)
    a.box((0, 0.716, 0), (1.212, 0.014, 0.632), "white", bevel=0.003)
    a.cyl((0, 0.37, 0), 0.045, 0.7, "blackEnamel", seg=14)
    a.box((0, 0.015, 0), (0.7, 0.03, 0.08), "castIron", bevel=0.006)
    a.box((0, 0.015, 0), (0.08, 0.03, 0.5), "castIron", bevel=0.006)


def stool_bar(a: Asset):
    w = a.w
    a.box((0, 1.05, 0), (w, 0.05, 0.4), "woodLight", bevel=0.008, seg=2)
    for x in (-0.45 * w, 0.45 * w):
        a.box((x, 0.515, 0), (0.05, 1.03, 0.05), "blackEnamel", bevel=0.004)
        a.box((x, 0.005, 0), (0.16, 0.01, 0.3), "blackEnamel", bevel=0.002)
        a.cyl((x, 0.25, 0.08), 0.01, 0.16, "chrome", axis="z", seg=8)
    a.cyl((0, 0.25, 0.16), 0.019, w * 0.9 + 0.05, "chrome", axis="x", seg=10)
    for x in (-0.85, -0.3, 0.3, 0.85):  # LIVE/sim seat offsets
        z = 0.55
        a.cyl((x, 0.011, z), 0.17, 0.022, "castIron", seg=18, r_top=0.15)
        a.cyl((x, 0.39, z), 0.025, 0.74, "chrome", seg=10)
        a.torus((x, 0.3, z), 0.15, 0.01, "chrome", seg=16, minor=4)
        for k in range(3):
            ang = k * 2 * math.pi / 3
            a.pipe([(x, 0.3, z), (x + math.cos(ang) * 0.15, 0.3, z + math.sin(ang) * 0.15)], 0.007, "chrome", sides=6)
        a.cyl((x, 0.755, z), 0.12, 0.02, "blackEnamel", seg=12)
        a.cyl((x, 0.79, z), 0.18, 0.05, "red", seg=20, bevel=0.018, bseg=2)


def waiting_bench(a: Asset):
    w, h, d = a.w, a.h, a.d
    for i in range(5):
        a.box((0, 0.43, -d / 2 + 0.06 + i * (d - 0.1) / 4.4), (w, 0.03, d * 0.16), "woodLight", bevel=0.005, seg=2)
    for i in range(3):
        y = 0.6 + i * 0.11
        a.box((0, y, -d / 2 + 0.035 - i * 0.01), (w, 0.08, 0.025), "woodLight", bevel=0.005, seg=2, r=(-0.12, 0, 0))
    for x in (-0.42 * w, 0.0, 0.42 * w):
        a.box((x, 0.21, d / 2 - 0.06), (0.04, 0.42, 0.04), "blackEnamel", bevel=0.004)
        a.box((x, 0.45, -d / 2 + 0.05), (0.04, 0.9, 0.04), "blackEnamel", bevel=0.004, r=(-0.1, 0, 0))
        a.box((x, 0.405, 0), (0.04, 0.03, d - 0.06), "blackEnamel", bevel=0.003)


# --------------------------------------------------------------------------
# registry
# --------------------------------------------------------------------------

BUILDERS = {
    # priority 1
    "fryer": fryer,
    "conveyor-oven": conveyor_oven,
    "pizza-makeline": pizza_makeline,
    "fridge": lambda a: upright(a, False),
    "drinks-fridge": drinks_fridge,
    "hot-holding": hot_holding,
    "rice-warmer": rice_warmer,
    "prep-table": prep_table,
    "pos-counter": pos_counter,
    "pickup-counter": pickup_counter,
    "dispatch-rack": dispatch_rack,
    "sink": sink,
    "hood": hood,
    "qc-pass": qc_pass,
    "packaging-table": packaging_table,
    "shelving": shelving,
    # cheap extras
    "freezer": lambda a: upright(a, True),
    "dough-table": dough_table,
    "breading-station": breading_station,
    "menu-board": menu_board,
    "handwash": handwash,
    "dishwasher": dishwasher,
    "walk-in-cold": lambda a: evaporator(a, False),
    "walk-in-freezer": lambda a: evaporator(a, True),
    # furniture
    "table-2": table_2,
    "table-4": table_4,
    "booth-4": booth_4,
    "stool-bar": stool_bar,
    "waiting-bench": waiting_bench,
}

LARGE_BUDGET, SMALL_BUDGET = 6000, 2000
FURNITURE_BUDGET = 3000  # many instances per dining room
LOD_COUNT = 6


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    opts = {"only": None, "render": True, "lod": True}
    i = 0
    while i < len(argv):
        if argv[i] == "--only":
            opts["only"] = [s.strip() for s in argv[i + 1].split(",") if s.strip()]
            i += 1
        elif argv[i] == "--no-render":
            opts["render"] = False
        elif argv[i] == "--no-lod":
            opts["lod"] = False
        i += 1
    return opts


def build_one(t, spec, lod=0):
    lib.reset_scene()
    a = Asset(t, spec["size"], lod=lod)
    BUILDERS[t](a)
    roles = a.finalize()
    return a, roles


def main():
    opts = parse_args()
    catalog = lib.parse_catalog(CATALOG)
    missing = [t for t in BUILDERS if t not in catalog]
    if missing:
        raise SystemExit(f"builders without catalogue entries: {missing}")
    types = opts["only"] or list(BUILDERS)
    # the 6 largest equipment items (by catalogue volume) get a LOD1
    eq = [t for t in BUILDERS if catalog[t]["kind"] == "equipment"]
    lod_types = sorted(eq, key=lambda t: -math.prod(catalog[t]["size"]))[:LOD_COUNT]

    stats_path = os.path.join(OUT, "stats.json")
    stats = {}
    if os.path.exists(stats_path):
        import json
        stats = json.load(open(stats_path))
    for t in types:
        spec = catalog[t]
        t0 = time.time()
        a, roles = build_one(t, spec)
        tris = a.triangles()
        lo, hi = a.bounds()
        kind = spec["kind"]
        raw = os.path.join(OUT, "raw", kind, f"{t}.glb")
        lib.export_glb(raw)
        large = math.prod(spec["size"]) > 0.35
        entry = {
            "kind": kind,
            "label": spec["label"],
            "size": spec["size"],
            "origin": "item-bottom-centre" if spec["elevated"] else "floor-centre",
            "triangles": tris,
            "budget": FURNITURE_BUDGET if kind == "furniture" else (LARGE_BUDGET if large else SMALL_BUDGET),
            "bounds": {"min": lo, "max": hi},
            "roles": sorted(roles),
            "lod1": None,
        }
        print(f"[build] {t:18s} tris={tris:5d} roles={sorted(roles)} ({time.time() - t0:.1f}s)")
        if opts["render"]:
            lib.render_preview(os.path.join(RENDERS, f"{t}.png"), t, elevated=spec["elevated"])
        if opts["lod"] and t in lod_types:
            a1, _ = build_one(t, spec, lod=1)
            tris1 = a1.decimate_to(int(tris * 0.38))
            lib.export_glb(os.path.join(OUT, "raw", kind, f"{t}.lod1.glb"))
            entry["lod1"] = {"triangles": tris1}
            print(f"[build] {t:18s} lod1 tris={tris1} ({tris1 / max(1, tris):.0%})")
        stats[t] = entry
    lib.write_json(stats_path, stats)
    over = [t for t, e in stats.items() if e["triangles"] > e["budget"]]
    if over:
        print("[build] WARNING over triangle budget:", over)


if __name__ == "__main__":
    main()
