import fs from "node:fs"
import path from "node:path"
import { defineConfig } from "vite"
import pkg from "./package.json" with { type: "json" }

export default defineConfig({
  define: {
    __CALINE_VERSION__: JSON.stringify(pkg.version)
  },
  build: {
    target: "es2020",
    lib: {
      entry: path.resolve(import.meta.dirname, "src/index.ts"),
      name: "Caline",
      fileName: () => "v1.js",
      formats: ["iife"]
    },
    rollupOptions: {
      output: {
        extend: true,
        exports: "named"
      }
    },
    cssCodeSplit: false,
    minify: "esbuild",
    emptyOutDir: true
  },
  plugins: [
    {
      name: "inline-css-and-copy",
      closeBundle() {
        const distDir = path.resolve(import.meta.dirname, "dist")
        const jsFile = path.resolve(distDir, "v1.js")
        const cssFile = path.resolve(distDir, "client.css")
        const destDir = path.resolve(
          import.meta.dirname,
          "../web/public/client"
        )
        const destFile = path.resolve(destDir, "v1.js")

        if (fs.existsSync(jsFile)) {
          let jsContent = fs.readFileSync(jsFile, "utf8")
          if (
            fs.existsSync(cssFile) &&
            !jsContent.includes('id="caline-style"')
          ) {
            const cssContent = fs.readFileSync(cssFile, "utf8")
            const injectionCode = `\n(function(){if(typeof document!=="undefined"){var st=document.getElementById("caline-style");if(!st){st=document.createElement("style");st.id="caline-style";st.textContent=${JSON.stringify(cssContent)};document.head.appendChild(st);}}})();\n`
            jsContent = injectionCode + jsContent
            fs.writeFileSync(jsFile, jsContent, "utf8")
          }
          fs.mkdirSync(destDir, { recursive: true })
          fs.copyFileSync(jsFile, destFile)
        }
      }
    }
  ],
  test: {
    environment: "jsdom",
    globals: true
  }
})
