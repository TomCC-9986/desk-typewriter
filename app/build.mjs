import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const common = { bundle: true, sourcemap: true, logLevel: "info", tsconfig: "tsconfig.json", loader: { ".glb": "binary" } };
if (process.env.DESK_RELEASE === "1" && !process.env.DESK_SERVER) throw new Error("DESK_SERVER is required for release builds");
const define = process.env.DESK_SERVER
  ? { "process.env.DESK_SERVER_DEFAULT": JSON.stringify(process.env.DESK_SERVER) }
  : {};

await build({ ...common, define, entryPoints: ["src/main/index.ts"], outfile: "dist/main.js", platform: "node", format: "cjs", external: ["electron"] });
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.js", platform: "node", format: "cjs", external: ["electron"] });

for (const w of ["typewriter", "feeder", "note", "fx", "panel"]) {
  await mkdir(`dist/windows/${w}`, { recursive: true });
  await build({ ...common, entryPoints: [`src/windows/${w}/${w}.ts`], outfile: `dist/windows/${w}/${w}.js`, platform: "browser", format: "iife" });
  await cp(`src/windows/${w}/${w}.html`, `dist/windows/${w}/${w}.html`);
  await cp(`src/windows/${w}/${w}.css`, `dist/windows/${w}/${w}.css`);
  if (existsSync(`src/windows/${w}/img`)) await cp(`src/windows/${w}/img`, `dist/windows/${w}/img`, { recursive: true });
}
await cp("src/windows/common.css", "dist/windows/common.css");
