import type { User } from "@prisma/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { decryptText, encryptNullableText, encryptText } from "./crypto.js";
import { handleServerError } from "./errors.js";
import { prisma } from "./prisma.js";

const TAGS = ["Session Prep", "Triggers", "Wins", "Homework", "Boundaries", "Anxiety", "General"] as const;
const REPORT_REASONS = ["Harassment", "Hate", "Spam", "Self-harm", "Privacy", "Other"] as const;
const ADJECTIVES = [
  "Gentle",
  "Quiet",
  "Brave",
  "Calm",
  "Patient",
  "Wise",
  "Kind",
  "Steady",
  "Warm",
  "Curious",
  "Tender",
  "Bright",
  "Peaceful",
  "Strong",
  "Hopeful",
] as const;
const ANIMALS = [
  "Otter",
  "Sparrow",
  "Fox",
  "Deer",
  "Bear",
  "Owl",
  "Dolphin",
  "Hawk",
  "Rabbit",
  "Cat",
  "Wolf",
  "Finch",
  "Crane",
  "Elk",
  "Wren",
] as const;

const PAGE_DEFAULT = 12;
const PAGE_MAX = 25;
const TRENDING_FETCH_MULTIPLIER = 4;
const SEARCH_FETCH_MULTIPLIER = 8;
const SEARCH_FETCH_MAX = 250;
const MAX_TITLE_LENGTH = 180;
const MAX_POST_BODY_LENGTH = 4000;
const MAX_COMMENT_LENGTH = 1200;
const MAX_REPORT_DETAILS_LENGTH = 500;
const POSTS_PER_HOUR_LIMIT = 6;
const COMMENTS_PER_HOUR_LIMIT = 40;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const HIDE_THRESHOLD_REPORTS = 3;

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_REGEX = /(\+?\d[\d\s().-]{8,}\d)/;
const URL_REGEX = /(https?:\/\/|www\.)/i;

export type CommunityResource = "community" | "community-comments" | "community-likes" | "community-reports";

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getCommunityAlias(userId: string) {
  const base = hashString(userId);
  const adjective = ADJECTIVES[base % ADJECTIVES.length];
  const animal = ANIMALS[Math.floor(base / ADJECTIVES.length) % ANIMALS.length];
  return `${adjective} ${animal}`;
}

function parseSort(value: unknown): "recent" | "trending" {
  return value === "recent" ? "recent" : "trending";
}

function parseTag(value: unknown): string | undefined {
  if (!value || typeof value !== "string") return undefined;
  if (value === "All") return undefined;
  if (TAGS.includes(value as (typeof TAGS)[number])) return value;
  return undefined;
}

function parseReplies(value: unknown): "all" | "with" | "without" {
  if (value === "with") return "with";
  if (value === "without") return "without";
  return "all";
}

function parseLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return PAGE_DEFAULT;
  return Math.max(1, Math.min(PAGE_MAX, Math.floor(parsed)));
}

function parseCursor(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function normalizeContent(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function validateSafety(text: string) {
  if (EMAIL_REGEX.test(text) || PHONE_REGEX.test(text)) {
    return "Do not share personal contact information in community posts.";
  }

  if (URL_REGEX.test(text)) {
    return "External links are blocked in community for safety.";
  }

  return null;
}

function buildWhere(params: {
  tag?: string;
  replies: "all" | "with" | "without";
  cursor: Date | null;
}) {
  return {
    isHidden: false,
    ...(params.tag ? { tag: params.tag } : {}),
    ...(params.cursor ? { createdAt: { lt: params.cursor } } : {}),
    ...(params.replies === "with"
      ? { comments: { some: { isHidden: false } } }
      : params.replies === "without"
        ? { comments: { none: { isHidden: false } } }
        : {}),
  };
}

function trendingScore(post: Pick<SerializedCommunityPost, "createdAt" | "likes" | "repliesCount">) {
  const ageMs = Date.now() - new Date(post.createdAt).getTime();
  const ageHours = Math.max(ageMs / (1000 * 60 * 60), 0);
  const recencyBoost = Math.max(72 - ageHours, 0) * 0.25;
  return post.likes * 3 + post.repliesCount * 2 + recencyBoost;
}

interface SerializedCommunityReply {
  id: string;
  alias: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  likes: number;
  liked: boolean;
}

interface SerializedCommunityPost {
  id: string;
  alias: string;
  title: string;
  body: string;
  tag: string;
  createdAt: Date;
  updatedAt: Date;
  likes: number;
  liked: boolean;
  repliesCount: number;
  replies: SerializedCommunityReply[];
}

function serializePost(post: any): SerializedCommunityPost {
  const title = decryptText(post.title);
  const body = decryptText(post.body);

  return {
    id: post.id,
    alias: getCommunityAlias(post.userId),
    title,
    body,
    tag: post.tag,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    likes: post._count.likes,
    liked: post.likes.length > 0,
    repliesCount: post._count.comments,
    replies: post.comments.map((comment: any) => ({
      id: comment.id,
      alias: getCommunityAlias(comment.userId),
      body: decryptText(comment.body),
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      likes: comment._count.likes,
      liked: comment.likes.length > 0,
    })),
  };
}

function matchesSearch(post: SerializedCommunityPost, search: string) {
  const needle = search.toLowerCase();
  if (!needle) return true;

  if (post.title.toLowerCase().includes(needle)) return true;
  if (post.body.toLowerCase().includes(needle)) return true;
  if (post.tag.toLowerCase().includes(needle)) return true;

  return post.replies.some(reply => reply.body.toLowerCase().includes(needle));
}

async function listPosts(req: VercelRequest, res: VercelResponse, user: User) {
  const tag = parseTag(req.query.tag);
  const sort = parseSort(req.query.sort);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const replies = parseReplies(req.query.replies);
  const limit = parseLimit(req.query.limit);
  const cursor = parseCursor(req.query.cursor);

  const baseFetchTake = sort === "trending" ? limit * TRENDING_FETCH_MULTIPLIER : limit + 1;
  const fetchTake = search
    ? Math.min(Math.max(baseFetchTake * SEARCH_FETCH_MULTIPLIER, limit * 6), SEARCH_FETCH_MAX)
    : baseFetchTake;

  const posts = await prisma.communityPost.findMany({
    where: buildWhere({ tag, replies, cursor }),
    include: {
      _count: {
        select: {
          likes: true,
          comments: {
            where: { isHidden: false },
          },
        },
      },
      likes: {
        where: { userId: user.id },
        select: { userId: true },
      },
      comments: {
        where: { isHidden: false },
        orderBy: { createdAt: "asc" },
        include: {
          _count: {
            select: { likes: true },
          },
          likes: {
            where: { userId: user.id },
            select: { userId: true },
          },
        },
        take: 100,
      },
    },
    orderBy: { createdAt: "desc" },
    take: fetchTake,
  });

  const serialized = posts.map(serializePost);
  const filtered = search ? serialized.filter(post => matchesSearch(post, search)) : serialized;
  const sorted =
    sort === "trending" ? [...filtered].sort((a, b) => trendingScore(b) - trendingScore(a)) : filtered;
  const hasMore = sorted.length > limit;
  const paged = sorted.slice(0, limit);
  const nextCursor =
    hasMore && paged.length > 0 ? new Date(paged[paged.length - 1].createdAt).toISOString() : null;

  return res.status(200).json({
    viewerAlias: getCommunityAlias(user.id),
    posts: paged,
    filters: {
      tag: tag ?? "All",
      sort,
      search,
      replies,
      limit,
    },
    pagination: {
      nextCursor,
      hasMore,
    },
    tags: ["All", ...TAGS],
    reportReasons: [...REPORT_REASONS],
  });
}

interface CreatePostBody {
  title?: string;
  body?: string;
  tag?: string;
}

async function createPost(req: VercelRequest, res: VercelResponse, user: User) {
  const body = (req.body ?? {}) as CreatePostBody;
  const title = normalizeContent(body.title ?? "");
  const content = normalizeContent(body.body ?? "");
  const tag = parseTag(body.tag) ?? "General";

  if (!title || title.length < 6) {
    return res.status(400).json({ error: "Title must be at least 6 characters" });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return res.status(400).json({ error: `Title must be under ${MAX_TITLE_LENGTH} characters` });
  }

  if (!content || content.length < 10) {
    return res.status(400).json({ error: "Post body must be at least 10 characters" });
  }
  if (content.length > MAX_POST_BODY_LENGTH) {
    return res.status(400).json({ error: `Post body must be under ${MAX_POST_BODY_LENGTH} characters` });
  }

  const safety = validateSafety(`${title} ${content}`);
  if (safety) return res.status(400).json({ error: safety });

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const tenMinutesAgo = new Date(Date.now() - DUPLICATE_WINDOW_MS);

  const [postCountLastHour, recentPosts] = await Promise.all([
    prisma.communityPost.count({
      where: {
        userId: user.id,
        createdAt: { gte: hourAgo },
      },
    }),
    prisma.communityPost.findMany({
      where: {
        userId: user.id,
        createdAt: { gte: tenMinutesAgo },
      },
      select: { id: true, title: true, body: true },
      take: 25,
    }),
  ]);

  const duplicatePost = recentPosts.some(
    post => decryptText(post.title) === title && decryptText(post.body) === content,
  );

  if (postCountLastHour >= POSTS_PER_HOUR_LIMIT) {
    return res.status(429).json({ error: "Posting too quickly. Please wait before creating another post." });
  }

  if (duplicatePost) {
    return res.status(409).json({ error: "Duplicate post detected. Please edit your message before reposting." });
  }

  const created = await prisma.communityPost.create({
    data: {
      userId: user.id,
      title: encryptText(title),
      body: encryptText(content),
      tag,
    },
    include: {
      _count: {
        select: {
          likes: true,
          comments: {
            where: { isHidden: false },
          },
        },
      },
      likes: {
        where: { userId: user.id },
        select: { userId: true },
      },
      comments: {
        where: { isHidden: false },
        orderBy: { createdAt: "asc" },
        include: {
          _count: {
            select: { likes: true },
          },
          likes: {
            where: { userId: user.id },
            select: { userId: true },
          },
        },
      },
    },
  });

  return res.status(201).json({ post: serializePost(created) });
}

interface CreateCommentBody {
  postId?: string;
  body?: string;
}

async function createComment(req: VercelRequest, res: VercelResponse, user: User) {
  const body = (req.body ?? {}) as CreateCommentBody;
  const postId = body.postId;
  const content = normalizeContent(body.body ?? "");

  if (!postId) {
    return res.status(400).json({ error: "postId is required" });
  }

  if (!content || content.length < 2) {
    return res.status(400).json({ error: "Reply must be at least 2 characters" });
  }

  if (content.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ error: `Reply must be under ${MAX_COMMENT_LENGTH} characters` });
  }

  const safety = validateSafety(content);
  if (safety) return res.status(400).json({ error: safety });

  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, isHidden: true },
  });
  if (!post || post.isHidden) {
    return res.status(404).json({ error: "Post not found" });
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const tenMinutesAgo = new Date(Date.now() - DUPLICATE_WINDOW_MS);

  const [commentCountLastHour, recentComments] = await Promise.all([
    prisma.communityComment.count({
      where: {
        userId: user.id,
        createdAt: { gte: hourAgo },
      },
    }),
    prisma.communityComment.findMany({
      where: {
        postId,
        userId: user.id,
        createdAt: { gte: tenMinutesAgo },
      },
      select: { id: true, body: true },
      take: 50,
    }),
  ]);

  const duplicateComment = recentComments.some(comment => decryptText(comment.body) === content);

  if (commentCountLastHour >= COMMENTS_PER_HOUR_LIMIT) {
    return res.status(429).json({ error: "Replying too quickly. Please wait before posting another reply." });
  }

  if (duplicateComment) {
    return res.status(409).json({ error: "Duplicate reply detected. Please edit before reposting." });
  }

  const comment = await prisma.communityComment.create({
    data: {
      postId,
      userId: user.id,
      body: encryptText(content),
    },
    include: {
      _count: {
        select: { likes: true },
      },
      likes: {
        where: { userId: user.id },
        select: { userId: true },
      },
    },
  });

  return res.status(201).json({
    comment: {
      id: comment.id,
      alias: getCommunityAlias(comment.userId),
      body: decryptText(comment.body),
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      likes: comment._count.likes,
      liked: comment.likes.length > 0,
    },
  });
}

interface ToggleLikeBody {
  targetType?: "post" | "comment";
  targetId?: string;
}

async function togglePostLike(targetId: string, userId: string) {
  const existing = await prisma.communityPostLike.findUnique({
    where: { userId_postId: { userId, postId: targetId } },
  });

  if (existing) {
    await prisma.communityPostLike.delete({
      where: { userId_postId: { userId, postId: targetId } },
    });
  } else {
    await prisma.communityPostLike.create({
      data: { userId, postId: targetId },
    });
  }

  const count = await prisma.communityPostLike.count({ where: { postId: targetId } });

  return { liked: !existing, likes: count };
}

async function toggleCommentLike(targetId: string, userId: string) {
  const existing = await prisma.communityCommentLike.findUnique({
    where: { userId_commentId: { userId, commentId: targetId } },
  });

  if (existing) {
    await prisma.communityCommentLike.delete({
      where: { userId_commentId: { userId, commentId: targetId } },
    });
  } else {
    await prisma.communityCommentLike.create({
      data: { userId, commentId: targetId },
    });
  }

  const count = await prisma.communityCommentLike.count({ where: { commentId: targetId } });

  return { liked: !existing, likes: count };
}

async function toggleLike(req: VercelRequest, res: VercelResponse, user: User) {
  const body = (req.body ?? {}) as ToggleLikeBody;
  const targetType = body.targetType;
  const targetId = body.targetId;

  if (!targetType || !targetId) {
    return res.status(400).json({ error: "targetType and targetId are required" });
  }

  if (targetType === "post") {
    const exists = await prisma.communityPost.findUnique({
      where: { id: targetId },
      select: { id: true, isHidden: true },
    });
    if (!exists || exists.isHidden) return res.status(404).json({ error: "Post not found" });

    const state = await togglePostLike(targetId, user.id);
    return res.status(200).json({ targetType, targetId, ...state });
  }

  if (targetType === "comment") {
    const exists = await prisma.communityComment.findUnique({
      where: { id: targetId },
      select: { id: true, isHidden: true },
    });
    if (!exists || exists.isHidden) return res.status(404).json({ error: "Comment not found" });

    const state = await toggleCommentLike(targetId, user.id);
    return res.status(200).json({ targetType, targetId, ...state });
  }

  return res.status(400).json({ error: "Invalid targetType" });
}

interface ReportBody {
  targetType?: "post" | "comment";
  targetId?: string;
  reason?: string;
  details?: string;
}

async function maybeHideTarget(targetType: "post" | "comment", targetId: string) {
  if (targetType === "post") {
    const openReports = await prisma.communityReport.count({
      where: {
        postId: targetId,
        status: "OPEN",
      },
    });

    if (openReports >= HIDE_THRESHOLD_REPORTS) {
      await prisma.communityPost.update({
        where: { id: targetId },
        data: {
          isHidden: true,
          hiddenAt: new Date(),
          hiddenReason: `Auto-hidden after ${openReports} reports`,
        },
      });
    }

    return openReports;
  }

  const openReports = await prisma.communityReport.count({
    where: {
      commentId: targetId,
      status: "OPEN",
    },
  });

  if (openReports >= HIDE_THRESHOLD_REPORTS) {
    await prisma.communityComment.update({
      where: { id: targetId },
      data: {
        isHidden: true,
        hiddenAt: new Date(),
        hiddenReason: `Auto-hidden after ${openReports} reports`,
      },
    });
  }

  return openReports;
}

async function createReport(req: VercelRequest, res: VercelResponse, user: User) {
  const body = (req.body ?? {}) as ReportBody;
  const targetType = body.targetType;
  const targetId = body.targetId;
  const reason = typeof body.reason === "string" ? body.reason : "Other";
  const details = typeof body.details === "string" ? body.details.trim().slice(0, MAX_REPORT_DETAILS_LENGTH) : null;
  const encryptedDetails = encryptNullableText(details);

  if (!targetType || !targetId) {
    return res.status(400).json({ error: "targetType and targetId are required" });
  }

  if (!REPORT_REASONS.includes(reason as (typeof REPORT_REASONS)[number])) {
    return res.status(400).json({ error: "Invalid report reason" });
  }

  if (targetType === "post") {
    const target = await prisma.communityPost.findUnique({
      where: { id: targetId },
      select: { id: true, userId: true, isHidden: true },
    });

    if (!target || target.isHidden) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (target.userId === user.id) {
      return res.status(400).json({ error: "You cannot report your own post" });
    }

    const existing = await prisma.communityReport.findFirst({
      where: {
        reporterId: user.id,
        postId: targetId,
        status: "OPEN",
      },
      select: { id: true },
    });

    if (existing) {
      return res.status(200).json({ reported: true, duplicate: true });
    }

    await prisma.communityReport.create({
      data: {
        reporterId: user.id,
        postId: targetId,
        reason,
        details: encryptedDetails,
      },
    });

    const openReports = await maybeHideTarget("post", targetId);
    return res.status(201).json({ reported: true, openReports });
  }

  if (targetType === "comment") {
    const target = await prisma.communityComment.findUnique({
      where: { id: targetId },
      select: { id: true, userId: true, isHidden: true },
    });

    if (!target || target.isHidden) {
      return res.status(404).json({ error: "Comment not found" });
    }

    if (target.userId === user.id) {
      return res.status(400).json({ error: "You cannot report your own reply" });
    }

    const existing = await prisma.communityReport.findFirst({
      where: {
        reporterId: user.id,
        commentId: targetId,
        status: "OPEN",
      },
      select: { id: true },
    });

    if (existing) {
      return res.status(200).json({ reported: true, duplicate: true });
    }

    await prisma.communityReport.create({
      data: {
        reporterId: user.id,
        commentId: targetId,
        reason,
        details: encryptedDetails,
      },
    });

    const openReports = await maybeHideTarget("comment", targetId);
    return res.status(201).json({ reported: true, openReports });
  }

  return res.status(400).json({ error: "Invalid targetType" });
}

export async function handleCommunityRequest(
  req: VercelRequest,
  res: VercelResponse,
  user: User,
  resource: CommunityResource,
) {
  try {
    if (resource === "community") {
      if (req.method === "GET") return await listPosts(req, res, user);
      if (req.method === "POST") return await createPost(req, res, user);

      res.setHeader("Allow", "GET, POST, OPTIONS");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    if (resource === "community-comments") {
      if (req.method === "POST") return await createComment(req, res, user);

      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    if (resource === "community-likes") {
      if (req.method === "POST") return await toggleLike(req, res, user);

      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    if (resource === "community-reports") {
      if (req.method === "POST") return await createReport(req, res, user);

      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    return res.status(400).json({ error: "Invalid community resource" });
  } catch (error) {
    return handleServerError(
      res,
      "community:request",
      error,
      "Community request failed. Please try again.",
    );
  }
}
