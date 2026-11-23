/**
 * Caline widget 词条定义（zh-CN / en 双语集中管理）。
 * 规格 §7、§1：缺词回退 zh-CN。
 */

export type LocaleKey =
  | "placeholder_nick"
  | "placeholder_mail"
  | "placeholder_link"
  | "placeholder_content"
  | "btn_submit"
  | "btn_submitting"
  | "btn_reply"
  | "btn_cancel"
  | "btn_preview"
  | "btn_edit"
  | "btn_delete"
  | "btn_save"
  | "sort_newest"
  | "sort_oldest"
  | "sort_hottest"
  | "comments_count"
  | "no_comments"
  | "sticky"
  | "login_to_comment"
  | "login_prompt"
  | "guest_closed"
  | "all_closed"
  | "edit_expired"
  | "delete_confirm"
  | "like"
  | "liked"
  | "load_more"
  | "loading"
  | "error_network"
  | "error_empty_nick"
  | "error_empty_content"
  | "error_word_limit"
  | "recent_title"
  | "pageview"
  | "guest"
  | "admin"
  | "verified"
  | "posting_as"
  | "logout"
  | "btn_image"
  | "uploading"
  | "upload_failed"
  | "emoji_panel"
  | "emoji_group_default"
  | "emoji_group_qq"
  | "emoji_group_weibo"
  | "emoji_group_bilibili"
  | "emoji_group_douyin"
  | "turnstile_required"

export const zhCN: Record<LocaleKey, string> = {
  placeholder_nick: "昵称 *",
  placeholder_mail: "邮箱 (Gravatar)",
  placeholder_link: "网址 (https://)",
  placeholder_content: "支持 Markdown 语法...",
  btn_submit: "发表评论",
  btn_submitting: "发送中...",
  btn_reply: "回复",
  btn_cancel: "取消",
  btn_preview: "预览",
  btn_edit: "编辑",
  btn_delete: "删除",
  btn_save: "保存",
  sort_newest: "最新",
  sort_oldest: "最早",
  sort_hottest: "最热",
  comments_count: "条评论",
  no_comments: "暂无评论，来抢沙发吧~",
  sticky: "置顶",
  login_to_comment: "登录后发表评论",
  login_prompt: "已有账号？点击登录",
  guest_closed: "当前仅允许登录用户发表评论",
  all_closed: "全站评论功能已关闭",
  edit_expired: "已超过 15 分钟编辑期限，请联系管理员",
  delete_confirm: "确定要删除这条评论吗？",
  like: "赞",
  liked: "已赞",
  load_more: "加载更多",
  loading: "加载中...",
  error_network: "网络请求失败，请稍后重试",
  error_empty_nick: "请填写昵称",
  error_empty_content: "评论内容不能为空",
  error_word_limit: "字数超出限制",
  recent_title: "最新评论",
  pageview: "次浏览",
  guest: "访客",
  admin: "管理员",
  verified: "已认证",
  posting_as: "以 {name} 身份发表",
  logout: "退出登录",
  btn_image: "插入图片",
  uploading: "上传中...",
  upload_failed: "图片上传失败",
  emoji_panel: "表情",
  emoji_group_default: "默认",
  emoji_group_qq: "QQ",
  emoji_group_weibo: "微博",
  emoji_group_bilibili: "B站",
  emoji_group_douyin: "抖音",
  turnstile_required: "请先完成人机验证"
}

export const enUS: Record<LocaleKey, string> = {
  placeholder_nick: "Nickname *",
  placeholder_mail: "Email (Gravatar)",
  placeholder_link: "Website (https://)",
  placeholder_content: "Markdown supported...",
  btn_submit: "Submit",
  btn_submitting: "Submitting...",
  btn_reply: "Reply",
  btn_cancel: "Cancel",
  btn_preview: "Preview",
  btn_edit: "Edit",
  btn_delete: "Delete",
  btn_save: "Save",
  sort_newest: "Newest",
  sort_oldest: "Oldest",
  sort_hottest: "Hottest",
  comments_count: "comments",
  no_comments: "No comments yet.",
  sticky: "Pinned",
  login_to_comment: "Sign in to comment",
  login_prompt: "Already have an account? Sign in",
  guest_closed: "Only registered users can comment",
  all_closed: "Comments are disabled",
  edit_expired: "Edit window expired (15m), please contact admin",
  delete_confirm: "Are you sure you want to delete this comment?",
  like: "Like",
  liked: "Liked",
  load_more: "Load more",
  loading: "Loading...",
  error_network: "Network error, please try again later",
  error_empty_nick: "Nickname is required",
  error_empty_content: "Content cannot be empty",
  error_word_limit: "Character limit exceeded",
  recent_title: "Recent Comments",
  pageview: "Views",
  guest: "Guest",
  admin: "Administrator",
  verified: "Verified",
  posting_as: "Posting as {name}",
  logout: "Sign out",
  btn_image: "Insert image",
  uploading: "Uploading...",
  upload_failed: "Image upload failed",
  emoji_panel: "Emoji",
  emoji_group_default: "Default",
  emoji_group_qq: "QQ",
  emoji_group_weibo: "Weibo",
  emoji_group_bilibili: "Bilibili",
  emoji_group_douyin: "Douyin",
  turnstile_required: "Please complete human verification"
}

export type SupportedLang = "zh-CN" | "en"

export function resolveLanguage(customLang?: string): SupportedLang {
  if (customLang) {
    const lower = customLang.toLowerCase()
    if (lower.startsWith("zh")) return "zh-CN"
    if (lower.startsWith("en")) return "en"
  }

  if (typeof document !== "undefined" && document.documentElement.lang) {
    const htmlLang = document.documentElement.lang.toLowerCase()
    if (htmlLang.startsWith("zh")) return "zh-CN"
    if (htmlLang.startsWith("en")) return "en"
  }

  return "zh-CN"
}

export function createTranslator(lang: SupportedLang) {
  const dict = lang === "en" ? enUS : zhCN
  return function t(
    key: LocaleKey,
    params?: Record<string, string | number>
  ): string {
    let str = dict[key] ?? zhCN[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v))
      }
    }
    return str
  }
}
