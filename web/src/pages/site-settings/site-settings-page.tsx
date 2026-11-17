import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type {
  CalineSiteSettings,
  CalineSiteSettingsPatch,
  GuestCommentMode
} from "@/lib/api-types"

export function SiteSettingsPage() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Form states
  const [auditSwitch, setAuditSwitch] = useState(false)
  const [guestMode, setGuestMode] = useState<GuestCommentMode>("open")
  const [reservedNicks, setReservedNicks] = useState("")
  const [disallowedWords, setDisallowedWords] = useState("")
  const [ipBlacklist, setIpBlacklist] = useState("")
  const [maxContentLength, setMaxContentLength] = useState(1000)
  const [ipRateLimitSeconds, setIpRateLimitSeconds] = useState(60)
  const [levelThresholds, setLevelThresholds] = useState("")
  const [gravatarMirror, setGravatarMirror] = useState("")
  const [safeDomains, setSafeDomains] = useState("")

  const [turnstileEnabled, setTurnstileEnabled] = useState(false)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("")
  const [turnstileSecretKey, setTurnstileSecretKey] = useState("")
  const [turnstileSecretKeySet, setTurnstileSecretKeySet] = useState(false)

  const [enotifyEnabled, setEnotifyEnabled] = useState(false)
  const [enotifyKey, setEnotifyKey] = useState("")
  const [enotifyKeySet, setEnotifyKeySet] = useState(false)

  const populate = useCallback((site: CalineSiteSettings) => {
    setAuditSwitch(site.auditSwitch ?? false)
    setGuestMode(site.guestMode ?? "open")
    setReservedNicks((site.reservedNicks ?? []).join("\n"))
    setDisallowedWords((site.disallowedWords ?? []).join("\n"))
    setIpBlacklist((site.ipBlacklist ?? []).join("\n"))
    setMaxContentLength(site.maxContentLength ?? 1000)
    setIpRateLimitSeconds(site.ipRateLimitSeconds ?? 60)
    setLevelThresholds((site.levelThresholds ?? []).join(", "))
    setGravatarMirror(site.gravatarMirror ?? "")
    setSafeDomains((site.safeDomains ?? []).join("\n"))

    setTurnstileEnabled(site.turnstileEnabled ?? false)
    setTurnstileSiteKey(site.turnstileSiteKey ?? "")
    setTurnstileSecretKey("")
    setTurnstileSecretKeySet(site.turnstileSecretKeySet ?? false)

    setEnotifyEnabled(site.enotifyEnabled ?? false)
    setEnotifyKey("")
    setEnotifyKeySet(site.enotifyKeySet ?? false)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await adminApi.settings()
      if (res.site) {
        populate(res.site)
      }
    } catch (err) {
      setError(describeApiError(t, err))
    } finally {
      setLoading(false)
    }
  }, [t, populate])

  useEffect(() => {
    void load()
  }, [load])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    const parsedThresholds = levelThresholds
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n))

    const patch: CalineSiteSettingsPatch = {
      auditSwitch,
      guestMode,
      reservedNicks: reservedNicks
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      disallowedWords: disallowedWords
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      ipBlacklist: ipBlacklist
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      maxContentLength: Number(maxContentLength) || 1000,
      ipRateLimitSeconds: Number(ipRateLimitSeconds) || 0,
      levelThresholds: parsedThresholds,
      gravatarMirror: gravatarMirror.trim(),
      safeDomains: safeDomains
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      turnstileEnabled,
      turnstileSiteKey: turnstileSiteKey.trim(),
      enotifyEnabled
    }

    if (turnstileSecretKey.trim()) {
      patch.turnstileSecretKey = turnstileSecretKey.trim()
    }
    if (enotifyKey.trim()) {
      patch.enotifyKey = enotifyKey.trim()
    }

    try {
      const updated = await adminApi.updateSettings({ site: patch })
      if (updated.site) {
        populate(updated.site)
      }
      toast.success(t("siteSettings.saved"))
    } catch (err) {
      setError(describeApiError(t, err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* 审核与访客 */}
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h3 className="font-heading text-sm font-semibold">
          {t("siteSettings.section.auditAndGuest")}
        </h3>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="audit-switch" className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {t("siteSettings.auditSwitch")}
            </span>
          </Label>
          <Switch
            id="audit-switch"
            checked={auditSwitch}
            onCheckedChange={setAuditSwitch}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="guest-mode" className="text-sm font-medium">
            {t("siteSettings.guestMode")}
          </Label>
          <Select
            value={guestMode}
            onValueChange={(val) => setGuestMode(val as GuestCommentMode)}
          >
            <SelectTrigger id="guest-mode" className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">
                {t("siteSettings.guestModeOptions.open")}
              </SelectItem>
              <SelectItem value="login_only">
                {t("siteSettings.guestModeOptions.login_only")}
              </SelectItem>
              <SelectItem value="closed">
                {t("siteSettings.guestModeOptions.closed")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* 内容规则 */}
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h3 className="font-heading text-sm font-semibold">
          {t("siteSettings.section.contentRules")}
        </h3>

        <div className="space-y-1.5">
          <Label htmlFor="reserved-nicks" className="text-sm font-medium">
            {t("siteSettings.reservedNicks")}
          </Label>
          <textarea
            id="reserved-nicks"
            value={reservedNicks}
            onChange={(e) => setReservedNicks(e.target.value)}
            placeholder={t("siteSettings.reservedNicksPlaceholder")}
            rows={3}
            className="w-full rounded-md border border-input bg-background p-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="disallowed-words" className="text-sm font-medium">
            {t("siteSettings.disallowedWords")}
          </Label>
          <textarea
            id="disallowed-words"
            value={disallowedWords}
            onChange={(e) => setDisallowedWords(e.target.value)}
            placeholder={t("siteSettings.disallowedWordsPlaceholder")}
            rows={3}
            className="w-full rounded-md border border-input bg-background p-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ip-blacklist" className="text-sm font-medium">
            {t("siteSettings.ipBlacklist")}
          </Label>
          <textarea
            id="ip-blacklist"
            value={ipBlacklist}
            onChange={(e) => setIpBlacklist(e.target.value)}
            placeholder={t("siteSettings.ipBlacklistPlaceholder")}
            rows={3}
            className="w-full rounded-md border border-input bg-background p-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="max-content-length" className="text-sm font-medium">
              {t("siteSettings.maxContentLength")}
            </Label>
            <Input
              id="max-content-length"
              type="number"
              min={1}
              value={maxContentLength}
              onChange={(e) => setMaxContentLength(Number(e.target.value))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ip-rate-limit" className="text-sm font-medium">
              {t("siteSettings.ipRateLimitSeconds")}
            </Label>
            <Input
              id="ip-rate-limit"
              type="number"
              min={0}
              value={ipRateLimitSeconds}
              onChange={(e) => setIpRateLimitSeconds(Number(e.target.value))}
            />
          </div>
        </div>
      </section>

      {/* 分级与安全 */}
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h3 className="font-heading text-sm font-semibold">
          {t("siteSettings.section.levelsAndDomains")}
        </h3>

        <div className="space-y-1.5">
          <Label htmlFor="level-thresholds" className="text-sm font-medium">
            {t("siteSettings.levelThresholds")}
          </Label>
          <Input
            id="level-thresholds"
            value={levelThresholds}
            onChange={(e) => setLevelThresholds(e.target.value)}
            placeholder={t("siteSettings.levelThresholdsPlaceholder")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="gravatar-mirror" className="text-sm font-medium">
            {t("siteSettings.gravatarMirror")}
          </Label>
          <Input
            id="gravatar-mirror"
            value={gravatarMirror}
            onChange={(e) => setGravatarMirror(e.target.value)}
            placeholder="https://cravatar.cn/avatar/"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="safe-domains" className="text-sm font-medium">
            {t("siteSettings.safeDomains")}
          </Label>
          <textarea
            id="safe-domains"
            value={safeDomains}
            onChange={(e) => setSafeDomains(e.target.value)}
            placeholder={t("siteSettings.safeDomainsPlaceholder")}
            rows={3}
            className="w-full rounded-md border border-input bg-background p-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
      </section>

      {/* 验证与通知 */}
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h3 className="font-heading text-sm font-semibold">
          {t("siteSettings.section.captchaAndNotice")}
        </h3>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="turnstile-switch" className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {t("siteSettings.turnstileEnabled")}
            </span>
          </Label>
          <Switch
            id="turnstile-switch"
            checked={turnstileEnabled}
            onCheckedChange={setTurnstileEnabled}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="turnstile-site-key" className="text-sm font-medium">
              {t("siteSettings.turnstileSiteKey")}
            </Label>
            <Input
              id="turnstile-site-key"
              value={turnstileSiteKey}
              onChange={(e) => setTurnstileSiteKey(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="turnstile-secret-key"
              className="text-sm font-medium"
            >
              {t("siteSettings.turnstileSecretKey")}
            </Label>
            <Input
              id="turnstile-secret-key"
              type="password"
              value={turnstileSecretKey}
              onChange={(e) => setTurnstileSecretKey(e.target.value)}
              placeholder={
                turnstileSecretKeySet
                  ? t("siteSettings.secretSet")
                  : t("siteSettings.secretNotSet")
              }
            />
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="enotify-switch" className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {t("siteSettings.enotifyEnabled")}
              </span>
            </Label>
            <Switch
              id="enotify-switch"
              checked={enotifyEnabled}
              onCheckedChange={setEnotifyEnabled}
            />
          </div>

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="enotify-key" className="text-sm font-medium">
              {t("siteSettings.enotifyKey")}
            </Label>
            <Input
              id="enotify-key"
              type="password"
              value={enotifyKey}
              onChange={(e) => setEnotifyKey(e.target.value)}
              placeholder={
                enotifyKeySet
                  ? t("siteSettings.secretSet")
                  : t("siteSettings.secretNotSet")
              }
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? t("common.actions.saving") : t("common.actions.save")}
        </Button>
      </div>
    </form>
  )
}
