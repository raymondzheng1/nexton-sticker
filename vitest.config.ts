import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/index.ts",
        "**/*.d.ts",
        "src/store/adapters/**", // thin IO glue (IndexedDB/Upstash) — covered by the contract + integration
        "src/app/**", // Next routes/UI — verified via handler unit tests + next build + manual viewport pass
      ],
    },
  },
});
