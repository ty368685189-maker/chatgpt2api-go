"use client";

import localforage from "localforage";

import type { ImageModel } from "@/lib/api";
import {
  listImageConversationsServer,
  saveImageConversationServer,
  deleteImageConversationServer,
} from "@/lib/api";

export type ImageConversationMode = "generate" | "edit";

export type StoredReferenceImage = {
  name: string;
  type: string;
  dataUrl: string;
};

export type StoredImage = {
  id: string;
  taskId?: string;
  status?: "loading" | "success" | "error";
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
  error?: string;
};

export type ImageTurnStatus = "queued" | "generating" | "success" | "error";

// 回复上一轮 AI 反问/拒绝时携带的上下文。
// 只用于在调用图片接口时拼接成模型可见的 prompt，不直接展示给用户。
// turn.prompt 永远只存用户本人输入的原文。
export type ImageReplyContext = {
  sourceTurnId: string;
  sourcePrompt: string;
  aiMessage: string;
};

export type ImageTurn = {
  id: string;
  prompt: string;
  model: ImageModel;
  mode: ImageConversationMode;
  referenceImages: StoredReferenceImage[];
  count: number;
  size: string;
  resolution?: string;
  images: StoredImage[];
  createdAt: string;
  status: ImageTurnStatus;
  error?: string;
  promptDeleted?: boolean;
  resultsDeleted?: boolean;
  replyContext?: ImageReplyContext;
};

export type ImageConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ImageTurn[];
};

export type ImageConversationStats = {
  queued: number;
  running: number;
};

const imageConversationStorage = localforage.createInstance({
  name: "chatgpt2api",
  storeName: "image_conversations",
});

const IMAGE_CONVERSATIONS_KEY = "items";
let imageConversationWriteQueue: Promise<void> = Promise.resolve();

function normalizeStoredImage(image: StoredImage): StoredImage {
  const normalized = {
    ...image,
    taskId: typeof image.taskId === "string" && image.taskId ? image.taskId : undefined,
    url: typeof image.url === "string" && image.url ? image.url : undefined,
    revised_prompt: typeof image.revised_prompt === "string" ? image.revised_prompt : undefined,
  };
  if (image.status === "loading" || image.status === "error" || image.status === "success") {
    return normalized;
  }
  return {
    ...normalized,
    status: image.b64_json || image.url ? "success" : "loading",
  };
}

function normalizeReferenceImage(image: StoredReferenceImage): StoredReferenceImage {
  return {
    name: image.name || "reference.png",
    type: image.type || "image/png",
    dataUrl: image.dataUrl,
  };
}

function dataUrlMimeType(dataUrl: string) {
  const match = dataUrl.match(/^data:(.*?);base64,/);
  return match?.[1] || "image/png";
}

function getLegacyReferenceImages(source: Record<string, unknown>): StoredReferenceImage[] {
  if (Array.isArray(source.referenceImages)) {
    return source.referenceImages
      .filter((image): image is StoredReferenceImage => {
        if (!image || typeof image !== "object") {
          return false;
        }
        const candidate = image as StoredReferenceImage;
        return typeof candidate.dataUrl === "string" && candidate.dataUrl.length > 0;
      })
      .map(normalizeReferenceImage);
  }

  if (source.sourceImage && typeof source.sourceImage === "object") {
    const image = source.sourceImage as { dataUrl?: unknown; fileName?: unknown };
    if (typeof image.dataUrl === "string" && image.dataUrl) {
      return [
        {
          name: typeof image.fileName === "string" && image.fileName ? image.fileName : "reference.png",
          type: dataUrlMimeType(image.dataUrl),
          dataUrl: image.dataUrl,
        },
      ];
    }
  }

  return [];
}

function normalizeReplyContext(value: unknown): ImageReplyContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const ctx = value as Partial<ImageReplyContext>;
  if (typeof ctx.sourceTurnId !== "string" || !ctx.sourceTurnId) {
    return undefined;
  }
  return {
    sourceTurnId: ctx.sourceTurnId,
    sourcePrompt: typeof ctx.sourcePrompt === "string" ? ctx.sourcePrompt : "",
    aiMessage: typeof ctx.aiMessage === "string" ? ctx.aiMessage : "",
  };
}

function normalizeTurn(turn: ImageTurn & Record<string, unknown>): ImageTurn {
  const normalizedImages = Array.isArray(turn.images) ? turn.images.map(normalizeStoredImage) : [];
  const derivedStatus: ImageTurnStatus =
    normalizedImages.some((image) => image.status === "loading")
      ? "generating"
      : normalizedImages.some((image) => image.status === "error")
        ? "error"
        : "success";

  return {
    id: String(turn.id || `${Date.now()}`),
    prompt: String(turn.prompt || ""),
    model: (turn.model as ImageModel) || "gpt-image-2",
    mode: turn.mode === "edit" ? "edit" : "generate",
    referenceImages: getLegacyReferenceImages(turn),
    count: Math.max(1, Number(turn.count || normalizedImages.length || 1)),
    size: typeof turn.size === "string" ? turn.size : "",
    resolution: typeof turn.resolution === "string" ? turn.resolution : "",
    images: normalizedImages,
    createdAt: String(turn.createdAt || new Date().toISOString()),
    status:
      turn.status === "queued" ||
      turn.status === "generating" ||
      turn.status === "success" ||
      turn.status === "error"
        ? turn.status
        : derivedStatus,
    error: typeof turn.error === "string" ? turn.error : undefined,
    promptDeleted: turn.promptDeleted === true,
    resultsDeleted: turn.resultsDeleted === true,
    replyContext: normalizeReplyContext(turn.replyContext),
  };
}

function normalizeConversation(conversation: ImageConversation & Record<string, unknown>): ImageConversation {
  const turns = Array.isArray(conversation.turns)
    ? conversation.turns.map((turn) => normalizeTurn(turn as ImageTurn & Record<string, unknown>))
    : [
        normalizeTurn({
          id: String(conversation.id || `${Date.now()}`),
          prompt: String(conversation.prompt || ""),
          model: (conversation.model as ImageModel) || "gpt-image-2",
          mode: conversation.mode === "edit" ? "edit" : "generate",
          referenceImages: getLegacyReferenceImages(conversation),
          count: Number(conversation.count || 1),
          size: typeof conversation.size === "string" ? conversation.size : "",
          resolution: typeof conversation.resolution === "string" ? conversation.resolution : "",
          images: Array.isArray(conversation.images) ? (conversation.images as StoredImage[]) : [],
          createdAt: String(conversation.createdAt || new Date().toISOString()),
          status:
            conversation.status === "generating" || conversation.status === "success" || conversation.status === "error"
              ? conversation.status
              : "success",
          error: typeof conversation.error === "string" ? conversation.error : undefined,
        }),
      ];
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;

  return {
    id: String(conversation.id || `${Date.now()}`),
    title: String(conversation.title || ""),
    createdAt: String(conversation.createdAt || lastTurn?.createdAt || new Date().toISOString()),
    updatedAt: String(conversation.updatedAt || lastTurn?.createdAt || new Date().toISOString()),
    turns,
  };
}

function sortImageConversations(conversations: ImageConversation[]): ImageConversation[] {
  return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function getTimestamp(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function pickLatestConversation(current: ImageConversation, next: ImageConversation) {
  return getTimestamp(next.updatedAt) >= getTimestamp(current.updatedAt) ? next : current;
}

function queueImageConversationWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = imageConversationWriteQueue.then(operation);
  imageConversationWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readStoredImageConversations(): Promise<ImageConversation[]> {
  const items =
    (await imageConversationStorage.getItem<Array<ImageConversation & Record<string, unknown>>>(
      IMAGE_CONVERSATIONS_KEY,
    )) || [];
  return items.map(normalizeConversation);
}

export async function listImageConversations(): Promise<ImageConversation[]> {
  // Load from both local and server, merge
  const localItems = await readStoredImageConversations();
  
  try {
    const serverData = await listImageConversationsServer();
    const serverItems = (serverData.items || []).map((item) => normalizeConversation(item as ImageConversation & Record<string, unknown>));
    
    if (serverItems.length > 0) {
      // Merge: server items + local items, deduplicate by id, pick latest
      const merged = new Map<string, ImageConversation>();
      for (const item of localItems) {
        merged.set(item.id, item);
      }
      for (const item of serverItems) {
        const existing = merged.get(item.id);
        merged.set(item.id, existing ? pickLatestConversation(existing, item) : item);
      }
      const result = sortImageConversations([...merged.values()]);
      
      // Save merged result back to local (without b64 to save space)
      const stripped = result.map(stripB64ForStorage);
      await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, stripped);
      
      return result;
    }
  } catch {
    // Server unavailable, fall back to local only
  }
  
  return sortImageConversations(localItems);
}

/** Strip b64_json from images for server sync (too large) */
function stripB64ForServer(conversation: ImageConversation): Record<string, unknown> {
  return {
    ...conversation,
    turns: conversation.turns.map((turn) => ({
      ...turn,
      referenceImages: [], // Don't sync reference images (large dataUrls)
      images: turn.images.map((img) => ({
        id: img.id,
        taskId: img.taskId,
        status: img.status,
        url: img.url,
        revised_prompt: img.revised_prompt,
        error: img.error,
        // Skip b64_json - too large for server sync
      })),
    })),
  };
}

/** Strip b64_json for local storage to save IndexedDB space */
function stripB64ForStorage(conversation: ImageConversation): ImageConversation {
  return {
    ...conversation,
    turns: conversation.turns.map((turn) => ({
      ...turn,
      images: turn.images.map((img) => {
        if (img.url || img.status !== "success") return img;
        // Keep b64 only if no URL available
        return img;
      }),
    })),
  };
}

export async function saveImageConversations(conversations: ImageConversation[]): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    const conversationMap = new Map(items.map((item) => [item.id, item]));
    for (const conversation of conversations.map(normalizeConversation)) {
      const current = conversationMap.get(conversation.id);
      conversationMap.set(conversation.id, current ? pickLatestConversation(current, conversation) : conversation);
    }
    const sorted = sortImageConversations([...conversationMap.values()]);
    await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, stripB64ForStorage(sorted));
    
    // Sync to server (fire and forget)
    for (const conversation of conversations) {
      try {
        await saveImageConversationServer(stripB64ForServer(conversation));
      } catch {
        // Ignore sync errors
      }
    }
  });
}

export async function saveImageConversation(conversation: ImageConversation): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    const nextConversation = normalizeConversation(conversation);
    const current = items.find((item) => item.id === nextConversation.id);
    const persistedConversation = current ? pickLatestConversation(current, nextConversation) : nextConversation;
    const nextItems = sortImageConversations([
      persistedConversation,
      ...items.filter((item) => item.id !== persistedConversation.id),
    ]);
    await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, stripB64ForStorage(nextItems));
    
    // Sync to server (fire and forget)
    try {
      await saveImageConversationServer(stripB64ForServer(persistedConversation));
    } catch {
      // Ignore sync errors
    }
  });
}

export async function renameImageConversation(id: string, title: string): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    const target = items.find((item) => item.id === id);
    if (!target) return;
    const updated = { ...target, title, updatedAt: new Date().toISOString() };
    const nextItems = sortImageConversations([
      updated,
      ...items.filter((item) => item.id !== id),
    ]);
    await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, nextItems);
    
    // Sync to server
    try {
      await saveImageConversationServer(stripB64ForServer(updated));
    } catch {
      // Ignore
    }
  });
}

export async function deleteImageConversation(id: string): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    await imageConversationStorage.setItem(
      IMAGE_CONVERSATIONS_KEY,
      items.filter((item) => item.id !== id),
    );
    
    // Delete from server too
    try {
      await deleteImageConversationServer(id);
    } catch {
      // Ignore
    }
  });
}

export async function clearImageConversations(): Promise<void> {
  await queueImageConversationWrite(async () => {
    await imageConversationStorage.removeItem(IMAGE_CONVERSATIONS_KEY);
  });
}

export function getImageConversationStats(conversation: ImageConversation | null): ImageConversationStats {
  if (!conversation) {
    return { queued: 0, running: 0 };
  }

  return conversation.turns.reduce(
    (acc, turn) => {
      if (turn.resultsDeleted) {
        return acc;
      }
      if (turn.status === "queued") {
        acc.queued += 1;
      } else if (turn.status === "generating") {
        acc.running += 1;
      }
      return acc;
    },
    { queued: 0, running: 0 },
  );
}
