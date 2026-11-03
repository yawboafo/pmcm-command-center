/**
 * Generates the three conceptual floor plan templates as JSON.
 * Usage: npx tsx scripts/generate-floorplans.ts [--svg <dir>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { modelA, modelB, modelC } from "../src/lib/floorplan/templates";
import { NavGrid } from "../src/lib/floorplan/nav";
import { planToSvg } from "../src/lib/floorplan/svg";

const outDir = join(__dirname, "..", "src", "data", "floorplans");
mkdirSync(outDir, { recursive: true });
const svgIdx = process.argv.indexOf("--svg");
const svgDir = svgIdx > 0 ? process.argv[svgIdx + 1] : null;

for (const [file, plan] of [["model-a", modelA()], ["model-b", modelB()], ["model-c", modelC()]] as const) {
  writeFileSync(join(outDir, `${file}.json`), JSON.stringify(plan, null, 1));
  const area = plan.dimensions.width * plan.dimensions.length;
  const grid = new NavGrid(plan);
  const unreachable = plan.workstations.filter((w) => !grid.findPath(plan.anchors.staffRest, w.standPoint)).map((w) => w.name);
  const custOk = !!grid.findPath(plan.anchors.outside, plan.anchors.queueHead) && !!grid.findPath(plan.anchors.queueHead, plan.anchors.pickup);
  const riderOk = !!grid.findPath([plan.anchors.riderDoor[0] - 3, plan.anchors.riderDoor[1]], plan.anchors.riderWait) || !!grid.findPath([plan.anchors.riderDoor[0], plan.anchors.riderDoor[1] - 3], plan.anchors.riderWait);
  console.log(`${file}: ${area} m², rooms ${plan.rooms.length}, walls ${plan.walls.length}, equipment ${plan.equipment.length}, furniture ${plan.furniture.length}, cams ${plan.cameras.length}, sensors ${plan.sensors.length}; customer path ${custOk}, rider path ${riderOk}, unreachable stations: ${unreachable.join(", ") || "none"}`);
  if (svgDir) writeFileSync(join(svgDir, `${file}.svg`), planToSvg(plan, { grid }));
}
