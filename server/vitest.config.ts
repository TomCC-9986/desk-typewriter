import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false, // hibernatable WebSockets don't work with isolated storage
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
