# What Chris sees — one page per camera zone

Each zone answers one question in under a minute: the big number, three or four supporting
numbers with yesterday beside them, and an alert that says what is wrong and what to do.
Everything is drawn from the branch's single simulation state (`docs/CAMERAS.md` §4).

---

## 1 · Front counter — "Is the queue too long, and is the till handled properly?"

**Camera**: high behind the tills, looking over the cashiers at the queue line.
**Big number**: **In queue** (green < 4 · amber 4–6 · red ≥ 7).
**Also**: Longest wait (amber 3 min · red 5 min) · Tills staffed "2 of 2" · Avg service (last 10 orders) · Till drawer (Closed / Open · sale / Open, no sale).
**On the feed**: a dashed queue line with "Queue 7 · longest 5:40"; a box on every person, the front customer labelled with their wait; cashiers labelled by name and "at post", "on break" or "away 4 min"; drinks-fridge temperatures.
**Alerts**: *Queue building at the counter* ("Queue 9 deep, longest wait 5:40, 1 of 2 tills staffed. → Move Kofi from packing to till 2.") · *No one at the till* · *Till drawer open with no sale* (critical after 45 s: "→ Ask the manager to check the till now and count the drawer.").
**Yesterday chips**: queue, longest wait, tills, service — modelled from the demand pattern.

## 2 · Kitchen & fryers — "Is the kitchen keeping up?"

**Camera**: fryer-room corner with clearance, looking down the fry line.
**Big number**: **Orders in kitchen** (thresholds scale with branch size).
**Also**: Oldest order "14 min · #1042" (amber 8 · red 12) · Fryers busy "2 of 4" · Fryer oil, lowest (red below the change threshold) · Cooks at post "7 of 8".
**On the feed**: order tags at each station ("#1042 · 7:20") that age green → amber → red; one oil badge on the worst fryer; hot-holding temperatures; cooks labelled with time away from the line.
**Alerts**: *Order over 12 minutes in the kitchen* (names the station that is backed up and who to move) · *Cook away from the line* · *Oil change due* (sensor).

## 3 · Heat lamp & pass — "Is food sitting too long under the lamp?"

**Camera**: in front of the hot-holding and pass, where the packers stand.
**Big number**: **Orders waiting** at the pass.
**Also**: Longest under lamp (amber 5 min · red 10) · Hot holding °C (must stay ≥ 63 °C) · Cook checks passed (last 20) · Chicken held vs target.
**On the feed**: tags on packed orders with their time under the lamp; cabinet temperatures.
**Alerts**: *Food waiting too long under the lamp* ("4 packed orders at the pass, oldest 9:10 (2 waiting for riders). → Call the next riders in and hand over the oldest bags first.") · hot-holding below limit (sensor).

## 4 · Dining area — "Is the dining area clean and comfortable?"

**Camera**: corner furthest from the entrance, wide lens over the tables.
**Big number**: **Seats taken** "12 / 61".
**Also**: Waiting for food · Spills ("1 · 6 min") · Next clean ("in 40 min" / "Overdue 12 min").
**On the feed**: people boxes; ten-minute occupancy heat map (toggle) to see where people actually sit and queue.
**Alerts**: *Spill not cleaned* after 4 min ("→ Send Ama with a mop and a wet-floor sign.") · *Dining clean overdue*.

## 5 · Pickup & rider bay — "Riders waiting for orders, or orders waiting for riders?"

**Camera**: dispatch-room corner, watching the rack and the riders' waiting spot.
**Big number**: **Riders waiting**.
**Also**: Longest rider wait (amber 5 · red 8 min) · Orders waiting for riders · Avg hand-over (ready → collected).
**On the feed**: riders labelled "Rider · waiting 6:30"; packed delivery orders tagged on the rack with their age.
**Alerts**: *Rider waiting too long* (lists the order numbers still in the kitchen) · *Orders packed but no rider* ("→ Call the delivery partner for more riders, or send the branch rider now.").

## 6 · Cold room & storage — "Is the cold room door shut and the temperature steady?"

**Camera**: inside the cold room, corner opposite the door.
**Big number**: **Cold room °C** (red above 5 °C, amber within 1 °C of it; "Sensor offline" if the probe stops).
**Also**: Door "Open · 1:20" / "Closed" (amber 30 s · red 90 s) · Openings today · Stock lines low.
**On the feed**: door badge anchored above the door; cabinet temperatures; whoever is fetching stock, named.
**Alerts**: *Cold room door left open* ("Cold room door open for 2 min, temperature 5.8 °C. → Ask Dzifa to shut the cold room door and check the seal.") · temperature above limit and sensor connectivity (sensor).

## 7 · Entrance & car park — "How busy is the front, and what is the weather doing to it?"

**Camera**: on the facade, below the sign, looking over the forecourt.
**Big number**: **Walk-ins last hour**.
**Also**: Last 10 min · Walked away (customers who left because of the queue) · Weather ("Light rain · clears in 40 min") · Door openings.
**On the feed**: arriving customers boxed; rain when it rains, dusk and night lighting as the day goes.
**Alerts**: none of its own — it feeds the counter rules; walk-outs turn the card amber/red.

## 8 · Back door & staff exit — "Is the back door opening when it should not?"

**Camera**: inside, facing the staff / delivery / emergency exit.
**Big number**: **Back door** "Closed" / "Open · 2:10" (red if the branch is closed).
**Also**: After-hours openings · Last opened · Staff outside · Openings today.
**On the feed**: door badge; staff going out on a break labelled "on break".
**Alerts**: *Back door opened after hours* (critical within seconds: "→ Check the camera and call the branch manager now.") · *Back door left open* during service.

---

**On every zone**: ticking timestamp, SIMULATED chip, link health; the last hour on a timeline
with alert / rush / shift / delivery / saved-moment markers; scrub or play at 1× / 4× / 16×;
Snapshot · 30 s clip · Share · Flag · Note. Three taps from the grid to an action.
