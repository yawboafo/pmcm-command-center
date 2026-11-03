/**
 * Menu catalogue importer: pulls the public Pizzaman Chickenman catalogue from the
 * Chris B ordering site (https://chrisb.app/menu, the company's own app) and writes
 * src/data/menu-catalogue.json. Re-run it to refresh prices; no code changes needed.
 *
 *   npx tsx scripts/import-menu.ts            # fetch + write
 *   npx tsx scripts/import-menu.ts --dry-run  # fetch + print summary, do not write
 *   npx tsx scripts/import-menu.ts --raw <file>  # also save the raw API responses (for audits)
 *
 * How the source works (inspected 2026-11-03):
 * - The menu pages are a Next.js app. Products are loaded in the browser through a
 *   public, unauthenticated Next.js *server action* named `getProducts`: a POST to the
 *   page URL with a `Next-Action: <action id>` header and a JSON body `[ <query context> ]`.
 *   The response is a React Server Components (RSC) text stream whose row `1:` holds
 *   `{ data: { productList, nextCursor, hasNextPage }, success, statusCode }`.
 * - The action id is a build hash, so it is NOT hard-coded: the script reads the page's
 *   JS chunks and finds `createServerReference("<id>", ..., "getProducts")`.
 *   Override with MENU_ACTION_ID=<id> if discovery ever fails.
 * - We send exactly the queries the category pages send (same parameters, same page URL),
 *   page through `nextCursor` like the infinite list does, and wait between requests.
 *   No auth, cookies, rate-limit or bot-protection bypass is involved. If the site starts
 *   refusing these requests, this script stops with an error; do not work around it.
 *
 * Verification rule (per item):
 *   "verified"   = returned by the query of the category page a customer opens for it
 *                  (sourceUrl/categoryUrl), with one consistent price across every query
 *                  that returned it, a plain base price (priceMultiplier 1) and no
 *                  unmapped branch prices.
 *   "unverified" = anything else (the reason is written to `notes`). Nothing is guessed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ORIGIN = "https://chrisb.app";
const MENU_URL = `${ORIGIN}/menu`;
const OUT_FILE = resolve(process.cwd(), "src/data/menu-catalogue.json");
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const REQUEST_GAP_MS = 400; // politeness delay between API calls
const MAX_PAGES_PER_QUERY = 40; // safety stop for the cursor loop

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RAW_OUT = args.includes("--raw") ? args[args.indexOf("--raw") + 1] : undefined;

// ---------------------------------------------------------------------------
// Raw source record (fields as returned by getProducts). Only the fields we read.
// ---------------------------------------------------------------------------
type RawProduct = {
  _id: string; // product id in the source system -> catalogueId
  productCode?: string; // same value as _id in every record seen
  name: string; // published product name -> name (kept exactly)
  description?: string | null; // per-size description -> description
  generalDescription?: string | null; // family-level description (fallback for description)
  unitPrice: number; // base price in PESEWAS (GH₵ x 100): 2000 = GH₵20 -> prices.regular / 100
  priceMultiplier?: number; // 1 on every record seen; anything else -> unverified
  discountPercentage?: number | null; // sale % -> prices.promotional (only when > 0 and in window)
  discountAmount?: number | null; // sale amount in pesewas -> prices.promotional
  discountStartsAt?: string | number | null;
  discountEndsAt?: string | number | null;
  branchPrices?: unknown[]; // per-branch overrides; empty on every record seen -> prices.branch
  enabled?: boolean; // -> available
  productImage?: string | null; // -> imageUrl (URL only, never downloaded)
  family?: string; // family code, e.g. CHICKEN_PIZZA -> sourceFamily, used for slugs and (N) pairing
  familyName?: string;
  size?: string; // raw size, e.g. "MEDIUM", "Medium", "0.45L", "10PCS" -> sourceSize, size
  productionCategory?: string; // PIZZAMAN | CHICKENMAN | PIZZAMAN_CHICKENMAN | DRINKS -> brand
  extras?: { _id: string; name: string; unitPrice: number }[]; // add-ons offered in this product's sheet
};

type RscEnvelope = {
  data?: { productList?: RawProduct[]; nextCursor?: { _id?: string } | null; hasNextPage?: boolean };
  success?: boolean;
  statusCode?: number;
  message?: string;
};

// ---------------------------------------------------------------------------
// The category pages and the exact query each one sends (copied from the page JS).
// ---------------------------------------------------------------------------
type PageQuery = {
  key: string; // our label
  pagePath: string; // page the browser is on (the action is POSTed to it)
  humanUrl: string; // URL a person can open to see these items
  categoryLabel: string; // published category path
  params: Record<string, unknown>; // query params, as the page builds them with no branch selected
};

const PRODUCTION_CATEGORY_TO_BRAND: Record<string, "pizzaman" | "chickenman" | "package" | "drinks"> = {
  PIZZAMAN: "pizzaman",
  CHICKENMAN: "chickenman",
  PIZZAMAN_CHICKENMAN: "package", // the "Packages" page
  DRINKS: "drinks",
};

function basePageQueries(): PageQuery[] {
  const sort = { sortBy: "_id", orderOf: "asc" };
  return [
    {
      key: "pizzaman",
      pagePath: "/menu/category/pizzaman/classics",
      humanUrl: `${ORIGIN}/menu/category/pizzaman/classics`,
      categoryLabel: "Pizzaman > Classics",
      params: { ...sort, productionCategory: "PIZZAMAN", branchIds: [] },
    },
    {
      key: "chickenman",
      pagePath: "/menu/category/chickenman",
      humanUrl: `${ORIGIN}/menu/category/chickenman`,
      categoryLabel: "Chickenman",
      params: { ...sort, productionCategory: "CHICKENMAN", categoryIds: [], limit: 50, branchIds: [] },
    },
    {
      key: "packages",
      pagePath: "/menu/category/packages",
      humanUrl: `${ORIGIN}/menu/category/packages`,
      categoryLabel: "Packages",
      params: { ...sort, productionCategory: "PIZZAMAN_CHICKENMAN", name: null, branchIds: [] },
    },
    {
      key: "drinks",
      pagePath: "/menu/category/drinks",
      humanUrl: `${ORIGIN}/menu/category/drinks`,
      categoryLabel: "Drinks",
      params: { ...sort, productionCategory: "DRINKS", name: null, branchIds: [] },
    },
  ];
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with up to 2 retries on *network* errors only (DNS/socket hiccups).
 * HTTP error statuses are never retried: a refusal stops the run.
 */
async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (attempt >= 2) throw new Error(`${init.method ?? "GET"} ${url}: ${e instanceof Error ? e.message : e}`);
      await sleep(2000 * (attempt + 1));
    }
  }
}

async function getText(url: string): Promise<string> {
  const res = await fetchRetry(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

/** Find the getProducts server-action id in the menu page's JS chunks. */
async function discoverActionId(menuHtml: string): Promise<{ id: string; chunk: string }> {
  if (process.env.MENU_ACTION_ID) return { id: process.env.MENU_ACTION_ID, chunk: "(env MENU_ACTION_ID)" };
  const chunks = [...new Set([...menuHtml.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]))];
  // Page chunks first: that is where the action reference lives.
  chunks.sort((a, b) => Number(b.includes("/app/")) - Number(a.includes("/app/")));
  const re = /createServerReference\)\("([0-9a-f]{20,})"[^)]*?"getProducts"\)/;
  for (const c of chunks) {
    const js = await getText(ORIGIN + c);
    const m = js.match(re);
    if (m) return { id: m[1], chunk: c };
  }
  throw new Error("Could not find the getProducts server action in the /menu JS chunks. Set MENU_ACTION_ID to override.");
}

/** Parse an RSC text stream and return the row that carries the product list. */
function parseRsc(text: string): RscEnvelope {
  for (const line of text.split("\n")) {
    const m = line.match(/^([0-9a-f]+):(\{.*\})$/);
    if (!m) continue;
    try {
      const obj = JSON.parse(m[2]) as RscEnvelope;
      if (obj && obj.data && Array.isArray(obj.data.productList)) return obj;
    } catch {
      /* not JSON: ignore */
    }
  }
  throw new Error(`Unexpected getProducts response (first 300 chars): ${text.slice(0, 300)}`);
}

let requestCount = 0;

/** Run one page query, following nextCursor like the page's infinite list does. */
async function runQuery(actionId: string, q: Pick<PageQuery, "pagePath" | "params">): Promise<RawProduct[]> {
  const all: RawProduct[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
    // Body = the arguments of queryFn(context): the react-query context the browser serialises.
    const pageParam = { ...q.params, cursor };
    const body = JSON.stringify([{ queryKey: ["products", q.params], pageParam, direction: "forward" }]);
    if (requestCount++ > 0) await sleep(REQUEST_GAP_MS);
    const res = await fetchRetry(ORIGIN + q.pagePath, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Next-Action": actionId,
        "Content-Type": "text/plain;charset=UTF-8",
        Accept: "text/x-component",
      },
      body,
    });
    if (!res.ok) throw new Error(`getProducts on ${q.pagePath} -> HTTP ${res.status}. Stopping (do not bypass).`);
    const env = parseRsc(await res.text());
    if (env.success === false) throw new Error(`getProducts on ${q.pagePath} failed: ${env.message ?? env.statusCode}`);
    all.push(...(env.data!.productList ?? []));
    const next = env.data!.nextCursor?._id;
    if (!next || env.data!.hasNextPage === false) return all;
    cursor = next;
  }
  throw new Error(`Query on ${q.pagePath} exceeded ${MAX_PAGES_PER_QUERY} pages`);
}

// ---------------------------------------------------------------------------
// Page config read from the server-rendered HTML (RSC payload in <script> tags)
// ---------------------------------------------------------------------------
type SubCategory = { id: string; displayName: string };

function unescapeRscHtml(html: string): string {
  // The RSC payload is embedded as JS string literals: \" and \\ escapes.
  return html.replace(/\\\\/g, "\\").replace(/\\"/g, '"');
}

function parseSubCategories(chickenmanHtml: string): SubCategory[] {
  const s = unescapeRscHtml(chickenmanHtml);
  const i = s.indexOf('"subCategories":[');
  if (i < 0) throw new Error("subCategories not found on the Chickenman page");
  const seg = s.slice(i, i + 20000);
  const out: SubCategory[] = [];
  for (const m of seg.matchAll(/\{"id":"([^"]+)","name":"[^"]*","displayName":"([^"]+)"/g)) {
    if (!out.some((x) => x.id === m[1])) out.push({ id: m[1], displayName: m[2] });
  }
  if (!out.length) throw new Error("No subcategories parsed from the Chickenman page");
  return out;
}

function parseFlashSales(menuHtml: string): { groups: string[]; header: string } | null {
  const s = unescapeRscHtml(menuHtml);
  const m = s.match(/"flashSalesGroups":\[([^\]]*)\],"header":"([^"]*)"/);
  if (!m) return null;
  return { groups: [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]), header: m[2] };
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------
type Brand = "pizzaman" | "chickenman" | "package" | "drinks";
type CatalogueItem = {
  catalogueId: string;
  slug: string;
  name: string;
  description: string | null;
  brand: Brand;
  category: string;
  size: "S" | "M" | "L" | "Jumbo" | "Double" | null;
  prices: { regular: number; promotional: number | null; delivery: number | null; branch: Record<string, number> };
  available: boolean;
  imageUrl: string | null;
  imageLicense: "not-licensed";
  verification: "verified" | "unverified";
  sourceUrl: string;
  verifiedAt: string;
  notes: string | null;
  // Extra traceability fields (not in the minimal schema, safe to ignore):
  categoryUrl: string;
  sourceFamily: string | null;
  sourceSize: string | null;
};

/** Raw size string -> pizza size code. Raw values are inconsistent in case ("MEDIUM", "Medium"). */
const PIZZA_SIZE: Record<string, CatalogueItem["size"]> = {
  SMALL: "S",
  MEDIUM: "M",
  LARGE: "L",
  JUMBO: "Jumbo",
  DOUBLE: "Double",
};
const SIZE_WORD: Record<string, string> = { S: "small", M: "medium", L: "large", Jumbo: "jumbo", Double: "double" };

/**
 * Pizza family code -> slug stem. Explicit so slugs read like the menu ("klarabella",
 * not "beef-pizza"). Unknown families fall back to kebab(familyName).
 */
const PIZZA_FAMILY_STEM: Record<string, string> = {
  CHICKEN_PIZZA: "chicken-pizza",
  BEEF_PIZZA: "klarabella", // published as "Klarabella" / "Klarabella Beef Pizza"
  KERSAME: "kersame",
  MORBELLA: "morbella",
  BEEFTUNA: "beef-and-tuna",
  CHILLA: "chilla",
  CHICHAM: "chicham",
  CHIBELLA: "chibella",
  OBIRIDAN: "obiridan",
  TRIPLE_C_PIZZA: "triple-c",
  BREEZY: "breezy",
  MEATZZA: "meatzza",
  DUKEMAN: "dukeman",
};

const kebab = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, "$1-$2") // 0.45L -> 0-45l
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Product page a person can open. Same pattern as the cards on the category pages:
 * /product/<family>/<familyName with spaces as "-">/<size>/<id>?outlet=
 * (it opens the family's size/protein picker with prices). Falls back to /product/<id>.
 */
function productUrl(p: RawProduct): string {
  if (!p.family || !p.familyName || !p.size) return `${ORIGIN}/product/${p._id}`;
  const seg = (s: string) => encodeURIComponent(s.trim().replace(/\s+/g, "-"));
  return `${ORIGIN}/product/${seg(p.family)}/${seg(p.familyName)}/${seg(p.size)}/${p._id}?outlet=`;
}

const isNDuplicate =(name: string) => /\(\s*n\s*\)\s*$/i.test(name);
const ghs = (pesewas: number) => Math.round(pesewas) / 100;

function activeDiscount(p: RawProduct, now: Date): { price: number; note: string } | null {
  const pct = Number(p.discountPercentage ?? 0);
  const amt = Number(p.discountAmount ?? 0);
  if (pct <= 0 && amt <= 0) return null;
  const toDate = (v: string | number | null | undefined) => (v == null || v === "" ? null : new Date(isNaN(Number(v)) ? String(v) : Number(v)));
  const start = toDate(p.discountStartsAt);
  const end = toDate(p.discountEndsAt);
  if ((start && start > now) || (end && end < now)) return null;
  const pesewas = amt > 0 ? p.unitPrice - amt : p.unitPrice * (1 - pct / 100);
  const window = `${start ? start.toISOString() : "open"} to ${end ? end.toISOString() : "open"}`;
  return {
    price: ghs(pesewas),
    note: `Promotional price derived from source discount (${amt > 0 ? `discountAmount ${ghs(amt)}` : `discountPercentage ${pct}%`}, ${window}).`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const retrievedAt = new Date();
  const verifiedAt = retrievedAt.toISOString().slice(0, 10);

  console.log(`GET ${MENU_URL}`);
  const menuHtml = await getText(MENU_URL);
  const action = await discoverActionId(menuHtml);
  console.log(`getProducts action id ${action.id} (found in ${action.chunk})`);
  const flash = parseFlashSales(menuHtml);

  const chickenmanHtml = await getText(`${ORIGIN}/menu/category/chickenman`);
  const subCategories = parseSubCategories(chickenmanHtml);

  // 1. Category page queries (what a customer sees on each page).
  const pages = basePageQueries();
  const seenIn = new Map<string, { page: PageQuery; price: number }[]>();
  const records = new Map<string, RawProduct>();
  const raw: Record<string, RawProduct[]> = {};
  const record = (key: string, page: PageQuery, list: RawProduct[]) => {
    raw[key] = list;
    for (const p of list) {
      records.set(p._id, records.get(p._id) ?? p);
      const arr = seenIn.get(p._id) ?? [];
      arr.push({ page, price: p.unitPrice });
      seenIn.set(p._id, arr);
    }
  };
  for (const page of pages) {
    const list = await runQuery(action.id, page);
    console.log(`  ${page.categoryLabel}: ${list.length}`);
    record(page.key, page, list);
  }

  // 2. Chickenman subcategory tabs (?subcategory=<id>), to label Jollof / Fried Rice / ...
  const subOf = new Map<string, SubCategory>();
  const chickenmanPage = pages.find((p) => p.key === "chickenman")!;
  for (const sc of subCategories) {
    const page: PageQuery = {
      key: `chickenman:${sc.id}`,
      pagePath: chickenmanPage.pagePath,
      humanUrl: `${ORIGIN}/menu/category/chickenman?subcategory=${encodeURIComponent(sc.id)}`,
      categoryLabel: `Chickenman > ${sc.displayName}`,
      params: { ...chickenmanPage.params, categoryIds: [sc.id] },
    };
    const list = await runQuery(action.id, page);
    console.log(`  ${page.categoryLabel}: ${list.length}`);
    record(page.key, page, list);
    for (const p of list) if (!subOf.has(p._id)) subOf.set(p._id, sc);
    pages.push(page);
  }

  // 3. "Flash Sales" strip on /menu (families listed in the page config).
  const flashIds = new Set<string>();
  if (flash?.groups.length) {
    const page: PageQuery = {
      key: "flash",
      pagePath: "/menu",
      humanUrl: MENU_URL,
      categoryLabel: flash.header,
      params: { exactFamilyList: flash.groups, enabled: true, branchIds: [] },
    };
    const list = await runQuery(action.id, page);
    console.log(`  ${flash.header} (${flash.groups.join(", ")}): ${list.length}`);
    record(page.key, page, list);
    for (const p of list) flashIds.add(p._id);
  }

  // 4. Completeness check: the same call with no category filter.
  const unfiltered: PageQuery = { key: "all", pagePath: "/menu", humanUrl: MENU_URL, categoryLabel: "(all)", params: { sortBy: "_id", orderOf: "asc", limit: 50 } };
  const allList = await runQuery(action.id, unfiltered);
  console.log(`  unfiltered catalogue: ${allList.length}`);
  record(unfiltered.key, unfiltered, allList);

  if (RAW_OUT) {
    mkdirSync(dirname(resolve(RAW_OUT)), { recursive: true });
    writeFileSync(resolve(RAW_OUT), JSON.stringify({ retrievedAt: retrievedAt.toISOString(), actionId: action.id, subCategories, flash, raw }, null, 2));
    console.log(`raw responses -> ${RAW_OUT}`);
  }

  // Keep slugs sticky per catalogueId across refreshes.
  const previousSlug = new Map<string, string>();
  if (existsSync(OUT_FILE)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_FILE, "utf8")) as { items?: { catalogueId: string; slug: string }[] };
      for (const it of prev.items ?? []) previousSlug.set(it.catalogueId, it.slug);
    } catch {
      /* unreadable previous file: derive fresh slugs */
    }
  }

  const products = [...records.values()];
  const byFamily = new Map<string, RawProduct[]>();
  for (const p of products) {
    const arr = byFamily.get(p.family ?? "") ?? [];
    arr.push(p);
    byFamily.set(p.family ?? "", arr);
  }

  const items: CatalogueItem[] = [];
  const usedSlugs = new Set<string>();
  for (const p of products) {
    const notes: string[] = [];
    let verified = true;
    const brand = PRODUCTION_CATEGORY_TO_BRAND[p.productionCategory ?? ""];
    if (!brand) throw new Error(`Unknown productionCategory "${p.productionCategory}" on ${p._id} ${p.name}: add it to PRODUCTION_CATEGORY_TO_BRAND`);

    const rawSize = (p.size ?? "").trim();
    const pizzaSize = brand === "pizzaman" ? PIZZA_SIZE[rawSize.toUpperCase()] ?? null : null;
    const isPizza = !!pizzaSize && !!p.family && p.family !== "EXTRAS";

    // Category page that shows this item to a customer.
    const sightings = seenIn.get(p._id) ?? [];
    const sub = subOf.get(p._id);
    const homeKey = brand === "chickenman" ? (sub ? `chickenman:${sub.id}` : "chickenman") : brand === "package" ? "packages" : brand;
    const home = pages.find((x) => x.key === homeKey)!;
    const onHomePage = sightings.some((s) => s.page.key === homeKey || (brand === "chickenman" && s.page.key === "chickenman"));
    if (!onHomePage) {
      verified = false;
      notes.push(`Not returned by the ${home.categoryLabel} page query; only seen via ${sightings.map((s) => s.page.categoryLabel).join(", ")}.`);
    }
    const distinctPrices = [...new Set(sightings.map((s) => s.price))];
    if (distinctPrices.length > 1) {
      verified = false;
      notes.push(`Price differs between queries: ${distinctPrices.map(ghs).join(" / ")} GHS.`);
    }
    if (!(Number.isFinite(p.unitPrice) && p.unitPrice > 0)) {
      verified = false;
      notes.push(`Source unitPrice is not a positive number (${p.unitPrice}).`);
    }
    if ((p.priceMultiplier ?? 1) !== 1) {
      verified = false;
      notes.push(`Source priceMultiplier is ${p.priceMultiplier}; regular price recorded as unitPrice only, meaning of multiplier unknown.`);
    }
    if (p.branchPrices && p.branchPrices.length) {
      verified = false;
      notes.push(`Source has ${p.branchPrices.length} branchPrices entries that this importer does not map yet.`);
    }

    // Pizza add-ons (family EXTRAS): the Classics page does not show them as cards; a
    // customer only sees them as an "Extras" option inside another product's sheet.
    if (p.family === "EXTRAS") {
      const hosts = products.filter((o) => (o.extras ?? []).some((e) => e._id === p._id));
      const hostPrices = [...new Set(hosts.flatMap((o) => (o.extras ?? []).filter((e) => e._id === p._id).map((e) => e.unitPrice)))];
      if (!hosts.length) {
        verified = false;
        notes.push(`Pizza add-on returned by the catalogue API, but not shown as a card on the Classics page and not offered as an extra on any product, so it could not be seen on a customer-facing page.`);
      } else if (hostPrices.length !== 1 || hostPrices[0] !== p.unitPrice) {
        verified = false;
        notes.push(`Pizza add-on; its price inside product sheets (${hostPrices.map(ghs).join(" / ")} GHS) does not match the catalogue price.`);
      } else {
        notes.push(`Pizza add-on: shown as an "Extras" option on ${hosts.length} product sheets at the same price, not as its own card.`);
      }
    }

    // Promotional price only when the source carries an active discount.
    const disc = activeDiscount(p, retrievedAt);
    if (disc) notes.push(disc.note);
    if (flashIds.has(p._id)) notes.push(`Listed in the "${flash?.header}" strip on /menu; the source carries no discount, so no promotional price is recorded.`);

    // "(N)" duplicates: pair with the un-suffixed sibling of the same family and size.
    if (isNDuplicate(p.name)) {
      const sib = (byFamily.get(p.family ?? "") ?? []).find(
        (o) => o._id !== p._id && !isNDuplicate(o.name) && (o.size ?? "").toUpperCase() === rawSize.toUpperCase(),
      );
      const norm = (s?: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      const descDiffers = !!sib && norm(sib.description) !== norm(p.description);
      const descNote = descDiffers ? " The published descriptions differ, so it may be a different recipe." : " The published descriptions match.";
      if (!sib) notes.push(`Catalogue entry with "(N)" suffix; no un-suffixed entry of the same family and size exists.`);
      else if (sib.unitPrice === p.unitPrice)
        notes.push(`Duplicate "(N)" catalogue entry of "${sib.name}" (${sib._id}) at the same price.${descNote}`);
      else
        notes.push(`"(N)" catalogue entry of "${sib.name}" (${sib._id}) at a different price (${ghs(p.unitPrice)} vs ${ghs(sib.unitPrice)} GHS).${descNote}`);
    }
    if (/^ST(AN|N)ADARD$/i.test(rawSize) && rawSize.toUpperCase() !== "STANDARD") notes.push(`Source size field reads "${rawSize}" (typo for STANDARD).`);

    // Slug: sticky per catalogueId; otherwise derived.
    let slug = previousSlug.get(p._id);
    if (!slug) {
      if (isPizza) {
        const stem = PIZZA_FAMILY_STEM[p.family!] ?? kebab(p.familyName ?? p.family!);
        slug = `pizzaman-${stem}-${SIZE_WORD[pizzaSize!]}${isNDuplicate(p.name) ? "-n" : ""}`;
      } else {
        slug = `${brand}-${kebab(p.name)}`;
      }
    }
    if (usedSlugs.has(slug)) slug = `${slug}-${p._id.slice(-6)}`;
    usedSlugs.add(slug);

    const description = (p.description ?? "").trim() || (p.generalDescription ?? "").trim() || null;
    const image = (p.productImage ?? "").trim();

    items.push({
      catalogueId: p._id,
      slug,
      name: p.name,
      description,
      brand,
      category: home.categoryLabel,
      size: isPizza ? pizzaSize : null,
      prices: { regular: ghs(p.unitPrice), promotional: disc ? disc.price : null, delivery: null, branch: {} },
      available: p.enabled !== false,
      imageUrl: image && /^https?:\/\//.test(image) ? image : null,
      imageLicense: "not-licensed",
      verification: verified ? "verified" : "unverified",
      sourceUrl: productUrl(p),
      verifiedAt,
      notes: notes.length ? notes.join(" ") : null,
      categoryUrl: home.humanUrl,
      sourceFamily: p.family ?? null,
      sourceSize: rawSize || null,
    });
  }

  const brandOrder: Brand[] = ["pizzaman", "chickenman", "package", "drinks"];
  items.sort((a, b) => brandOrder.indexOf(a.brand) - brandOrder.indexOf(b.brand) || a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug));

  const catalogue = {
    schemaVersion: 1,
    source: {
      name: "Chris B (official ordering app)",
      url: MENU_URL,
      endpoint: `POST ${ORIGIN}/menu/category/<page> with header "Next-Action: ${action.id}" (Next.js server action getProducts)`,
      retrievedAt: retrievedAt.toISOString(),
      priceUnit: "unitPrice is published in pesewas; divided by 100 to give GHS",
    },
    currency: "GHS",
    items,
  };

  const counts: Record<string, number> = {};
  for (const it of items) counts[it.category] = (counts[it.category] ?? 0) + 1;
  const nVerified = items.filter((i) => i.verification === "verified").length;
  console.log(`\n${items.length} items (${nVerified} verified, ${items.length - nVerified} unverified)`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  if (allList.length !== items.length) console.warn(`WARNING: unfiltered catalogue has ${allList.length} records but ${items.length} items were built.`);

  if (DRY_RUN) return;
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(catalogue, null, 2) + "\n");
  console.log(`wrote ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
