import { describe, expect, it } from "vitest"
import {
  type AdminCommentBatchInput,
  type AdminDeleteCommentResult,
  type ApiResponse,
  type AuthMe,
  type CalineDataDump,
  type CalineSiteSettings,
  type CommentCountsResult,
  type CommentPublicItem,
  type CreateCommentInput,
  type CreateCommentResult,
  type ListCommentsResult,
  type PageReactionResult,
  type PageViewResult,
  type RecentCommentItem,
  isApiErrorResponse,
  isApiSuccess
} from "../src"

describe("@caline/shared contracts", () => {
  it("validates unified API success envelope", () => {
    const successPayload: ApiResponse<{ id: number }> = {
      data: { id: 101 }
    }
    expect(isApiSuccess(successPayload)).toBe(true)
    expect(isApiErrorResponse(successPayload)).toBe(false)
    if (isApiSuccess(successPayload)) {
      expect(successPayload.data.id).toBe(101)
    }
  })

  it("validates unified API error envelope", () => {
    const errorPayload: ApiResponse<never> = {
      error: {
        code: "INVALID_COMMENT",
        message: "Content cannot be empty"
      }
    }
    expect(isApiSuccess(errorPayload)).toBe(false)
    expect(isApiErrorResponse(errorPayload)).toBe(true)
  })

  it("satisfies comment tree structure without exposing guest email", () => {
    const rootComment: CommentPublicItem = {
      id: 1,
      userId: null,
      nick: "GuestUser",
      avatar: "https://cravatar.cn/avatar/d41d8cd98f00b204e9800998ecf8427e",
      link: "https://example.com",
      url: "/posts/first",
      contentHtml: "<p>Hello world</p>",
      sticky: false,
      likeCount: 3,
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
      replies: [
        {
          id: 2,
          userId: 1,
          nick: "Admin",
          avatar: "https://example.com/avatar.png",
          link: "https://admin.blog",
          url: "/posts/first",
          pid: 1,
          rid: 1,
          replyTo: {
            id: 1,
            nick: "GuestUser",
            userId: null
          },
          contentHtml: "<p>Welcome!</p>",
          likeCount: 1,
          createdAt: "2026-11-18T00:05:00.000Z",
          updatedAt: "2026-11-18T00:05:00.000Z"
        }
      ]
    }

    const listResult: ListCommentsResult = {
      items: [rootComment],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1
    }

    expect(listResult.items[0].replies[0].replyTo?.nick).toBe("GuestUser")
    // Verify `mail` is not on the public comment item
    expect("mail" in listResult.items[0]).toBe(false)
  })

  it("satisfies guest create comment response with editToken", () => {
    const createInput: CreateCommentInput = {
      url: "/posts/first",
      content: "This is a comment",
      nick: "Guest",
      mail: "guest@example.com"
    }

    const createResult: CreateCommentResult = {
      comment: {
        id: 42,
        url: createInput.url,
        status: "approved",
        contentHtml: "<p>This is a comment</p>",
        createdAt: "2026-11-18T00:00:00.000Z"
      },
      status: "approved",
      editToken: "rnd_edit_token_12345"
    }

    expect(createResult.editToken).toBeDefined()
  })

  it("satisfies page view and reaction contracts", () => {
    const viewResult: PageViewResult = {
      url: "/posts/first",
      pageview: 120
    }
    const reactionResult: PageReactionResult = {
      url: "/posts/first",
      pageview: 120,
      reactions: {
        reaction0: 5,
        reaction1: 2,
        reaction2: 0,
        reaction3: 0,
        reaction4: 0,
        reaction5: 0,
        reaction6: 0,
        reaction7: 0,
        reaction8: 0
      }
    }

    expect(viewResult.pageview).toBe(120)
    expect(reactionResult.reactions.reaction0).toBe(5)
  })

  it("satisfies comment counts mapping", () => {
    const counts: CommentCountsResult = {
      "/posts/first": 12,
      "/posts/second": 0
    }
    expect(counts["/posts/first"]).toBe(12)
    expect(counts["/posts/second"]).toBe(0)
  })

  it("satisfies recent comment widget contract", () => {
    const recent: RecentCommentItem = {
      id: 99,
      url: "/posts/first",
      nick: "Visitor",
      avatar: "https://cravatar.cn/avatar/1234",
      link: "https://visitor.site",
      contentHtml: "<p>Nice post!</p>",
      createdAt: "2026-11-18T01:00:00.000Z"
    }
    expect(recent.nick).toBe("Visitor")
  })

  it("satisfies admin comment cascade delete contract", () => {
    const deleteResult: AdminDeleteCommentResult = {
      success: true,
      deletedId: 10,
      deletedCount: 3,
      deletedIds: [10, 11, 12]
    }
    expect(deleteResult.deletedCount).toBe(3)
    expect(deleteResult.deletedIds).toContain(10)
  })

  it("satisfies admin comment batch action contract", () => {
    const batchInput: AdminCommentBatchInput = {
      ids: [1, 2, 3],
      action: "approve"
    }
    expect(batchInput.action).toBe("approve")
  })

  it("satisfies auth me with Caline extended profile fields", () => {
    const me: AuthMe = {
      id: 1,
      email: "admin@example.com",
      displayName: "Site Admin",
      role: "admin",
      status: "active",
      emailVerified: true,
      mustChangePassword: false,
      language: "zh",
      timezone: "Asia/Shanghai",
      totpEnabled: false,
      emailTwoFactorEnabled: false,
      passkeyCount: 0,
      profileLocks: {
        displayNameLocked: false
      },
      label: "博主",
      avatar: "https://example.com/avatar.png",
      url: "https://example.com"
    }
    expect(me.label).toBe("博主")
  })

  it("satisfies Caline site settings contract", () => {
    const settings: CalineSiteSettings = {
      auditSwitch: false,
      guestMode: "open",
      reservedNicks: ["Admin", "博主"],
      disallowedWords: ["spam_word"],
      ipBlacklist: ["1.2.3.4"],
      maxContentLength: 1000,
      ipRateLimitSeconds: 60,
      levelThresholds: [5, 20, 50],
      gravatarMirror: "https://cravatar.cn/avatar/",
      safeDomains: ["https://myblog.com"],
      turnstileEnabled: false,
      turnstileSiteKey: "",
      turnstileSecretKeySet: false,
      enotifyEnabled: false,
      enotifyKeySet: false
    }
    expect(settings.guestMode).toBe("open")
    expect(settings.maxContentLength).toBe(1000)
  })

  it("satisfies data dump schema excluding password_hash", () => {
    const dump: CalineDataDump = {
      version: "1.0.0",
      exportedAt: "2026-11-18T00:00:00.000Z",
      comments: [],
      counters: [],
      users: [
        {
          id: 1,
          email: "admin@example.com",
          role: "admin",
          status: "active",
          email_verified: 1,
          language: "zh",
          display_name: "Admin",
          timezone: "Asia/Shanghai",
          created_at: "2026-11-18T00:00:00.000Z",
          updated_at: "2026-11-18T00:00:00.000Z",
          label: "博主",
          avatar: "",
          url: "",
          github_id: null
        }
      ]
    }
    expect("password_hash" in dump.users[0]).toBe(false)
  })
})
