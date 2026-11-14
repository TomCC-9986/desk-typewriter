// Bundle the live typewriter (web/demo.ts + the app's machine3d/sound/layout) into public/assets/demo.js.
// The app embeds its full-size model; the page fetches assets/typewriter.glb (meshopt + webp, ~2 MB) instead.
// Usage: node build-web.mjs   (after prepare.mjs, which copies assets/ into public/)
import { build } from "../app/node_modules/esbuild/lib/main.js";
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const shared = fileURLToPath(new URL("../shared/", import.meta.url));
await build({
  entryPoints: ["web/demo.ts"], bundle: true, format: "esm", target: "es2020", minify: !process.env.DEV, sourcemap: false,
  outfile: "public/assets/demo.js", nodePaths: ["../app/node_modules"], logLevel: "info",
  plugins: [{
    name: "web",
    setup(b) {
      b.onResolve({ filter: /^@shared\// }, (a) => ({ path: shared + a.path.slice(8) + ".ts" }));
      b.onResolve({ filter: /typewriter\.glb$/ }, () => ({ path: "glb-stub", namespace: "stub" }));   // not bundled on the web
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default new Uint8Array(0);", loader: "js" }));
    },
  }],
});
mkdirSync("public/img", { recursive: true });
cpSync("../app/src/windows/typewriter/img/paper_aged.jpg", "public/img/paper_aged.jpg");
