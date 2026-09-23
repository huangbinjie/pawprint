import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [
    {
      name: "dev-refresh-csp",
      apply: "serve",
      transformIndexHtml: {
        order: "pre",
        handler: (html) =>
          html
            .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
            .replace(
              "ws://localhost:5173",
              "ws://localhost:5173 ws://127.0.0.1:5173",
            ),
      },
    },
    react({ jsxImportSource: "@pawprint/i18n" }),
  ],
  base: "./",
  resolve: { alias: { "@pawprint/i18n": fileURLToPath(new URL("./src/i18n", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
