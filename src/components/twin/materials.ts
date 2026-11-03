import * as THREE from "three";

/**
 * Shared materials and procedural textures for the restaurant twin.
 * Everything is generated in-browser (no texture downloads) and cached
 * module-wide so every branch scene reuses the same GPU resources.
 */

const cache = new Map<string, THREE.Material>();
const texCache = new Map<string, THREE.Texture>();

function std(key: string, params: THREE.MeshStandardMaterialParameters) {
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial(params);
    cache.set(key, m);
  }
  return m;
}

function phys(key: string, params: THREE.MeshPhysicalMaterialParameters) {
  let m = cache.get(key) as THREE.MeshPhysicalMaterial | undefined;
  if (!m) {
    m = new THREE.MeshPhysicalMaterial(params);
    cache.set(key, m);
  }
  return m;
}

export const BRAND = {
  red: "#EE1D25",
  yellow: "#FFD400",
  green: "#5AB350",
  grey: "#585858",
};

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number], srgb = true) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx, w, h);
  t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  texCache.set(key, t);
  return t;
}

/** Deterministic speckle noise (like grit / paint texture) over the current canvas. */
function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amt: number, n: number, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const v = rnd();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${amt * rnd()})` : `rgba(0,0,0,${amt * rnd()})`;
    const sz = 1 + rnd() * 2.5;
    ctx.fillRect(rnd() * w, rnd() * h, sz, sz);
  }
}

function tileTexture(key: string, base: string, grout: string, tiles: number, jitter: number, seed = 1, grit = 0.05) {
  return canvasTexture(key, 512, 512, (ctx, w) => {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const step = w / tiles;
    ctx.fillStyle = grout;
    ctx.fillRect(0, 0, w, w);
    const c = new THREE.Color(base);
    for (let y = 0; y < tiles; y++)
      for (let x = 0; x < tiles; x++) {
        const k = 1 + (rnd() - 0.5) * jitter;
        ctx.fillStyle = `rgb(${Math.min(255, c.r * 255 * k)},${Math.min(255, c.g * 255 * k)},${Math.min(255, c.b * 255 * k)})`;
        ctx.fillRect(x * step + 2, y * step + 2, step - 4, step - 4);
        // soft highlight on each tile edge for a glazed look
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(x * step + 2, y * step + 2, step - 4, 3);
      }
    noise(ctx, w, w, grit, 7000, seed + 3);
  });
}

/** Terrazzo: warm base with coloured chips — reads well from dollhouse distance. */
function terrazzoTexture() {
  return canvasTexture("terrazzo", 512, 512, (ctx, w) => {
    ctx.fillStyle = "#ece6dc";
    ctx.fillRect(0, 0, w, w);
    let s = 21;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const chips = ["#c9bfb0", "#b7aa98", "#d9cfc0", "#a39582", "#e2b9a6", "#9fb3b0"];
    for (let i = 0; i < 2200; i++) {
      ctx.fillStyle = chips[Math.floor(rnd() * chips.length)];
      ctx.beginPath();
      const r = 0.8 + rnd() * 3.2;
      ctx.ellipse(rnd() * w, rnd() * w, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.07)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= w; i += w / 2) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, w);
      ctx.moveTo(0, i);
      ctx.lineTo(w, i);
      ctx.stroke();
    }
  });
}

export function textures() {
  return {
    steel: canvasTexture("steel", 256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#c4c9cf";
      ctx.fillRect(0, 0, w, h);
      let s = 5;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},${0.04 + rnd() * 0.06})`;
        ctx.fillRect(rnd() * w, rnd() * h, 20 + rnd() * 120, 1);
      }
    }),
    paint: canvasTexture("paint", 256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#f1ece4";
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 0.035, 5000, 11);
    }, [2, 1]),
    asphalt: canvasTexture("asphalt", 512, 512, (ctx, w, h) => {
      ctx.fillStyle = "#4f545a";
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 0.12, 16000, 13);
    }, [10, 10]),
    concrete: canvasTexture("concrete", 512, 512, (ctx, w, h) => {
      ctx.fillStyle = "#c9c6bf";
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 0.06, 9000, 17);
      ctx.strokeStyle = "rgba(0,0,0,0.09)";
      ctx.lineWidth = 2;
      for (let i = 0; i <= w; i += 128) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, h);
        ctx.moveTo(0, i);
        ctx.lineTo(w, i);
        ctx.stroke();
      }
    }, [8, 8]),
    grass: canvasTexture("grass", 256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#5d8a3e";
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 0.14, 9000, 19);
    }, [30, 30]),
    sky: canvasTexture("sky", 4, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, "#8fbde6");
      g.addColorStop(0.5, "#d4e5f2");
      g.addColorStop(1, "#eef2f6");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 256);
    }),
    duskSky: canvasTexture("duskSky", 4, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, "#28305a");
      g.addColorStop(0.45, "#a3607a");
      g.addColorStop(0.6, "#f2a46a");
      g.addColorStop(1, "#f6cf9a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 256);
    }),
  };
}

/** Per-room floor material keyed by room type. Texture repeat is set per-mesh via a cloned texture. */
export function floorMaterial(type: string, w: number, d: number): THREE.MeshStandardMaterial {
  const key = `floor:${type}:${w.toFixed(1)}x${d.toFixed(1)}`;
  const existing = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (existing) return existing;
  let tex: THREE.Texture;
  let roughness = 0.55;
  let tileSize = 0.6;
  switch (type) {
    case "dining":
    case "customer":
      tex = terrazzoTexture();
      roughness = 0.32;
      tileSize = 2.4;
      break;
    case "counter":
      tex = tileTexture("tile:counter", "#3a3a3d", "#2a2a2c", 4, 0.08, 5);
      tileSize = 0.8;
      break;
    case "cold":
    case "freezer":
      tex = tileTexture("tile:cold", "#c9d4dc", "#9fb0bc", 6, 0.05, 7);
      tileSize = 0.6;
      break;
    case "dry":
    case "office":
    case "staff":
      tex = tileTexture("tile:grey", "#b9b6b0", "#9c9890", 4, 0.05, 9);
      tileSize = 0.8;
      break;
    case "toilet":
    case "wash":
    case "waste":
      tex = tileTexture("tile:wash", "#a9b7b5", "#7f8e8c", 8, 0.05, 11);
      tileSize = 0.4;
      break;
    case "dispatch":
      tex = tileTexture("tile:dispatch", "#55585e", "#3f4146", 4, 0.06, 13);
      tileSize = 0.8;
      break;
    default:
      // Kitchens: quarry tiles, anti-slip, warm red-brown.
      tex = tileTexture("tile:kitchen", "#9a4b3b", "#5e2e25", 8, 0.12, 17);
      tileSize = 0.3 * 4;
      roughness = 0.7;
  }
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w / tileSize, d / tileSize);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness, metalness: 0.02, color: type === "dining" || type === "customer" ? "#e4ddd2" : "#ffffff" });
  cache.set(key, m);
  return m;
}

export const M = {
  steel: () => std("steel", { color: "#dfe3e8", map: textures().steel, metalness: 0.85, roughness: 0.32 }),
  steelDark: () => std("steelDark", { color: "#8d939a", map: textures().steel, metalness: 0.85, roughness: 0.4 }),
  brushed: () => std("brushed", { color: "#cfd4da", map: textures().steel, metalness: 0.75, roughness: 0.45 }),
  black: () => std("black", { color: "#1b1c1f", metalness: 0.2, roughness: 0.6 }),
  blackGloss: () => std("blackGloss", { color: "#0d0e10", metalness: 0.3, roughness: 0.2 }),
  rubber: () => std("rubber", { color: "#2a2b2e", roughness: 0.9 }),
  white: () => std("white", { color: "#f4f4f2", roughness: 0.5 }),
  whiteGloss: () => std("whiteGloss", { color: "#fbfbfa", roughness: 0.25 }),
  wall: () => std("wall", { color: "#ffffff", map: textures().paint, roughness: 0.9 }),
  wallKitchen: () => std("wallKitchen", { color: "#e8ecee", roughness: 0.6 }),
  wallExterior: () => std("wallExterior", { color: "#f4f0ea", map: textures().paint, roughness: 0.85 }),
  wallTop: () => std("wallTop", { color: "#2b2d31", roughness: 0.8 }),
  ceiling: () => std("ceiling", { color: "#f2f1ee", roughness: 0.95 }),
  red: () => std("red", { color: BRAND.red, roughness: 0.38, metalness: 0.15 }),
  redCladding: () => std("redCladding", { color: "#d8141c", roughness: 0.3, metalness: 0.35 }),
  yellow: () => std("yellow", { color: BRAND.yellow, roughness: 0.55 }),
  yellowFabric: () => std("yellowFabric", { color: "#f2bf1d", roughness: 0.92 }),
  lime: () => std("lime", { color: "#9ccc3a", roughness: 0.45 }),
  green: () => std("green", { color: BRAND.green, roughness: 0.6 }),
  wood: () => std("wood", { color: "#9a6a43", roughness: 0.7 }),
  woodLight: () => std("woodLight", { color: "#c49a6c", roughness: 0.65 }),
  tableRed: () => std("tableRed", { color: "#c4161d", roughness: 0.35, metalness: 0.05 }),
  teal: () => std("teal", { color: "#1f7f86", roughness: 0.8 }),
  door: () => std("door", { color: "#d3d6da", roughness: 0.5, metalness: 0.3 }),
  frame: () => std("frame", { color: "#2c2f33", roughness: 0.4, metalness: 0.6 }),
  glass: () => phys("glass", { color: "#cfe6f2", metalness: 0, roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  fridgeGlass: () => phys("fridgeGlass", { color: "#bfe3f5", roughness: 0.08, transparent: true, opacity: 0.3, depthWrite: false }),
  oil: () => std("oil", { color: "#c08a1e", roughness: 0.12, metalness: 0.1, emissive: "#5a3300", emissiveIntensity: 0.25 }),
  dough: () => std("dough", { color: "#f1dcae", roughness: 0.85 }),
  pizza: () => std("pizza", { color: "#d9a25a", roughness: 0.8 }),
  sauce: () => std("sauce", { color: "#b5311d", roughness: 0.7 }),
  cheese: () => std("cheese", { color: "#f6d47a", roughness: 0.6 }),
  chicken: () => std("chicken", { color: "#b8691f", roughness: 0.65 }),
  rice: () => std("rice", { color: "#d8642a", roughness: 0.85 }),
  friedRice: () => std("friedRice", { color: "#e2c27a", roughness: 0.85 }),
  pepper: () => std("pepper", { color: "#3c9a3a", roughness: 0.6 }),
  onion: () => std("onion", { color: "#e7d7e8", roughness: 0.6 }),
  corn: () => std("corn", { color: "#f1c232", roughness: 0.6 }),
  cardboard: () => std("cardboard", { color: "#c49a64", roughness: 0.9 }),
  boxWhite: () => std("boxWhite", { color: "#f7f3ea", roughness: 0.8 }),
  bag: () => std("bag", { color: "#f3efe6", roughness: 0.85 }),
  sack: () => std("sack", { color: "#d8c9a3", roughness: 0.95 }),
  plastic: (color: string) => std(`plastic:${color}`, { color, roughness: 0.55 }),
  emissive: (color: string, intensity = 1.5) => std(`emis:${color}:${intensity}`, { color, emissive: color, emissiveIntensity: intensity, roughness: 0.4, toneMapped: false }),
  heatLamp: () => std("heatLamp", { color: "#ff9a3c", emissive: "#ff7a1a", emissiveIntensity: 2.2, toneMapped: false }),
  screen: () => std("screen", { color: "#0a0c10", emissive: "#2a62c9", emissiveIntensity: 0.6, roughness: 0.2 }),
  asphalt: () => std("asphalt", { color: "#ffffff", map: textures().asphalt, roughness: 0.95 }),
  pavement: () => std("pavement", { color: "#ffffff", map: textures().concrete, roughness: 0.92 }),
  grass: () => std("grass", { color: "#ffffff", map: textures().grass, roughness: 1 }),
  soil: () => std("soil", { color: "#7a4a2a", roughness: 1 }),
  leaf: () => std("leaf", { color: "#3d7a2e", roughness: 0.8, side: THREE.DoubleSide }),
  trunk: () => std("trunk", { color: "#7a6247", roughness: 0.95 }),
  lineWhite: () => std("lineWhite", { color: "#e8e8e8", roughness: 0.8 }),
  lineYellow: () => std("lineYellow", { color: "#e7c000", roughness: 0.8 }),
  frost: () => std("frost", { color: "#e8f3f8", roughness: 0.4, metalness: 0.2 }),
};

export function signTexture(): THREE.Texture {
  return canvasTexture("sign:chickenman", 1024, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = "900 118px Montserrat, 'Arial Black', Arial, sans-serif";
    ctx.textBaseline = "middle";
    const chicken = "CHICKEN";
    const man = "MAN";
    const cw = ctx.measureText(chicken + " ").width;
    const mw = ctx.measureText(man).width;
    const x0 = (w - cw - mw) / 2;
    ctx.lineJoin = "round";
    ctx.lineWidth = 16;
    ctx.strokeStyle = BRAND.red;
    ctx.strokeText(chicken, x0, h * 0.52);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(chicken, x0, h * 0.52);
    ctx.strokeStyle = "#7a1010";
    ctx.lineWidth = 10;
    ctx.strokeText(man, x0 + cw, h * 0.52);
    ctx.fillStyle = BRAND.yellow;
    ctx.fillText(man, x0 + cw, h * 0.52);
  });
}

export function taglineTexture(): THREE.Texture {
  return canvasTexture("sign:tagline", 512, 96, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = "italic 700 56px 'Brush Script MT', 'Segoe Script', cursive";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("it's flaming hot", w / 2, h / 2);
  });
}

export function badgeTexture(): THREE.Texture {
  return canvasTexture("sign:pizzaman", 512, 512, (ctx, w) => {
    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 14;
    ctx.strokeStyle = "#111";
    ctx.stroke();
    // pizza slice
    ctx.fillStyle = "#f6d47a";
    ctx.strokeStyle = BRAND.red;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(w / 2, w * 0.2);
    ctx.lineTo(w * 0.32, w * 0.5);
    ctx.lineTo(w * 0.68, w * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = BRAND.red;
    for (const [x, y] of [[0.47, 0.38], [0.53, 0.44], [0.43, 0.46]]) {
      ctx.beginPath();
      ctx.arc(w * x, w * y, w * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = BRAND.green;
    ctx.beginPath();
    ctx.ellipse(w * 0.58, w * 0.33, w * 0.05, w * 0.022, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.font = "900 70px Montserrat, 'Arial Black', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PIZZAMAN", w / 2, w * 0.66);
    ctx.font = "700 30px Montserrat, Arial, sans-serif";
    ctx.fillText("ESTD 2018", w / 2, w * 0.78);
  });
}

const MENU_PANELS = [
  ["PIZZA", "#c0392b", ["Chicken Pizza", "Chibella", "Triple C", "Klarabella", "Dukeman"]],
  ["JOLLOF", "#d35400", ["Guyman Metreat", "PlayMan Jollof", "Mini Bucket", "Maxi Bucket"]],
  ["CHICKEN", "#b9770e", ["Chicken Bucket", "Wings Bucket", "Variety Bucket"]],
  ["PACKS", "#7d3c98", ["Gen-Z Pack", "Borgaman Pack", "Family Pack"]],
] as const;

/** The brand font as loaded by next/font (falls back to a heavy system face). */
function brandFont(weight: number, px: number) {
  let fam = "";
  if (typeof document !== "undefined") fam = getComputedStyle(document.documentElement).getPropertyValue("--font-brand").trim() || getComputedStyle(document.body).getPropertyValue("--font-brand").trim();
  return `${weight} ${px}px ${fam ? `${fam}, ` : ""}Montserrat, 'Arial Black', Arial, sans-serif`;
}

/* Small food illustrations for menu boards and graphics (flat, brand palette). */
function drawPizza(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = "#c98a3e";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f3c24f";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.84, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#b5311d";
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4 + 0.3;
    const rr = r * (0.2 + 0.5 * ((i * 0.618) % 1));
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = BRAND.green;
  for (let i = 0; i < 5; i++) {
    const a = i * 1.7 + 1.1;
    ctx.fillRect(x + Math.cos(a) * r * 0.45 - r * 0.06, y + Math.sin(a) * r * 0.45 - r * 0.02, r * 0.12, r * 0.04);
  }
  ctx.strokeStyle = "rgba(120,70,20,0.55)";
  ctx.lineWidth = Math.max(1, r * 0.03);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(a) * r * 0.84, y - Math.sin(a) * r * 0.84);
    ctx.lineTo(x + Math.cos(a) * r * 0.84, y + Math.sin(a) * r * 0.84);
    ctx.stroke();
  }
}

function drawDrumstick(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = "#efe6d2";
  ctx.fillRect(s * 0.35, -s * 0.07, s * 0.45, s * 0.14);
  ctx.beginPath();
  ctx.arc(s * 0.82, -s * 0.07, s * 0.09, 0, Math.PI * 2);
  ctx.arc(s * 0.82, s * 0.07, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(-s * 0.1, -s * 0.12, s * 0.05, 0, 0, s * 0.5);
  g.addColorStop(0, "#e09a42");
  g.addColorStop(1, "#9a5418");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.48, s * 0.33, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawJollof(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = "#f4f1ea";
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.1, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d4572a";
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.86, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e2733a";
  for (let i = 0; i < 26; i++) ctx.fillRect(x + Math.cos(i * 2.3) * r * 0.6 * ((i * 0.37) % 1), y + Math.sin(i * 2.3) * r * 0.3 * ((i * 0.53) % 1), r * 0.06, r * 0.04);
  drawDrumstick(ctx, x + r * 0.25, y - r * 0.05, r * 0.7, -0.5);
  ctx.fillStyle = BRAND.green;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.45, y, r * 0.16, r * 0.08, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawPack(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = "#f6f4ee";
  ctx.fillRect(x - s * 0.55, y - s * 0.1, s * 0.75, s * 0.5);
  ctx.fillStyle = BRAND.red;
  ctx.fillRect(x - s * 0.55, y + s * 0.08, s * 0.75, s * 0.12);
  ctx.fillStyle = BRAND.yellow;
  ctx.fillRect(x - s * 0.55, y + s * 0.2, s * 0.75, s * 0.03);
  // bottle
  ctx.fillStyle = "#3b1f12";
  ctx.fillRect(x + s * 0.32, y - s * 0.3, s * 0.18, s * 0.7);
  ctx.fillRect(x + s * 0.37, y - s * 0.45, s * 0.08, s * 0.16);
  ctx.fillStyle = BRAND.red;
  ctx.fillRect(x + s * 0.32, y - s * 0.05, s * 0.18, s * 0.15);
  drawDrumstick(ctx, x - s * 0.2, y - s * 0.22, s * 0.45, 0.3);
}

export function menuBoardTexture(index: number): THREE.Texture {
  return canvasTexture(`menu:${index}`, 1536, 480, (ctx, w, h) => {
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, w, h);
    const panels = [MENU_PANELS[index % 4], MENU_PANELS[(index + 1) % 4], MENU_PANELS[(index + 2) % 4]];
    const pw = w / 3;
    panels.forEach(([title, color, items], i) => {
      const x = i * pw;
      const g = ctx.createLinearGradient(x, 0, x + pw, h);
      g.addColorStop(0, color);
      g.addColorStop(1, "#1a0a06");
      ctx.fillStyle = g;
      ctx.fillRect(x + 8, 8, pw - 16, h - 16);
      // light burst behind the food
      const cx = x + pw * 0.7;
      const cy = h * 0.6;
      const burst = ctx.createRadialGradient(cx, cy, 10, cx, cy, pw * 0.34);
      burst.addColorStop(0, "rgba(255,214,120,0.55)");
      burst.addColorStop(1, "rgba(255,214,120,0)");
      ctx.fillStyle = burst;
      ctx.fillRect(x + 8, 8, pw - 16, h - 16);
      if (title === "PIZZA") drawPizza(ctx, cx, cy, pw * 0.2);
      else if (title === "CHICKEN") {
        drawDrumstick(ctx, cx - pw * 0.08, cy + h * 0.05, pw * 0.22, -0.4);
        drawDrumstick(ctx, cx + pw * 0.06, cy - h * 0.07, pw * 0.22, 0.5);
        drawDrumstick(ctx, cx + pw * 0.02, cy + h * 0.14, pw * 0.2, 2.6);
      } else if (title === "JOLLOF") drawJollof(ctx, cx, cy, pw * 0.2);
      else drawPack(ctx, cx, cy, pw * 0.36);
      // title band
      ctx.fillStyle = BRAND.yellow;
      ctx.font = brandFont(900, 66);
      ctx.textBaseline = "alphabetic";
      ctx.fillText(title, x + 34, 92);
      ctx.fillStyle = BRAND.yellow;
      ctx.fillRect(x + 34, 108, pw * 0.3, 6);
      ctx.fillStyle = "#fff";
      ctx.font = brandFont(600, 34);
      (items as readonly string[]).forEach((it, k) => ctx.fillText(it, x + 34, 168 + k * 56));
      // brand stripe along the bottom of each panel
      ctx.fillStyle = BRAND.red;
      ctx.fillRect(x + 8, h - 30, pw - 16, 10);
      ctx.fillStyle = BRAND.yellow;
      ctx.fillRect(x + 8, h - 20, pw - 16, 6);
      ctx.fillStyle = BRAND.green;
      ctx.fillRect(x + 8, h - 14, pw - 16, 6);
    });
  });
}

/** Text strip at the right aspect (w / h metres) so lettering is never stretched. */
export function stripTexture(text: string, bg: string, fg: string, aspect: number, accent?: string): THREE.Texture {
  const H = 96;
  const W = Math.min(2048, Math.max(128, Math.round(H * aspect)));
  return canvasTexture(`strip:${text}:${bg}:${fg}:${W}`, W, H, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (accent) {
      ctx.fillStyle = accent;
      ctx.fillRect(0, h - 10, w, 10);
    }
    ctx.fillStyle = fg;
    let px = 60;
    ctx.font = brandFont(800, px);
    while (ctx.measureText(text).width > w * 0.9 && px > 14) ctx.font = brandFont(800, (px -= 2));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h * (accent ? 0.46 : 0.52));
  });
}

/** Customer-facing POS counter front: red panel, yellow / green brand swoosh, call to order. */
export function counterFrontTexture(aspect: number): THREE.Texture {
  const a = Math.max(2, Math.min(8, Math.round(aspect * 2) / 2));
  const H = 256;
  const W = Math.round(H * a);
  return canvasTexture(`counterFront:${a}`, W, H, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#f02a30");
    g.addColorStop(1, "#c8151c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // diagonal "flame" streaks
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#fff";
    for (let x = -h; x < w; x += 70) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 26, h);
      ctx.lineTo(x + 26 + h * 0.6, 0);
      ctx.lineTo(x + h * 0.6, 0);
      ctx.fill();
    }
    ctx.restore();
    // swoosh band
    ctx.fillStyle = BRAND.yellow;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.72);
    ctx.bezierCurveTo(w * 0.3, h * 0.6, w * 0.6, h * 0.92, w, h * 0.7);
    ctx.lineTo(w, h * 0.82);
    ctx.bezierCurveTo(w * 0.6, h * 1.02, w * 0.3, h * 0.72, 0, h * 0.84);
    ctx.fill();
    ctx.fillStyle = BRAND.green;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.88);
    ctx.bezierCurveTo(w * 0.3, h * 0.78, w * 0.6, h * 1.05, w, h * 0.86);
    ctx.lineTo(w, h * 0.9);
    ctx.bezierCurveTo(w * 0.6, h * 1.09, w * 0.3, h * 0.82, 0, h * 0.92);
    ctx.fill();
    // lettering
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = brandFont(900, 74);
    ctx.fillText("ORDER HERE", h * 0.32, h * 0.3);
    ctx.fillStyle = BRAND.yellow;
    ctx.font = brandFont(700, 34);
    ctx.fillText("PIZZA  ·  CHICKEN  ·  JOLLOF", h * 0.34, h * 0.52);
    // food icons on the right
    const r = h * 0.27;
    drawPizza(ctx, w - r * 1.35, h * 0.4, r);
    if (w > h * 4) drawDrumstick(ctx, w - r * 3.6, h * 0.42, r * 1.5, -0.35);
  });
}

/** Illuminated drinks-fridge header (white lettering over the red light box). */
export function fridgeHeaderTexture(): THREE.Texture {
  return canvasTexture("fridgeHeader", 640, 112, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.font = brandFont(900, 58);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ICE COLD DRINKS", w / 2, h * 0.54);
  });
}

/** Lettering for the entrance canopy fascia: brand name in white and yellow (text only, no logo). */
export function canopyTexture(): THREE.Texture {
  return canvasTexture("canopy", 1536, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = brandFont(900, 104);
    ctx.textBaseline = "middle";
    const a = "PIZZAMAN";
    const b = "CHICKENMAN";
    const gap = 46;
    const aw = ctx.measureText(a).width;
    const bw = ctx.measureText(b).width;
    const x0 = (w - aw - bw - gap) / 2;
    ctx.lineJoin = "round";
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#7a1010";
    ctx.strokeText(a, x0, h * 0.54);
    ctx.strokeText(b, x0 + aw + gap, h * 0.54);
    ctx.fillStyle = "#fff";
    ctx.fillText(a, x0, h * 0.54);
    ctx.fillStyle = BRAND.yellow;
    ctx.fillText(b, x0 + aw + gap, h * 0.54);
  });
}

/**
 * Glazing manifestation band (safety marking on shopfront glass): brand stripes and a
 * repeating product line. Tiles horizontally every 2 m; clone it per window for the repeat.
 */
export function windowBandTexture(): THREE.Texture {
  return canvasTexture("windowBand", 1024, 96, (ctx, w, h) => {
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = BRAND.red;
    ctx.fillRect(0, 0, w, 12);
    ctx.fillStyle = BRAND.yellow;
    ctx.fillRect(0, 12, w, 6);
    ctx.fillStyle = BRAND.green;
    ctx.fillRect(0, h - 8, w, 8);
    ctx.fillStyle = "#c8151c";
    ctx.font = brandFont(800, 38);
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText("FRESH PIZZA  •  CRISPY CHICKEN  •  JOLLOF  •", w / 2, h * 0.56);
  }, [1, 1]);
}

export function posterTexture(): THREE.Texture {
  return canvasTexture("poster", 512, 768, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, BRAND.red);
    g.addColorStop(1, "#7a0c10");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = BRAND.yellow;
    ctx.font = "900 64px Montserrat, 'Arial Black', Arial";
    ctx.fillText("GOOD FOOD", 40, 110);
    ctx.fillStyle = "#fff";
    ctx.fillText("IS HERE", 40, 180);
    ctx.fillStyle = "rgba(255,212,0,0.9)";
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.62, 170, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c0392b";
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.62, 140, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function labelTexture(text: string, bg: string, fg = "#fff"): THREE.Texture {
  return canvasTexture(`label:${text}:${bg}`, 256, 64, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = "800 30px Montserrat, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2);
  });
}

/** Deterministic colour palettes for people. */
export const SHIRTS = ["#2d6cdf", "#e8e8e8", "#1f9d73", "#7b4bc4", "#f28c28", "#3b3f46", "#d64f8b", "#4aa3c7", "#f2c94c", "#8a5a3c"];
export const PANTS = ["#23262b", "#2f4a7a", "#5a4632", "#3e3e3e", "#6b6f78", "#1b2a3a"];
export const SKIN = ["#5a3a26", "#6e4630", "#4a2e1f", "#7d5236", "#3d261a", "#8a5c3c"];
