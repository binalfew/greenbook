import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const MODE = process.env.NODE_ENV;

export default defineConfig(({ isSsrBuild }) => ({
  build: {
    target: "es2022",
    cssCodeSplit: MODE === "production",
    sourcemap: MODE === "development",
    rollupOptions: isSsrBuild
      ? {
          input: "./server/app.ts",
        }
      : undefined,
  },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
}));
