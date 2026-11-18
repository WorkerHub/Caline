import {
  ExternalLinkIcon,
  HeartIcon,
  PencilIcon,
  Trash2Icon
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { currentLanguage } from "@/i18n"
import { commentsApi, meApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { CommentMeItem, CommentStatus } from "@/lib/api-types"
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

/**
 * 我的评论页：登录用户查看本人全部评论（approved/waiting/spam），
 * 严格脱敏（不渲染 IP/UA），按创建时间倒序分页，支持行内/弹窗编辑与二次确认删除。
 */
export function MyCommentsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<CommentMeItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // 编辑弹窗
  const [editingItem, setEditingItem] = useState<CommentMeItem | null>(null)
  const [editContent, setEditContent] = useState("")
  const [editError, setEditError] = useState("")
  const [editBusy, setEditBusy] = useState(false)

  // 删除二次确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<CommentMeItem | null>(null)
  const [deleteError, setDeleteError] = useState("")
  const [deleteBusy, setDeleteBusy] = useState(false)

  const loadComments = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await meApi.comments({ page, pageSize: PAGE_SIZE })
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
  }, [page, t])

  useEffect(() => {
    void loadComments()
  }, [loadComments])

  const openEdit = (item: CommentMeItem) => {
    setEditingItem(item)
    setEditContent(item.contentRaw ?? item.content_raw ?? "")
    setEditError("")
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingItem) return
    const content = editContent.trim()
    if (!content) return

    setEditBusy(true)
    setEditError("")
    try {
      const res = await commentsApi.update(editingItem.id, { content })
      setItems((prev) =>
        prev.map((item) =>
          item.id === editingItem.id
            ? {
                ...item,
                contentRaw: content,
                content_raw: content,
                contentHtml: res.contentHtml,
                content_html: res.contentHtml,
                updatedAt: res.updatedAt,
                updated_at: res.updatedAt
              }
            : item
        )
      )
      toast.success(t("myComments.updated"))
      setEditingItem(null)
    } catch (err) {
      setEditError(describeApiError(t, err))
    } finally {
      setEditBusy(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError("")
    try {
      await commentsApi.delete(deleteTarget.id)
      toast.success(t("myComments.deleted"))
      setDeleteTarget(null)
      // 若当前页删空且非第一页，退回上一页重新拉取
      if (items.length === 1 && page > 1) {
        setPage((p) => p - 1)
      } else {
        void loadComments()
      }
    } catch (err) {
      setDeleteError(describeApiError(t, err))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4" data-testid="my-comments-page">
      {total > 0 ? (
        <div className="flex justify-end">
          <span className="text-xs text-muted-foreground">
            {t("myComments.total", { total })}
          </span>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("myComments.empty")}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">
                    {t("myComments.statusColumn")}
                  </TableHead>
                  <TableHead>{t("myComments.content")}</TableHead>
                  <TableHead className="w-[180px]">
                    {t("myComments.pageColumn")}
                  </TableHead>
                  <TableHead className="w-[110px] text-right">
                    {t("comments.meta.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const raw = item.contentRaw ?? item.content_raw ?? ""
                  const created = item.createdAt ?? item.created_at ?? ""
                  const likes = item.likeCount ?? item.like_count ?? 0
                  return (
                    <TableRow key={item.id} data-testid={`comment-row-${item.id}`}>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <Badge
                            variant={STATUS_VARIANT[item.status]}
                            className="text-[10px] px-1 py-0"
                          >
                            {t(`myComments.status.${item.status}`)}
                          </Badge>
                          <div className="text-[11px] text-muted-foreground/70">
                            {created
                              ? new Date(created).toLocaleString(
                                  intlLocale(currentLanguage())
                                )
                              : null}
                          </div>
                          {likes > 0 ? (
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <HeartIcon className="size-3 fill-muted-foreground/30" />
                              <span>{likes}</span>
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <p className="line-clamp-4 text-sm whitespace-pre-wrap break-words">
                          {raw}
                        </p>
                      </TableCell>
                      <TableCell className="align-top">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 max-w-[170px] truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          <span className="truncate">{item.url}</span>
                          <ExternalLinkIcon
                            className="size-3 shrink-0"
                            aria-hidden="true"
                          />
                        </a>
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("myComments.edit")}
                            onClick={() => openEdit(item)}
                          >
                            <PencilIcon className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            aria-label={t("myComments.delete")}
                            onClick={() => {
                              setDeleteError("")
                              setDeleteTarget(item)
                            }}
                          >
                            <Trash2Icon className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("myComments.page", { page, totalPages })}</span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t("myComments.prev")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("myComments.next")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* 编辑弹窗 */}
      <Dialog
        open={editingItem !== null}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => void handleEditSubmit(e)}>
            <DialogHeader>
              <DialogTitle>{t("myComments.editDialogTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={5}
                required
                className="w-full rounded-md border bg-transparent p-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={t("myComments.content")}
              />
              {editError ? (
                <p role="alert" className="text-xs text-destructive">
                  {editError}
                </p>
              ) : null}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={editBusy}>
                  {t("myComments.cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={editBusy || !editContent.trim()}>
                {t("myComments.editDialogSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除二次确认弹窗 */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("myComments.deleteDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("myComments.deleteDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p role="alert" className="text-xs text-destructive">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={deleteBusy}>
                {t("myComments.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteBusy}
              onClick={() => void handleDeleteConfirm()}
            >
              {t("myComments.deleteDialogConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
