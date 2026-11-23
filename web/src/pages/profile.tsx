import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { PencilIcon } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { meApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import { accountInitial } from "@/lib/user-identity"
import { useAuthStore } from "@/stores/auth"

/** 个人资料页：默认只读展示昵称，点「编辑」才出现输入框；昵称锁开启时编辑按钮置灰。 */
export function ProfilePage() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const refresh = useAuthStore((state) => state.refresh)
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState(user?.displayName ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>("")
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState("")

  useEffect(() => {
    return () => {
      if (previewUrl && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  if (!user) return null

  const locked = user.profileLocks.displayNameLocked

  const startEdit = () => {
    setDisplayName(user.displayName)
    setError("")
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    setError("")
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (previewUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(previewUrl)
    }
    setSelectedFile(file)
    setAvatarError("")
    const objectUrl =
      typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : "blob:mock-avatar-preview"
    setPreviewUrl(objectUrl)
  }

  const cancelAvatarPreview = () => {
    if (previewUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewUrl("")
    setSelectedFile(null)
    setAvatarError("")
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleUploadAvatar = async () => {
    if (!selectedFile) return
    setAvatarUploading(true)
    setAvatarError("")
    try {
      const res = await meApi.uploadAvatar(selectedFile)
      if (user && res.avatar) {
        setUser({ ...user, avatar: res.avatar })
      }
      await refresh()
      toast.success(t("profile.avatarSaved"))
      cancelAvatarPreview()
    } catch (err) {
      setAvatarError(
        describeApiError(t, err) || t("profile.avatarUploadFailed")
      )
    } finally {
      setAvatarUploading(false)
    }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const updated = await meApi.update({ displayName: displayName.trim() })
      setUser(updated)
      setDisplayName(updated.displayName)
      toast.success(t("profile.saved"))
      setEditing(false)
    } catch (saveError) {
      setError(describeApiError(t, saveError))
    } finally {
      setBusy(false)
    }
  }

  const rows = (
    <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
      <dt className="text-muted-foreground">{t("profile.displayName")}</dt>
      <dd>
        {editing ? (
          <Input
            id="profile-display-name"
            name="display-name"
            autoComplete="name"
            aria-label={t("profile.displayName")}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        ) : (
          user.displayName
        )}
      </dd>

      <dt className="text-muted-foreground">{t("profile.email")}</dt>
      <dd className="flex items-center gap-2">
        <span className="break-all">{user.email}</span>
        <Badge variant={user.emailVerified ? "secondary" : "outline"}>
          {user.emailVerified
            ? t("profile.emailVerified")
            : t("profile.emailUnverified")}
        </Badge>
      </dd>

      <dt className="text-muted-foreground">{t("profile.role")}</dt>
      <dd>{t(`common.role.${user.role}`)}</dd>
    </dl>
  )

  const avatarSection = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <Avatar className="size-20">
        {previewUrl ? (
          <AvatarImage
            src={previewUrl}
            alt={t("profile.avatarPreview")}
            data-testid="avatar-preview-img"
          />
        ) : user.avatar ? (
          <AvatarImage src={user.avatar} alt={user.displayName || user.email} />
        ) : null}
        <AvatarFallback className="text-lg font-semibold">
          {accountInitial(user)}
        </AvatarFallback>
      </Avatar>

      <div className="space-y-2">
        <input
          ref={fileInputRef}
          id="profile-avatar-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          aria-label={t("profile.selectAvatar")}
          onChange={handleFileChange}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={avatarUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {t("profile.selectAvatar")}
          </Button>

          {previewUrl ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={avatarUploading}
                onClick={handleUploadAvatar}
              >
                {avatarUploading
                  ? t("profile.uploading")
                  : t("common.actions.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={avatarUploading}
                onClick={cancelAvatarPreview}
              >
                {t("common.actions.cancel")}
              </Button>
            </>
          ) : null}
        </div>

        {avatarError ? (
          <p role="alert" className="text-sm text-destructive">
            {avatarError}
          </p>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {avatarSection}

      {editing ? (
        <form className="space-y-4" onSubmit={save}>
          {rows}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? t("common.actions.saving") : t("common.actions.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={cancel}
            >
              {t("common.actions.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={startEdit}
            >
              <PencilIcon />
              {t("common.actions.edit")}
            </Button>
          </div>
          {rows}
        </>
      )}
    </div>
  )
}
