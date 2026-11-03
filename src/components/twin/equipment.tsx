"use client";

import { memo, useMemo } from "react";
import * as THREE from "three";
import type { Equipment } from "@/lib/floorplan/types";
import { cachedBasic } from "./building";
import { M, labelTexture, menuBoardTexture } from "./materials";
import { Ball, Box, Cyl, G, Legs, Slab, seeded } from "./parts";

/**
 * Procedural equipment models in local space: origin at the footprint's
 * floor centre, width along x, depth along z, front facing +z.
 * Moving parts (pizzas on the conveyor, fryer baskets, steam, stock) are
 * drawn by the live layer so these stay static and cheap.
 */
export const EquipmentModel = memo(function EquipmentModel({ e }: { e: Equipment }) {
  const [w, h, d] = e.size;
  switch (e.type) {
    case "conveyor-oven":
      return <ConveyorOven w={w} h={h} d={d} />;
    case "deck-oven":
      return <DeckOven w={w} h={h} d={d} />;
    case "fryer":
      return <Fryer w={w} h={h} d={d} />;
    case "pizza-makeline":
      return <Makeline w={w} h={h} d={d} />;
    case "dough-table":
      return <DoughTable w={w} h={h} d={d} />;
    case "prep-table":
      return <PrepTable w={w} h={h} d={d} id={e.id} />;
    case "breading-station":
      return <Breading w={w} h={h} d={d} />;
    case "rice-stove":
      return <RiceStove w={w} h={h} d={d} />;
    case "rice-warmer":
      return <Warmer w={w} h={h} d={d} />;
    case "hot-holding":
      return <HotHolding w={w} h={h} d={d} />;
    case "packaging-table":
      return <PackagingTable w={w} h={h} d={d} id={e.id} />;
    case "qc-pass":
      return <QcPass w={w} h={h} d={d} />;
    case "dispatch-rack":
      return <DispatchRack w={w} h={h} d={d} />;
    case "fridge":
      return <Upright w={w} h={h} d={d} freezer={false} />;
    case "freezer":
      return <Upright w={w} h={h} d={d} freezer />;
    case "walk-in-cold":
    case "walk-in-freezer":
      return <Evaporator w={w} h={h} d={d} freezer={e.type === "walk-in-freezer"} />;
    case "shelving":
      return <Shelving w={w} h={h} d={d} id={e.id} />;
    case "sink":
      return <Sink w={w} h={h} d={d} />;
    case "handwash":
      return <Handwash w={w} h={h} d={d} />;
    case "dishwasher":
      return <Dishwasher w={w} h={h} d={d} />;
    case "hood":
      return <Hood w={w} h={h} d={d} />;
    case "pos-counter":
      return <PosCounter w={w} h={h} d={d} />;
    case "pickup-counter":
      return <PickupCounter w={w} h={h} d={d} />;
    case "menu-board":
      return <MenuBoard w={w} h={h} d={d} id={e.id} />;
    case "drinks-fridge":
      return <DrinksFridge w={w} h={h} d={d} />;
    case "desk":
      return <Desk w={w} h={h} d={d} />;
    case "lockers":
      return <Lockers w={w} h={h} d={d} />;
    case "toilet":
      return <Toilet w={w} h={h} d={d} />;
    case "waste-bins":
      return <WasteBins w={w} h={h} d={d} />;
    case "mop-sink":
      return <MopSink w={w} h={h} d={d} />;
    default:
      return <Slab p={[0, 0, 0]} s={[w, h, d]} m={M.steel()} />;
  }
});

type Dims = { w: number; h: number; d: number };

function ConveyorOven({ w, h, d }: Dims) {
  const bodyW = w * 0.62;
  const standH = h * 0.32;
  const deckH = (h - standH) / 2 - 0.02;
  return (
    <group>
      <Legs w={bodyW} d={d * 0.9} h={standH} m={M.black()} t={0.05} />
      <Box p={[0, standH * 0.35, 0]} s={[bodyW * 0.95, 0.03, d * 0.85]} m={M.steelDark()} />
      {[0, 1].map((k) => {
        const y = standH + k * (deckH + 0.02);
        return (
          <group key={k}>
            <Slab p={[0, y, -0.03]} s={[bodyW, deckH, d * 0.9]} m={M.steel()} />
            {/* oven mouth on both ends */}
            <Box p={[-bodyW / 2 - 0.001, y + deckH * 0.42, 0.06]} s={[0.01, deckH * 0.3, d * 0.62]} m={M.blackGloss()} />
            <Box p={[bodyW / 2 + 0.001, y + deckH * 0.42, 0.06]} s={[0.01, deckH * 0.3, d * 0.62]} m={M.blackGloss()} />
            {/* conveyor belt running through, extending both sides */}
            <Box p={[0, y + deckH * 0.3, 0.06]} s={[w, 0.025, d * 0.6]} m={M.steelDark()} shadow={false} />
            {/* window strip + control panel */}
            <Box p={[0, y + deckH * 0.55, d * 0.42 + 0.002]} s={[bodyW * 0.6, deckH * 0.18, 0.01]} m={M.blackGloss()} />
            <Box p={[bodyW * 0.38, y + deckH * 0.5, d * 0.42 + 0.004]} s={[bodyW * 0.18, deckH * 0.5, 0.012]} m={M.black()} />
            <Box p={[bodyW * 0.38, y + deckH * 0.62, d * 0.42 + 0.012]} s={[bodyW * 0.12, deckH * 0.12, 0.005]} m={M.emissive("#ff5a2a", 1.2)} />
          </group>
        );
      })}
      {/* catch trays at both conveyor ends */}
      {[-1, 1].map((sx) => (
        <Box key={sx} p={[sx * (w / 2 - 0.12), standH + deckH * 0.22, 0.06]} s={[0.22, 0.03, d * 0.62]} m={M.steel()} />
      ))}
    </group>
  );
}

function DeckOven({ w, h, d }: Dims) {
  const standH = 0.5;
  const deck = (h - standH) / 2;
  return (
    <group>
      <Legs w={w} d={d} h={standH} m={M.black()} />
      {[0, 1].map((k) => (
        <group key={k} position={[0, standH + k * deck, 0]}>
          <Slab p={[0, 0, 0]} s={[w, deck - 0.02, d]} m={M.steel()} />
          <Box p={[0, deck * 0.45, d / 2 + 0.01]} s={[w * 0.8, deck * 0.5, 0.02]} m={M.steelDark()} />
          <Box p={[0, deck * 0.75, d / 2 + 0.04]} s={[w * 0.6, 0.03, 0.03]} m={M.black()} />
        </group>
      ))}
    </group>
  );
}

function Fryer({ w, h, d }: Dims) {
  const top = h * 0.82;
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, top, d]} m={M.steel()} />
      {/* front door seams & knobs */}
      <Box p={[0, top * 0.45, d / 2 + 0.002]} s={[0.006, top * 0.7, 0.004]} m={M.steelDark()} shadow={false} />
      {[-0.25, 0.25].map((x) => (
        <Cyl key={x} p={[x * w, top * 0.9, d / 2 + 0.02]} radius={0.025} h={0.03} m={M.black()} r={[Math.PI / 2, 0, 0]} low />
      ))}
      {/* two wells */}
      {[-0.24, 0.24].map((x) => (
        <group key={x}>
          <Box p={[x * w, top - 0.005, 0.03]} s={[w * 0.42, 0.012, d * 0.62]} m={M.oil()} shadow={false} />
          <Box p={[x * w, top + 0.01, 0.03 - d * 0.32]} s={[w * 0.44, 0.02, 0.02]} m={M.steelDark()} />
        </group>
      ))}
      {/* backsplash + flue + basket hangers */}
      <Slab p={[0, top, -d / 2 + 0.04]} s={[w, h - top, 0.08]} m={M.steel()} />
      <Slab p={[0, top, -d / 2 + 0.12]} s={[w * 0.9, 0.08, 0.08]} m={M.steelDark()} />
      <Box p={[0, h - 0.04, -d / 2 + 0.11]} s={[w * 0.9, 0.025, 0.06]} m={M.steelDark()} />
    </group>
  );
}

const PAN_COLORS = () => [M.sauce(), M.cheese(), M.pepper(), M.onion(), M.corn(), M.chicken(), M.plastic("#5b2a1a"), M.plastic("#d9a3a3")];

function Makeline({ w, h, d }: Dims) {
  const top = h * 0.88;
  const pans = PAN_COLORS();
  return (
    <group>
      <Slab p={[0, 0.08, 0]} s={[w, top - 0.08, d]} m={M.steel()} />
      <Legs w={w} d={d} h={0.08} m={M.black()} />
      {/* fridge doors */}
      {[-0.33, 0, 0.33].map((x) => (
        <group key={x}>
          <Box p={[x * w, top * 0.5, d / 2 + 0.006]} s={[w * 0.31, top * 0.7, 0.01]} m={M.brushed()} />
          <Box p={[x * w, top * 0.78, d / 2 + 0.025]} s={[w * 0.22, 0.02, 0.02]} m={M.black()} />
        </group>
      ))}
      {/* cutting board work surface at the front */}
      <Box p={[0, top + 0.012, d * 0.18]} s={[w * 0.96, 0.025, d * 0.42]} m={M.whiteGloss()} />
      {/* raised refrigerated pan rail at the back */}
      <Slab p={[0, top, -d * 0.27]} s={[w, 0.1, d * 0.4]} m={M.steel()} />
      {pans.map((m, i) => (
        <Box key={i} p={[(-0.5 + (i + 0.5) / pans.length) * w * 0.92, top + 0.095, -d * 0.27]} s={[(w * 0.92) / pans.length - 0.02, 0.025, d * 0.3]} m={m} shadow={false} />
      ))}
      {/* sneeze guard */}
      <Box p={[0, top + 0.32, -d * 0.12]} s={[w * 0.96, 0.008, d * 0.32]} m={M.glass()} r={[0.35, 0, 0]} shadow={false} />
      {[-0.48, 0.48].map((x) => (
        <Box key={x} p={[x * w, top + 0.22, -d * 0.2]} s={[0.02, 0.24, 0.02]} m={M.steel()} />
      ))}
    </group>
  );
}

function TableBase({ w, h, d, top = M.steel() }: Dims & { top?: THREE.Material }) {
  return (
    <>
      <Legs w={w} d={d} h={h - 0.04} m={M.steel()} />
      <Box p={[0, 0.2, 0]} s={[w * 0.95, 0.02, d * 0.9]} m={M.brushed()} />
      <Box p={[0, h - 0.02, 0]} s={[w, 0.04, d]} m={top} />
    </>
  );
}

function DoughTable({ w, h, d }: Dims) {
  return (
    <group>
      <TableBase w={w} h={h} d={d} />
      {Array.from({ length: 10 }).map((_, i) => (
        <Ball key={i} p={[(-0.4 + (i % 5) * 0.2) * w * 0.9, h + 0.04, (i < 5 ? -0.15 : 0.12) * d]} radius={0.07} s={[1, 0.6, 1]} m={M.dough()} low />
      ))}
      <Box p={[0, 0.24, 0]} s={[w * 0.7, 0.06, d * 0.6]} m={M.plastic("#e0e0e0")} />
    </group>
  );
}

function PrepTable({ w, h, d, id }: Dims & { id: string }) {
  const r = useMemo(() => seeded(id), [id]);
  return (
    <group>
      <TableBase w={w} h={h} d={d} />
      <Box p={[-w * 0.2, h + 0.01, 0.05]} s={[w * 0.35, 0.02, d * 0.55]} m={M.plastic("#f1f1f1")} />
      <Box p={[w * 0.25, h + 0.05, -0.1]} s={[0.32, 0.08, 0.22]} m={M.plastic(r() > 0.5 ? "#3c7dd9" : "#e8e8e8")} />
      <Cyl p={[w * 0.38, h + 0.06, 0.12]} radius={0.06} h={0.12} m={M.steel()} low />
    </group>
  );
}

function Breading({ w, h, d }: Dims) {
  return (
    <group>
      <TableBase w={w} h={h} d={d} />
      {[-0.3, 0, 0.3].map((x, i) => (
        <group key={x}>
          <Box p={[x * w, h + 0.05, 0]} s={[w * 0.27, 0.1, d * 0.6]} m={M.steel()} />
          <Box p={[x * w, h + 0.095, 0]} s={[w * 0.25, 0.01, d * 0.55]} m={i === 1 ? M.white() : i === 0 ? M.plastic("#c96f4a") : M.plastic("#e7d9b0")} shadow={false} />
        </group>
      ))}
      <Box p={[0, h + 0.003, d * 0.45]} s={[w, 0.006, 0.02]} m={M.plastic("#d8141c")} shadow={false} />
    </group>
  );
}

function RiceStove({ w, h, d }: Dims) {
  const top = h * 0.5;
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, top, d]} m={M.steelDark()} />
      <Box p={[0, top * 0.5, d / 2 + 0.003]} s={[w * 0.9, top * 0.6, 0.005]} m={M.black()} />
      {[-0.25, 0.25].map((x) => (
        <group key={x}>
          <mesh geometry={G.torus} material={M.black()} position={[x * w, top + 0.01, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.5, 0.5, 0.5]} />
          <Cyl p={[x * w, top + 0.22, 0]} radius={Math.min(0.34, d * 0.42)} h={0.42} m={M.steel()} />
          <Cyl p={[x * w, top + 0.45, 0]} radius={Math.min(0.35, d * 0.43)} h={0.03} m={M.brushed()} />
          <Ball p={[x * w, top + 0.49, 0]} radius={0.03} m={M.black()} low />
        </group>
      ))}
    </group>
  );
}

function Warmer({ w, h, d }: Dims) {
  const top = h * 0.82;
  const fills = [M.rice(), M.friedRice(), M.plastic("#e3a33b")];
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, top, d]} m={M.steel()} />
      {fills.map((m, i) => (
        <group key={i}>
          <Box p={[(-0.33 + i * 0.33) * w, top - 0.01, 0]} s={[w * 0.3, 0.02, d * 0.8]} m={M.steelDark()} />
          <Box p={[(-0.33 + i * 0.33) * w, top + 0.008, 0]} s={[w * 0.27, 0.025, d * 0.7]} m={m} shadow={false} />
        </group>
      ))}
      <Box p={[0, h + 0.18, -d * 0.05]} s={[w * 0.98, 0.008, d * 0.6]} m={M.glass()} r={[0.3, 0, 0]} shadow={false} />
      <Box p={[0, h + 0.36, -d * 0.2]} s={[w * 0.9, 0.05, 0.1]} m={M.steel()} />
      <Box p={[0, h + 0.33, -d * 0.2]} s={[w * 0.8, 0.012, 0.06]} m={M.heatLamp()} shadow={false} />
    </group>
  );
}

function HotHolding({ w, h, d }: Dims) {
  return (
    <group>
      <Legs w={w} d={d} h={0.12} m={M.black()} />
      <Slab p={[0, 0.12, 0]} s={[w, h - 0.12, d]} m={M.steel()} />
      <Box p={[0, h * 0.55, d / 2 + 0.005]} s={[w * 0.86, h * 0.72, 0.01]} m={M.fridgeGlass()} shadow={false} />
      <Box p={[0, h * 0.55, d / 2 - 0.02]} s={[w * 0.84, h * 0.7, 0.01]} m={M.emissive("#ffb347", 0.35)} shadow={false} />
      {[0.32, 0.52, 0.72].map((y) => (
        <Box key={y} p={[0, h * y, 0]} s={[w * 0.84, 0.015, d * 0.8]} m={M.steelDark()} shadow={false} />
      ))}
      <Box p={[0, h - 0.04, d / 2 + 0.01]} s={[w * 0.3, 0.04, 0.01]} m={M.emissive("#ff5a2a", 1)} shadow={false} />
    </group>
  );
}

function PackagingTable({ w, h, d, id }: Dims & { id: string }) {
  const r = useMemo(() => seeded(id), [id]);
  const stacks = useMemo(() => [0.6 + r() * 0.4, 0.4 + r() * 0.5], [r]);
  return (
    <group>
      <TableBase w={w} h={h} d={d} />
      {/* pizza box stacks on the back edge */}
      {stacks.map((k, i) => (
        <group key={i} position={[(-0.32 + i * 0.2) * w, h, -d * 0.25]}>
          <Slab p={[0, 0, 0]} s={[0.36, 0.3 * k, 0.36]} m={M.boxWhite()} />
          <Box p={[0, 0.3 * k + 0.001, 0]} s={[0.3, 0.002, 0.08]} m={M.red()} shadow={false} />
        </group>
      ))}
      {/* stacked chicken buckets */}
      <Cyl p={[w * 0.32, h + 0.14, -d * 0.2]} radius={0.11} h={0.28} m={M.red()} />
      <Box p={[w * 0.15, h + 0.002, d * 0.1]} s={[0.25, 0.004, 0.18]} m={M.plastic("#fff3c4")} shadow={false} />
      {/* label printer */}
      <Slab p={[w * 0.42, h, d * 0.15]} s={[0.12, 0.1, 0.16]} m={M.black()} />
    </group>
  );
}

function QcPass({ w, h, d }: Dims) {
  const shelf = 1.0;
  return (
    <group>
      <Legs w={w} d={d} h={shelf} m={M.steel()} />
      <Box p={[0, shelf, 0]} s={[w, 0.04, d]} m={M.steel()} />
      <Box p={[0, 0.25, 0]} s={[w * 0.95, 0.02, d * 0.9]} m={M.brushed()} />
      {/* heat lamp gantry */}
      {[-0.48, 0.48].map((x) => (
        <Box key={x} p={[x * w, shelf + (h - shelf) / 2, -d * 0.4]} s={[0.04, h - shelf, 0.04]} m={M.steel()} />
      ))}
      <Box p={[0, h - 0.03, -d * 0.1]} s={[w, 0.06, d * 0.7]} m={M.steel()} />
      {[-0.3, 0, 0.3].map((x) => (
        <Box key={x} p={[x * w, h - 0.065, -d * 0.1]} s={[w * 0.22, 0.015, d * 0.4]} m={M.heatLamp()} shadow={false} />
      ))}
      {/* ticket rail */}
      <Box p={[0, h - 0.1, d * 0.27]} s={[w * 0.9, 0.025, 0.015]} m={M.steelDark()} />
      {[-0.3, -0.1, 0.15].map((x) => (
        <Box key={x} p={[x * w, h - 0.17, d * 0.275]} s={[0.07, 0.12, 0.002]} m={M.white()} shadow={false} />
      ))}
      {/* a probe thermometer */}
      <Box p={[w * 0.35, shelf + 0.03, d * 0.2]} s={[0.05, 0.02, 0.12]} m={M.plastic("#e8e8e8")} />
    </group>
  );
}

function DispatchRack({ w, h, d }: Dims) {
  const shelves = 4;
  return (
    <group>
      {[-0.5, 0.5].flatMap((x) => [-0.5, 0.5].map((z) => <Box key={`${x}${z}`} p={[x * (w - 0.03), h / 2, z * (d - 0.03)]} s={[0.03, h, 0.03]} m={M.black()} />))}
      {Array.from({ length: shelves }).map((_, i) => (
        <Box key={i} p={[0, 0.15 + i * ((h - 0.2) / (shelves - 1)), 0]} s={[w, 0.025, d]} m={M.steel()} />
      ))}
      <Box p={[0, h - 0.04, 0]} s={[w, 0.08, d]} m={M.red()} />
      <mesh position={[0, h - 0.04, d / 2 + 0.002]} scale={[w * 0.8, 0.07, 1]} geometry={G.plane} material={cachedBasic("dispatch", () => labelTexture("DISPATCH", "#EE1D25"), { transparent: false })} />
    </group>
  );
}

function Upright({ w, h, d, freezer }: Dims & { freezer: boolean }) {
  const body = freezer ? M.frost() : M.steel();
  return (
    <group>
      <Slab p={[0, 0.06, -0.02]} s={[w, h - 0.06, d - 0.04]} m={body} />
      <Legs w={w} d={d - 0.1} h={0.06} m={M.black()} t={0.05} />
      {/* door with seal and handle */}
      <Box p={[0, 0.08 + (h - 0.36) / 2, d / 2 - 0.02]} s={[w - 0.03, h - 0.38, 0.03]} m={body} />
      <Box p={[0, 0.08 + (h - 0.36) / 2, d / 2 - 0.036]} s={[w - 0.01, h - 0.36, 0.004]} m={M.rubber()} shadow={false} />
      <Box p={[w / 2 - 0.08, h * 0.5, d / 2 + 0.03]} s={[0.025, h * 0.45, 0.03]} m={M.steelDark()} />
      {/* top grille and display */}
      <Box p={[0, h - 0.13, d / 2 - 0.01]} s={[w - 0.04, 0.2, 0.02]} m={M.black()} />
      {Array.from({ length: 5 }).map((_, i) => (
        <Box key={i} p={[(-0.3 + i * 0.12) * w, h - 0.13, d / 2 + 0.001]} s={[0.02, 0.14, 0.004]} m={M.steelDark()} shadow={false} />
      ))}
      <Box p={[-w * 0.3, h - 0.12, d / 2 + 0.004]} s={[0.12, 0.05, 0.004]} m={M.emissive(freezer ? "#4fc3ff" : "#5dff8a", 1.2)} shadow={false} />
    </group>
  );
}

function Evaporator({ w, h, d, freezer }: Dims & { freezer: boolean }) {
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, h, d]} m={freezer ? M.frost() : M.white()} />
      {[-0.25, 0.25].map((x) => (
        <group key={x}>
          <mesh geometry={G.circle} material={M.black()} position={[x * w, h / 2, d / 2 + 0.003]} scale={h * 0.75} />
          <mesh geometry={G.torus} material={M.steelDark()} position={[x * w, h / 2, d / 2 + 0.006]} scale={h * 0.38} />
        </group>
      ))}
      <Box p={[0, h + 0.15, -d / 4]} s={[0.04, 0.3, 0.04]} m={M.steel()} />
    </group>
  );
}

function Shelving({ w, h, d, id }: Dims & { id: string }) {
  const r = useMemo(() => seeded(id), [id]);
  const tiers = 4;
  const items = useMemo(() => {
    const list: Array<{ x: number; y: number; s: [number, number, number]; m: THREE.Material; round?: boolean }> = [];
    const palette = [M.cardboard(), M.sack(), M.boxWhite(), M.plastic("#3c7dd9"), M.plastic("#e8b923"), M.red(), M.plastic("#d9d2c5")];
    for (let t = 0; t < tiers; t++) {
      let x = -w / 2 + 0.05;
      while (x < w / 2 - 0.15) {
        const bw = 0.15 + r() * 0.25;
        if (x + bw > w / 2 - 0.03) break;
        if (r() > 0.18) {
          const bh = 0.12 + r() * 0.22;
          const m = palette[Math.floor(r() * palette.length)];
          list.push({ x: x + bw / 2, y: 0.12 + t * ((h - 0.2) / (tiers - 1)) + 0.02, s: [bw - 0.02, bh, d * (0.6 + r() * 0.3)], m, round: m === M.sack() });
        }
        x += bw;
      }
    }
    return list;
  }, [r, w, h, d]);
  return (
    <group>
      {[-0.5, 0.5].flatMap((x) => [-0.5, 0.5].map((z) => <Box key={`${x}${z}`} p={[x * (w - 0.03), h / 2, z * (d - 0.03)]} s={[0.03, h, 0.03]} m={M.steelDark()} />))}
      {Array.from({ length: tiers }).map((_, i) => (
        <Box key={i} p={[0, 0.12 + i * ((h - 0.2) / (tiers - 1)), 0]} s={[w, 0.02, d]} m={M.brushed()} />
      ))}
      {items.map((it, i) =>
        it.round ? (
          <Ball key={i} p={[it.x, it.y + it.s[1] / 2, 0]} radius={it.s[0] / 2} s={[1, (it.s[1] / it.s[0]) * 1.2, (it.s[2] / it.s[0]) * 0.9]} m={it.m} low />
        ) : (
          <Slab key={i} p={[it.x, it.y, 0]} s={it.s} m={it.m} />
        ),
      )}
    </group>
  );
}

function Sink({ w, h, d }: Dims) {
  const n = w > 1 ? 3 : 2;
  return (
    <group>
      <Legs w={w} d={d} h={h - 0.2} m={M.steel()} />
      <Slab p={[0, h - 0.25, 0]} s={[w, 0.25, d]} m={M.steel()} />
      {Array.from({ length: n }).map((_, i) => (
        <Box key={i} p={[(-0.5 + (i + 0.5) / n) * w, h + 0.001, 0.03]} s={[w / n - 0.06, 0.004, d * 0.7]} m={M.steelDark()} shadow={false} />
      ))}
      <Slab p={[0, h, -d / 2 + 0.03]} s={[w, 0.25, 0.04]} m={M.steel()} />
      {Array.from({ length: n }).map((_, i) => (
        <group key={i} position={[(-0.5 + (i + 0.5) / n) * w, h, -d / 2 + 0.08]}>
          <Cyl p={[0, 0.15, 0]} radius={0.015} h={0.3} m={M.steel()} low />
          <Cyl p={[0, 0.3, 0.07]} radius={0.012} h={0.15} m={M.steel()} r={[Math.PI / 2, 0, 0]} low />
        </group>
      ))}
    </group>
  );
}

function Handwash({ w, h, d }: Dims) {
  return (
    <group>
      <Slab p={[0, h - 0.22, 0]} s={[w, 0.22, d]} m={M.steel()} />
      <Box p={[0, h - 0.12, 0]} s={[0.04, 0.25, 0.04]} m={M.steel()} />
      <Box p={[0, h + 0.002, 0.02]} s={[w * 0.75, 0.004, d * 0.6]} m={M.steelDark()} shadow={false} />
      <Cyl p={[0, h + 0.1, -d / 2 + 0.06]} radius={0.015} h={0.2} m={M.steel()} low />
      {/* soap & towels above */}
      <Slab p={[-w * 0.3, h + 0.35, -d / 2 + 0.05]} s={[0.1, 0.18, 0.08]} m={M.white()} />
      <Slab p={[w * 0.2, h + 0.45, -d / 2 + 0.06]} s={[0.25, 0.3, 0.1]} m={M.white()} />
      <mesh position={[0, h + 0.85, -d / 2 + 0.01]} scale={[0.36, 0.09, 1]} geometry={G.plane} material={cachedBasic("washhands", () => labelTexture("WASH HANDS", "#1f7a4d"), { transparent: false })} />
    </group>
  );
}

function Dishwasher({ w, h, d }: Dims) {
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, h * 0.55, d]} m={M.steel()} />
      <Slab p={[0, h * 0.55, 0]} s={[w * 0.95, h * 0.45, d * 0.95]} m={M.brushed()} />
      <Box p={[0, h * 0.78, d / 2 + 0.02]} s={[w * 0.6, 0.03, 0.03]} m={M.black()} />
      <Box p={[w * 0.3, h * 0.45, d / 2 + 0.003]} s={[0.12, 0.06, 0.004]} m={M.emissive("#5dff8a", 0.8)} shadow={false} />
    </group>
  );
}

function Hood({ w, h, d }: Dims) {
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, h, d]} m={M.steel()} />
      {/* filters underneath */}
      {Array.from({ length: Math.max(2, Math.round(w / 0.5)) }).map((_, i, arr) => (
        <Box key={i} p={[(-0.5 + (i + 0.5) / arr.length) * w * 0.9, -0.001, -d * 0.1]} s={[(w * 0.9) / arr.length - 0.03, 0.004, d * 0.5]} m={M.steelDark()} shadow={false} />
      ))}
      <Box p={[0, 0.002 - 0.004, d * 0.3]} s={[w * 0.85, 0.006, 0.05]} m={M.emissive("#fff6e0", 1.4)} shadow={false} />
      {/* duct to ceiling */}
      <Slab p={[0, h, -d * 0.2]} s={[Math.min(0.5, w * 0.3), 1.2, 0.4]} m={M.brushed()} />
    </group>
  );
}

function PosCounter({ w, h, d }: Dims) {
  const terminals = Math.max(1, Math.round(w / 1.4));
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, h - 0.05, d]} m={M.white()} />
      {/* customer-facing red/white front */}
      <Box p={[0, (h - 0.05) * 0.42, d / 2 + 0.01]} s={[w, (h - 0.05) * 0.84, 0.02]} m={M.red()} />
      <Box p={[0, (h - 0.05) * 0.86, d / 2 + 0.012]} s={[w, 0.07, 0.02]} m={M.white()} />
      <Box p={[0, 0.04, d / 2 + 0.02]} s={[w, 0.08, 0.03]} m={M.black()} />
      <Box p={[0, h - 0.025, 0.02]} s={[w + 0.06, 0.05, d + 0.06]} m={M.woodLight()} />
      {Array.from({ length: terminals }).map((_, i) => {
        const x = (-0.5 + (i + 0.5) / terminals) * w;
        return (
          <group key={i} position={[x, h, -0.05]}>
            <Cyl p={[0, 0.06, 0]} radius={0.04} h={0.12} m={M.black()} low />
            <group position={[0, 0.2, 0]} rotation={[-0.35, 0, 0]}>
              <Box p={[0, 0, 0]} s={[0.36, 0.24, 0.03]} m={M.black()} />
              <Box p={[0, 0, -0.017]} s={[0.33, 0.21, 0.003]} m={M.screen()} shadow={false} />
            </group>
            {/* customer facing display */}
            <group position={[0, 0.16, 0.08]} rotation={[0.3, Math.PI, 0]}>
              <Box p={[0, 0, 0]} s={[0.18, 0.12, 0.02]} m={M.black()} />
              <Box p={[0, 0, -0.011]} s={[0.16, 0.1, 0.002]} m={M.emissive("#ff4b3a", 0.6)} shadow={false} />
            </group>
          </group>
        );
      })}
    </group>
  );
}

function PickupCounter({ w, h, d }: Dims) {
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, h - 0.05, d]} m={M.white()} />
      <Box p={[0, (h - 0.05) * 0.42, d / 2 + 0.01]} s={[w, (h - 0.05) * 0.84, 0.02]} m={M.plastic("#2b2d31")} />
      <mesh position={[0, (h - 0.05) * 0.55, d / 2 + 0.022]} scale={[w * 0.7, 0.16, 1]} geometry={G.plane} material={cachedBasic("collection", () => labelTexture("COLLECTION", "#2b2d31", "#FFD400"), { transparent: false })} />
      <Box p={[0, h - 0.025, 0]} s={[w + 0.06, 0.05, d + 0.06]} m={M.woodLight()} />
      <Box p={[w * 0.4, h + 0.15, -d * 0.3]} s={[0.25, 0.3, 0.02]} m={M.black()} />
      <Box p={[w * 0.4, h + 0.15, -d * 0.3 + 0.011]} s={[0.22, 0.26, 0.002]} m={M.emissive("#3fd17a", 0.7)} shadow={false} />
    </group>
  );
}

function MenuBoard({ w, h, d, id }: Dims & { id: string }) {
  const idx = useMemo(() => Math.floor(seeded(id)() * 4), [id]);
  const mat = cachedBasic(`menu:${idx}`, () => menuBoardTexture(idx), { transparent: false });
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w + 0.06, h + 0.06, d]} m={M.blackGloss()} />
      <mesh geometry={G.plane} material={mat} position={[0, h / 2, d / 2 + 0.002]} scale={[w, h, 1]} />
      {/* hangers */}
      {[-0.4, 0.4].map((x) => (
        <Box key={x} p={[x * w, h + 0.4, 0]} s={[0.015, 0.8, 0.015]} m={M.steelDark()} />
      ))}
    </group>
  );
}

function DrinksFridge({ w, h, d }: Dims) {
  const bottles = useMemo(() => {
    const out: Array<[number, number, number, string]> = [];
    const cols = ["#c0392b", "#f39c12", "#27ae60", "#2c3e50", "#8e44ad", "#e74c3c"];
    for (let s = 0; s < 4; s++) for (let i = 0; i < 6; i++) out.push([(-0.42 + i * 0.17) * w, 0.35 + s * 0.38, -0.05, cols[(i + s) % cols.length]]);
    return out;
  }, [w]);
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, h, d]} m={M.blackGloss()} />
      <Box p={[0, h * 0.5, d / 2 - 0.05]} s={[w - 0.08, h - 0.4, 0.02]} m={M.emissive("#e8f4ff", 0.45)} shadow={false} />
      {[0.2, 0.58, 0.96, 1.34].map((y) => (
        <Box key={y} p={[0, y + 0.08, 0]} s={[w - 0.1, 0.01, d - 0.12]} m={M.steelDark()} shadow={false} />
      ))}
      {bottles.map(([x, y, z, c], i) => (
        <Cyl key={i} p={[x, y + 0.1, z + d * 0.2]} radius={0.03} h={0.22} m={M.plastic(c)} low shadow={false} />
      ))}
      <Box p={[0, h * 0.48, d / 2 + 0.005]} s={[w - 0.06, h - 0.36, 0.01]} m={M.fridgeGlass()} shadow={false} />
      <Box p={[0, h - 0.12, d / 2 + 0.01]} s={[w, 0.22, 0.02]} m={M.red()} />
      <Box p={[w / 2 - 0.07, h * 0.5, d / 2 + 0.03]} s={[0.02, h * 0.4, 0.03]} m={M.steel()} />
    </group>
  );
}

function Desk({ w, h, d }: Dims) {
  return (
    <group>
      <Legs w={w} d={d} h={h - 0.03} m={M.black()} />
      <Box p={[0, h - 0.015, 0]} s={[w, 0.03, d]} m={M.woodLight()} />
      <Box p={[0, h + 0.26, -d * 0.25]} s={[0.55, 0.33, 0.03]} m={M.black()} />
      <Box p={[0, h + 0.26, -d * 0.25 + 0.016]} s={[0.51, 0.29, 0.002]} m={M.screen()} shadow={false} />
      <Box p={[0, h + 0.05, -d * 0.25]} s={[0.05, 0.1, 0.05]} m={M.black()} />
      <Box p={[0, h + 0.008, d * 0.1]} s={[0.4, 0.015, 0.13]} m={M.black()} />
      {/* chair */}
      <group position={[0, 0, d * 0.75]}>
        <Cyl p={[0, 0.23, 0]} radius={0.03} h={0.45} m={M.black()} low />
        <Box p={[0, 0.47, 0]} s={[0.46, 0.06, 0.44]} m={M.black()} />
        <Box p={[0, 0.78, 0.2]} s={[0.44, 0.55, 0.05]} m={M.black()} />
      </group>
    </group>
  );
}

function Lockers({ w, h, d }: Dims) {
  const n = Math.max(2, Math.round(w / 0.4));
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, h, d]} m={M.plastic("#6c7a89")} />
      {Array.from({ length: n }).map((_, i) => {
        const x = (-0.5 + (i + 0.5) / n) * w;
        return (
          <group key={i}>
            <Box p={[x, h / 2, d / 2 + 0.003]} s={[w / n - 0.02, h - 0.06, 0.006]} m={M.plastic("#7f8fa1")} shadow={false} />
            {[0.85, 0.82, 0.79].map((y) => (
              <Box key={y} p={[x, h * y, d / 2 + 0.008]} s={[w / n - 0.12, 0.012, 0.004]} m={M.plastic("#4b5663")} shadow={false} />
            ))}
            <Box p={[x + w / n / 2 - 0.05, h * 0.55, d / 2 + 0.012]} s={[0.02, 0.08, 0.01]} m={M.steel()} shadow={false} />
          </group>
        );
      })}
    </group>
  );
}

function Toilet({ w, d }: Dims) {
  return (
    <group>
      <Cyl p={[0, 0.2, 0.05]} radius={w * 0.45} h={0.4} m={M.whiteGloss()} />
      <Cyl p={[0, 0.41, 0.07]} radius={w * 0.5} h={0.03} m={M.whiteGloss()} />
      <Slab p={[0, 0.4, -d / 2 + 0.1]} s={[w * 0.95, 0.38, 0.18]} m={M.whiteGloss()} />
    </group>
  );
}

function WasteBins({ w, h, d }: Dims) {
  const cols = ["#2e8b57", "#1f6fb2", "#6b6f78", "#c0392b"];
  const n = Math.max(3, Math.round(w / 0.42));
  return (
    <group>
      {Array.from({ length: n }).map((_, i) => {
        const x = (-0.5 + (i + 0.5) / n) * w;
        return (
          <group key={i}>
            <Slab p={[x, 0, 0]} s={[w / n - 0.04, h * 0.85, d * 0.9]} m={M.plastic(cols[i % cols.length])} />
            <Slab p={[x, h * 0.85, -0.02]} s={[w / n - 0.02, 0.05, d * 0.95]} m={M.plastic(cols[i % cols.length])} r={[-0.12, 0, 0]} />
          </group>
        );
      })}
    </group>
  );
}

function MopSink({ w, h, d }: Dims) {
  return (
    <group>
      <Slab p={[0, 0, 0]} s={[w, h * 0.5, d]} m={M.steel()} />
      <Slab p={[w * 0.25, 0, d * 0.7]} s={[0.3, 0.3, 0.3]} m={M.yellow()} />
      <Box p={[w * 0.25, 0.75, d * 0.7]} s={[0.025, 1.0, 0.025]} m={M.woodLight()} r={[0.15, 0, 0]} />
    </group>
  );
}
