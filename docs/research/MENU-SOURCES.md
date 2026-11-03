# Menu catalogue: sources and refresh

File: `src/data/menu-catalogue.json` (written by `scripts/import-menu.ts`).
Last retrieval: **2026-11-03T17:39Z**.

## Source and endpoint

- Site: https://chrisb.app/menu (Chris B, the company's own ordering app).
- The category pages load products in the browser with a public Next.js **server action** named `getProducts`. The browser sends `POST https://chrisb.app/menu/category/<page>` with the header `Next-Action: 7f958f021d39ba9f26246f5b63fedc9f961b601255` and a JSON body that holds the react-query context (`queryKey`, `pageParam`). The response is an RSC text stream. Row `1:` holds `{ data: { productList, nextCursor, hasNextPage } }`.
- The action id is a build hash and will change when the site is redeployed. The script reads it from the `/menu` page's JS chunks on every run (`createServerReference("<id>", …, "getProducts")`). If that lookup fails, set `MENU_ACTION_ID` to override it.
- The script sends the same queries the pages send, with no branch selected: Pizzaman Classics (`productionCategory: PIZZAMAN`), Chickenman and each subcategory tab (`CHICKENMAN`, `categoryIds: [jollof|friedRice|chicken|potato|extras]`), Packages (`PIZZAMAN_CHICKENMAN`), Drinks (`DRINKS`) and the "Flash Sales" strip (`exactFamilyList` read from the `/menu` page config). It also runs one unfiltered call to check that nothing is missing. It pages through `nextCursor` and waits 400 ms between calls. No auth, cookies or bot-protection bypass is involved. An HTTP error stops the run.
- Prices: `unitPrice` is in **pesewas**, so the script divides it by 100 (for example 2000 = GH₵20). The rendered pages confirm this (see the cross-check below).
- `branchPrices` is empty and `priceMultiplier` is 1 on all 199 records. No record has a discount (`discountPercentage` and `discountAmount` are 0, and there are no start or end dates). So `promotional` and `delivery` are `null` and `branch` is `{}` everywhere.

## Item counts (199 products, all `enabled`)

| Category | Items |
|---|---|
| Pizzaman > Classics | 119 (13 pizza families × sizes, including "(N)" duplicates, plus Guy man pizza and 3 add-ons) |
| Chickenman > Jollof | 19 |
| Chickenman > Fried Rice | 19 |
| Chickenman > Chicken | 6 |
| Chickenman > Potato | 4 |
| Chickenman > Extras | 2 |
| Packages | 12 |
| Drinks | 18 |

**197 verified, 2 unverified.** The unfiltered call returned the same 199 records as the union of the category-page calls.

"verified" means all of the following hold:
- the query of the page a customer opens returned the item;
- the price is the same in every query that returned it;
- the price is a plain base price (multiplier 1, no branch overrides).

Pizza add-ons are verified only if a product sheet offers them.

## Unverifiable

- **Vegetables** (GH₵10) and **Cocktail Sauce** (GH₵10): the API returns them with the Pizzaman family `EXTRAS`. The Classics page does not show them as cards, and no product offers them as an add-on. Only Cheese (GH₵25) appears as an add-on, on 83 product sheets. Both are marked `unverified`.
- Delivery prices and branch-specific prices are not published, so none are recorded.
- In-store prices are not covered. These are online base prices.

## Cross-check (2026-11-03)

**Against RESEARCH.md §4 (170 price points compared):**
- Every pizza ladder (13 families × 5 sizes, including the "(N)" entries) matches.
- Guy man pizza and the 3 add-ons match.
- All Jollof and Fried Rice tiers match, including Assorted and beef.
- The chicken buckets, wings buckets, Variety Bucket, potatoes, plantain and coleslaw match.
- All 12 packages and all 18 drinks match.
- The only differences are the five **Dukeman "(N)"** prices: 125 / 160 / 215 / 284 / 304 against 130 / 165 / 220 / 294 / 314. RESEARCH.md already says Dukeman (N) is GH₵5 to 10 cheaper, so this is not a discrepancy. The (N) descriptions also differ: "Chicken Sausage" instead of "Ham, Diced Sausage".

Non-price differences from RESEARCH.md (descriptions only):
- **Chicken Pizza:** the un-suffixed entries say "Chicken Breast, Onion and Green Pepper". The "(n)" entries and the page card say "Chicken Breast and Green Pepper".
- **Morbella "(N)":** says "Chicken Sausage" where the other entries say "Diced Sausage".
- **Meatzza "(N)":** lists the same toppings in a different order.
- **Complete Guyman:** includes a Guyman Pizza and a Coke 0.35 L, which RESEARCH.md does not mention.
- **Mini and Maxi buckets:** the "Chicken" variant has 4 drumsticks (Mini) or 6 drumsticks (Maxi), not "8 wings or chicken".

**Against the live pages (rendered in a browser, no location set):**
- **Drinks page:** all 18 drinks show the same prices (Coke card 15.00 to 40.00).
- **Classics page:** all 13 family price ranges match the catalogue's min and max. Examples: Dukeman 125 to 314, which includes the (N) entries; Chicken pizza 90 to 247; Klarabella, shown as "Beef pizza", 90 to 247. Guy man pizza shows GH₵49.
- **Product sheets** (size or protein pickers):

  | Sheet | Prices shown (GH₵) |
  |---|---|
  | Chibella | S110 / M145 / L190 / Jumbo256 / Double276 |
  | Klarabella | 90 / 130 / 150 / 227 / 247 |
  | Chicken pizza | both ladders: 90 / 130 / 150 / 227 / 247 |
  | Dukeman | all 10 prices, including (N) |
  | PlayMan Jollof | Wings 79, Chicken 79, Beef 99 |
  | Wings bucket | 80 / 125 / 200 |
  | Gen-Z Pack | 4 × 150 |
  | Coke | 0.45 L 15, 1.5 L 40 |

  The Cheese add-on shows GH₵25.
- **Chickenman Jollof tab:** 8 family cards; the prices and ranges match.
- **Chickenman Chicken tab:** 10 bucket 105, 5 bucket 55, Wings 80 to 200, Variety 130.
- **Packages page:** Borgaman 199, Complete Guyman 99 (Jollof and Fried Rice), Gen-Z 150, Assorted Family 400, Family 300.
- The Chickenman "All" tab rendered empty without a branch. The subcategory tabs rendered normally.

Other observations:
- **Flash Sales:** the "Flash Sales" strip on `/menu` lists the families `CHICKEN_BUCKET` (5 Bucket only; the 10 bucket is in family `CHICKENBUCKET`), `PLAYMAN_CHICKENMAN_JOLLOFNW` and `PLAYMAN_FRIEDRICE`. None of them has a discount, so no promotional price is recorded, and `notes` says so.
- **"(N)" entries:** kept as separate items with a `-n` slug suffix and a note that names their un-suffixed twin.
- **Size field typos:** the source spells the size `STANADARD` or `STNADARD` on 3 records. The script records this in `notes`.

## JSON fields beyond the requested schema

- `categoryUrl`: the category page or tab URL.
- `sourceFamily`: the raw `family` code.
- `sourceSize`: the raw `size`.
- `source.priceUnit`

`size` is set only for pizzas (`S|M|L|Jumbo|Double`). Every other item has `size: null`, and the raw value is kept in `sourceSize` (for example `0.45L`, `10PCS`, `MINI`). `sourceUrl` is the product sheet URL in the format the site's own cards use: `/product/<family>/<familyName>/<size>/<id>?outlet=`.

## Slugs

- Pizzas: `pizzaman-<stem>-<small|medium|large|jumbo|double>[-n]`. The stem comes from the family code through an explicit map (`BEEF_PIZZA` maps to `klarabella`, `TRIPLE_C_PIZZA` maps to `triple-c`).
- Everything else: `<brand>-<kebab(name)>`.
- Slugs are **sticky per `catalogueId`**: a refresh reuses the slug already in the JSON, so renames at the source do not break recipe mappings.

## How to refresh

```sh
cd web
npx tsx scripts/import-menu.ts            # writes src/data/menu-catalogue.json
npx tsx scripts/import-menu.ts --dry-run  # summary only
npx tsx scripts/import-menu.ts --raw /tmp/chrisb-raw.json  # also keep raw responses for audit
```

On Node 22.6 or later, `node scripts/import-menu.ts` also works.

After a refresh:
- Check the printed counts and the `unverified` items.
- Review the git diff of the JSON before committing.

The run fails loudly in these cases:
- the action id cannot be found;
- the response shape changes;
- a new `productionCategory` appears.
