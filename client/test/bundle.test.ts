import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

describe("Caline Client Bundle", () => {
  it("generates v1.js and gzip size is <= 30KB", () => {
    const bundlePath = path.resolve(import.meta.dirname, "../dist/v1.js")
    expect(fs.existsSync(bundlePath)).toBe(true)

    const content = fs.readFileSync(bundlePath)
    const compressed = zlib.gzipSync(content)
    const sizeInKb = compressed.length / 1024

    // 规格 §7、§12：目标 gzip <= 30KB
    expect(sizeInKb).toBeLessThanOrEqual(30)
    expect(compressed.length).toBeLessThanOrEqual(30 * 1024)
  })

  it("syncs v1.js to web/public/client/v1.js", () => {
    const publicPath = path.resolve(
      import.meta.dirname,
      "../../web/public/client/v1.js"
    )
    expect(fs.existsSync(publicPath)).toBe(true)

    const publicContent = fs.readFileSync(publicPath)
    const distContent = fs.readFileSync(
      path.resolve(import.meta.dirname, "../dist/v1.js")
    )
    expect(publicContent.equals(distContent)).toBe(true)
  })
})
