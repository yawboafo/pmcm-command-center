"""
Scripted low-poly people for the twin: one shared body, swappable parts, rigid-part rig.

    blender -b --factory-startup --python blender/build_people.py -- [--no-render]

Output
    blender/out/raw/characters/people.glb   one node per part (pivot = joint), single vcol material
    blender/out/stats.json                  merged entry "people" (kind "characters"), incl. the rig
    blender/renders/people.png              QA line-up: crew, supervisor, customers, rider, posed

Why rigid parts instead of a skinned mesh: the app poses every agent each frame from the
simulation (walk / carry / work / clean / sit / idle). Rigid parts let the app instance every
part across all agents (one draw call per part type, whatever the head-count), with no skinning
cost, and keep the pose code a few lines of joint rotations. Joints are hidden by overlapping
caps (shoulder, hip, knee, elbow) the way stylised game characters do it.

Colour is NOT baked per outfit. Every vertex carries COLOR_0 =
    R  slot / 15   which palette entry colours this face (see SLOTS)
    G  ambient occlusion (ray-traced in the rest pose, 0.55..1)
    B  roughness override (0 = use the slot default)
The app decodes the slot against a per-instance palette (skin, top, bottom, shoes, hair,
accent, forearm, shin), so outfits, skin tones and hair colours cost nothing extra.
Slots 8+ are fixed colours (eyes, soles, brand trim, visor) or shades of a palette entry.
"""

from __future__ import annotations

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import lib  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
RENDERS = os.path.join(HERE, "renders")

# ---------------------------------------------------------------------------
# slots (keep in sync with S_* and the shader in src/components/twin/people.tsx)
# ---------------------------------------------------------------------------
SKIN, TOP, BOTTOM, SHOES, HAIR, ACCENT, FOREARM, SHIN = range(8)
DARK, WHITE, RED, YELLOW, VISOR, SKIN_DARK, TOP_DARK, ACCENT_DARK = range(8, 16)

# ---------------------------------------------------------------------------
# rest-pose rig, app space (x = character's left, y up, z = facing), 1.72 m adult.
# L/R limbs share one mesh: limb meshes are symmetric about their own x = 0 plane.
# ---------------------------------------------------------------------------
JOINTS = {
    "pelvis": (0.0, 0.94, 0.0),
    "torso": (0.0, 1.00, 0.0),
    "head": (0.0, 1.47, -0.005),
    "hip": (0.092, 0.905, 0.0),
    "knee": (0.092, 0.50, 0.0),
    "ankle": (0.092, 0.085, 0.0),
    "shoulder": (0.176, 1.39, -0.012),
    "elbow": (0.176, 1.11, -0.012),
    "wrist": (0.176, 0.86, -0.012),
}
# arms hang slightly away from the body (radians about z, applied by the app's rig too)
ARM_SPLAY = 0.1


def V(*a):
    return Vector(a if len(a) == 3 else a[0])


# ---------------------------------------------------------------------------
# mesh builder: a bmesh in joint-local app space with per-corner slot colour
# ---------------------------------------------------------------------------


class Part:
    def __init__(self, name: str, joint: str):
        self.name = name
        self.joint = joint
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.rough: dict[int, float] = {}  # face index -> roughness override

    # -- faces ---------------------------------------------------------------
    def face(self, verts, slot, rough=0.0):
        f = self.bm.faces.new(verts)
        for lp in f.loops:
            lp[self.col] = (slot / 15.0, 1.0, rough, 1.0)
        return f

    def ring(self, c, rx, rz, n, p=2.0, phase=0.0, front=1.0):
        out = []
        for i in range(n):
            a = phase + 2 * math.pi * i / n
            ca, sa = math.cos(a), math.sin(a)
            x = rx * math.copysign(abs(ca) ** (2 / p), ca)
            z = rz * math.copysign(abs(sa) ** (2 / p), sa)
            if z > 0:
                z *= front
            out.append(self.bm.verts.new((c[0] + x, c[1], c[2] + z)))
        return out

    def loft(self, secs, slots, *, n=10, p=2.0, cap0=True, cap1=True, rough=0.0, phase=None):
        """Loft of horizontal rings. secs = [(y, rx, rz, zc[, p][, x]) ...] in either order.
        Winding is (r0[i], r1[i], r1[j], r0[j]): the surface faces left of the profile when the
        profile runs counter-clockwise in the (radius, y) plane, i.e. outward for a bottom-to-top
        list, and for folds listed outer-up -> over the top -> inner-down (collars).
        slots: int, list (one per band) or callable(band) -> slot."""
        phase = math.pi / n if phase is None else phase
        nb = len(secs) - 1
        slot_of = (lambda b: slots(b)) if callable(slots) else (
            (lambda b: slots[b]) if isinstance(slots, (list, tuple)) else (lambda b: slots))
        if secs[0][0] > secs[-1][0]:  # listed top -> bottom: flip so the outside faces out
            secs = secs[::-1]
            orig = slot_of
            slot_of = lambda b: orig(nb - 1 - b)  # noqa: E731
        rings = []
        for s in secs:
            y, rx, rz, zc = s[:4]
            pp = s[4] if len(s) > 4 else p
            x = s[5] if len(s) > 5 else 0.0
            rings.append(self.ring((x, y, zc), rx, rz, n, pp, phase))
        for b in range(nb):
            r0, r1 = rings[b], rings[b + 1]
            slot = slot_of(b)
            for i in range(n):
                j = (i + 1) % n
                self.face((r0[i], r1[i], r1[j], r0[j]), slot, rough)
        if cap0:
            self.cap(rings[0], slot_of(0), rough, up=False)
        if cap1:
            self.cap(rings[-1], slot_of(nb - 1), rough, up=True)
        return rings

    def cap(self, ring, slot, rough=0.0, up=True):
        c = sum((v.co for v in ring), Vector()) / len(ring)
        cv = self.bm.verts.new(c)
        n = len(ring)
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            self.face((b, a, cv) if up else (a, b, cv), slot, rough)

    def zrings(self, secs, n, p):
        rings = []
        for z, hw, top, bot in secs:
            cy, ry = (top + bot) / 2, (top - bot) / 2
            ring = []
            for i in range(n):
                a = 2 * math.pi * i / n + math.pi / n
                ca, sa = math.cos(a), math.sin(a)
                x = hw * math.copysign(abs(ca) ** (2 / p), ca)
                y = ry * math.copysign(abs(sa) ** (2 / p), sa)
                ring.append(self.bm.verts.new((x, cy + y, z)))
            rings.append(ring)
        return rings

    def loft_z(self, secs, slot_fn, *, n=10, p=3.0, cap_slot=None):
        """Loft along +z (shoes, boxes). secs = [(z, hw, top, bottom) ...] back -> front; closed.
        slot_fn(face_centre) -> slot."""
        rings = self.zrings(secs, n, p)
        for b in range(len(rings) - 1):
            r0, r1 = rings[b], rings[b + 1]
            for i in range(n):
                j = (i + 1) % n
                q = (r0[i], r0[j], r1[j], r1[i])
                cen = sum((v.co for v in q), Vector()) / 4
                self.face(q, slot_fn(cen))
        for ring, front in ((rings[0], False), (rings[-1], True)):
            c = sum((v.co for v in ring), Vector()) / len(ring)
            cv = self.bm.verts.new(c)
            for i in range(n):
                a, b = ring[i], ring[(i + 1) % n]
                self.face((a, b, cv) if front else (b, a, cv), slot_fn(c) if cap_slot is None else cap_slot)

    def ellipsoid(self, c, r, slot, *, seg=10, rings=7, keep=None, deform=None, slot_fn=None, rough=0.0):
        """UV ellipsoid (outward normals). keep(face_centre_unit) filters faces (open shells),
        deform(unit) -> unit, slot_fn(face_centre_unit) -> slot."""
        def unit(k, i):
            t = math.pi * k / rings
            a = 2 * math.pi * (i % seg) / seg
            return Vector((math.sin(t) * math.sin(a), math.cos(t), math.sin(t) * math.cos(a)))

        made = {}

        def vert(k, i):
            key = (k, 0) if k in (0, rings) else (k, i % seg)
            if key not in made:
                u = unit(k, i)
                w = deform(u.copy()) if deform else u
                made[key] = self.bm.verts.new((c[0] + w.x * r[0], c[1] + w.y * r[1], c[2] + w.z * r[2]))
            return made[key]

        for k in range(rings):
            for i in range(seg):
                if k == 0:
                    q = (vert(0, 0), vert(1, i), vert(1, i + 1))
                    us = (unit(0, 0), unit(1, i), unit(1, i + 1))
                elif k == rings - 1:
                    q = (vert(k, i), vert(rings, 0), vert(k, i + 1))
                    us = (unit(k, i), unit(rings, 0), unit(k, i + 1))
                else:
                    q = (vert(k, i), vert(k + 1, i), vert(k + 1, i + 1), vert(k, i + 1))
                    us = (unit(k, i), unit(k + 1, i), unit(k + 1, i + 1), unit(k, i + 1))
                cu = (sum(us, Vector()) / len(us)).normalized()
                if keep and not keep(cu):
                    continue
                self.face(q, slot_fn(cu) if slot_fn else slot, rough)
        return list(made.values())

    def box(self, c, s, slot, r=(0, 0, 0), rough=0.0):
        bm2 = bmesh.new()
        bmesh.ops.create_cube(bm2, size=1.0)
        m = Matrix.Translation(Vector(c)) @ Euler(r, "ZYX").to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))
        vs = {}
        for v in bm2.verts:
            vs[v.index] = self.bm.verts.new(m @ v.co)
        for f in bm2.faces:
            self.face([vs[v.index] for v in f.verts], slot, rough)
        bm2.free()

    def strap(self, p0, p1, w, t, slot):
        """Thin box from p0 to p1 (width w across, thickness t along z-ish)."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        up = d.normalized()
        side = up.cross(Vector((0, 0, 1))).normalized()
        nrm = side.cross(up).normalized()
        m = Matrix((side.to_4d(), up.to_4d(), nrm.to_4d(), (0, 0, 0, 1))).transposed()
        m.col[3] = ((p0 + p1) / 2).to_4d()
        bm2 = bmesh.new()
        bmesh.ops.create_cube(bm2, size=1.0)
        sc = Matrix.Diagonal((w, d.length, t, 1))
        vs = {v.index: self.bm.verts.new(m @ sc @ v.co) for v in bm2.verts}
        for f in bm2.faces:
            self.face([vs[v.index] for v in f.verts], slot)
        bm2.free()

    def surface(self, grid, slot, rough=0.0):
        """Quad grid (rows of Vectors) -> faces; one-sided, normal by winding."""
        rows = [[self.bm.verts.new(p) for p in row] for row in grid]
        for a, b in zip(rows, rows[1:]):
            for i in range(len(a) - 1):
                self.face((a[i], a[i + 1], b[i + 1], b[i]), slot, rough)

    # -- finish --------------------------------------------------------------
    def to_object(self) -> bpy.types.Object:
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        me = bpy.data.meshes.new(self.name)
        # app space -> Blender space (C), mesh stays joint-local; the object sits at the joint
        bmesh.ops.transform(bm, matrix=lib.C, verts=bm.verts)
        bm.to_mesh(me)
        bm.free()
        for poly in me.polygons:
            poly.use_smooth = True
        me.set_sharp_from_angle(angle=math.radians(50))
        me.materials.append(lib.material("vcol"))
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.matrix_world = lib.C @ Matrix.Translation(Vector(JOINTS[self.joint])) @ lib.C.inverted()
        ob["joint"] = self.joint
        return ob


# ---------------------------------------------------------------------------
# body parts (authored joint-local)
# ---------------------------------------------------------------------------


def jl(joint, y):
    """World height -> joint-local y."""
    return y - JOINTS[joint][1]


TORSO_SECS = [  # world y, rx, rz, zc, p
    (0.952, 0.158, 0.106, 0.002, 2.4),
    (1.000, 0.153, 0.101, 0.004, 2.4),
    (1.080, 0.146, 0.098, 0.010, 2.4),
    (1.180, 0.157, 0.104, 0.016, 2.4),
    (1.270, 0.171, 0.110, 0.016, 2.5),
    (1.340, 0.180, 0.106, 0.008, 2.8),
    (1.388, 0.192, 0.098, -0.004, 3.2),
    (1.425, 0.172, 0.084, -0.010, 2.8),
    (1.452, 0.118, 0.068, -0.010, 2.3),
    (1.474, 0.064, 0.054, -0.008, 2.0),
]


def torso_front_z(y, secs=TORSO_SECS):
    for a, b in zip(secs, secs[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return a[3] + a[2] + t * ((b[3] + b[2]) - (a[3] + a[2]))
    return secs[-1][3] + secs[-1][2]


def torso_part(name, *, grow=0.0, bust=0.0, hem=0.952, band=None, neck_skin=False, collar=None, buttons=0,
               zipper=False, badge=False, stripes=()):
    """Shirt-type torso. band: (y0, y1, slot) colour bands; collar: 'polo' | 'shirt' | 'stand' | 'crew'."""
    p = Part(name, "torso")
    secs = []
    for y, rx, rz, zc, pp in TORSO_SECS:
        if y == 0.952:
            y = hem
        g = grow * (1.0 if y < 1.44 else 0.4)
        b = bust * max(0.0, 1 - abs(y - 1.29) / 0.07)
        secs.append([y, rx + g, rz + g + b, zc + b * 0.6, pp])
    # insert extra rings at colour-band edges so slots stay crisp
    cuts = sorted({e for s in stripes for e in s[:2]} | ({1.435} if neck_skin else set()))
    for c in cuts:
        for a, b in zip(secs, secs[1:]):
            if a[0] < c < b[0]:
                t = (c - a[0]) / (b[0] - a[0])
                secs.insert(secs.index(b), [c] + [a[i] + t * (b[i] - a[i]) for i in range(1, 5)])
                break

    def slot(bi):
        y0, y1 = secs[bi][0], secs[bi + 1][0]
        ym = (y0 + y1) / 2
        for s0, s1, sl in stripes:
            if s0 <= ym <= s1:
                return sl
        if neck_skin and ym > 1.435:
            return SKIN
        if collar == "crew" and ym > 1.458:
            return TOP_DARK
        return TOP

    local = [(jl("torso", s[0]), s[1], s[2], s[3], s[4]) for s in secs]
    p.loft(local, slot, n=14)
    neck_y = jl("torso", 1.47)
    if collar in ("polo", "shirt"):
        trim = YELLOW if collar == "polo" else TOP
        # folded collar: a thick ring around the neck, flaring onto the shoulders
        p.loft([(neck_y - 0.03, 0.112, 0.084, -0.012), (neck_y - 0.008, 0.088, 0.070, -0.010),
                (neck_y + 0.012, 0.070, 0.060, -0.010), (neck_y + 0.008, 0.062, 0.054, -0.010),
                (neck_y - 0.02, 0.060, 0.052, -0.008)], [TOP, trim, trim, TOP], n=14, cap0=False, cap1=False)
        # placket
        for k in range(buttons):
            y = 1.43 - k * (0.05 if collar == "polo" else 0.085)
            p.box((0, jl("torso", y), torso_front_z(y) + 0.002 + bust * 0.6), (0.012, 0.012, 0.006), WHITE)
    elif collar == "stand":
        p.loft([(neck_y - 0.02, 0.085 + grow * 0.4, 0.074 + grow * 0.4, -0.01), (neck_y + 0.045, 0.074, 0.066, -0.008),
                (neck_y + 0.05, 0.066, 0.058, -0.008), (neck_y - 0.01, 0.062, 0.052, -0.008)],
               [TOP, TOP_DARK, TOP], n=14, cap0=False, cap1=False)
    if zipper:
        for y0 in (0.97, 1.13, 1.29):
            y1 = min(y0 + 0.16, 1.47)
            ym = (y0 + y1) / 2
            p.box((0, jl("torso", ym), torso_front_z(ym) + grow + 0.002), (0.008, y1 - y0, 0.006), DARK)
    if badge:
        y = 1.31
        p.box((-0.085, jl("torso", y), torso_front_z(y) - 0.012), (0.06, 0.022, 0.006), WHITE, r=(0, 0.35, 0))
    return p


def pelvis_part(name, skirt=False):
    p = Part(name, "pelvis")
    if not skirt:
        secs = [(1.03, 0.148, 0.096, 0.004), (0.975, 0.152, 0.099, 0.004), (0.92, 0.160, 0.104, 0.006),
                (0.875, 0.156, 0.100, 0.004), (0.845, 0.128, 0.086, 0.0)]
        p.loft([(jl("pelvis", y), rx, rz, zc) for y, rx, rz, zc in secs], BOTTOM, n=12, p=2.3)
        # belt just under the shirt hem (visible when a top is tucked/short)
        p.loft([(jl("pelvis", 0.962), 0.1545, 0.1012, 0.004), (jl("pelvis", 0.94), 0.157, 0.1025, 0.005)], DARK, n=12, p=2.3,
               cap0=False, cap1=False)
    else:
        secs = [(1.03, 0.148, 0.096, 0.004), (0.975, 0.153, 0.100, 0.004), (0.90, 0.176, 0.118, 0.008),
                (0.76, 0.198, 0.134, 0.012), (0.63, 0.214, 0.146, 0.014), (0.615, 0.205, 0.138, 0.014)]
        p.loft([(jl("pelvis", y), rx, rz, zc) for y, rx, rz, zc in secs], BOTTOM, n=14, p=2.2)
    return p


def thigh_part():
    p = Part("thigh", "hip")
    p.loft([(0.05, 0.068, 0.07, 0.0), (0.0, 0.085, 0.088, 0.004), (-0.10, 0.082, 0.086, 0.012), (-0.22, 0.072, 0.076, 0.010),
            (-0.33, 0.061, 0.064, 0.004), (-0.40, 0.055, 0.058, 0.0), (-0.44, 0.042, 0.046, 0.0)], BOTTOM, n=10)
    return p


def shin_part():
    p = Part("shin", "knee")
    p.loft([(0.035, 0.046, 0.05, 0.0), (-0.01, 0.056, 0.058, 0.002), (-0.12, 0.058, 0.062, -0.012), (-0.25, 0.048, 0.05, -0.006),
            (-0.36, 0.039, 0.041, 0.0), (-0.42, 0.036, 0.038, 0.0)], SHIN, n=8)
    return p


def foot_part():
    p = Part("foot", "ankle")
    g = -0.085  # ground, ankle-local

    def slot(c):
        return WHITE if c.y < g + 0.016 else SHOES

    p.loft_z([(-0.068, 0.036, g + 0.07, g), (-0.04, 0.045, g + 0.105, g), (0.0, 0.048, g + 0.10, g),
              (0.05, 0.050, g + 0.075, g), (0.11, 0.050, g + 0.058, g), (0.16, 0.044, g + 0.048, g),
              (0.19, 0.030, g + 0.038, g + 0.002)], slot, n=8)
    return p


def upper_arm_part():
    p = Part("upper_arm", "shoulder")
    secs = [(0.045, 0.026, 0.03, 0.0), (0.02, 0.046, 0.05, 0.0), (-0.04, 0.054, 0.055, 0.0), (-0.13, 0.053, 0.053, 0.002),
            (-0.136, 0.045, 0.046, 0.002), (-0.20, 0.044, 0.045, 0.0), (-0.285, 0.040, 0.042, 0.0), (-0.31, 0.032, 0.034, 0.0)]
    p.loft(secs, [TOP, TOP, TOP, TOP, FOREARM, FOREARM, FOREARM], n=8)
    return p


def forearm_part():
    p = Part("forearm", "elbow")
    p.loft([(0.028, 0.034, 0.036, 0.0), (0.0, 0.044, 0.044, 0.0), (-0.06, 0.045, 0.043, 0.004), (-0.17, 0.036, 0.034, 0.002),
            (-0.25, 0.029, 0.026, 0.0), (-0.268, 0.025, 0.021, 0.0)], FOREARM, n=8)
    return p


def hand_part():
    p = Part("hand", "wrist")
    # palm faces the thigh (x), thumb points forward (+z): symmetric, so one mesh serves both hands
    p.loft([(0.012, 0.022, 0.026, 0.0), (-0.02, 0.022, 0.036, 0.002), (-0.07, 0.025, 0.046, 0.004), (-0.12, 0.021, 0.044, 0.002),
            (-0.162, 0.015, 0.032, 0.0), (-0.178, 0.008, 0.016, 0.0)], SKIN, n=6)
    p.loft([(-0.035, 0.012, 0.013, 0.03), (-0.07, 0.012, 0.012, 0.05), (-0.105, 0.009, 0.009, 0.06)], SKIN, n=6)
    return p


# ---------------------------------------------------------------------------
# head + head-wear
# ---------------------------------------------------------------------------

SKULL_C = (0.0, 0.176, 0.010)  # head-local
SKULL_R = (0.091, 0.116, 0.105)


def skull_deform(u: Vector) -> Vector:
    if u.y < 0:  # jaw tapers, chin forward
        k = 1 - 0.28 * (-u.y) ** 1.4
        u.x *= k
        if u.z > 0:
            u.z = u.z * (1 - 0.1 * (-u.y))
        else:
            u.z *= k
    if u.z < 0:
        u.z *= 1.08  # occiput
    if u.z > 0.7:
        u.z = 0.7 + (u.z - 0.7) * 0.6  # flatter face
    return u


def head_part():
    p = Part("head", "head")
    p.loft([(-0.03, 0.054, 0.051, 0.0), (0.04, 0.051, 0.049, 0.004), (0.09, 0.052, 0.052, 0.012)], SKIN, n=10, cap0=False, cap1=False)
    p.ellipsoid(SKULL_C, SKULL_R, SKIN, seg=14, rings=10, deform=skull_deform)
    cx, cy, cz = SKULL_C
    # ears
    for sx in (-1, 1):
        p.ellipsoid((sx * 0.091, cy - 0.005, cz - 0.012), (0.015, 0.03, 0.021), SKIN, seg=5, rings=3)
    # nose
    p.ellipsoid((0.0, cy - 0.02, cz + 0.099), (0.018, 0.024, 0.017), SKIN, seg=6, rings=3)
    # eyes, brows, mouth
    for sx in (-1, 1):
        p.ellipsoid((sx * 0.034, cy + 0.008, cz + 0.088), (0.013, 0.0095, 0.008), DARK, seg=6, rings=3, rough=0.15)
        p.box((sx * 0.035, cy + 0.032, cz + 0.087), (0.032, 0.007, 0.012), HAIR, r=(0.0, -sx * 0.25, sx * 0.08))
    p.box((0.0, cy - 0.056, cz + 0.083), (0.034, 0.008, 0.012), SKIN_DARK)
    return p


def hair_short():
    p = Part("hair_short", "head")

    def keep(u):
        # hairline: high at the forehead, lower over the ears and nape
        if u.z > 0.35:
            return u.y > 0.42
        if u.z > -0.2:
            return u.y > 0.12
        return u.y > -0.25

    r = tuple(x * 1.06 for x in SKULL_R)
    p.ellipsoid(SKULL_C, r, HAIR, seg=14, rings=10, keep=keep, deform=skull_deform)
    return p


def hair_afro():
    p = Part("hair_afro", "head")
    rnd = random.Random(3)
    bumps = [Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized() for _ in range(18)]

    def deform(u):
        k = 1 + 0.06 * max(u.dot(b) ** 12 for b in bumps)
        return u * k

    def keep(u):
        return not (u.z > 0.25 and u.y < 0.32) and u.y > -0.45

    p.ellipsoid((0.0, 0.206, -0.006), (0.13, 0.125, 0.132), HAIR, seg=14, rings=9, keep=keep, deform=deform)
    return p


def hair_bun():
    p = hair_short()
    p.name = "hair_bun"
    p.ellipsoid((0.0, 0.276, -0.076), (0.05, 0.046, 0.048), HAIR, seg=10, rings=6)
    return p


def headwrap():
    p = Part("headwrap", "head")

    def keep(u):
        if u.z > 0.3:
            return u.y > 0.38
        return u.y > -0.05

    r = tuple(x * 1.13 for x in SKULL_R)
    p.ellipsoid((SKULL_C[0], SKULL_C[1] + 0.012, SKULL_C[2] - 0.004), r, ACCENT, seg=14, rings=10, keep=keep, deform=skull_deform)
    # the knot: two fanned lobes on top (a typical Ghanaian duku tie)
    for sx in (-1, 1):
        p.ellipsoid((sx * 0.048, 0.318, 0.0), (0.062, 0.042, 0.052), ACCENT, seg=8, rings=5)
    p.ellipsoid((0.0, 0.306, 0.034), (0.042, 0.036, 0.042), ACCENT_DARK, seg=8, rings=5)
    return p


def cap():
    p = Part("cap", "head")
    c = (0.0, 0.226, -0.01)  # dome centre: its equator sits just above the brows
    r = (0.104, 0.088, 0.12)

    def keep(u):
        return u.y > -0.01

    p.ellipsoid(c, r, ACCENT, seg=14, rings=8, keep=keep)
    # sweatband: closes the dome edge
    p.loft([(c[1] - 0.012, r[0] * 0.99, r[2] * 0.99, c[2]), (c[1] + 0.001, r[0], r[2], c[2])], ACCENT_DARK, n=14, cap0=False, cap1=False)
    p.ellipsoid((0.0, c[1] + r[1], c[2]), (0.012, 0.007, 0.012), ACCENT, seg=6, rings=3)  # button
    # peak: curved, top ACCENT, underside darker
    z0 = c[2] + r[2] * 0.93
    grid_top, grid_bot = [], []
    for k in range(4):
        t = k / 3
        row_t, row_b = [], []
        for i in range(7):
            sx = -1 + 2 * i / 6
            x = sx * 0.088 * (1 - 0.3 * t)
            z = z0 - 0.03 * sx * sx * (1 - t) + 0.06 * t * (1 - 0.3 * sx * sx)
            y = c[1] - 0.004 - 0.002 * t - 0.01 * sx * sx
            row_t.append(Vector((x, y + 0.004, z)))
            row_b.append(Vector((x, y - 0.002, z)))
        grid_top.append(row_t)
        grid_bot.append(row_b)
    p.surface([list(reversed(r_)) for r_ in grid_top], ACCENT)
    p.surface(grid_bot, ACCENT_DARK)
    return p


def helmet():
    p = Part("helmet", "head")
    c = (0.0, 0.18, 0.006)
    r = (0.128, 0.14, 0.145)

    def keep(u):
        return u.y > -0.62

    def slot(u):
        if u.z > 0.45 and -0.12 < u.y < 0.42 and abs(u.x) < 0.8:
            return VISOR
        return HAIR  # rider palette puts the helmet colour in the hair slot

    p.ellipsoid(c, r, HAIR, seg=16, rings=10, keep=keep, slot_fn=slot, rough=0.0)
    # gloss: visor faces get a roughness override
    for f in p.bm.faces:
        lp = f.loops[0][p.col]
        if round(lp[0] * 15) == VISOR:
            for l in f.loops:
                l[p.col] = (VISOR / 15, 1.0, 0.08, 1.0)
        else:
            for l in f.loops:
                l[p.col] = (HAIR / 15, 1.0, 0.28, 1.0)
    # rim at the neck opening
    yb = c[1] - r[1] * 0.62
    p.loft([(yb + 0.004, r[0] * 0.80, r[2] * 0.80, c[2]), (yb - 0.012, r[0] * 0.74, r[2] * 0.74, c[2])], DARK, n=16, cap0=False, cap1=False)
    return p


# ---------------------------------------------------------------------------
# clothing extras
# ---------------------------------------------------------------------------


def apron_bib():
    """Black bib apron (torso part): front panel following the chest, with a neck strap."""
    p = Part("apron_bib", "torso")
    rows = []
    for y in (1.0, 1.08, 1.17, 1.25, 1.31):
        # torso section at y
        for a, b in zip(TORSO_SECS, TORSO_SECS[1:]):
            if a[0] <= y <= b[0]:
                t = (y - a[0]) / (b[0] - a[0])
                rx = a[1] + t * (b[1] - a[1])
                rz = a[2] + t * (b[2] - a[2])
                zc = a[3] + t * (b[3] - a[3])
                break
        half = 0.68 if y < 1.2 else 0.68 - (y - 1.2) * 2.6
        row = []
        for i in range(7):
            ang = math.pi / 2 + (-1 + 2 * i / 6) * half  # around the front (+z)
            ca, sa = math.cos(ang), math.sin(ang)
            x = (rx + 0.008) * math.copysign(abs(ca) ** (2 / 2.4), ca)
            z = zc + (rz + 0.008) * math.copysign(abs(sa) ** (2 / 2.4), sa)
            row.append(Vector((-x, jl("torso", y), z)))
        rows.append(row)
    p.surface(rows, ACCENT)
    p.surface([list(reversed(r_)) for r_ in rows], ACCENT_DARK)  # back face (seen from the side)
    for sx in (-1, 1):  # neck strap: bib corner -> round the back of the neck
        pts = [(sx * 0.062, 1.305), (sx * 0.068, 1.395), (sx * 0.074, 1.462)]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            p.strap((x0, jl("torso", y0), torso_front_z(y0) + 0.006), (x1, jl("torso", y1), torso_front_z(y1) + 0.004), 0.016, 0.005, ACCENT)
    return p


def apron_waist():
    """Waist half of the apron (pelvis part): front skirt panel to just above the knee."""
    p = Part("apron_waist", "pelvis")
    rows = []
    for y, rx, rz in ((1.0, 0.162, 0.110), (0.92, 0.172, 0.118), (0.80, 0.182, 0.126), (0.68, 0.19, 0.132), (0.60, 0.192, 0.134)):
        row = []
        for i in range(9):
            ang = math.pi / 2 + (-1 + 2 * i / 8) * 1.2
            row.append(Vector((-rx * math.cos(ang), jl("pelvis", y), 0.006 + rz * math.sin(ang))))
        rows.append(row)
    p.surface(rows[::-1], ACCENT)
    p.surface([list(reversed(r_)) for r_ in rows[::-1]], ACCENT_DARK)
    # waist band + pocket
    p.loft([(jl("pelvis", 1.005), 0.16, 0.108, 0.004), (jl("pelvis", 0.985), 0.163, 0.111, 0.004)], ACCENT, n=12, p=2.3,
           cap0=False, cap1=False)
    p.box((0.0, jl("pelvis", 0.84), 0.138), (0.2, 0.08, 0.008), ACCENT_DARK)
    return p


def delivery_box():
    """Insulated delivery backpack (torso part). Colour = accent; reflective band; straps."""
    p = Part("delivery_box", "torso")
    cy, cz = jl("torso", 1.24), -0.285
    w, h, d = 0.40, 0.42, 0.30
    # body: bevelled box via a z-loft of rounded-rect sections
    secs = []
    for z, k in ((cz - d / 2, 0.94), (cz - d / 2 + 0.012, 1.0), (cz + d / 2 - 0.012, 1.0), (cz + d / 2, 0.94)):
        secs.append((z, w / 2 * k, cy + h / 2 * k, cy - h / 2 * k))

    def slot(c):
        if abs(c.y - (cy + 0.07)) < 0.025:
            return WHITE
        if c.y > cy + h / 2 - 0.035:
            return ACCENT_DARK
        return ACCENT

    p.loft_z(secs, slot, n=16, p=6.0, cap_slot=ACCENT)
    # band across the back + straps over the shoulders
    for sx in (-1, 1):
        p.box((sx * 0.1, jl("torso", 1.43), -0.04), (0.04, 0.012, 0.2), DARK, r=(0.15, 0, 0))
        p.box((sx * 0.1, jl("torso", 1.30), 0.105), (0.04, 0.22, 0.012), DARK, r=(-0.12, 0, 0))
    return p


# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------

PARTS = {
    "head": head_part,
    "torso_polo": lambda: torso_part("torso_polo", collar="polo", buttons=2, badge=True),
    "torso_tee": lambda: torso_part("torso_tee", collar="crew"),
    "torso_shirt": lambda: torso_part("torso_shirt", collar="shirt", buttons=6, hem=0.93),
    "torso_blouse": lambda: torso_part("torso_blouse", bust=0.016, neck_skin=True),
    "torso_jacket": lambda: torso_part("torso_jacket", grow=0.016, collar="stand", zipper=True, hem=0.92,
                                       stripes=((1.205, 1.232, WHITE),)),
    "pelvis": lambda: pelvis_part("pelvis"),
    "pelvis_skirt": lambda: pelvis_part("pelvis_skirt", skirt=True),
    "upper_arm": upper_arm_part,
    "forearm": forearm_part,
    "hand": hand_part,
    "thigh": thigh_part,
    "shin": shin_part,
    "foot": foot_part,
    "hair_short": hair_short,
    "hair_afro": hair_afro,
    "hair_bun": hair_bun,
    "headwrap": headwrap,
    "cap": cap,
    "helmet": helmet,
    "apron_bib": apron_bib,
    "apron_waist": apron_waist,
    "delivery_box": delivery_box,
}

# parts that make up the AO occluder set (default outfit); L/R limbs are mirrored placements
BASE = ["head", "torso_tee", "pelvis", "upper_arm", "forearm", "hand", "thigh", "shin", "foot", "hair_short"]
PAIRED_JOINTS = {"hip", "knee", "ankle", "shoulder", "elbow", "wrist"}


def joint_matrix(joint, side=1):
    """Rest-pose placement (app space) of a part's joint frame. side=-1 mirrors to the right."""
    x, y, z = JOINTS[joint]
    m = Matrix.Translation(Vector((x * side, y, z)))
    if joint in ("shoulder", "elbow", "wrist"):
        sx, sy, sz = JOINTS["shoulder"]
        # arm splay about the shoulder
        sh = Matrix.Translation(Vector((sx * side, sy, sz))) @ Matrix.Rotation(ARM_SPLAY * side, 4, "Z") @ Matrix.Translation(-Vector((sx * side, sy, sz)))
        m = sh @ m
    return m


def app_mesh(ob):
    """(verts, polys) of a part object in joint-local app space."""
    inv = lib.C.inverted()
    vs = [inv @ v.co for v in ob.data.vertices]
    return vs, [list(p.vertices) for p in ob.data.polygons]


def bake_ao(objs: dict):
    """Ray-traced ambient occlusion in the rest pose, written to COLOR_0.G (mirror-averaged on limbs)."""
    occl_v, occl_f = [], []

    def add(ob, side):
        vs, ps = app_mesh(ob)
        m = joint_matrix(ob["joint"], side)
        off = len(occl_v)
        occl_v.extend(m @ v for v in vs)
        occl_f.extend([i + off for i in p] for p in ps)

    for n in BASE:
        ob = objs[n]
        for side in ((1, -1) if ob["joint"] in PAIRED_JOINTS else (1,)):
            add(ob, side)
    base_bvh = BVHTree.FromPolygons(occl_v, occl_f)
    rnd = random.Random(11)
    dirs = []
    while len(dirs) < 24:
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        if 0.1 < d.length <= 1:
            dirs.append(d.normalized())
    for name, ob in objs.items():
        vs, ps = app_mesh(ob)
        own = BVHTree.FromPolygons(vs, ps)  # self-occlusion in joint-local space
        me = ob.data
        me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
        inv3 = lib.C.inverted().to_3x3()
        normals = [(inv3 @ v.normal).normalized() for v in me.vertices]
        sides = (1, -1) if ob["joint"] in PAIRED_JOINTS else (1,)
        ao = []
        for i, v in enumerate(vs):
            nrm = normals[i]
            acc = 0.0
            for side in sides:
                m = joint_matrix(ob["joint"], side)
                wv = m @ v
                wn = (m.to_3x3() @ nrm).normalized()
                hit, tot = 0.0, 0
                for d in dirs:
                    if d.dot(nrm) < 0.05:
                        continue
                    tot += 1
                    loc, *_ = own.ray_cast(v + nrm * 0.002, d, 0.09)
                    wd = (m.to_3x3() @ d).normalized()
                    loc2 = None
                    if name in BASE or name.startswith(("torso", "pelvis")):
                        loc2, *_ = base_bvh.ray_cast(wv + wn * 0.004, wd, 0.12)
                    if loc is not None or loc2 is not None:
                        hit += 1
                occ = hit / max(1, tot)
                sky = 0.5 + 0.5 * max(-1.0, min(1.0, wn.y))  # downward faces see less sky
                acc += (1 - 0.55 * occ) * (0.84 + 0.16 * sky)
            ao.append(max(0.5, min(1.0, acc / len(sides))))
        col = me.color_attributes["Col"]
        for poly in me.polygons:
            for li in poly.loop_indices:
                c = col.data[li].color
                col.data[li].color = (c[0], ao[me.loops[li].vertex_index], c[2], 1.0)


def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


# ---------------------------------------------------------------------------
# QA render: decode slots with a demo palette and pose a line-up
# ---------------------------------------------------------------------------

FIXED = {DARK: "#141414", WHITE: "#f2f2ee", RED: "#EE1D25", YELLOW: "#FFD400", VISOR: "#1d2733"}


def shade(hexc, k):
    r, g, b, _ = lib.hex_rgba(hexc)
    return (r * k, g * k, b * k, 1)


def decode_material(name, pal):
    """pal: dict slot->hex for slots 0..7. Builds a constant ColorRamp lookup on COLOR_0.R."""
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(attr.outputs["Color"], sep.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    cols = []
    for s in range(16):
        if s < 8:
            c = lib.hex_rgba(pal[s])
        elif s in FIXED:
            c = lib.hex_rgba(FIXED[s])
        elif s == SKIN_DARK:
            c = shade(pal[SKIN], 0.62)
        elif s == TOP_DARK:
            c = shade(pal[TOP], 0.7)
        else:
            c = shade(pal[ACCENT], 0.72)
        cols.append(c)
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = cols[0]
    els[1].position = (1 - 0.5) / 15
    els[1].color = cols[1]
    for s in range(2, 16):
        e = els.new((s - 0.5) / 15)
        e.color = cols[s]
    nt.links.new(sep.outputs[0], ramp.inputs["Fac"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(ramp.outputs["Color"], mul.inputs[6])
    comb = nt.nodes.new("ShaderNodeCombineColor")
    nt.links.new(sep.outputs[1], comb.inputs[0])
    nt.links.new(sep.outputs[1], comb.inputs[1])
    nt.links.new(sep.outputs[1], comb.inputs[2])
    nt.links.new(comb.outputs[0], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.7
    return m


LINEUP = [
    # (label, parts, palette, pose)
    ("cook", ["head", "hair_short", "cap", "torso_polo", "apron_bib", "pelvis", "apron_waist"],
     {SKIN: "#5a3a26", TOP: "#d61a20", BOTTOM: "#1b1c1f", SHOES: "#1b1c1f", HAIR: "#141414", ACCENT: "#1b1c1f", FOREARM: "#5a3a26", SHIN: "#1b1c1f"}, "work"),
    ("supervisor", ["head", "hair_short", "cap", "torso_polo", "pelvis"],
     {SKIN: "#7d5236", TOP: "#1d1f24", BOTTOM: "#1b1c1f", SHOES: "#1b1c1f", HAIR: "#141414", ACCENT: "#FFD400", FOREARM: "#7d5236", SHIN: "#1b1c1f"}, "idle"),
    ("cashier", ["head", "hair_bun", "cap", "torso_polo", "pelvis"],
     {SKIN: "#6e4630", TOP: "#EE1D25", BOTTOM: "#1b1c1f", SHOES: "#1b1c1f", HAIR: "#141414", ACCENT: "#1b1c1f", FOREARM: "#6e4630", SHIN: "#1b1c1f"}, "carry"),
    ("customer-a", ["head", "hair_short", "torso_tee", "pelvis"],
     {SKIN: "#4a2e1f", TOP: "#2d6cdf", BOTTOM: "#2f4a7a", SHOES: "#e8e8e8", HAIR: "#141414", ACCENT: "#f28c28", FOREARM: "#4a2e1f", SHIN: "#2f4a7a"}, "walk"),
    ("customer-b", ["head", "headwrap", "torso_blouse", "pelvis_skirt"],
     {SKIN: "#3d261a", TOP: "#f2c94c", BOTTOM: "#1f9d73", SHOES: "#8a5a3c", HAIR: "#141414", ACCENT: "#d64f8b", FOREARM: "#3d261a", SHIN: "#3d261a"}, "walk2"),
    ("customer-c", ["head", "hair_afro", "torso_shirt", "pelvis"],
     {SKIN: "#8a5c3c", TOP: "#e8e8e8", BOTTOM: "#5a4632", SHOES: "#3b2a20", HAIR: "#1c1410", ACCENT: "#2d6cdf", FOREARM: "#e8e8e8", SHIN: "#5a4632"}, "sit"),
    ("rider", ["head", "helmet", "torso_jacket", "delivery_box", "pelvis"],
     {SKIN: "#5a3a26", TOP: "#1f9d55", BOTTOM: "#23262b", SHOES: "#1b1c1f", HAIR: "#1b1c1f", ACCENT: "#1f9d55", FOREARM: "#1f9d55", SHIN: "#23262b"}, "idle"),
]


def pose_angles(pose):
    """Joint rotations (three.js XYZ euler) for the QA poses; mirrors the app's poseAgent()."""
    a = {k: (0.0, 0.0, 0.0) for k in ("torso", "head", "hip", "knee", "shoulder", "elbow")}
    r = {"hipL": 0, "hipR": 0, "kneeL": 0, "kneeR": 0, "shL": 0, "shR": 0, "elL": -0.12, "elR": -0.12, "lean": 0.0, "drop": 0.0}
    if pose in ("walk", "walk2"):
        s = 0.9 if pose == "walk" else -0.8
        r.update(hipL=0.5 * s, hipR=-0.5 * s, kneeL=0.05, kneeR=0.55, shL=-0.45 * s, shR=0.45 * s, elL=-0.3, elR=-0.2)
    elif pose == "work":
        r.update(shL=-0.8, shR=-1.0, elL=-0.7, elR=-0.5, lean=0.12)
    elif pose == "carry":
        r.update(shL=-0.55, shR=-0.55, elL=-0.75, elR=-0.75)
    elif pose == "sit":
        r.update(hipL=-1.5, hipR=-1.5, kneeL=1.5, kneeR=1.5, shL=-0.6, shR=-0.6, elL=-0.7, elR=-0.7, drop=0.42)
    return r


def assemble(objs, parts, pal, pose, offset):
    """Duplicate the part objects into a posed character at `offset` (app x)."""
    mat = decode_material(f"pal-{offset}", pal)
    r = pose_angles(pose)
    root = Matrix.Translation(Vector((offset, 0, 0)))
    body = Matrix.Translation(Vector((0, -r["drop"], 0))) if r["drop"] else Matrix()

    def rot(x=0.0, z=0.0):
        return Euler((x, 0, z), "ZYX").to_matrix().to_4x4()

    def at(j, side=1):
        x, y, z = JOINTS[j]
        return Matrix.Translation(Vector((x * side, y, z)))

    def rel(child, parent, side=1):
        return Matrix.Translation(Vector(JOINTS[child]) * Vector((side, 1, 1)) - Vector(JOINTS[parent]) * Vector((side, 1, 1)))

    W = {}
    W["pelvis"] = root @ body @ at("pelvis")
    W["torso"] = W["pelvis"] @ rel("torso", "pelvis") @ rot(r["lean"])
    W["head"] = W["torso"] @ rel("head", "torso")
    for side, tag in ((1, "L"), (-1, "R")):
        W["hip" + tag] = W["pelvis"] @ rel("hip", "pelvis", side) @ rot(r["hip" + tag])
        W["knee" + tag] = W["hip" + tag] @ rel("knee", "hip", side) @ rot(r["knee" + tag])
        W["ankle" + tag] = W["knee" + tag] @ rel("ankle", "knee", side) @ rot(-r["hip" + tag] - r["knee" + tag] if pose == "sit" else 0)
        W["shoulder" + tag] = W["torso"] @ rel("shoulder", "torso", side) @ rot(r["sh" + tag], ARM_SPLAY * side)
        W["elbow" + tag] = W["shoulder" + tag] @ rel("elbow", "shoulder", side) @ rot(r["el" + tag])
        W["wrist" + tag] = W["elbow" + tag] @ rel("wrist", "elbow", side)
    names = parts + ["upper_arm", "forearm", "hand", "thigh", "shin", "foot"]
    for n in names:
        src = objs[n]
        j = src["joint"]
        for tag in (("L", "R") if j in PAIRED_JOINTS else ("",)):
            ob = src.copy()
            ob.data = src.data
            ob.hide_render = False
            ob.hide_viewport = False
            ob.material_slots[0].link = "OBJECT"
            ob.material_slots[0].material = mat
            bpy.context.scene.collection.objects.link(ob)
            ob.matrix_world = lib.C @ W[j + tag] @ lib.C.inverted()


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    render = "--no-render" not in argv
    lib.reset_scene()
    objs = {}
    for name, fn in PARTS.items():
        part = fn()
        part.name = name
        objs[name] = part.to_object()
        objs[name].name = name
        objs[name].data.name = name
    bake_ao(objs)
    tris = {n: tri_count(o) for n, o in objs.items()}
    raw = os.path.join(OUT, "raw", "characters", "people.glb")
    lib.export_glb(raw)
    base_person = sum(tris[n] for n in ("head", "torso_tee", "pelvis", "hair_short")) + 2 * sum(
        tris[n] for n in ("upper_arm", "forearm", "hand", "thigh", "shin", "foot"))
    print("[people] tris per part:", tris)
    print(f"[people] base person (tee, trousers, short hair) = {base_person} tris; all parts = {sum(tris.values())}")

    import json
    stats_path = os.path.join(OUT, "stats.json")
    stats = json.load(open(stats_path)) if os.path.exists(stats_path) else {}
    stats["people"] = {
        "kind": "characters",
        "label": "People (rigid-part rig)",
        "size": [0.6, 1.72, 0.4],
        "origin": "floor-centre",
        "triangles": sum(tris.values()),
        "budget": 6000,
        "bounds": {"min": [-0.3, 0.0, -0.45], "max": [0.3, 1.86, 0.3]},
        "roles": sorted(objs),
        "lod1": None,
        "extra": {
            "rig": {"joints": {k: list(v) for k, v in JOINTS.items()}, "armSplay": ARM_SPLAY,
                    "parts": {n: o["joint"] for n, o in objs.items()}},
            "partTriangles": tris,
            "personTriangles": base_person,
        },
    }
    lib.write_json(stats_path, stats)

    if render:
        # hide the rest-pose originals and build the posed line-up
        for o in list(objs.values()):
            o.hide_render = True
            o.hide_viewport = True
        spacing = 0.72
        for i, (_, parts, pal, pose) in enumerate(LINEUP):
            assemble(objs, parts, pal, pose, (i - (len(LINEUP) - 1) / 2) * spacing)
        for o in objs.values():
            bpy.data.objects.remove(o, do_unlink=True)
        render_lineup(os.path.join(RENDERS, "people.png"), len(LINEUP) * spacing)


def render_lineup(path, width):
    """Orthographic 3/4 front view of the posed line-up (render_preview frames it too loosely)."""
    lib.render_preview(path, "people", res=(1600, 640))  # sets up world, lights, floor, camera
    scene = bpy.context.scene
    cam = scene.camera
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = width * 1.02
    d = Vector((0.35, -1.0, 0.38)).normalized()  # Blender space: front (-y), a little right, above
    target = Vector((0.0, 0.0, 0.92))
    cam.location = target + d * 12
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x, scene.render.resolution_y = 1600, 640
    bpy.ops.render.render(write_still=True)
    if "--closeup" in sys.argv:  # QA only: heads of the first three characters
        cam.data.ortho_scale = 1.5
        target = Vector((-width / 2 + 0.75, 0.0, 1.45))
        cam.location = target + d * 12
        scene.render.filepath = os.path.join(OUT, "people-close.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
