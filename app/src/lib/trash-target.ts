export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface DockInfo { tileSize: number; iconCount: number }

export const DEFAULT_DOCK: DockInfo = { tileSize: 48, iconCount: 14 };

/** Estimated screen position of the Trash (mac Dock) or Recycle Bin (Windows desktop, top-left). */
export function trashTarget(platform: string, bounds: Rect, work: Rect, dock: DockInfo = DEFAULT_DOCK): Point {
  if (platform !== "darwin") return { x: work.x + 40, y: work.y + 40 };
  const half = dock.tileSize / 2;
  const len = dock.iconCount * dock.tileSize + 24;
  const bottomGap = bounds.y + bounds.height - (work.y + work.height);
  const leftGap = work.x - bounds.x;
  const rightGap = bounds.x + bounds.width - (work.x + work.width);
  const alongX = Math.min(bounds.x + bounds.width - half, Math.round(bounds.x + bounds.width / 2 + len / 2 - half));
  const alongY = Math.min(bounds.y + bounds.height - half, Math.round(bounds.y + bounds.height / 2 + len / 2 - half));
  if (bottomGap > 8) return { x: alongX, y: Math.round(bounds.y + bounds.height - bottomGap / 2) };
  if (leftGap > 8) return { x: Math.round(bounds.x + leftGap / 2), y: alongY };
  if (rightGap > 8) return { x: Math.round(bounds.x + bounds.width - rightGap / 2), y: alongY };
  return { x: alongX, y: bounds.y + bounds.height - 10 }; // auto-hidden dock
}

export function countTiles(defaultsOutput: string): number {
  return (defaultsOutput.match(/"tile-data"/g) ?? []).length;
}
