"""Convert research/branches.json (verified official directory data) into the app's branch dataset.

Floor-plan assignment is a DEMO assumption (no real layouts are public):
  1. Demo trio requested by the client: East Legon -> C, Spintex -> B, KNUST -> A.
  2. Other 24-hour outlets (official store hours 00:00-23:59) -> C (flagship format).
  3. Filling-station, pickup-only and mobile-kitchen outlets -> A (compact takeaway).
  4. Remaining Greater Accra / Ashanti outlets -> B; all others -> A.
Usage: python3 -I scripts/import-branches.py ../research/branches.json src/data/branches.json
"""
import json, sys

src, dst = sys.argv[1], sys.argv[2]
raw = json.load(open(src))
DEMO = {"East Legon": ("C", "Demo flagship (client-selected)"), "Spintex": ("B", "Demo standard branch (client-selected)"), "KNUST": ("A", "Demo compact branch (client-selected)")}
out = []
for b in raw:
    sd = b["sourceDetails"]
    hours = b.get("operatingHours") or {}
    notes = " ".join(sd.get("notes") or [])
    is24 = hours.get("storeOpen") == "00:00" and hours.get("storeClose") == "23:59"
    mobile = "truck" in notes.lower() or "trailer" in notes.lower()
    if b["name"] in DEMO:
        fmt, why = DEMO[b["name"]]
    elif is24:
        fmt, why = "C", "24-hour outlet -> flagship template"
    elif sd.get("siteContext") or sd.get("pickupOnly") or mobile:
        fmt, why = "A", "Filling-station / pickup-only / mobile outlet -> compact template"
    elif b["region"] in ("Greater Accra", "Ashanti"):
        fmt, why = "B", "Metro outlet -> standard template"
    else:
        fmt, why = "A", "Regional outlet -> compact template"
    out.append({
        "id": b["id"],
        "name": b["name"],
        "brand": b["brand"],
        "region": b["region"],
        "city": b["city"],
        "lat": b["latitude"],
        "lng": b["longitude"],
        "coordinatePrecision": sd.get("coordinatePrecisionDecimals"),
        "hours": {k: hours.get(k) for k in ("storeOpen", "storeClose", "deliveryOpen", "deliveryClose")},
        "is24h": is24,
        "pickupOnly": bool(sd.get("pickupOnly")),
        "siteContext": sd.get("siteContext"),
        "phone": sd.get("branchPhone"),
        "courierType": sd.get("courierType"),
        "notes": notes or None,
        "source": b["source"],
        "coordinateSource": b["coordinateSource"],
        "lastVerified": b["lastVerified"],
        "floorPlanType": fmt,
        "floorPlanReason": why,
    })
json.dump(out, open(dst, "w"), indent=1, ensure_ascii=False)
from collections import Counter
print(len(out), Counter(x["floorPlanType"] for x in out))
