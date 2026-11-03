"use client";

import { useMemo, useState } from "react";
import catalogue from "@/data/menu-catalogue.json";
import { Glass, SectionTitle, UnavailableBadge, VerifiedBadge, cx } from "@/components/ui/primitives";
import { ghs } from "@/lib/format";
import { MENU, MENU_UNPRICED } from "@/lib/sim/menu";

interface CatalogueItem {
  catalogueId: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  size: string | null;
  prices: { regular: number | null; promotional: number | null; delivery: number | null; branch: Record<string, number> };
  available: boolean;
  verification: "verified" | "unverified";
  sourceUrl: string;
  verifiedAt: string;
  notes: string | null;
}

const ITEMS = (catalogue as { items: CatalogueItem[] }).items;
const SIMULATED = new Set(MENU.map((m) => m.catalogueSlug));

/**
 * Settings → Menu & prices: the published catalogue the simulation prices orders from,
 * with source and verification date per item. Refreshed by `npx tsx scripts/import-menu.ts`.
 */
export default function MenuCatalogue() {
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ITEMS.filter((i) => (!brand || i.brand === brand) && (!s || i.name.toLowerCase().includes(s) || i.category.toLowerCase().includes(s)));
  }, [q, brand]);
  const src = (catalogue as { source: { name: string; url: string; retrievedAt: string } }).source;
  const unverified = ITEMS.filter((i) => i.verification !== "verified").length;

  return (
    <Glass className="p-4 lg:col-span-2">
      <SectionTitle right={<span className="font-mono text-[10px] text-white/40">{ITEMS.length} items · {unverified} unverified</span>}>Menu &amp; prices</SectionTitle>
      <p className="mb-3 text-[11px] text-white/55">
        Published catalogue from{" "}
        <a href={src.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
          {src.name}
        </a>
        , retrieved {src.retrievedAt.slice(0, 16).replace("T", " ")} UTC. Prices are online base prices in GH₵; no branch-specific or delivery prices are published. Items marked SIMULATED ORDERS are the ones the demand generator uses. Product images are not shown — they are not licensed for reuse.
      </p>
      {MENU_UNPRICED.length > 0 && <p className="mb-2 text-[11px] text-amber-300">Not in the current catalogue, so left out of simulated orders: {MENU_UNPRICED.join(", ")}.</p>}
      <div className="mb-2 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menu…" className="w-56 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white" aria-label="Search menu" />
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white" aria-label="Brand">
          <option value="">All brands</option>
          <option value="pizzaman">Pizzaman</option>
          <option value="chickenman">Chickenman</option>
          <option value="package">Packages</option>
          <option value="drinks">Drinks</option>
        </select>
      </div>
      <div className="scroll-thin max-h-80 overflow-auto">
        <table className="w-full min-w-[720px] text-left text-[11.5px]">
          <thead className="sticky top-0 bg-[#0b0e13] text-[10px] uppercase tracking-wider text-white/40">
            <tr>
              {["Item", "Category", "Regular", "Promo", "Status", "Verified", "Source"].map((h) => (
                <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="text-white/75">
            {rows.map((i) => (
              <tr key={i.catalogueId} className="border-t border-white/5">
                <td className="px-2 py-1">
                  <span className="text-white">{i.name}</span>
                  {SIMULATED.has(i.slug) && <span className="ml-1.5 rounded bg-amber-400/10 px-1 font-mono text-[9px] text-amber-300">SIMULATED ORDERS</span>}
                  {i.notes && <div className="text-[10px] text-white/35">{i.notes}</div>}
                </td>
                <td className="px-2 py-1 text-white/55">{i.category}</td>
                <td className="px-2 py-1 font-mono">{i.prices.regular !== null ? ghs(i.prices.regular) : <UnavailableBadge />}</td>
                <td className={cx("px-2 py-1 font-mono", i.prices.promotional !== null && "text-emerald-300")}>{i.prices.promotional !== null ? ghs(i.prices.promotional) : "—"}</td>
                <td className="px-2 py-1">{i.available ? "Available" : <span className="text-white/40">Unavailable</span>}</td>
                <td className="px-2 py-1">{i.verification === "verified" ? <VerifiedBadge label={i.verifiedAt} /> : <span className="font-mono text-[9px] text-amber-300">UNVERIFIED</span>}</td>
                <td className="px-2 py-1">
                  <a href={i.sourceUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                    open
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Glass>
  );
}
