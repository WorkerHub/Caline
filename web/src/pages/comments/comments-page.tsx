import {
  BanIcon,
  CheckIcon,
  ClockIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LaptopIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  Trash2Icon,
  XIcon
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { currentLanguage } from "@/i18n"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { CommentAdminItem, CommentStatus } from "@/lib/api-types"
import { intlLocale } from "@/lib/language"

const STATUS_VARIANT: Record<
  CommentStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  approved: "secondary",
  waiting: "default",
  spam: "destructive"
}

const PAGE_SIZE = 20

export function CommentsPage() {
  const { t } = useTranslation()
  const [statusTab, setStatusTab] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [activeQuery, setActiveQuery] = useState("")
  const [page, setPage] = useState(1)

  const [items, setItems] = useState<CommentAdminItem[]>([])
  const [_total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const [busyId, setBusyId] = useState<number | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  // 编辑弹窗
  const [editingItem, setEditingItem] = useState<CommentAdminItem | null>(null)
  const [editContent, setEditContent] = useState("")
  const [editError, setEditError] = useState("")

  // 删除单项确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<CommentAdminItem | null>(
    null
  )
  const [deleteError, setDeleteError] = useState("")

  // 批量删除确认弹窗
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchDeleteError, setBatchDeleteError] = useState("")

  const loadComments = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await adminApi.comments({
        status: statusTab === "all" ? "all" : (statusTab as CommentStatus),
        q: activeQuery || undefined,
        page,
        pageSize: PAGE_SIZE
      })
      setItems(res.items)
      setTotal(res.total)
      setTotalPages(
        Math.max(1, res.totalPages || Math.ceil(res.total / PAGE_SIZE))
      )
    } catch (err) {
      setError(describeApiError(t, err))
    } finally {
      setLoading(false)
    }
  }, [statusTab, activeQuery, page, t])

  useEffect(() => {
    void loadComments()
  }, [loadComments])

  const handleTabChange = (val: string) => {
    setStatusTab(val)
    setPage(1)
    setSelectedIds([])
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setActiveQuery(searchQuery.trim())
    setPage(1)
    setSelectedIds([])
  }

  const handleClearSearch = () => {
    setSearchQuery("")
    setActiveQuery("")
    setPage(1)
    setSelectedIds([])
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === items.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(items.map((item) => item.id))
    }
  }

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const handleUpdateStatus = async (
    item: CommentAdminItem,
    status: CommentStatus
  ) => {
    setBusyId(item.id)
    try {
      await adminApi.updateComment(item.id, { status })
      toast.success(
        t(
          status === "approved"
            ? "comments.toast.approved"
            : status === "spam"
              ? "comments.toast.spammed"
              : "comments.toast.updated"
        )
      )
      await loadComments()
    } catch (err) {
      toast.error(describeApiError(t, err))
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleSticky = async (item: CommentAdminItem) => {
    setBusyId(item.id)
    try {
      await adminApi.updateComment(item.id, { sticky: !item.sticky })
      toast.success(
        t(
          !item.sticky ? "comments.toast.stickied" : "comments.toast.unstickied"
        )
      )
      await loadComments()
    } catch (err) {
      toast.error(describeApiError(t, err))
    } finally {
      setBusyId(null)
    }
  }

  const openEdit = (item: CommentAdminItem) => {
    setEditingItem(item)
    setEditContent(item.contentRaw)
    setEditError("")
  }

  const submitEdit = async () => {
    if (!editingItem) return
    setBusyId(editingItem.id)
    setEditError("")
    try {
      await adminApi.updateComment(editingItem.id, { content: editContent })
      toast.success(t("comments.toast.updated"))
      setEditingItem(null)
      await loadComments()
    } catch (err) {
      setEditError(describeApiError(t, err))
    } finally {
      setBusyId(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setBusyId(deleteTarget.id)
    setDeleteError("")
    try {
      await adminApi.deleteComment(deleteTarget.id)
      toast.success(t("comments.toast.deleted"))
      setDeleteTarget(null)
      setSelectedIds((prev) => prev.filter((id) => id !== deleteTarget.id))
      await loadComments()
    } catch (err) {
      setDeleteError(describeApiError(t, err))
    } finally {
      setBusyId(null)
    }
  }

  const handleBatchAction = async (
    action: "approve" | "spam" | "waiting" | "delete"
  ) => {
    if (selectedIds.length === 0) return
    setBatchBusy(true)
    setBatchDeleteError("")
    try {
      const res = await adminApi.batchComments({ ids: selectedIds, action })
      toast.success(
        t("comments.toast.batchSuccess", { count: res.affectedCount })
      )
      setSelectedIds([])
      setBatchDeleteOpen(false)
      await loadComments()
    } catch (err) {
      const msg = describeApiError(t, err)
      if (action === "delete") {
        setBatchDeleteError(msg)
      } else {
        toast.error(msg)
      }
    } finally {
      setBatchBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={statusTab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="all">{t("comments.status.all")}</TabsTrigger>
            <TabsTrigger value="waiting">
              {t("comments.status.waiting")}
            </TabsTrigger>
            <TabsTrigger value="spam">{t("comments.status.spam")}</TabsTrigger>
            <TabsTrigger value="approved">
              {t("comments.status.approved")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <form
          onSubmit={handleSearchSubmit}
          className="relative flex items-center"
        >
          <SearchIcon
            className="absolute left-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("comments.searchPlaceholder")}
            className="w-full pl-8 pr-8 sm:w-64"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2.5 text-muted-foreground hover:text-foreground"
              aria-label={t("comments.searchClear")}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </form>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="rounded-xl border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {t("comments.empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={
                      selectedIds.length > 0 &&
                      selectedIds.length === items.length
                    }
                    onChange={toggleSelectAll}
                    aria-label={t("comments.batch.selectAll")}
                    className="size-4 rounded border-input"
                  />
                </TableHead>
                <TableHead className="w-48">
                  {t("comments.meta.date")}
                </TableHead>
                <TableHead>{t("comments.edit.content")}</TableHead>
                <TableHead className="w-32">
                  {t("comments.meta.page")}
                </TableHead>
                <TableHead className="text-right">
                  {t("comments.meta.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  data-selected={selectedIds.includes(item.id)}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelectOne(item.id)}
                      aria-label={`${item.nick} ${item.id}`}
                      className="size-4 rounded border-input"
                    />
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-col gap-1 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <span className="truncate">
                          {item.nick || item.mail || "—"}
                        </span>
                        {item.sticky ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1 py-0"
                          >
                            {t("comments.actions.sticky")}
                          </Badge>
                        ) : null}
                        <Badge
                          variant={STATUS_VARIANT[item.status]}
                          className="text-[10px] px-1 py-0"
                        >
                          {t(`comments.status.${item.status}`)}
                        </Badge>
                      </div>
                      {item.mail ? (
                        <span className="truncate text-muted-foreground">
                          {item.mail}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground/70">
                        {new Date(item.createdAt).toLocaleString(
                          intlLocale(currentLanguage())
                        )}
                      </span>
                      <div className="flex flex-wrap gap-2 text-muted-foreground/60 text-[11px] pt-0.5">
                        {item.ip ? (
                          <span className="inline-flex items-center gap-0.5">
                            <GlobeIcon className="size-3" aria-hidden="true" />
                            {item.ip}
                          </span>
                        ) : null}
                        {item.ua ? (
                          <span
                            className="inline-flex items-center gap-0.5 max-w-[120px] truncate"
                            title={item.ua}
                          >
                            <LaptopIcon className="size-3" aria-hidden="true" />
                            {item.ua}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <p className="line-clamp-3 text-sm whitespace-pre-wrap break-words">
                        {item.contentRaw}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 max-w-[140px] truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <span className="truncate">{item.url}</span>
                      <ExternalLinkIcon
                        className="size-3 shrink-0"
                        aria-hidden="true"
                      />
                    </a>
                  </TableCell>
                  <TableCell className="align-top text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busyId === item.id}
                          aria-label={t("comments.meta.actions")}
                        >
                          <EllipsisIcon className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        {item.status !== "approved" ? (
                          <DropdownMenuItem
                            onClick={() =>
                              void handleUpdateStatus(item, "approved")
                            }
                          >
                            <CheckIcon className="size-4" aria-hidden="true" />
                            {t("comments.actions.approve")}
                          </DropdownMenuItem>
                        ) : null}
                        {item.status !== "spam" ? (
                          <DropdownMenuItem
                            onClick={() =>
                              void handleUpdateStatus(item, "spam")
                            }
                          >
                            <BanIcon className="size-4" aria-hidden="true" />
                            {t("comments.actions.spam")}
                          </DropdownMenuItem>
                        ) : null}
                        {item.status !== "waiting" ? (
                          <DropdownMenuItem
                            onClick={() =>
                              void handleUpdateStatus(item, "waiting")
                            }
                          >
                            <ClockIcon className="size-4" aria-hidden="true" />
                            {t("comments.actions.waiting")}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          onClick={() => void handleToggleSticky(item)}
                        >
                          {item.sticky ? (
                            <>
                              <PinOffIcon
                                className="size-4"
                                aria-hidden="true"
                              />
                              {t("comments.actions.unsticky")}
                            </>
                          ) : (
                            <>
                              <PinIcon className="size-4" aria-hidden="true" />
                              {t("comments.actions.sticky")}
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(item)}>
                          <PencilIcon className="size-4" aria-hidden="true" />
                          {t("comments.actions.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => {
                            setDeleteError("")
                            setDeleteTarget(item)
                          }}
                        >
                          <Trash2Icon className="size-4" aria-hidden="true" />
                          {t("comments.actions.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
            <span>
              {t("comments.pagination.page", {
                current: page,
                total: totalPages
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("comments.pagination.prev")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t("comments.pagination.next")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* 浮动批量操作条 */}
      {selectedIds.length > 0 ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 shadow-xl transition-all">
          <span className="text-sm font-medium pr-2 border-r">
            {t("comments.batch.selected", { count: selectedIds.length })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={batchBusy}
            onClick={() => void handleBatchAction("approve")}
          >
            {t("comments.actions.approve")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={batchBusy}
            onClick={() => void handleBatchAction("spam")}
          >
            {t("comments.actions.spam")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={batchBusy}
            onClick={() => void handleBatchAction("waiting")}
          >
            {t("comments.actions.waiting")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={batchBusy}
            onClick={() => {
              setBatchDeleteError("")
              setBatchDeleteOpen(true)
            }}
          >
            {t("comments.actions.delete")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={batchBusy}
            onClick={() => setSelectedIds([])}
          >
            {t("comments.batch.clear")}
          </Button>
        </div>
      ) : null}

      {/* 编辑正文弹窗 */}
      <Dialog
        open={editingItem !== null}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("comments.edit.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-input bg-background p-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            {editError ? (
              <p role="alert" className="text-sm text-destructive">
                {editError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" size="sm" variant="outline">
                {t("common.actions.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              disabled={busyId === editingItem?.id}
              onClick={() => void submitEdit()}
            >
              {t("common.actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 单项删除确认弹窗 */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteError("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("comments.delete.title")}</DialogTitle>
            <DialogDescription>
              {t("comments.delete.description")}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" size="sm" variant="outline">
                {t("common.actions.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busyId === deleteTarget?.id}
              onClick={() => void confirmDelete()}
            >
              {t("comments.actions.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量删除确认弹窗 */}
      <Dialog
        open={batchDeleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBatchDeleteOpen(false)
            setBatchDeleteError("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("comments.batch.confirmDeleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("comments.batch.confirmDeleteDescription", {
                count: selectedIds.length
              })}
            </DialogDescription>
          </DialogHeader>
          {batchDeleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {batchDeleteError}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" size="sm" variant="outline">
                {t("common.actions.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={batchBusy}
              onClick={() => void handleBatchAction("delete")}
            >
              {t("comments.actions.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
