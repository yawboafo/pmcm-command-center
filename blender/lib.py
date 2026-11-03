"""
Shared helpers for the scripted Blender -> glTF asset pipeline.

All geometry helpers take APP-SPACE coordinates so that builders read exactly
like `src/components/twin/equipment.tsx`:

    x = width (right +), y = up, z = depth (front / operator side +)

`Asset` converts app space to Blender space (Z-up, front = -Y) once, through
the matrix `C` (a +90 degree rotation about X).  The glTF exporter's +Y-up
conversion undoes that, so a point (x, y, z) written here lands at exactly
(x, y, z) in the exported glTF / three.js scene.

Every helper creates one Blender object per "part"; `Asset.finalize()` applies
modifiers (bevel / boolean / solidify) and joins parts by ROLE, so the glTF
ends up with a handful of named nodes:

    BODY    main body (always present)
    STATUS  single-material indicator light the app recolours
    GLASS   transparent panes (alpha blend; kept separate for sorting)
    SCREEN  emissive display surfaces
    LIGHT   emissive lamps / heat lamps / light boxes
    LABEL   UV-mapped quad(s) the app can put a canvas text texture on
    STOCK / FOOD / PROPS  removable dressing (vertex-coloured, 1 draw call)
    DUCT    hood duct stub (the app may hide or stretch it)
"""

from __future__ import annotations

import json
import math
import os
import random
import re

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

# app space -> Blender space
C = Matrix.Rotation(math.pi / 2, 4, "X")
# Blender primitive (axis +Z) -> app primitive (axis +Y)
Z_TO_Y = Matrix.Rotation(-math.pi / 2, 4, "X")

# --------------------------------------------------------------------------
# colour + material library
# --------------------------------------------------------------------------


def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h: str, a: float = 1.0):
    h = h.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return (_lin(r), _lin(g), _lin(b), a)


# Names mirror `M.*` in src/components/twin/materials.ts where one exists, so
# the app can map glTF material names back to its own shared materials if it
# ever wants to (e.g. to keep the canvas brushed-steel texture).
PALETTE: dict[str, dict] = {
    # metals - no textures: brushed look comes from roughness + bevel highlights
    "steel": dict(color="#d3d8de", metallic=0.9, roughness=0.3),
    "steelDark": dict(color="#80868d", metallic=0.85, roughness=0.42),
    "brushed": dict(color="#c6cbd1", metallic=0.85, roughness=0.46),
    "chrome": dict(color="#e6e9ec", metallic=1.0, roughness=0.12),
    "aluminium": dict(color="#b9bec4", metallic=0.8, roughness=0.55),
    "castIron": dict(color="#2a2b2d", metallic=0.6, roughness=0.55),
    # enamel / plastics
    "black": dict(color="#1b1c1f", metallic=0.1, roughness=0.6),
    "blackGloss": dict(color="#0d0e10", metallic=0.2, roughness=0.18),
    "blackEnamel": dict(color="#141518", metallic=0.15, roughness=0.32),
    "rubber": dict(color="#202124", roughness=0.9),
    "charcoal": dict(color="#2b2d31", roughness=0.55),
    "white": dict(color="#f4f4f2", roughness=0.5),
    "whiteGloss": dict(color="#fbfbfa", roughness=0.25),
    "cuttingBoard": dict(color="#eef0ea", roughness=0.55),
    "red": dict(color="#EE1D25", metallic=0.15, roughness=0.38),
    "redCladding": dict(color="#d8141c", metallic=0.35, roughness=0.3),
    "yellow": dict(color="#FFD400", roughness=0.55),
    "yellowFabric": dict(color="#f2bf1d", roughness=0.92),
    "lime": dict(color="#9ccc3a", roughness=0.45),
    "teal": dict(color="#1f7f86", roughness=0.85),
    "tealDark": dict(color="#175f64", roughness=0.85),
    "wood": dict(color="#9a6a43", roughness=0.7),
    "woodLight": dict(color="#c49a6c", roughness=0.62),
    "tableRed": dict(color="#c4161d", metallic=0.05, roughness=0.32),
    "frost": dict(color="#e8f3f8", metallic=0.2, roughness=0.4),
    "gasket": dict(color="#2a2b2e", roughness=0.85),
    "oil": dict(color="#a8701a", metallic=0.1, roughness=0.06, emissive="#4a2a00", strength=0.15),
    # glass (alpha blend - cheaper than KHR_materials_transmission in three.js)
    "glass": dict(color="#cfe6f2", roughness=0.05, alpha=0.22),
    "fridgeGlass": dict(color="#bfe3f5", roughness=0.06, alpha=0.28),
    # emissive
    "statusCold": dict(color="#4fc3ff", emissive="#4fc3ff", strength=2.0, roughness=0.4),
    "water": dict(color="#8fb8c8", roughness=0.04, alpha=0.45),
    "status": dict(color="#5dff8a", emissive="#5dff8a", strength=2.0, roughness=0.4),
    "screen": dict(color="#0a0c10", emissive="#2a62c9", strength=0.6, roughness=0.2),
    "screenGreen": dict(color="#0a1a10", emissive="#3fd17a", strength=0.7, roughness=0.2),
    "screenRed": dict(color="#1a0a08", emissive="#ff4b3a", strength=0.6, roughness=0.2),
    "digits": dict(color="#ff5a2a", emissive="#ff5a2a", strength=1.5, roughness=0.4),
    "heatLamp": dict(color="#ff9a3c", emissive="#ff7a1a", strength=2.2, roughness=0.4),
    "lightPanel": dict(color="#fff6e0", emissive="#fff6e0", strength=1.4, roughness=0.4),
    "interiorLight": dict(color="#e8f4ff", emissive="#e8f4ff", strength=0.45, roughness=0.5),
    "warmGlow": dict(color="#ffb347", emissive="#ffb347", strength=0.35, roughness=0.5),
    "lightBoxRed": dict(color="#EE1D25", emissive="#EE1D25", strength=0.35, roughness=0.35),
    "labelYellow": dict(color="#FFD400", roughness=0.5),
    # one material for all vertex-coloured dressing (stock, food, props)
    "vcol": dict(color="#ffffff", roughness=0.7, vertex_color=True),
}


def material(key: str) -> bpy.types.Material:
    m = bpy.data.materials.get(key)
    if m:
        return m
    spec = PALETTE.get(key)
    if spec is None and key.startswith("plastic:"):
        spec = dict(color=key.split(":", 1)[1], roughness=0.55)
    if spec is None:
        raise KeyError(f"unknown material {key}")
    m = bpy.data.materials.new(key)
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf is None:  # very old / very new defaults
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = nt.nodes.get("Material Output") or nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    base = hex_rgba(spec["color"])
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Metallic"].default_value = spec.get("metallic", 0.0)
    bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.5)
    if "emissive" in spec:
        bsdf.inputs["Emission Color"].default_value = hex_rgba(spec["emissive"])
        bsdf.inputs["Emission Strength"].default_value = spec.get("strength", 1.0)
    if "alpha" in spec:
        bsdf.inputs["Alpha"].default_value = spec["alpha"]
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            m.blend_method = "BLEND"
        m.use_backface_culling = False
    if spec.get("vertex_color"):
        node = nt.nodes.new("ShaderNodeVertexColor")
        node.layer_name = "Col"
        nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    m.diffuse_color = base
    m.roughness = spec.get("roughness", 0.5)
    m.metallic = spec.get("metallic", 0.0)
    return m


# --------------------------------------------------------------------------
# scene helpers
# --------------------------------------------------------------------------


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"


def _xform(p=(0, 0, 0), r=None) -> Matrix:
    """App-space TRS (no scale) -> Blender world matrix. r is a three.js Euler XYZ."""
    m = Matrix.Translation(Vector(p))
    if r is not None:
        # three.js 'XYZ' (intrinsic) == Blender 'ZYX' (extrinsic order naming)
        m = m @ Euler(r, "ZYX").to_matrix().to_4x4()
    return C @ m


class Asset:
    """Collects parts of one equipment / furniture model and exports it."""

    def __init__(self, type_: str, size, lod: int = 0, seed: int = 7):
        self.type = type_
        self.w, self.h, self.d = size
        self.size = list(size)
        self.lod = lod
        self.parts: list[tuple[bpy.types.Object, str]] = []
        self.cutters: list[bpy.types.Object] = []
        self.uv_roles: set[str] = set()
        self.rng = random.Random(f"{type_}:{seed}")

    # ---- quality knobs --------------------------------------------------
    @property
    def detail(self) -> bool:
        """False on LOD1: callers skip knobs, rivets, wires, small props."""
        return self.lod == 0

    def segs(self, n: int) -> int:
        return n if self.lod == 0 else max(6, n // 2)

    # ---- low level ------------------------------------------------------
    def _object(self, bm: bmesh.types.BMesh, mat: str, role: str, *, bevel=0.0, seg=1,
                smooth_angle=35.0, cuts=None, solidify=None, uv=False, vcol=None,
                harden=True, angle_limit=40.0) -> bpy.types.Object:
        me = bpy.data.meshes.new(role)
        bm.to_mesh(me)
        bm.free()
        if vcol is not None:
            mat = "vcol"
        me.materials.append(material(mat))
        for poly in me.polygons:
            poly.use_smooth = True
        if uv:
            self.uv_roles.add(role)
        else:
            while me.uv_layers:
                me.uv_layers.remove(me.uv_layers[0])
        if vcol is not None:
            attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
            rgba = hex_rgba(vcol)
            for d in attr.data:
                d.color = rgba
        ob = bpy.data.objects.new(role, me)
        bpy.context.scene.collection.objects.link(ob)
        if solidify:
            mod = ob.modifiers.new("solidify", "SOLIDIFY")
            mod.thickness = solidify
            mod.offset = -1.0
            mod.use_even_offset = True
        for cutter in cuts or []:
            mod = ob.modifiers.new("cut", "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.object = cutter
            mod.solver = "EXACT"
        # LOD1 keeps a single-segment chamfer on the larger panels only
        if bevel > 0 and seg > 0 and (self.lod == 0 or bevel >= 0.006):
            mod = ob.modifiers.new("bevel", "BEVEL")
            mod.width = bevel
            mod.segments = seg if self.lod == 0 else 1
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(angle_limit)
            mod.harden_normals = harden
            mod.use_clamp_overlap = True
            mod.miter_outer = "MITER_ARC"
        else:
            me.set_sharp_from_angle(angle=math.radians(smooth_angle))
        self.parts.append((ob, role))
        return ob

    def _cutter(self, p, s, r=None) -> bpy.types.Object:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(s), verts=bm.verts)
        bmesh.ops.transform(bm, matrix=_xform(p, r), verts=bm.verts)
        me = bpy.data.meshes.new("cutter")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new("cutter", me)
        bpy.context.scene.collection.objects.link(ob)
        ob.hide_render = True
        ob.hide_set(True)
        self.cutters.append(ob)
        return ob

    # ---- primitives (app space) ------------------------------------------
    def box(self, p, s, mat, role="BODY", *, bevel=0.004, seg=1, r=None, slab=False,
            cuts=None, uv=False, vcol=None, solidify=None, open_top=False):
        """Box by centre (or bottom-centre when slab=True). cuts = [(p, s), ...]
        boolean-subtracted boxes in the same app space."""
        p = Vector(p)
        if slab:
            p = p + Vector((0, s[1] / 2, 0))
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0, calc_uvs=uv)
        bmesh.ops.scale(bm, vec=Vector(s), verts=bm.verts)
        if open_top:
            top = [f for f in bm.faces if f.normal.y > 0.9]
            bmesh.ops.delete(bm, geom=top, context="FACES_ONLY")
        bmesh.ops.transform(bm, matrix=_xform(p, r), verts=bm.verts)
        cutters = [self._cutter(cp, cs, cr[0] if cr else None) for cp, cs, *cr in (cuts or [])]
        return self._object(bm, mat, role, bevel=bevel, seg=seg, cuts=cutters, uv=uv, vcol=vcol,
                            solidify=solidify)

    def tub(self, p, s, wall, mat, role="BODY", *, bevel=0.003, r=None, vcol=None):
        """Open-topped tray / pan / well (walls grow inward from the outer size)."""
        return self.box(p, s, mat, role, bevel=bevel, r=r, open_top=True, solidify=wall, vcol=vcol)

    def cyl(self, p, radius, h, mat, role="BODY", *, seg=16, axis="y", r_top=None, r=None,
            bevel=0.0, bseg=1, caps=True, vcol=None, scale=None):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=self.segs(seg),
                              radius1=radius, radius2=radius if r_top is None else r_top, depth=h)
        rot = Z_TO_Y
        if axis == "x":
            rot = Matrix.Rotation(-math.pi / 2, 4, "Z") @ Z_TO_Y  # app Y -> app X
        elif axis == "z":
            rot = Matrix.Rotation(math.pi / 2, 4, "X") @ Z_TO_Y  # app Y -> app Z
        bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
        if scale:
            bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
        bmesh.ops.transform(bm, matrix=_xform(p, r), verts=bm.verts)
        return self._object(bm, mat, role, bevel=bevel, seg=bseg, vcol=vcol, angle_limit=50)

    def sphere(self, p, radius, mat, role="BODY", *, seg=12, rings=8, scale=(1, 1, 1), r=None, vcol=None):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=self.segs(seg), v_segments=max(4, rings if self.lod == 0 else rings // 2), radius=radius)
        bmesh.ops.transform(bm, matrix=Z_TO_Y, verts=bm.verts)
        bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
        bmesh.ops.transform(bm, matrix=_xform(p, r), verts=bm.verts)
        return self._object(bm, mat, role, smooth_angle=80, vcol=vcol)

    def lathe(self, p, profile, mat, role="BODY", *, seg=12, vcol=None, r=None):
        """Surface of revolution about app Y. profile = [(radius, y), ...] bottom -> top."""
        n = self.segs(seg)
        bm = bmesh.new()
        rings = []
        for rad, y in profile:
            ring = []
            for i in range(n):
                a = 2 * math.pi * i / n
                ring.append(bm.verts.new((rad * math.cos(a), y, rad * math.sin(a))))
            rings.append(ring)
        for a_ring, b_ring in zip(rings, rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((a_ring[i], a_ring[j], b_ring[j], b_ring[i]))
        if profile[0][0] > 1e-4:
            bm.faces.new(list(reversed(rings[0])))
        if profile[-1][0] > 1e-4:
            bm.faces.new(rings[-1])
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.transform(bm, matrix=_xform(p, r), verts=bm.verts)
        return self._object(bm, mat, role, smooth_angle=50, vcol=vcol)

    def prism(self, profile, length, mat, role="BODY", *, axis="x", p=(0, 0, 0), bevel=0.004, seg=1,
              r=None, cuts=None, vcol=None):
        """Extrude a convex-ish 2D profile. axis x: profile=(z, y); axis z: (x, y); axis y: (x, z)."""
        bm = bmesh.new()
        def v3(u, v, t):
            if axis == "x":
                return (t, v, u)
            if axis == "z":
                return (u, v, t)
            return (u, t, v)
        a = [bm.verts.new(v3(u, v, -length / 2)) for u, v in profile]
        b = [bm.verts.new(v3(u, v, length / 2)) for u, v in profile]
        n = len(profile)
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], b[i], b[j], a[j]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.transform(bm, matrix=_xform(p, r), verts=bm.verts)
        cutters = [self._cutter(cp, cs) for cp, cs in (cuts or [])]
        return self._object(bm, mat, role, bevel=bevel, seg=seg, cuts=cutters, vcol=vcol)

    def torus(self, p, R, rad, mat, role="BODY", *, seg=20, minor=6, r=None, vcol=None):
        n, m = self.segs(seg), max(4, minor if self.lod == 0 else minor // 2)
        bm = bmesh.new()
        rings = []
        for i in range(n):
            a = 2 * math.pi * i / n
            ring = []
            for j in range(m):
                b = 2 * math.pi * j / m
                rr = R + rad * math.cos(b)
                ring.append(bm.verts.new((rr * math.cos(a), rad * math.sin(b), rr * math.sin(a))))
            rings.append(ring)
        for i in range(n):
            for j in range(m):
                a0, a1 = rings[i], rings[(i + 1) % n]
                bm.faces.new((a0[j], a0[(j + 1) % m], a1[(j + 1) % m], a1[j]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.transform(bm, matrix=_xform(p, r), verts=bm.verts)
        return self._object(bm, mat, role, smooth_angle=80, vcol=vcol)

    def pipe(self, points, radius, mat, role="BODY", *, sides=8, caps=True, vcol=None):
        """Round tube swept along an app-space polyline (use arc() for bends)."""
        sides = sides if self.lod == 0 else max(4, sides // 2)
        pts = [Vector(q) for q in points]
        bm = bmesh.new()
        rings = []
        n1 = None
        for i, q in enumerate(pts):
            if i == 0:
                t = (pts[1] - pts[0]).normalized()
            elif i == len(pts) - 1:
                t = (pts[-1] - pts[-2]).normalized()
            else:
                t = ((pts[i] - pts[i - 1]).normalized() + (pts[i + 1] - pts[i]).normalized()).normalized()
            if n1 is None:  # initial frame, then parallel transport (no twisting)
                up = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
                n1 = t.cross(up).normalized()
            else:
                n1 = (n1 - t * n1.dot(t)).normalized()
            n2 = t.cross(n1).normalized()
            ring = [bm.verts.new(q + (n1 * math.cos(2 * math.pi * s / sides) + n2 * math.sin(2 * math.pi * s / sides)) * radius) for s in range(sides)]
            rings.append(ring)
        for a_ring, b_ring in zip(rings, rings[1:]):
            for s in range(sides):
                s2 = (s + 1) % sides
                bm.faces.new((a_ring[s], a_ring[s2], b_ring[s2], b_ring[s]))
        if caps:
            bm.faces.new(list(reversed(rings[0])))
            bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.transform(bm, matrix=C, verts=bm.verts)
        return self._object(bm, mat, role, smooth_angle=60, vcol=vcol)

    def label(self, p, s, mat="labelYellow", role="LABEL", r=None):
        """Front-facing (+z) quad with 0..1 UVs for an app-side canvas texture."""
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        w, h = s
        vs = [bm.verts.new(v) for v in ((-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0))]
        f = bm.faces.new(vs)
        for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = (u, v)
        bmesh.ops.transform(bm, matrix=_xform(p, r), verts=bm.verts)
        return self._object(bm, mat, role, uv=True)

    # ---- composite helpers -------------------------------------------------
    def round_legs(self, w, d, h, mat="steel", *, inset=0.05, radius=0.02, feet=True, y0=0.0, gusset=True):
        """Tubular stainless legs with bullet feet and top gussets (commercial tables)."""
        xs = (-w / 2 + inset + radius, w / 2 - inset - radius)
        zs = (-d / 2 + inset + radius, d / 2 - inset - radius)
        for x in xs:
            for z in zs:
                foot = 0.03 if feet else 0.0
                self.cyl((x, y0 + foot + (h - foot) / 2, z), radius, h - foot, mat, seg=12)
                if feet:
                    self.cyl((x, y0 + foot / 2, z), radius * 1.15, foot, "steelDark", seg=12, r_top=radius * 0.9)
                if gusset and self.detail:
                    self.cyl((x, y0 + h - 0.03, z), radius * 1.45, 0.06, mat, seg=12, r_top=radius * 1.6)
        return xs, zs

    def square_legs(self, w, d, h, mat="black", *, inset=0.05, t=0.04, y0=0.0):
        for x in (-w / 2 + inset + t / 2, w / 2 - inset - t / 2):
            for z in (-d / 2 + inset + t / 2, d / 2 - inset - t / 2):
                self.box((x, y0 + h / 2, z), (t, h, t), mat, bevel=0.004)

    def caster(self, x, z, h, *, wheel=0.04):
        """Swivel caster: wheel + fork + stem reaching up to height h."""
        self.cyl((x, wheel, z), wheel, 0.03, "rubber", axis="x", seg=12)
        if self.detail:
            self.cyl((x, wheel, z), wheel * 0.45, 0.034, "steelDark", axis="x", seg=8)
        self.box((x, wheel + 0.02, z - 0.012), (0.045, wheel + 0.02, 0.05), "steelDark", bevel=0.003)
        stem = h - (2 * wheel + 0.04)
        if stem > 0.01:
            self.box((x, 2 * wheel + 0.04 + stem / 2, z), (0.06, stem, 0.06), "steelDark", bevel=0.004)

    def wire_shelf(self, y, w, d, *, z=0.0, mat="chrome", pitch=0.045):
        """Wire shelf: flat perimeter frame + front-back wires (reads as real wire shelving)."""
        t = 0.012
        self.box((0, y, z + d / 2 - t / 2), (w, 0.03, t), mat, bevel=0.002)
        self.box((0, y, z - d / 2 + t / 2), (w, 0.03, t), mat, bevel=0.002)
        self.box((-w / 2 + t / 2, y, z), (t, 0.03, d), mat, bevel=0.002)
        self.box((w / 2 - t / 2, y, z), (t, 0.03, d), mat, bevel=0.002)
        if self.detail:
            n = max(2, int((w - 0.04) / pitch))
            for i in range(n):
                x = -w / 2 + 0.02 + (i + 0.5) * (w - 0.04) / n
                self.box((x, y + 0.008, z), (0.004, 0.006, d - 0.02), mat, bevel=0)
            # two longitudinal support wires
            for zz in (-d / 6, d / 6):
                self.box((0, y + 0.002, z + zz), (w - 0.02, 0.006, 0.004), mat, bevel=0)
        else:
            self.box((0, y + 0.006, z), (w - 0.02, 0.004, d - 0.02), mat, bevel=0)

    # ---- finishing ------------------------------------------------------
    def finalize(self) -> dict:
        """Apply modifiers, join parts by role, return {role: object}."""
        dg = bpy.context.evaluated_depsgraph_get()
        for ob, _ in self.parts:
            ev = ob.evaluated_get(dg)
            me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
            old = ob.data
            ob.modifiers.clear()
            ob.data = me
            bpy.data.meshes.remove(old)
        for c in self.cutters:
            bpy.data.objects.remove(c, do_unlink=True)
        self.cutters.clear()
        by_role: dict[str, list] = {}
        for ob, role in self.parts:
            by_role.setdefault(role, []).append(ob)
        out = {}
        for role, objs in by_role.items():
            main = objs[0]
            if len(objs) > 1:
                with bpy.context.temp_override(active_object=main, object=main, selected_objects=objs,
                                               selected_editable_objects=objs):
                    bpy.ops.object.join()
            main.name = role
            main.data.name = role
            me = main.data
            if role not in self.uv_roles:
                while me.uv_layers:
                    me.uv_layers.remove(me.uv_layers[0])
            out[role] = main
        self.parts = [(o, r) for r, o in out.items()]
        return out

    def triangles(self) -> int:
        n = 0
        for ob in bpy.context.scene.objects:
            if ob.type == "MESH" and not ob.hide_render and ob.name != "__floor":
                ob.data.calc_loop_triangles()
                n += len(ob.data.loop_triangles)
        return n

    def bounds(self):
        lo = Vector((1e9, 1e9, 1e9))
        hi = -lo
        for ob in bpy.context.scene.objects:
            if ob.type != "MESH" or ob.name.startswith("__"):
                continue
            for v in ob.data.vertices:
                w = C.inverted() @ (ob.matrix_world @ v.co)  # back to app space
                lo = Vector(map(min, lo, w))
                hi = Vector(map(max, hi, w))
        return [round(x, 4) for x in lo], [round(x, 4) for x in hi]

    def decimate_to(self, target_tris: int):
        """Collapse-decimate every mesh proportionally until <= target (LOD fallback)."""
        cur = self.triangles()
        if cur <= target_tris:
            return cur
        ratio = max(0.05, target_tris / cur)
        for ob in list(bpy.context.scene.objects):
            if ob.type != "MESH" or ob.name in ("STATUS",):
                continue
            mod = ob.modifiers.new("decimate", "DECIMATE")
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            dg = bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
            ob.modifiers.clear()
            ob.data = me
        return self.triangles()


# --------------------------------------------------------------------------
# geometry utils
# --------------------------------------------------------------------------


def at(p, r, o):
    """App-space point o (local to a part placed at p with three.js Euler r)."""
    return tuple(Vector(p) + Euler(r, "ZYX").to_matrix() @ Vector(o))


def arc(center, radius, a0, a1, n=6, plane="zy"):
    """Points on an arc in the given app plane ('zy': u=z, v=y)."""
    cx, cy, cz = center
    pts = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        u, v = math.cos(a) * radius, math.sin(a) * radius
        if plane == "zy":
            pts.append((cx, cy + v, cz + u))
        elif plane == "xy":
            pts.append((cx + u, cy + v, cz))
        else:
            pts.append((cx + u, cy, cz + v))
    return pts


# --------------------------------------------------------------------------
# export
# --------------------------------------------------------------------------


def export_glb(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        use_visible=False,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_vertex_color="MATERIAL",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_draco_mesh_compression_enable=False,
        export_meshopt_compression_enable=False,
        # NB: export_image_format="NONE" makes the exporter ignore the material's vertex-colour
        # node and write a white COLOR_0 (real colours in COLOR_1, later pruned) - leave it AUTO.
    )


# --------------------------------------------------------------------------
# QA render (EEVEE, neutral studio, 3/4 view)
# --------------------------------------------------------------------------


def _world_studio(scene):
    world = bpy.data.worlds.new("studio")
    scene.world = world
    nt = world.node_tree
    nodes, links = nt.nodes, nt.links
    bg = nodes.get("Background") or nodes.new("ShaderNodeBackground")
    out = nodes.get("World Output") or nodes.new("ShaderNodeOutputWorld")
    tc = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.18, 0.185, 0.19, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (0.95, 0.95, 0.95, 1)
    mr = nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1
    mr.inputs["From Max"].default_value = 1
    links.new(tc.outputs["Generated"], sep.inputs[0])
    links.new(sep.outputs["Z"], mr.inputs["Value"])
    links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.75
    links.new(bg.outputs[0], out.inputs[0])


def render_preview(path: str, title: str = "", res=(720, 560), elevated=False):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    try:
        scene.eevee.taa_render_samples = 48
        scene.eevee.use_raytracing = True
        scene.eevee.use_shadows = True
    except Exception:
        pass
    try:
        scene.view_settings.view_transform = "Khronos PBR Neutral"
        scene.view_settings.exposure = -0.7
    except Exception:
        try:
            scene.view_settings.view_transform = "Standard"
        except Exception:
            pass
    _world_studio(scene)

    meshes = [o for o in scene.objects if o.type == "MESH"]
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for ob in meshes:
        for corner in ob.bound_box:
            wc = ob.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, wc))
            hi = Vector(map(max, hi, wc))
    center = (lo + hi) / 2
    radius = (hi - lo).length / 2

    # floor / backdrop (not exported: render happens after export)
    # elevated items (hood, evaporators, menu board) are viewed from below, floor 2 m down
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, lo.z - (2.0 if elevated else 0.0005)))
    floor = bpy.context.active_object
    floor.name = "__floor"
    fm = bpy.data.materials.new("__floor")
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.62, 0.62, 0.61, 1)
    fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
    floor.data.materials.append(fm)

    def area(name, loc, power, size, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = power
        ld.size = size
        ld.color = color
        lo_ = bpy.data.objects.new(name, ld)
        scene.collection.objects.link(lo_)
        lo_.location = Vector(loc)
        d = center - lo_.location
        lo_.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

    s = max(radius, 0.6)
    area("key", center + Vector((-2.2, -3.0, 3.0)) * s, 900 * s * s, 3.0 * s, (1.0, 0.97, 0.93))
    area("fill", center + Vector((3.2, -1.6, 1.4)) * s, 300 * s * s, 4.0 * s, (0.92, 0.96, 1.0))
    area("rim", center + Vector((0.8, 3.2, 2.6)) * s, 500 * s * s, 2.5 * s)

    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 50
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    # 3/4 view from the front-right (app +z front == Blender -y)
    direction = Vector((0.72, -1.0, -0.42 if elevated else 0.62)).normalized()
    fov = 2 * math.atan(cam_d.sensor_width / (2 * cam_d.lens))
    aspect = res[1] / res[0]
    fov_min = fov * aspect if aspect < 1 else fov
    dist = radius / math.sin(fov_min / 2) * 1.02
    cam.location = center + direction * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)


# --------------------------------------------------------------------------
# catalogue parsing (single source of truth = src/lib/floorplan/catalog.ts)
# --------------------------------------------------------------------------


def parse_catalog(path: str) -> dict:
    src = open(path, encoding="utf-8").read()
    out = {}
    for block, kind in (("EQUIPMENT_CATALOG", "equipment"), ("FURNITURE_CATALOG", "furniture")):
        start = src.index(block)
        body = src[start : src.index("};", start)]
        for m in re.finditer(r'^\s*"?([\w-]+)"?\s*:\s*\{(.*)\},?\s*$', body, re.M):
            key, rest = m.group(1), m.group(2)
            size = re.search(r"size:\s*\[([^\]]+)\]", rest)
            if not size:
                continue
            out[key] = dict(
                kind=kind,
                size=[float(x) for x in size.group(1).split(",")],
                elevated="elevated: true" in rest,
                label=(re.search(r'label:\s*"([^"]+)"', rest) or [None, key])[1],
            )
    return out


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
