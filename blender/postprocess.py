#!/usr/bin/env python3
"""
Web-ready step after build_assets.py (runs with the system python3, not Blender).

  1. gltf-transform (via npx) on every raw GLB:
       dedup + weld + prune + EXT_meshopt_compression (+ KHR_mesh_quantization)
     with flatten / join / instance / palette / simplify OFF so the named
     BODY / STATUS / GLASS ... nodes survive exactly as built, and attribute pruning OFF so
     the UVs of untextured LABEL / SCREEN quads survive.
  2. public/models/manifest.json (triangles + bytes measured from the final files).
  3. blender/renders/contact-sheet.png (needs Pillow; skipped with a warning if absent).

    python3 blender/postprocess.py [--only fryer,fridge] [--no-optimize] [--no-sheet]

--no-optimize copies the raw GLBs instead (no decoder needed in the app).
A file at blender/hand/<kind>/<type>.glb (+ optional .lod1.glb) overrides the scripted
build for that type and is recorded as "source": "hand" in the manifest.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, "out", "raw")
HAND = os.path.join(HERE, "hand")  # hand-made overrides: hand/<kind>/<type>.glb (+ .lod1.glb)
PUBLIC = os.path.join(ROOT, "public", "models")
RENDERS = os.path.join(HERE, "renders")
GLTF_TRANSFORM = ["npx", "--yes", "@gltf-transform/cli@4.5.1"]
OPT_FLAGS = [
    "--compress", "meshopt", "--meshopt-level", "high",
    "--flatten", "false", "--join", "false", "--instance", "false",
    "--palette", "false", "--simplify", "false", "--texture-compress", "false",
    "--resample", "false", "--weld", "true", "--prune", "true",
    # keep TEXCOORD_0 on LABEL / SCREEN quads: they carry no texture in the file (the app puts its
    # canvas artwork on them), so attribute pruning would otherwise strip their UVs
    "--prune-attributes", "false",
]
TOTAL_BUDGET = 2.5 * 1024 * 1024


def glb_json(path: str) -> dict:
    with open(path, "rb") as f:
        data = f.read()
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, f"{path} is not a GLB"
    clen, ctype = struct.unpack_from("<II", data, 12)
    assert ctype == 0x4E4F534A
    return json.loads(data[20 : 20 + clen])


def glb_triangles(path: str) -> int:
    g = glb_json(path)
    tris = 0
    for mesh in g.get("meshes", []):
        for prim in mesh["primitives"]:
            if prim.get("mode", 4) != 4:
                continue
            if "indices" in prim:
                tris += g["accessors"][prim["indices"]]["count"] // 3
            else:
                tris += g["accessors"][prim["attributes"]["POSITION"]]["count"] // 3
    return tris


def glb_summary(path: str) -> dict:
    g = glb_json(path)
    return {
        "nodes": [n.get("name") for n in g.get("nodes", [])],
        "primitives": sum(len(m["primitives"]) for m in g.get("meshes", [])),
        "materials": len(g.get("materials", [])),
        "extensionsRequired": g.get("extensionsRequired", []),
    }


def optimise(src: str, dst: str, enabled: bool) -> bool:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if not enabled:
        shutil.copyfile(src, dst)
        return False
    cmd = GLTF_TRANSFORM + ["optimize", src, dst] + OPT_FLAGS
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[post] gltf-transform failed for {src}; copying raw.\n{res.stderr[-800:]}", file=sys.stderr)
        shutil.copyfile(src, dst)
        return False
    return True


def contact_sheet(manifest: dict, out: str):
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("[post] Pillow not installed - skipping contact sheet", file=sys.stderr)
        return
    items = [(t, e) for t, e in manifest["assets"].items() if os.path.exists(os.path.join(RENDERS, f"{t}.png"))]
    cols, tw, th, lab = 6, 360, 280, 46
    rows = (len(items) + cols - 1) // cols
    head = 70
    sheet = Image.new("RGB", (cols * tw, head + rows * (th + lab)), (238, 238, 236))
    draw = ImageDraw.Draw(sheet)

    def font(size, bold=False):
        for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
                  "/System/Library/Fonts/Helvetica.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
        return ImageFont.load_default()

    total = sum(e["bytes"] + (e.get("lod1Bytes") or 0) for e in manifest["assets"].values())
    draw.text((16, 14), "Pizzaman Chickenman twin - scripted asset QA", fill=(30, 30, 30), font=font(26, True))
    draw.text((16, 46), f"{len(manifest['assets'])} assets  |  {total / 1024:.0f} KB total (incl. LOD1)  |  "
              f"{manifest.get('compression') or 'uncompressed'}  |  generated {manifest['generatedAt']}",
              fill=(90, 90, 90), font=font(15))
    for i, (t, e) in enumerate(items):
        x, y = (i % cols) * tw, head + (i // cols) * (th + lab)
        im = Image.open(os.path.join(RENDERS, f"{t}.png")).convert("RGB")
        im.thumbnail((tw, th))
        sheet.paste(im, (x + (tw - im.width) // 2, y))
        draw.text((x + 10, y + th + 4), t, fill=(20, 20, 20), font=font(17, True))
        lod = f"  LOD1 {e['lod1Triangles']}" if e.get("lod1") else ""
        draw.text((x + 10, y + th + 25), f"{e['triangles']} tris  {e['bytes'] / 1024:.0f} KB{lod}", fill=(80, 80, 80), font=font(14))
    sheet.save(out, optimize=True)
    print(f"[post] contact sheet -> {out}")


def main():
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        only = set(args[args.index("--only") + 1].split(","))
    do_opt = "--no-optimize" not in args
    stats = json.load(open(os.path.join(HERE, "out", "stats.json")))
    manifest_path = os.path.join(PUBLIC, "manifest.json")
    prev = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"assets": {}}
    assets = dict(prev.get("assets", {}))
    compressed_any = False
    for t, s in stats.items():
        kind = s["kind"]
        rel = f"models/{kind}/{t}.glb"
        dst = os.path.join(ROOT, "public", rel)
        hand = os.path.join(HAND, kind, f"{t}.glb")
        is_hand = os.path.exists(hand)
        src_dir = os.path.join(HAND, kind) if is_hand else os.path.join(RAW, kind)
        if only is None or t in only:
            compressed_any |= optimise(os.path.join(src_dir, f"{t}.glb"), dst, do_opt)
        lod_rel, lod_bytes, lod_tris = None, None, None
        lod_src = os.path.join(src_dir, f"{t}.lod1.glb")
        if (s.get("lod1") and not is_hand) or (is_hand and os.path.exists(lod_src)):
            lod_rel = f"models/{kind}/{t}.lod1.glb"
            lod_dst = os.path.join(ROOT, "public", lod_rel)
            if only is None or t in only:
                optimise(lod_src, lod_dst, do_opt)
            lod_bytes, lod_tris = os.path.getsize(lod_dst), glb_triangles(lod_dst)
        summary = glb_summary(dst)
        assets[t] = {
            "path": rel,
            "lod1": lod_rel,
            "size": s["size"],
            "triangles": glb_triangles(dst),
            "bytes": os.path.getsize(dst),
            "origin": s["origin"],
            "source": "hand" if is_hand else "scripted",
            # extra (non-contract) fields
            "kind": kind,
            "label": s["label"],
            "bounds": None if is_hand else s["bounds"],
            "nodes": sorted(set(summary["nodes"])),
            "drawCalls": summary["primitives"],
            "lod1Triangles": lod_tris,
            "lod1Bytes": lod_bytes,
            "extensionsRequired": summary["extensionsRequired"],
            # builder-specific extras (e.g. the people rig: joint positions + part -> joint map)
            **s.get("extra", {}),
        }
    req = sorted({x for a in assets.values() for x in a["extensionsRequired"]})
    manifest = {
        "schemaVersion": 1,
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "generator": "blender/build_assets.py, build_people.py, build_props.py + blender/postprocess.py",
        "units": "metres, +Y up, front +Z",
        "compression": "EXT_meshopt_compression" if "EXT_meshopt_compression" in req else None,
        "extensionsRequired": req,
        "assets": dict(sorted(assets.items())),
    }
    os.makedirs(PUBLIC, exist_ok=True)
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    total = sum(a["bytes"] + (a["lod1Bytes"] or 0) for a in assets.values())
    eq_total = sum(a["bytes"] + (a["lod1Bytes"] or 0) for a in assets.values() if a["kind"] == "equipment")
    print(f"[post] manifest -> {manifest_path}")
    print(f"[post] equipment {eq_total / 1024:.0f} KB, all {total / 1024:.0f} KB (budget {TOTAL_BUDGET / 1024:.0f} KB); "
          f"extensionsRequired={req}")
    if eq_total > TOTAL_BUDGET:
        print("[post] WARNING: public/models/equipment over the 2.5 MB budget", file=sys.stderr)
    if "--no-sheet" not in args:
        contact_sheet(manifest, os.path.join(RENDERS, "contact-sheet.png"))


if __name__ == "__main__":
    main()
