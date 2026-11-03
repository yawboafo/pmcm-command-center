# Scripted Blender → glTF asset pipeline

Builds the commercial-kitchen and front-of-house models for the digital twin as
optimised GLBs, from Python, reproducibly. No hand-edited `.blend` files are
involved. Every asset is regenerated from `build_assets.py`.

```
blender/
  lib.py            shared helpers: PBR material library, bevelled boxes, tubs, pipes,
                    lathe, booleans, role joining, export, decimate, QA render, catalogue parser
  build_assets.py   one builder function per equipment / furniture type (+ registry)
  build_people.py   rigid-part people: shared body + swappable parts, rig in the manifest, QA line-up
  build_props.py    food / packaging / hand-held props (one GLB each, <= 600 tris)
  postprocess.py    gltf-transform (meshopt), manifest.json, contact sheet  (system python3)
  out/              raw (un-optimised) GLBs + stats.json      (build artefacts, safe to delete)
  renders/          <type>.png QA renders + contact-sheet.png
public/models/
  equipment/<type>.glb (+ <type>.lod1.glb)   web-ready
  furniture/<type>.glb
  characters/people.glb
  props/<name>.glb
  manifest.json
```

## Running

Requirements: Blender 5.2 on `PATH`, Node (for `npx @gltf-transform/cli@4.5.1`), and
python3 with Pillow (only for the contact sheet).

```bash
# from web/
blender -b --factory-startup --python blender/build_assets.py            # everything (~15 s)
blender -b --factory-startup --python blender/build_assets.py -- --only fryer,fridge
blender -b --factory-startup --python blender/build_assets.py -- --no-render --no-lod
blender -b --factory-startup --python blender/build_people.py            # people (~3 s, renders people.png)
blender -b --factory-startup --python blender/build_people.py -- --closeup   # + out/people-close.png (heads)
blender -b --factory-startup --python blender/build_props.py             # all props (~5 s)
blender -b --factory-startup --python blender/build_props.py -- --only pizza,crate
python3 blender/postprocess.py                                           # optimise + manifest + sheet (~1 min)
python3 blender/postprocess.py --only fryer,fridge                       # re-optimise a subset (manifest is merged)
python3 blender/postprocess.py --no-optimize                             # copy raw GLBs (no meshopt decoder needed)
```

`stats.json` and `manifest.json` are merged across runs, so `--only` never drops other assets.
Sizes are **parsed from `src/lib/floorplan/catalog.ts`** at build time. If a catalogue
default size changes, rebuild and the models follow.

## The contract (what the app relies on)

| Rule | Detail |
|---|---|
| One GLB per type | `public/models/equipment/<type>.glb`, `public/models/furniture/<type>.glb` |
| Units / axes | metres, +Y up, front (operator side / customer side for counters) = +Z |
| Size | modelled at the catalogue default `size` `[w, h, d]`; scale by `e.size / manifest.size` (not by the bounding box, since some items have parts above `h`, e.g. hood duct, backsplashes, overshelves; see `bounds` in the manifest) |
| Origin | floor-centre of the footprint; for `elevated` types (hood, evaporators, menu board) the bottom-centre of the item itself |
| Node names | `BODY` (always), `STATUS` (single-material indicator the app recolours), plus optional `GLASS`, `SCREEN`, `LIGHT`, `LABEL`, `FOOD`, `STOCK`, `PROPS`, `DUCT` |
| Live anchors | moving parts drawn by `src/components/twin/live.tsx` sit at fixed relative heights: fryer oil at `0.82h` with wells at `x = ±0.24w, z = 0.03`; oven belts at `standH + k·(deckH+0.02) + 0.3·deckH`, with an open tunnel and front window so the glow box shows; make-line board top at `0.88h + 0.025`; hot-holding trays at `h·{0.33, 0.53, 0.73}`; rice wells at `x = {-0.33, 0, 0.33}·w`; dispatch shelves at `0.15 + i·(h-0.2)/3`; QC shelf top at `1.02`; counters' worktop at `h`. Builders mark these with `# LIVE:` comments |
| Budgets | ≤ 6k tris large equipment, ≤ 2k small (< 0.35 m³), ≤ 3k furniture; whole `public/models/equipment` ≤ 2.5 MB |

Node-level details that matter to the loader:

* A multi-material node (usually `BODY`) loads in three.js as a `Group` named `BODY`
  with one child `Mesh` per material. `STATUS` is always a single `Mesh`.
* **Meshopt + quantisation:** the final files use `EXT_meshopt_compression` and
  `KHR_mesh_quantization` (both *required*). Quantisation moves the dequantisation
  into each node's `position`/`scale`, so **never reset node transforms**. Recolour
  STATUS by swapping or tinting its material only. The loader needs
  `gltfLoader.setMeshoptDecoder(MeshoptDecoder)` from
  `three/examples/jsm/libs/meshopt_decoder.module.js`.
* `FOOD` / `STOCK` / `PROPS` use one material (`vcol`) with a `COLOR_0` vertex colour,
  so all dressing is one draw call. GLTFLoader turns on `vertexColors` automatically.
* `LABEL` (and the menu board's `SCREEN`) are UV-mapped quads (0..1) facing +Z, so
  the app can put its canvas `labelTexture` / `menuBoardTexture` on them.
* Glass is `alphaMode: BLEND` (no `KHR_materials_transmission`), which is cheap in three.js.
* Emissive parts use `KHR_materials_emissive_strength` where strength > 1.
* Material names match `M.*` in `src/components/twin/materials.ts` where possible
  (`steel`, `steelDark`, `brushed`, `black`, `red`, `woodLight`, ...), so the app may
  remap them to its shared materials if it wants the canvas brushed-steel texture.

## People contract (`characters/people.glb`)

* One node per part, named as in `PARTS` in `build_people.py`; each node's origin is its joint in
  the rest pose (`JOINTS`, metres, +x = the character's left). L/R limbs share one mesh, so limb
  meshes must stay symmetric about their own x = 0 plane. The manifest entry's `rig` carries
  `joints`, `armSplay` and `parts` (part → joint); the app builds its instancing offsets from it.
* `COLOR_0` is data, not colour: `.r` = palette slot / 15, `.g` = baked AO, `.b` = roughness
  override (0 = default). Slots: 0 skin, 1 top, 2 bottom, 3 shoes, 4 hair (helmet for riders),
  5 accent (cap / apron / head-wrap / delivery box), 6 forearm (sleeve or skin), 7 shin (trouser or
  skin), 8 dark, 9 white, 10 brand red, 11 brand yellow, 12 visor, 13–15 darker skin / top / accent.
  Keep the `S_*` slot constants and the shader in `src/components/twin/people.tsx` in sync when adding slots.
* A hand-made replacement must keep node names, joint origins and the slot encoding (or the app
  needs a different material path). Budget: ≤ 2.5k tris for a dressed person.

## Adding an asset

1. Make sure the type exists in `EQUIPMENT_CATALOG` / `FURNITURE_CATALOG`.
2. Write a builder in `build_assets.py`. It receives `a: Asset` with `a.w, a.h, a.d`
   and works in app space, like `equipment.tsx`:
   ```python
   def my_thing(a):
       w, h, d = a.w, a.h, a.d
       a.box((0, h / 2, 0), (w, h, d), "steel", bevel=0.01, seg=2)          # centred box
       a.box((0, 0, 0), (w, 0.1, d), "black", slab=True)                    # bottom-centred
       a.box(p, s, "steel", cuts=[(cut_p, cut_s)])                          # boolean cut-outs
       a.tub(p, s, wall, "steelDark")                                       # open pan / well
       a.cyl(p, r, h, "chrome", axis="x")  ;  a.pipe([...pts], r, "chrome") # tubes, handles
       a.box(p, s, "status", "STATUS", bevel=0)                             # recolourable light
       a.box(p, s, "", "STOCK", vcol="#c49a64")                             # vertex-coloured dressing
       if a.detail: ...                                                     # skipped on LOD1
   ```
3. Register it in `BUILDERS`, run `--only my-thing`, look at `blender/renders/my-thing.png`,
   iterate, then run `postprocess.py`.

Helpers keep LOD1 cheap automatically: `a.detail` is False, cylinder/sphere segments
are halved, and only chamfers ≥ 6 mm survive (single segment). If a LOD1 is still above
38 % of LOD0 it is collapse-decimated as a fallback (`Asset.decimate_to`). LOD1 is
produced for the 6 largest equipment types by catalogue volume.

## Replacing a scripted asset with a hand-made one (artist workflow)

The app only sees `public/models/<kind>/<type>.glb` + `manifest.json`, so an artist can
swap any single asset without touching the code:

1. Start from the scripted model: import `blender/out/raw/<kind>/<type>.glb` into Blender
   (it is un-compressed). It shows the exact size, origin and live-anchor positions to
   respect. Keep it on a hidden reference layer.
2. Model or sculpt, then UV and texture as needed. Keep the contract: metres, origin at
   floor-centre (or item-bottom-centre for elevated items), front facing Blender **-Y**
   (glTF +Z), size equal to the catalogue default, live anchors unchanged. Name the
   objects `BODY` and `STATUS` (+ optional roles above). `STATUS` must use a single
   material of its own.
3. Export glTF Binary with +Y up, *Apply Modifiers* on, Draco **off**, to
   `blender/hand/<kind>/<type>.glb` (and `<type>.lod1.glb` if you want a LOD).
   Save the `.blend` source next to it (`blender/hand/<kind>/<type>.blend`).
4. Run `python3 blender/postprocess.py --only <type>`. A file in `blender/hand/` always
   wins over the scripted build: it is meshopt-compressed, triangles and bytes are
   measured, and the manifest entry gets `"source": "hand"`. The scripted builder keeps
   running and its raw output stays in `out/raw/` as the reference and fallback. Delete
   the hand file to revert.
5. Check the result in `npx @gltf-transform/cli inspect public/models/<kind>/<type>.glb`
   and in the twin: the live layer (baskets, belt pizzas, bags) must still line up.
6. Image textures: keep to KTX2 or WebP, ≤ 1k for equipment, and watch the 2.5 MB folder
   budget. Run `npx @gltf-transform/cli inspect` on the result.
