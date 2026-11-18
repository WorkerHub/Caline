import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "ui-dev-fallback",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (
            req.url &&
            (req.url === "/ui" || req.url.startsWith("/ui/")) &&
            !req.url.includes(".")
          ) {
            req.url = "/ui/index.html"
          }
          next()
        })
      }
    }
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src")
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        ui: path.resolve(import.meta.dirname, "ui/index.html")
      }
    }
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      },
      "/manifest.webmanifest": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      }
    }
  }
})
