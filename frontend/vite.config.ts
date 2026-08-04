import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * We use vite-plugin-pwa (which wraps Workbox under the hood) rather than
 * hand-rolling a service worker file. Hand-written service workers are a
 * classic source of subtle cache-invalidation bugs — Workbox's generated
 * precache manifest + versioning handles "did my new deploy actually
 * replace the cached assets" correctly, which is exactly the kind of thing
 * that's easy to get wrong under exam-day time pressure.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Intelli-Attach",
        short_name: "IntelliAttach",
        description: "Geo-verified industrial attachment & logbook platform",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // Network-first for API calls (we want fresh data when online, and
        // graceful fallback to whatever's cached when offline). Cache-first
        // for the static app shell (JS/CSS/HTML), since those only change on
        // deploy, not on every request.
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: true }, // test the SW during `vite dev`, not just prod builds
    }),
  ],
  server: { port: 5173 },
});
