import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, shell } from "electron";
import type { Note } from "@shared/protocol";
import { noteFileBody, noteFileName } from "../lib/note-file";
import { countTiles, DEFAULT_DOCK, type DockInfo } from "../lib/trash-target";

const defaultsRead = (key: string) =>
  new Promise<string>((resolve) => execFile("defaults", ["read", "com.apple.dock", key], (err, out) => resolve(err ? "" : out)));

export async function readDockInfo(): Promise<DockInfo> {
  if (process.platform !== "darwin") return DEFAULT_DOCK;
  const [tile, apps, others] = await Promise.all([defaultsRead("tilesize"), defaultsRead("persistent-apps"), defaultsRead("persistent-others")]);
  // +5: Finder, Trash, and a guess for running / recent apps not pinned
  return { tileSize: Number(tile.trim()) || DEFAULT_DOCK.tileSize, iconCount: countTiles(apps) + countTiles(others) + 5 };
}

/** Writes the note as a .txt and moves it to the system Trash / Recycle Bin. */
export async function trashNoteFile(n: Note): Promise<void> {
  const dir = join(app.getPath("temp"), "desk-typewriter");
  await mkdir(dir, { recursive: true });
  const file = join(dir, noteFileName(n));
  await writeFile(file, noteFileBody(n), "utf8");
  try {
    await shell.trashItem(file);
  } catch (e) {
    console.error("trashItem failed", e);
  }
}
