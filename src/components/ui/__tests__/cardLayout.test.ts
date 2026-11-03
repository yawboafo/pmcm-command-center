import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardKey, clampPlacement, parseCards, useCardLayout } from "../cardLayout";

const area = { width: 1000, height: 600 };
const card = { width: 300, height: 100 };

describe("clampPlacement", () => {
  it("leaves a card that fits where it is", () => {
    expect(clampPlacement({ x: 200, y: 150 }, card, area)).toEqual({ x: 200, y: 150 });
  });
  it("keeps a card inside every edge, with a margin", () => {
    expect(clampPlacement({ x: -500, y: -500 }, card, area)).toEqual({ x: 12, y: 12 });
    expect(clampPlacement({ x: 5000, y: 5000 }, card, area)).toEqual({ x: 688, y: 488 });
  });
  it("pins a card bigger than its area to the top left", () => {
    expect(clampPlacement({ x: 400, y: 400 }, { width: 2000, height: 2000 }, area)).toEqual({ x: 12, y: 12 });
  });
});

describe("parseCards", () => {
  it("keeps valid hidden and placed state and drops stacking order", () => {
    expect(parseCards('{"map:legend":{"hidden":true,"place":{"x":1,"y":2,"w":3},"z":9}}')).toEqual({ "map:legend": { hidden: true, place: { x: 1, y: 2, w: 3 } } });
  });
  it("survives malformed storage", () => {
    expect(parseCards(null)).toEqual({});
    expect(parseCards("not json")).toEqual({});
    expect(parseCards('{"map:legend":{"hidden":"yes","place":{"x":"1","y":null,"w":3}}}')).toEqual({ "map:legend": {} });
    expect(parseCards('{"map:legend":null}')).toEqual({ "map:legend": {} });
  });
});

describe("card layout store", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: { setItem: vi.fn(), getItem: () => null } });
    useCardLayout.setState({ cards: {}, topZ: 0 });
  });

  it("hides, shows and saves a card", () => {
    const key = cardKey("map", "legend");
    useCardLayout.getState().setHidden(key, true);
    expect(useCardLayout.getState().cards[key].hidden).toBe(true);
    expect(window.localStorage.setItem).toHaveBeenCalledWith("ops.cards.v1", JSON.stringify({ [key]: { hidden: true } }));
    useCardLayout.getState().setHidden(key, false);
    expect(useCardLayout.getState().cards[key].hidden).toBe(false);
  });

  it("raises the last touched card above the others", () => {
    const { raise } = useCardLayout.getState();
    raise("map:a");
    raise("map:b");
    const { cards } = useCardLayout.getState();
    expect(cards["map:b"].z).toBeGreaterThan(cards["map:a"].z!);
  });

  it("resets one area without touching the other", () => {
    const s = useCardLayout.getState();
    s.setHidden("map:legend", true);
    s.place("map:filters", { x: 1, y: 2, w: 3 });
    s.setHidden("camera:alerts", true);
    s.resetArea("map");
    expect(Object.keys(useCardLayout.getState().cards)).toEqual(["camera:alerts"]);
  });

  it("puts a single card back", () => {
    const s = useCardLayout.getState();
    s.place("map:legend", { x: 1, y: 2, w: 3 });
    s.resetCard("map:legend");
    expect(useCardLayout.getState().cards["map:legend"]).toBeUndefined();
  });
});
