import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration specs drive a real child process and a real screen grab.
    testTimeout: 30_000,
    environment: "node",
  },
});
