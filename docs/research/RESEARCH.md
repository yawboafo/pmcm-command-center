# Pizzaman Chickenman: research notes for the digital-twin demo

Access date for all sources: **2026-11-03**, unless a different date is given.
Companion file: `branches.json` (70 branches).

---

## Sources

| # | Source | What it gave |
|---|--------|--------------|
| S1 | https://www.pizzamanchickenman.com/outlets | The full branch directory. The page embeds a JSON `branchList` with 70 records: name, location text, region, lat/lng, phone, branch code, hours, courier, photo URL. It also states totalOutlets 70, totalShops 69, totalMobileKitchens 1. |
| S2 | https://www.pizzamanchickenman.com/outlets/<NAME>/<id> | Detail page for each branch. All 70 URLs returned HTTP 200. |
| S3 | https://www.pizzamanchickenman.com/about/our-story | History, the two brands, scale, the central kitchens claim, the drive-through claim and awards. |
| S4 | https://www.pizzamanchickenman.com/ (home), /chrisb-app, schema.org JSON-LD | Contact details, founders, founding year, app ratings, office address. |
| S5 | Site CSS (`/_next/static/css/*.css`) and logos (`/logo.png`, CDN `pizzamansite/pizzmanLogo.png`, `ChickenmanLogos.png`) | Colour tokens, fonts, logo pixel colours. |
| S6 | https://chrisb.app/menu and https://chrisb.app/menu/category/{pizzaman/classics, chickenman, packages, drinks} | Menu structure. The full product list came from the page's public `getProducts` call (the same call the browser makes): 199 products with prices. |
| S7 | https://chrisb.app/branches | Shows the same branch IDs as S1. Its JSON-LD says `numberOfItems: 62`. |
| S8 | Official news: `/news/after-5-years-on-wheels-...-tafo/6ad0c9c00217511d7b57453d` (2026-10-15), `/news/recognised-at-2026-ghana-tourism-authority-regional-awards/6ac0f6f9ad7169bac073ffbd` (2026-10-03), `/news/chris-b-app-3-three-years-of-innovation-and-convenience/6ae7c7e012a1b75f5681230d` (2026-11-02), `/news/csw26-...` (2026-10-15) | Tafo branch moved from a truck to a building, regional awards, app statistics. |
| S9 | https://en.wikipedia.org/wiki/Pizzaman-Chickenman | Legal name, HQ, founders, chairman, ">89 branches as of Sept 2025", Nyankyerenase warehouse case (May 2023). |
| S10 | https://starrfm.com.gh/?p=384637 ("Pizza sold for $1000 at Kumasi", 2021-06-06) | Ahodwo opening: 24/7 outlet with Pinkberry attached. |
| S11 | Bolt Food Kumasi article: https://graphic.com.gh/business/business-news/bolt-food-expands-to-kumasi-bringing-popular-restaurants-to-ghanas-second-largest-city.html ; Glovo exit: https://techpoint.africa/news/glovo-to-shut-down-in-ghana/ | Third-party delivery. Seen in search-result summaries only; I did not fetch these pages. |
| S12 | Pinkberry Ghana: https://starrfm.com.gh/2017/07/pinkberry-yogurt-store-opens-in-ghana/ , https://internationalfrozenyogurt.com/froyo-in-ghana-history-trends-and-shops/ | Pinkberry is a separate franchise that shares sites with Pizzaman Chickenman. Seen in search-result summaries only. |
| S13 | Yen.com.gh, CEO hostel-fees story: https://yen.com.gh/people/222007-pizzaman-chicken-ceo-recounts-using-knust-hostel-fees-start-business-wasnt-easy/ | First oven was a used one costing GH₵1,100. Seen in a search-result summary only. |

Social channels (listed on the official site; I did not scrape them because they need a login or render client-side):
- Instagram https://www.instagram.com/pizzamanchickenman
- X https://x.com/pizzamanghana
- Facebook https://www.facebook.com/share/19PngWnJB7
- TikTok https://www.tiktok.com/@pizzamanchickenman_
- Snapchat https://t.snapchat.com/bw6Hqy3u
- LinkedIn https://www.linkedin.com/company/ceqa-food-beverages-limited

---

## 1. Company background

### Verified facts
- **Operator.** The site footer reads "Ceqa Food & Beverages" (S4). Wikipedia gives the legal name as *CEQA Food and Beverages Ghana Company Limited* (S9). Contact email: info@ceqalimited.com.
- **Founding.** January 2018, in a rented apartment in Kotei-Kumasi near KNUST. The founders were Christian Boakye Yiadom (CEO, Actuarial Science student), Ebenezer Essuman-Amankwah (Mathematics student; COO per S9) and Prince Owusu (S3). Schema.org lists Richard Nii-Armah Quaye as a third founder (S4). He is CEO of Quick Angels and chairman per S9.
- **Early history.** They first sold pizza by the slice and folded A4 sheets into boxes. The first full box was sold in April 2018. The first shop was in Ayeduase and took GH₵12,000 in its first month (S3). The first branch was on KNUST Mango Road (S9).
- **Chickenman.** The sister brand launched in 2019 through a partnership with Quick Angels Ghana Ltd. It sells Jollof, fried rice and rice-and-stew alongside chicken (S3).
- **Brand positioning.** "Ghana's largest indigenous fast-food chain" (S4 JSON-LD).
- **Scale stated on the official site (S3).** "70 outlets across Ghana (69 restaurants and 1 mobile kitchens), supported by a dedicated team of 1,500 employees."
- **Drive-throughs.** "The only eatery hub in West Africa to feature two innovative pizza drive-throughs" (S3). **The two locations are not named.**
- **Awards.**
  - The company says it was "Food Company of the Year" at the Ghana Business Awards 2024 (S3). This is a company claim; my web search did not independently confirm it.
  - Four branches won "Fast Food of the Year 2026" at the Ghana Tourism Authority regional awards: Goaso, Bolga, Agona Swedru and Koforidua (S8).
- **24/7 trading.** The Ahodwo (Kumasi) branch opened in June 2021 as a 24/7 outlet, with Pinkberry attached (S10).
- **Office addresses (they conflict).**
  - Site footer: Plot 75 Adumuah Bossman Street, Ring Road Central, Accra, next to Fidelity Bank (S4).
  - Schema.org: "North Legon" (S4).
  - Wikipedia: Osu (S9).
- **Phone.** 0302 753 430 (+233 302 753 430). The site warns "Do NOT Google our contact!" because scammers impersonate the brand.

### Branch-count claims (they conflict)

| Claim | Source |
|---|---|
| **70** outlets, listed one by one with coordinates. **This is the count used.** | S1, S3 |
| 62 | Chris B /branches JSON-LD (S7) |
| "89+ branches across all 16 regions" | Site-wide meta description (S8 pages) |
| "90+ outlets" | Chris B JSON-LD (S6) |
| ">89 branches (Sept 2025)" | Wikipedia (S9) |

The directory covers **11 of the 16 regions**. No branch is listed in Oti, Western North, Savannah, North East or Upper West.

### Assumptions / unknowns
- The "89+/90+" figures may count planned or closed sites, or Pinkberry counters. That is not explained anywhere.
- I could not identify which outlet is the single "mobile kitchen":
  - Aflao Shell and Ho Trafalgar share one photo, which shows a food trailer.
  - Tafo was served by a truck for about 5 years and became a physical branch in Oct 2026.
- The drive-through sites are unknown.

---

## 2. Central kitchens, warehouses and operations

### Verified facts
- "We operate **9 central kitchens and warehouses** that supply all outlets on a **24-hour schedule** … door-to-door deliveries, backed by a dedicated **24-hour call center**" (S3).
- The only facility named publicly is a **company warehouse at Nyankyerenase, near Kumasi**. It appears in a May 2023 theft court case over cooking oil and chicken wings (S9).
- Each branch record has these fields (S1):
  - `pickupOnly`: true for Bogoso Mobik Station, Aflao Shell and Bolgatanga.
  - `deliveryOnly`: false for all branches.
  - Store and delivery hours.
  - `courierType`: ALTIN_COURIER at 52 branches (Greater Accra and Ashanti) and CHRISB_DISPATCH at 18 (the other regions).
- **Store hours.**
  - Most branches: 09:00–23:59.
  - 24 hours (00:00–23:59): Dansoman, East Legon, Ahodwo and KNUST.
  - Opening at 12:00: Abokobi, Ashongman, Mile 7, Asokwa and Kissieman.
  - Amrahia closes at 22:59.
- **Delivery hours.** 09:00–21:00 at every branch.
- **Kitchen and process details that are public:**
  - The pizza is "a fusion of American Deep Dish and Italian-style", with a **default 9.5-inch crust** (S3).
  - Chicken is seasoned with ginger, garlic, *hwentia* and rosemary (S3).
  - Product records give portion specs. For example:
    - Jollof/fried rice portions: 300 g (Guyman Metreat), 400 g (PlayMan), 800 g (Mini bucket), 1,000 g (Maxi bucket).
    - Fried plantain: 80 g.
    - Beef portions: 100 g or 150 g.
    - Coleslaw is a standard side.
  - Pizza ingredient master list: chicken, beef, mortadella, tuna, ham, diced sausage, brisket, chicken crunch/fillet, green pepper, onion, sweet corn, tomato sauce, oyster sauce, BBQ sauce, house cocktail sauce, cheese and flour (S6).
- **Founding equipment.** The founders used a second-hand oven bought for GH₵1,100 and a study table as the counter (S3, S13).

### Assumptions / unknowns
- **No public information** on the locations of the 9 central kitchens, or on oven type (deck vs conveyor), fryer count, cold-chain setup or prep workflow.
- Given 9 hubs supplying 70 outlets, outlets most likely do final assembly and cooking (baking pizza, frying chicken) from centrally prepared dough, sauces and marinated proteins. **This is an assumption.**
- ALTIN_COURIER appears to be a third-party courier integration. CHRISB_DISPATCH appears to be the company's own riders. **Both readings are inferred from field names only.**
- **No public floor plans exist.** I found no floor plans, kitchen layouts or architectural drawings for any branch. Any floor plan in the demo must be labelled illustrative.

---

## 3. Ordering and delivery channels

### Verified facts
- **Chris B app.** This is the company's own app and is free.
  - iOS: https://apps.apple.com/gh/app/chris-b/id6445878198
  - Android: https://play.google.com/store/apps/details?id=com.pizzamangh
  - Web: https://chrisb.app/menu
- **Chris B features** (S8, 2026-11-02, "Chris B @ 3"):
  - Launched about 3 years ago, partly to stop scammers impersonating the brand.
  - Over **450,000 downloads** and **1.6 million orders**. Rated 4.5★ and ranked #2 among food-ordering apps (company claim).
  - Secure payments, real-time tracking, wallet deposits, loyalty points.
  - **Text/chat ordering with "Chris B"** and gamified rewards ("Spin the Wheel").
- **App ratings in structured data.** The site JSON-LD says 4.9 from 29,000 reviews. Chris B's own JSON-LD says 4.7 from 2,500.
- **Phone ordering.** 0302 753 430, plus a phone number for each branch (in `branches.json` under `sourceDetails.branchPhone`).
- **Menu category routes on Chris B.** Pizzaman (`pizzaman/classics`), Chickenman (subcategories Jollof, Fried Rice, Chicken, Potato, Extras), Packages, Drinks. A "Flash Sales" group also exists.
- **Bolt Food.** Pizzaman Chickenman was among the restaurants named when Bolt Food launched in Kumasi (S11).
- **Glovo.** Glovo listed the brand but **left Ghana in May 2024** (S11).

### Assumptions / unknowns
- I did not confirm current Bolt Food availability branch by branch.
- ChowDeck presence comes from one blog post and is low confidence.
- The site's warning suggests the company prefers direct ordering over aggregators.

---

## 4. Menu and prices

Source: Chris B public catalogue (S6), pulled 2026-11-03. **199 products**, all enabled. Prices are base prices in GH₵. `branchPrices` was empty on every record, so no branch-specific prices are published. Many pizzas appear twice, as "X" and "X (N)". These look like duplicate catalogue entries at the same price, apart from Dukeman, where the "(N)" version is GH₵5–10 cheaper.

### Pizzaman pizzas
Pizza sizes: **Small / Medium / Large / Jumbo / Double**. Prices are listed as S / M / L / Jumbo / Double.

| Pizza | Toppings | Prices (GH₵) |
|---|---|---|
| Chicken Pizza | chicken breast, green pepper | 90 / 130 / 150 / 227 / 247 |
| Klarabella (Beef Pizza) | beef, onion, sweet corn | 90 / 130 / 150 / 227 / 247 |
| Kersame | beef, chicken, green pepper, onion | 100 / 135 / 170 / 237 / 257 |
| Morbella | beef, diced sausage, sweet corn | 100 / 135 / 170 / 237 / 257 |
| Beef and Tuna | beef, tuna | 100 / 135 / 170 / 237 / 257 |
| Chilla | chicken breast, chicken sausage, green pepper | 100 / 135 / 170 / 237 / 257 |
| Chicham | chicken, ham, cocktail sauce, onion, green pepper | 100 / 135 / 170 / 237 / 257 |
| Chibella | chicken, beef, diced sausage | 110 / 145 / 190 / 256 / 276 |
| Obiridan | beef, chicken, tuna, BBQ sauce | 110 / 145 / 190 / 256 / 276 |
| Triple C | chicken breast, chicken crunch, chicken fillet | 110 / 145 / 190 / 256 / 276 |
| Breezy | beef, chicken, ham, diced sausage | 120 / 155 / 205 / 275 / 295 |
| Meatzza | beef, brisket, chicken breast, chicken crunch | 120 / 155 / 205 / 275 / 295 |
| Dukeman (top tier) | beef, chicken, ham, sausage, tuna | 130 / 165 / 220 / 294 / 314 |

Other Pizzaman items:
- Guy Man Pizza (mini small + 300 ml Coke): GH₵49.
- Extras: Cheese GH₵25, Vegetables GH₵10, Cocktail Sauce GH₵10.

The homepage also promotes "Tripple C", "Chicham" and "Crisibreezi". Crisibreezi does not appear in the Chris B catalogue; it may be a promotional name.

### Chickenman: Jollof and Fried Rice
Fried rice uses the same ladder and prices as Jollof. "Assorted" versions cost more.

| Item | Contents | Price (GH₵) |
|---|---|---|
| Guyman Metreat Jollof / Fried Rice | 300 g rice, 1 drumstick | 49 (Assorted 69) |
| PlayMan Jollof / Fried Rice | 400 g rice, 80 g plantain, 4 wings, coleslaw | 79 (beef 99; Assorted 99) |
| Jollof / Fried Rice Mini Bucket | 800 g rice, plantain, 8 wings or chicken, coleslaw | 150 (100 g beef 180; Assorted 180) |
| Jollof / Fried Rice Maxi Bucket | 1,000 g rice, plantain, 12 wings or 6 drumsticks | 210 (150 g beef 230; Assorted 230) |

### Chickenman: Chicken
- Chicken Bucket: 5 pcs GH₵55, 10 pcs GH₵105.
- Wings Bucket (tossed wings): 10 pcs GH₵80, 15 pcs GH₵125, 30 pcs GH₵200.
- Variety Bucket (15 pcs): GH₵130.

### Chickenman: Potato and extras (sides)
- Playman Sweet Potato (with 4 wings): GH₵79.
- Sweet Potato Bucket: GH₵130.
- Spicy Sweet Potatoes: Playman GH₵79, Bucket GH₵130.
- Extra Plantain: GH₵10.
- Extra Coleslaw: GH₵10.

### Packages / combos (Pizzaman × Chickenman)
- Complete Guyman (Jollof or Fried Rice; wings or chicken): GH₵99.
- Gen-Z Pack (Chibella Medium pizza + Guyman Jollof or Fried Rice with wings or chicken): GH₵150.
- Borgaman Pack (Chibella or Kersame Medium + Coke 0.45 L + 10 wings): GH₵199.
- Guyman Family Pack (800 g Jollof + 800 g fried rice + 10 wings + 5 drumsticks + kɔkɔɔ/shito + coleslaw): GH₵300.
- Assorted Guyman Family Pack: GH₵400.

### Drinks
| Drink | Price (GH₵) |
|---|---|
| Bottle Water | 5 |
| Tampico 0.5 L | 10 |
| Coke 0.45 L | 15 |
| Alvaro | 15 |
| Malt | 20 |
| Tealeys Sobolo | 25 |
| Apple Cidar | 30 |
| Juices | 30 |
| Coke / Fanta / Sprite 1.5 L | 40 |
| Kiss | 40 |
| Heineken | 40 |
| Juices Premium | 45 |
| Don Simon | 50 |
| Ceres | 60 |
| Just Juice | 60 |
| Welch's | 65 |

### Assumptions / unknowns
- These are online base prices. In-store prices may differ.
- No desserts appear under the Pizzaman Chickenman catalogue. Frozen yoghurt is sold by the co-located Pinkberry outlets (separate brand).
- I did not find the diameters of the pizza sizes. Only the 9.5-inch "default" crust is stated.

---

## 5. Brand identity

### Verified facts
**Colour tokens in the site CSS (S5):**

| Token | Hex |
|---|---|
| `--okw-brand-color-red` | `#EE1D25` (also used as the danger colour) |
| `--okw-brand-color-green` | `#5AB350` |
| `--okw-brand-color-yellow` | `#E7C000` |
| `--okw-brand-color-grey` | `#585858` |

**Colours measured from the logo files:**
- Red `#EE1D25`. This exactly matches the CSS token.
- Chickenman yellow `#FFD400`.
- Pizzaman leaf green `#5AB350`.
- Black `#000000` and white `#FFFFFF`.

**Fonts.** Montserrat and Montserrat Alternates (Google Fonts).

**Logo (combined lockup, `/logo.png`).** Two interlocking **jigsaw-puzzle pieces** with a black outline:
- The left piece is white. It carries the black **"PIZZAMAN"** wordmark with "ESTD 2018" and a pizza-slice icon: a red triangular slice outline with red pepperoni dots and a **green basil leaf**.
- The right piece is red. It carries the **"CHICKEN MAN"** wordmark with a **yellow rooster-head** icon and the script tagline **"it's flaming hot"**.

**Standalone Chickenman logo.** Yellow stylised rooster comb and head. "CHICKEN" is in red and "MAN" in yellow, with a red handwritten tagline "it's flaming hot".

**Standalone Pizzaman mark.** A pizza-slice triangle in a white circular badge.

### Signage as seen in the 64 distinct official branch photos (S1)
- A **white circular Pizzaman badge**, beside illuminated 3-D channel letters "CHICKEN" (white with red outline) and "MAN" (yellow), with the yellow rooster above the "N" and the red script tagline underneath.
- At night the letters are backlit white/blue, and the Pizzaman disc has a blue halo ring.

---

## 6. Store exteriors and interiors

All observations come from the official branch photos (S1 `branchImage`). These are company marketing shots, many taken at grand openings.

### Verified observations (photos)

**Exterior: typical design**
- **Bright red** aluminium-composite cladding: horizontal fascia bands and box frames around **full-height glazed storefronts**.
- Many sites are **two-storey**, with an upstairs glazed dining level and an external staircase.
- Some are converted ground-floor units in mixed-use buildings.

**Exterior: variants**
- Orange and grey cladding (Fawoade).
- Purple pillars (Suame).
- A black-and-red façade with gold trim (Emena).
- White rendered fronts with red signage only (Atonsu, Santasi, Kasoa).

**Exterior: features seen at some sites**
- Outdoor seating under a timber pergola with pendant lanterns (Spintex, KNUST).
- Picnic-style benches on a forecourt (North Kaneshie).
- Artificial-turf entrance strips (Santasi, Suame, Tanoso).
- A large printed banner "The wait is over / Good food is here" on new sites (Ablekuma, Adenta Rowi, Kwabenya).
- Red and white balloon arches at openings.

**Pinkberry co-location**
- **Pinkberry** frozen yoghurt signage (green wordmark with a pink swirl) shares the frontage at many branches. I could see it in 43 branch photos that are unique to their branch.
- Pinkberry Ghana is a **separate franchise** (S12). The branch data has a `branchHasPinkBerry` field, but it is null everywhere.
- In `branches.json`, these 43 sites have brand "Pizzaman Chickenman + Pinkberry". The basis is my visual check of the photos.

**Fuel-station forecourt sites**
- Shell: Mankessim, Aflao, Kwadaso/Sofoline.
- Total: Tema Comm 10.
- GOIL: Tanoso.
- Star Oil: Atonsu.
- Mobik: Bogoso, Tarkwa.
- Kingsperp: Emena.
- The Bolgatanga photo also shows a fuel-station canopy.

**Mobile units.** A white trailer or food truck with pizza graphics and the 0302 753 430 number (photos for Aflao/Ho and Tafo).

**Interior (Buduburam photo, plus glimpses through the glass at Kasoa, Ofankor, Weija and Ahodwo)**
- **Front service counter** along the back wall: red and white counter front, with **digital menu screens (TVs) mounted above**.
- A graphic or mural feature wall.
- Light tiled floor and ceiling downlights.
- Mixed casual seating:
  - wooden-frame chairs;
  - **yellow upholstered armchairs and sofas**;
  - **lime-green** shell chairs;
  - red tables, plus high tables with stools;
  - teal booths (Weija).
- Framed food photos on the walls (Ofankor).

### Assumptions / unknowns
- **Open kitchen? Not visible in any photo.** The kitchen appears to sit behind the counter wall (closed or semi-closed back-of-house). This is unconfirmed.
- Seating capacities and dining-area sizes are not published.
- Some photos are reused across branches, so they cannot be used to verify those sites:
  - Abokobi, Abura, Mankessim and UCC share one photo.
  - Kotobabi, Lashibi and Tema Comm 7 share one photo.
  - Aflao and Ho share one photo.

---

## 7. Notes on `branches.json`

**Coordinates**
- **All 70 branches have coordinates taken from the official directory** (S1). Each branch's Google Maps link is in `sourceDetails.mapLink`, and `coordinateSource` is set to the S1 URL.
- 15 records have coordinates with 4 or fewer decimal places, so roughly ±10 m. A few may be approximate pins rather than storefronts.
- No `approx*` fields were needed.

**Address**
- `address` is the official `branchLocation` text, copied verbatim when it adds something beyond the locality name (for example "17-9 Justice A. Brobbey Ave", "SCC BUS STOP").
- Where the official text only repeats the locality, `address` is null.
- Tafo's address comes from the official news post (S8).
- I invented no addresses.

**City**
- The source gives region only, so I assigned `city` from the locality name. "Accra" means the Greater Accra metropolitan area.

**Region**
- The value is as officially listed. Exception to note: **Kasoa, Kasoa Nyanyanu and Buduburam are listed by the company as Greater Accra, but they are administratively in Central Region.** This is flagged in `sourceDetails.notes`.

**Other fields**
- `operationalStatus` is "operational" because every branch has `enabled: true` on Chris B and appears on the official site on 2026-11-03.
- `restaurantType` is left "unknown". `sourceDetails.siteContext` marks the fuel-station sites.
- `floorPlanType` is "unassigned" everywhere because no public floor plans exist.
