import { build } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
await build({
  configFile: false,
  root: path.join(root, "renderer"),
  base: "./",
  build: {
    outDir: path.resolve(root, "../../tmp/interaction-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.join(root, "renderer/index.html"),
        worklet: path.join(root, "renderer/audio-worklet.mjs"),
      },
      output: { entryFileNames: "assets/[name].js" },
    },
  },
});
