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

export function menuBoardTexture(index: number): THREE.Texture {
  return canvasTexture(`menu:${index}`, 1024, 320, (ctx, w, h) => {
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
      ctx.fillRect(x + 6, 6, pw - 12, h - 12);
      // food "photo" blob
      ctx.fillStyle = "rgba(255,210,120,0.85)";
      ctx.beginPath();
      ctx.ellipse(x + pw * 0.72, h * 0.62, pw * 0.2, h * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(190,60,30,0.9)";
      ctx.beginPath();
      ctx.ellipse(x + pw * 0.72, h * 0.62, pw * 0.15, h * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = BRAND.yellow;
      ctx.font = "900 44px Montserrat, 'Arial Black', Arial, sans-serif";
      ctx.fillText(title, x + 24, 62);
      ctx.fillStyle = "#fff";
      ctx.font = "600 24px Montserrat, Arial, sans-serif";
      (items as readonly string[]).forEach((it, k) => ctx.fillText(it, x + 24, 110 + k * 38));
    });
  });
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
