import { describe, expect, it } from "vitest";
import { countTiles, trashTarget } from "./trash-target";

const bounds = { x: 0, y: 0, width: 1440, height: 900 };
const dock = { tileSize: 48, iconCount: 10 };

describe("trashTarget", () => {
  it("windows: recycle bin at top-left of work area", () => {
    expect(trashTarget("win32", bounds, { x: 0, y: 0, width: 1440, height: 860 })).toEqual({ x: 40, y: 40 });
  });

  it("mac bottom dock: right end of the dock", () => {
    const p = trashTarget("darwin", bounds, { x: 0, y: 25, width: 1440, height: 805 }, dock);
    // dock length = 10*48+24 = 504 → right end at 720+252=972, minus half tile → 948
    expect(p).toEqual({ x: 948, y: 865 });
  });

  it("mac left dock: bottom end of the dock", () => {
    const p = trashTarget("darwin", bounds, { x: 70, y: 25, width: 1370, height: 875 }, dock);
    expect(p).toEqual({ x: 35, y: 678 });
  });

  it("mac hidden dock: assume bottom edge", () => {
    const p = trashTarget("darwin", bounds, { x: 0, y: 25, width: 1440, height: 875 }, dock);
    expect(p).toEqual({ x: 948, y: 890 });
  });

  it("clamps inside the screen", () => {
    const p = trashTarget("darwin", bounds, { x: 0, y: 25, width: 1440, height: 805 }, { tileSize: 48, iconCount: 60 });
    expect(p.x).toBe(1416);
  });

  it("counts dock tiles in `defaults read` output", () => {
    expect(countTiles('(\n    {\n        "tile-data" = {\n        };\n    },\n    {\n        "tile-data" = {\n        };\n    }\n)')).toBe(2);
    expect(countTiles("")).toBe(0);
  });
});
