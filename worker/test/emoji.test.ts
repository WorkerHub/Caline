import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { EMOJI_MANIFESTS } from "../src/data/emojis"
import { initializedContext, request } from "./support/app"

describe("Self-hosted Emoji Packages & Manifest Endpoints", () => {
  it("serves qq emoji manifest with correct headers and mapping", async () => {
    const ctx = await initializedContext()
    const res = await request(ctx.env, "/emoji/qq/manifest.json")
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    )
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")

    const data = (await res.json()) as Record<string, string>
    expect(data.smile).toBe("qq_smile.gif")
    expect(Object.keys(data).length).toBe(199)
  })

  it("serves weibo emoji manifest with correct headers and mapping", async () => {
    const ctx = await initializedContext()
    const res = await request(ctx.env, "/emoji/weibo/manifest.json")
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    )
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")

    const data = (await res.json()) as Record<string, string>
    expect(data.doge).toBe("weibo_doge.png")
    expect(Object.keys(data).length).toBe(89)
  })

  it("serves bilibili emoji manifest with correct headers and mapping", async () => {
    const ctx = await initializedContext()
    const res = await request(ctx.env, "/emoji/bilibili/manifest.json")
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    )
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")

    const data = (await res.json()) as Record<string, string>
    expect(data.doge).toBe("bb_doge.png")
    expect(Object.keys(data).length).toBe(51)
  })

  it("returns 404 for invalid or prototype pollution emoji groups", async () => {
    const ctx = await initializedContext()
    const resNonexistent = await request(
      ctx.env,
      "/emoji/nonexistent/manifest.json"
    )
    expect(resNonexistent.status).toBe(404)

    const resProto = await request(ctx.env, "/emoji/__proto__/manifest.json")
    expect(resProto.status).toBe(404)

    const resConstructor = await request(
      ctx.env,
      "/emoji/constructor/manifest.json"
    )
    expect(resConstructor.status).toBe(404)
  })

  it("cross-checks static manifest.json and EMOJI_MANIFESTS to prevent drift", () => {
    const emojiRoot = path.resolve(
      import.meta.dirname,
      "../../web/public/emoji"
    )
    const groups = ["qq", "weibo", "bilibili"] as const

    for (const group of groups) {
      const manifestPath = path.join(emojiRoot, group, "manifest.json")
      expect(fs.existsSync(manifestPath)).toBe(true)

      const staticManifest = JSON.parse(
        fs.readFileSync(manifestPath, "utf8")
      ) as Record<string, string>
      const runtimeManifest = EMOJI_MANIFESTS[group]

      expect(staticManifest).toEqual(runtimeManifest)
    }
  })

  it("verifies physical static assets exist in web/public/emoji and correspond to manifests", () => {
    const emojiRoot = path.resolve(
      import.meta.dirname,
      "../../web/public/emoji"
    )
    const groups = ["qq", "weibo", "bilibili"] as const

    for (const group of groups) {
      const groupDir = path.join(emojiRoot, group)
      expect(fs.existsSync(groupDir)).toBe(true)

      const manifestPath = path.join(groupDir, "manifest.json")
      expect(fs.existsSync(manifestPath)).toBe(true)

      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, "utf8")
      ) as Record<string, string>
      expect(Object.keys(manifest).length).toBeGreaterThan(0)

      for (const [name, relPath] of Object.entries(manifest)) {
        expect(name).toBeTruthy()
        expect(relPath).toBeTruthy()
        const imgPath = path.join(groupDir, relPath)
        expect(fs.existsSync(imgPath)).toBe(true)
        const stat = fs.statSync(imgPath)
        expect(stat.size).toBeGreaterThan(0)
      }
    }
  })
})
