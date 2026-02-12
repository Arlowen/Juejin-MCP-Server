import { z } from "zod";

import type { ToolDefinition } from "../types.js";

const uploadImageItemSchema = z
  .object({
    name: z.string().trim().min(1),
    url: z.string().trim().url().nullable().optional(),
    base64: z.string().trim().min(1).nullable().optional(),
    mime: z.string().trim().min(1).optional().default("image/png")
  })
  .refine((item) => Boolean(item.url || item.base64), {
    message: "url 和 base64 至少提供一个"
  });

const imageUploadSchema = {
  images: z.array(uploadImageItemSchema).min(1)
};

type ImageUploadInput = z.infer<z.ZodObject<typeof imageUploadSchema>>;

export const imageUploadToolDefinition: ToolDefinition<
  typeof imageUploadSchema,
  ImageUploadInput,
  {
    assets: Array<{
      name: string;
      url: string;
      assetId: string;
      width: number;
      height: number;
    }>;
  }
> = {
  name: "image_upload",
  description: "上传图片并返回可用于文章插入的资源信息。",
  schema: imageUploadSchema,
  handler: async (input, context) => {
    const assets = await context.runtime.imageFlow.uploadImages(input.images, context.trace);
    return {
      data: {
        assets
      }
    };
  }
};

const draftCreateSchema = {
  title: z.string().trim().min(1),
  content: z.string().min(1),
  format: z.enum(["markdown", "richtext"]).optional().default("markdown"),
  tags: z.array(z.string().trim().min(1)).optional().default([]),
  category: z.string().trim().min(1).nullable().optional(),
  coverUrl: z.string().trim().url().nullable().optional(),
  assets: z.array(z.record(z.unknown())).optional().default([]),
  visibility: z.enum(["public", "private"]).optional().default("public")
};

type DraftCreateInput = z.infer<z.ZodObject<typeof draftCreateSchema>>;

export const draftCreateToolDefinition: ToolDefinition<
  typeof draftCreateSchema,
  DraftCreateInput,
  {
    draftId: string;
    editorUrl: string;
    reused: boolean;
  }
> = {
  name: "draft_create",
  description: "创建文章草稿，支持幂等去重。",
  schema: draftCreateSchema,
  handler: async (input, context) => {
    const result = await context.runtime.draftFlow.createDraft(input, context.trace);
    return {
      data: result
    };
  }
};

const draftPublishSchema = {
  draftId: z.string().trim().min(1),
  confirm: z.boolean().optional().default(true),
  scheduleTime: z.string().trim().min(1).nullable().optional()
};

type DraftPublishInput = z.infer<z.ZodObject<typeof draftPublishSchema>>;

export const draftPublishToolDefinition: ToolDefinition<
  typeof draftPublishSchema,
  DraftPublishInput,
  {
    articleId: string;
    articleUrl: string;
  }
> = {
  name: "draft_publish",
  description: "发布指定草稿，支持定时发布。",
  schema: draftPublishSchema,
  handler: async (input, context) => {
    const result = await context.runtime.draftFlow.publishDraft(input, context.trace);
    return {
      data: result
    };
  }
};

const articleGetSchema = {
  articleId: z.string().trim().min(1).nullable().optional(),
  articleUrl: z.string().trim().url().nullable().optional()
};

type ArticleGetInput = z.infer<z.ZodObject<typeof articleGetSchema>>;

export const articleGetToolDefinition: ToolDefinition<
  typeof articleGetSchema,
  ArticleGetInput,
  {
    articleId: string;
    title: string;
    url: string;
    publishedAt: string;
  }
> = {
  name: "article_get",
  description: "根据 articleId 或 articleUrl 获取文章详情。",
  schema: articleGetSchema,
  handler: async (input, context) => {
    const result = await context.runtime.articleFlow.getArticle(input, context.trace);
    return {
      data: result
    };
  }
};

const articleListMineSchema = {
  page: z.number().int().positive().optional().default(1),
  pageSize: z.number().int().positive().max(100).optional().default(20)
};

type ArticleListMineInput = z.infer<z.ZodObject<typeof articleListMineSchema>>;

export const articleListMineToolDefinition: ToolDefinition<
  typeof articleListMineSchema,
  ArticleListMineInput,
  {
    items: Array<{
      articleId: string;
      title: string;
      url: string;
      publishedAt: string;
    }>;
    page: number;
    pageSize: number;
  }
> = {
  name: "article_list_mine",
  description: "分页返回当前账号的文章列表。",
  schema: articleListMineSchema,
  handler: async (input, context) => {
    const result = await context.runtime.articleFlow.listMine(input, context.trace);
    return {
      data: result
    };
  }
};

const profileGetSelfSchema = {};

type ProfileGetSelfInput = z.infer<z.ZodObject<typeof profileGetSelfSchema>>;

export const profileGetSelfToolDefinition: ToolDefinition<
  typeof profileGetSelfSchema,
  ProfileGetSelfInput,
  {
    nickname: string;
    uid: string;
    avatarUrl: string;
    bio: string;
    followers: number;
    following: number;
  }
> = {
  name: "profile_get_self",
  description: "获取当前登录用户的资料。",
  schema: profileGetSelfSchema,
  handler: async (_input, context) => {
    const profile = await context.runtime.profileFlow.getSelf(context.trace);
    return {
      data: profile
    };
  }
};
