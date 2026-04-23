import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default {
  root: resolve(__dirname, "tests"),
  test: {
    environment: "node",
    globals: true,
    include: ["unit/**/*.test.js"],
    exclude: [
      "**/node_modules/**",
      "../.claude/worktrees/**",
      "../.worktrees/**",
      ".claude/worktrees/**",
      ".worktrees/**",
      "**/.claude/worktrees/**",
      "**/.worktrees/**",
    ],
    silent: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "open-sse": resolve(__dirname, "open-sse"),
    },
  },
};
