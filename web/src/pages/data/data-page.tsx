import { DownloadIcon, FileUpIcon, UploadIcon } from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { CalineDataDump } from "@/lib/api-types"

export function DataPage() {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")

  const [parsedData, setParsedData] = useState<CalineDataDump | null>(null)
  const [fileName, setFileName] = useState("")
  const [importError, setImportError] = useState("")
  const [importing, setImporting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    setExportError("")
    try {
      const dump = await adminApi.exportData()
      const json = JSON.stringify(dump, null, 2)
      const blob = new Blob([json], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(t("data.export.success"))
    } catch (err) {
      setExportError(describeApiError(t, err))
    } finally {
      setExporting(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError("")
    const file = e.target.files?.[0]
    if (!file) {
      setParsedData(null)
      setFileName("")
      return
    }

    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        const parsed = JSON.parse(text) as CalineDataDump
        if (
          !parsed ||
          typeof parsed !== "object" ||
          !Array.isArray(parsed.comments) ||
          !Array.isArray(parsed.counters) ||
          !Array.isArray(parsed.users)
        ) {
          setImportError(t("data.import.invalidJson"))
          setParsedData(null)
          return
        }
        setParsedData(parsed)
      } catch {
        setImportError(t("data.import.invalidJson"))
        setParsedData(null)
      }
    }
    reader.readAsText(file)
  }

  const handleImportSubmit = async () => {
    if (!parsedData) return
    setImporting(true)
    setImportError("")
    try {
      const res = await adminApi.importData({
        data: parsedData,
        overwrite: true
      })
      toast.success(
        t("data.import.success", {
          comments: res.importedComments,
          counters: res.importedCounters,
          users: res.importedUsers
        })
      )
      setConfirmOpen(false)
      setParsedData(null)
      setFileName("")
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (err) {
      setImportError(describeApiError(t, err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 导出数据 */}
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <DownloadIcon
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="font-heading text-sm font-semibold">
            {t("data.export.title")}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("data.export.description")}
        </p>

        {exportError ? (
          <p role="alert" className="text-sm text-destructive">
            {exportError}
          </p>
        ) : null}

        <Button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
        >
          <DownloadIcon className="size-4" aria-hidden="true" />
          {exporting ? t("common.loading") : t("data.export.action")}
        </Button>
      </section>

      {/* 导入数据 */}
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <UploadIcon
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="font-heading text-sm font-semibold">
            {t("data.import.title")}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("data.import.description")}
        </p>

        {importError ? (
          <p role="alert" className="text-sm text-destructive">
            {importError}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
            id="backup-file-input"
            aria-label={t("data.import.selectFile")}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUpIcon className="size-4" aria-hidden="true" />
            {t("data.import.selectFile")}
          </Button>
          <span className="truncate text-xs text-muted-foreground">
            {fileName || t("data.import.noFile")}
          </span>
        </div>

        {parsedData ? (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("data.import.preview")}
            </h4>
            <p className="text-sm font-medium">
              {t("data.import.stats", {
                comments: parsedData.comments.length,
                counters: parsedData.counters.length,
                users: parsedData.users.length
              })}
            </p>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {parsedData.version ? (
                <span>
                  {t("data.import.version")}: {parsedData.version}
                </span>
              ) : null}
              {parsedData.exportedAt ? (
                <span>
                  {t("data.import.exportedAt")}: {parsedData.exportedAt}
                </span>
              ) : null}
            </div>

            <div className="pt-2">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
              >
                {t("data.import.action")}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {/* 覆盖导入二次确认对话框 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("data.import.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("data.import.confirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={importing}
              >
                {t("common.actions.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={importing}
              onClick={() => void handleImportSubmit()}
            >
              {importing ? t("common.loading") : t("data.import.confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
