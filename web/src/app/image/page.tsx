"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { History, Infinity as InfinityIcon, LoaderCircle, Plus, Trash2, CheckSquare, Download, Share2, Star } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { ImageComposer } from "@/app/image/components/image-composer";
import { ImageResults, type ImageLightboxItem, type ImagePublishState } from "@/app/image/components/image-results";
import { ImageSidebar } from "@/app/image/components/image-sidebar";
import { ImageLightbox } from "@/components/image-lightbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  createImageEditTask,
  createImageGenerationTask,
  cancelImageTasks,
  deleteManagedImages,
  fetchImageTasks,
  fetchMyIdentity,
  publishGalleryItem,
  type ImageTask,
  type ManagedImage,
} from "@/lib/api";

function getPathFromUrl(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/\/images\/(.+)$/);
  return match ? match[1] : null;
}
import { useAuthGuard } from "@/lib/use-auth-guard";
import {
  clearImageConversations,
  deleteImageConversation,
  getImageConversationStats,
  listImageConversations,
  renameImageConversation,
  saveImageConversation,
  saveImageConversations,
  type ImageConversation,
  type ImageConversationMode,
  type ImageTurn,
  type ImageTurnStatus,
  type StoredImage,
  type StoredReferenceImage,
} from "@/store/image-conversations";

const ACTIVE_CONVERSATION_STORAGE_KEY = "chatgpt2api:image_active_conversation_id";
const IMAGE_SIZE_STORAGE_KEY = "chatgpt2api:image_last_size";
const IMAGE_RESOLUTION_STORAGE_KEY = "chatgpt2api:image_last_resolution";
const IMAGE_COUNT_STORAGE_KEY = "chatgpt2api:image_last_count";
const HIGH_RESOLUTION_VALUES = new Set(["2k", "4k"]);
// 每个会话的滚动位置单独存。用 sessionStorage 因为这就是"会话级"的临时位置，
// 关浏览器后从底部重看更自然；要跨浏览器会话保留改成 localStorage 即可。
const SCROLL_POSITION_STORAGE_KEY = "chatgpt2api:image_scroll_positions";

const MAX_REFERENCE_IMAGES = 5;

function clampImageCount(value: string, maxLimit = 4) {
  return String(Math.max(1, Math.min(maxLimit, Math.floor(Number(value) || 1))));
}

function isHighResolution(value: string | null | undefined) {
  return HIGH_RESOLUTION_VALUES.has(String(value || "").trim().toLowerCase());
}

const activeConversationQueueIds = new Set<string>();

function buildConversationTitle(prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 12)}...`;
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAvailableQuota() {
  // 已废弃：admin 直接显示 ∞，不再走号池累加，留壳避免外部潜在调用炸掉。
  return "∞";
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取参考图失败"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string) {
  const [header, content] = dataUrl.split(",", 2);
  const matchedMimeType = header.match(/data:(.*?);base64/)?.[1];
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mimeType || matchedMimeType || "image/png" });
}

function buildReferenceImageFromResult(image: StoredImage, fileName: string): StoredReferenceImage | null {
  if (!image.b64_json) {
    return null;
  }

  return {
    name: fileName,
    type: "image/png",
    dataUrl: `data:image/png;base64,${image.b64_json}`,
  };
}

async function fetchImageAsFile(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("读取结果图失败");
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

async function buildReferenceImageFromStoredImage(image: StoredImage, fileName: string) {
  const direct = buildReferenceImageFromResult(image, fileName);
  if (direct) {
    return {
      referenceImage: direct,
      file: dataUrlToFile(direct.dataUrl, direct.name, direct.type),
    };
  }

  if (!image.url) {
    return null;
  }
  const rel = getPathFromUrl(image.url);
  const fetchUrl = rel ? `/images/${rel}` : image.url;
  const file = await fetchImageAsFile(fetchUrl, fileName);
  return {
    referenceImage: {
      name: file.name,
      type: file.type || "image/png",
      dataUrl: await readFileAsDataUrl(file),
    },
    file,
  };
}

function taskDataToStoredImage(image: StoredImage, task: ImageTask): StoredImage {
  if (image.status === "error" && (image.error === "用户已取消该任务" || image.error === "已取消")) {
    if (task.status === "running" || task.status === "queued" || task.status === "pending") {
      return image;
    }
  }

  if (task.status === "success") {
    const first = task.data?.[0];
    if (!first?.b64_json && !first?.url) {
      return {
        ...image,
        taskId: task.id,
        status: "error",
        error: "未返回图片数据",
      };
    }
    return {
      ...image,
      taskId: task.id,
      status: "success",
      b64_json: first.b64_json,
      url: first.url,
      revised_prompt: first.revised_prompt,
      error: undefined,
    };
  }

  if (task.status === "error") {
    return {
      ...image,
      taskId: task.id,
      status: "error",
      error: task.error || "生成失败",
    };
  }

  if (task.status === "canceled") {
    return {
      ...image,
      taskId: task.id,
      status: "error",
      error: task.error || "已取消",
    };
  }

  return {
    ...image,
    taskId: task.id,
    status: "loading",
    error: undefined,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function pickFallbackConversationId(conversations: ImageConversation[]) {
  const activeConversation = conversations.find((conversation) =>
    conversation.turns.some((turn) => turn.status === "queued" || turn.status === "generating"),
  );
  return activeConversation?.id ?? conversations[0]?.id ?? null;
}

function sortImageConversations(conversations: ImageConversation[]) {
  return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function collectLoadingTaskIds(conversation: ImageConversation): string[] {
  const ids: string[] = [];
  for (const turn of conversation.turns) {
    if (turn.resultsDeleted) continue;
    for (const image of turn.images) {
      if (image.status === "loading" && image.taskId) {
        ids.push(image.taskId);
      }
    }
  }
  return ids;
}

function collectTurnLoadingTaskIds(turn: ImageTurn): string[] {
  if (turn.resultsDeleted) return [];
  return turn.images.flatMap((image) =>
    image.status === "loading" && image.taskId ? [image.taskId] : [],
  );
}

async function cancelTaskIdsSilently(ids: string[]) {
  if (ids.length === 0) return;
  try {
    await cancelImageTasks(ids);
  } catch {
    // 取消失败不阻塞 UI 删除流程；后端任务会按重试/超时自然终止
  }
}

function deriveTurnStatus(turn: ImageTurn): Pick<ImageTurn, "status" | "error"> {
  const loadingCount = turn.images.filter((image) => image.status === "loading").length;
  const failedCount = turn.images.filter((image) => image.status === "error").length;
  const successCount = turn.images.filter((image) => image.status === "success").length;
  if (loadingCount > 0) {
    return { status: turn.status === "queued" ? "queued" : "generating", error: undefined };
  }
  if (failedCount > 0) {
    return { status: "error", error: `其中 ${failedCount} 张未成功生成` };
  }
  if (successCount > 0) {
    return { status: "success", error: undefined };
  }
  return { status: "queued", error: undefined };
}

async function syncConversationImageTasks(items: ImageConversation[]) {
  const taskIds = Array.from(
    new Set(
      items.flatMap((conversation) =>
        conversation.turns.flatMap((turn) =>
          turn.resultsDeleted
            ? []
            : turn.images.flatMap((image) => (image.status === "loading" && image.taskId ? [image.taskId] : [])),
        ),
      ),
    ),
  );
  if (taskIds.length === 0) {
    return items;
  }

  let taskList: Awaited<ReturnType<typeof fetchImageTasks>>;
  try {
    taskList = await fetchImageTasks(taskIds);
  } catch {
    return items;
  }
  const taskMap = new Map(taskList.items.map((task) => [task.id, task]));
  let changed = false;
  const normalized = items.map((conversation) => {
    const turns = conversation.turns.map((turn) => {
      let turnChanged = false;
      const images = turn.images.map((image) => {
        if (image.status !== "loading" || !image.taskId) {
          return image;
        }
        const task = taskMap.get(image.taskId);
        if (!task) {
          return image;
        }
        const nextImage = taskDataToStoredImage(image, task);
        if (nextImage !== image) {
          turnChanged = true;
        }
        return nextImage;
      });
      if (!turnChanged) {
        return turn;
      }
      changed = true;
      const derived = deriveTurnStatus({ ...turn, images });
      return {
        ...turn,
        ...derived,
        images,
      };
    });
    if (turns === conversation.turns || !turns.some((turn, index) => turn !== conversation.turns[index])) {
      return conversation;
    }
    return {
      ...conversation,
      turns,
      updatedAt: new Date().toISOString(),
    };
  });

  if (changed) {
    await saveImageConversations(normalized);
  }
  return normalized;
}

async function recoverConversationHistory(items: ImageConversation[]) {
  let changed = false;
  const normalized = items.map((conversation) => {
    const turns = conversation.turns.map((turn) => {
      if (turn.status !== "queued" && turn.status !== "generating") {
        return turn;
      }

      let turnChanged = false;
      const images = turn.images.map((image) => {
        if (image.status !== "loading" || image.taskId) {
          return image;
        }
        turnChanged = true;
        return {
          ...image,
          status: "error" as const,
          error: "页面刷新或任务中断，未找到可恢复的任务 ID",
        };
      });
      const derived = deriveTurnStatus({ ...turn, images });
      if (!turnChanged && derived.status === turn.status && derived.error === turn.error) {
        return turn;
      }
      changed = true;
      return {
        ...turn,
        ...derived,
        images,
      };
    });

    if (!turns.some((turn, index) => turn !== conversation.turns[index])) {
      return conversation;
    }

    return {
      ...conversation,
      turns,
      updatedAt: new Date().toISOString(),
    };
  });

  if (changed) {
    await saveImageConversations(normalized);
  }

  return syncConversationImageTasks(normalized);
}


function ImagePageContent({ isAdmin }: { isAdmin: boolean }) {
  const didLoadQuotaRef = useRef(false);
  const initialLoadCompleteRef = useRef(false);
  const conversationsRef = useRef<ImageConversation[]>([]);
  const resultsViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 滚动位置：每个会话独立记一份，刷新/切页都能落回上次位置
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const restoredConversationIdRef = useRef<string | null>(null);
  const lastTurnCountRef = useRef<number>(0);
  const lastActiveCountRef = useRef<number>(0);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [imagePrompt, setImagePrompt] = useState("");
  const [imageCount, setImageCount] = useState("1");
  const [imageSize, setImageSize] = useState("");
  const [imageResolution, setImageResolution] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceImages, setReferenceImages] = useState<StoredReferenceImage[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [availableQuota, setAvailableQuota] = useState("加载中...");
  const [canUseHighResolution, setCanUseHighResolution] = useState(isAdmin);
  const [lightboxImages, setLightboxImages] = useState<ImageLightboxItem[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  // 底部渐隐条只在"内容超出视口且没滚到底"时显示——
  // 没有内容、刚好填满、或者已经滚到底，都不应该看到那块灰雾。
  const [showBottomFade, setShowBottomFade] = useState(false);
  // 当用户在错误卡片上点击"回复"时记录的上下文，仅 UI 展示 + 提交时拼装 API prompt 用，
  // 不会进入 turn.prompt 也不会进入聊天可见列表，所以用户视野里永远只有自己说过的话。
  const [replyTarget, setReplyTarget] = useState<{
    conversationId: string;
    sourceTurnId: string;
    sourcePrompt: string;
    aiMessage: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { type: "one"; id: string }
    | { type: "prompt"; conversationId: string; turnId: string }
    | { type: "results"; conversationId: string; turnId: string }
    | { type: "all" }
    | { type: "batch" }
    | null
  >(null);

  // New batch management states
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  const [isBatchActionLoading, setIsBatchActionLoading] = useState(false);

  // New favorites/starring states
  const [favorites, setFavorites] = useState<ManagedImage[]>([]);

  // Dynamically compute max images allowed per request based on remaining quota
  const maxImageCountLimit = useMemo(() => {
    if (availableQuota === "∞") return 4;
    if (availableQuota === "加载中..." || availableQuota === "--") return 4;
    const remaining = Number(availableQuota);
    return Math.max(1, Math.min(4, remaining));
  }, [availableQuota]);

  const countOptions = useMemo(() => {
    const opts = [];
    for (let i = 1; i <= maxImageCountLimit; i++) {
      opts.push(i);
    }
    return opts;
  }, [maxImageCountLimit]);

  const parsedCount = useMemo(() => {
    const num = Number(imageCount) || 1;
    const clamped = Math.max(1, Math.min(maxImageCountLimit, num));
    return clamped;
  }, [imageCount, maxImageCountLimit]);

  useEffect(() => {
    const num = Number(imageCount) || 1;
    if (num > maxImageCountLimit) {
      setImageCount(String(maxImageCountLimit));
    }
  }, [maxImageCountLimit, imageCount]);
  // 提交前的乐观额度检查：拦掉那些"已发送对话"成功 toast 后又紧跟着 "额度不足" 错误 toast 的双弹。
  // 管理员/不限额度/没拿到额度数据时一律放行，让后端兜底。
  const ensureQuotaForRequest = useCallback(
    (count: number) => {
      if (isAdmin) return true;
      if (availableQuota === "∞") return true;
      if (availableQuota === "加载中..." || availableQuota === "--") return true;
      const remaining = Number(availableQuota);
      if (!Number.isFinite(remaining)) return true;
      if (remaining <= 0) {
        toast.error("额度不足，请联系管理员追加额度后再试");
        return false;
      }
      if (remaining < count) {
        toast.error(`剩余额度仅 ${remaining}，无法生成 ${count} 张`);
        return false;
      }
      return true;
    },
    [availableQuota, isAdmin],
  );
  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const lastPrompt = useMemo(() => {
    if (!selectedConversation) return "";
    const activeTurns = selectedConversation.turns.filter((t) => !t.promptDeleted && t.prompt.trim());
    if (activeTurns.length === 0) return "";
    return activeTurns[activeTurns.length - 1].prompt;
  }, [selectedConversation]);
  const activeTaskCount = useMemo(
    () =>
      conversations.reduce((sum, conversation) => {
        const stats = getImageConversationStats(conversation);
        return sum + stats.queued + stats.running;
      }, 0),
    [conversations],
  );
  const deleteConfirmTitle =
    deleteConfirm?.type === "all"
      ? "清空历史记录"
      : deleteConfirm?.type === "prompt"
        ? "删除提示词记录"
        : deleteConfirm?.type === "results"
          ? "删除生成结果"
          : deleteConfirm?.type === "one"
            ? "删除对话"
            : deleteConfirm?.type === "batch"
              ? "批量删除图片"
              : "";
  const deleteConfirmDescription =
    deleteConfirm?.type === "all"
      ? "确认删除全部图片历史记录吗？删除后无法恢复。"
      : deleteConfirm?.type === "prompt"
        ? "确认删除这条提示词记录吗？对应生成结果会保留。"
        : deleteConfirm?.type === "results"
          ? "确认删除这条生成结果吗？对应提示词记录会保留。"
          : deleteConfirm?.type === "one"
            ? "确认删除这条图片对话吗？删除后无法恢复。"
            : deleteConfirm?.type === "batch"
              ? `确认删除选中的 ${selectedImageIds.size} 张图片吗？删除后无法恢复。`
              : "";

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // /works 页"用此图重画"会把 { rel, url, prompt } 写进 sessionStorage 然后跳过来。
  // 这里 mount 时读一次：拉图 → 转 File + dataUrl → 塞参考图区，prompt 直接灌输入框。
  // 读完立刻清掉 key，避免下次刷新页面又触发一次。
  // 优先用 rel 拼 `/images/${rel}` 同源拉取，避开 item.url 是后端绝对地址跨源 fetch 撞 CORS
  // (浏览器允许 <img> 跨源加载但拦 fetch，旧版直接传 url 会在这里报 "Failed to fetch")
  // ---
  // 不用 cancelled 守卫的原因：dev 模式 Strict Mode 会跑 effect 两次：
  //   1) 首次：读到 payload，removeItem，启动 fetch
  //   2) 首次 cleanup: cancelled=true
  //   3) 二次：再读 sessionStorage 已为 null，直接 return（没新 fetch）
  //   4) 首次 fetch 完成 → cancelled=true → 结果被丢弃，state 永远不设
  // 现象就是"不报错也没图"。改用 ref 哨兵保证全局只消费一次，且不让 cleanup 阻断结果落盘。
  const redrawHandoffConsumedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (redrawHandoffConsumedRef.current) return;
    redrawHandoffConsumedRef.current = true;

    const searchParams = new URLSearchParams(window.location.search);
    const queryRel = searchParams.get("redraw_rel");
    const queryUrl = searchParams.get("redraw_url");
    const queryPrompt = searchParams.get("redraw_prompt");

    let payload: { rel?: string; url?: string; prompt?: string } | null = null;

    if (queryRel || queryUrl) {
      payload = {
        rel: queryRel || "",
        url: queryUrl || "",
        prompt: queryPrompt || "",
      };
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch {}
    } else {
      let raw: string | null = null;
      try {
        raw = window.sessionStorage.getItem("chatgpt2api:redraw_handoff");
        if (raw) window.sessionStorage.removeItem("chatgpt2api:redraw_handoff");
      } catch {}
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {}
      }
    }

    if (!payload) return;
    const rel = payload.rel?.trim().replace(/^\/+/, "");
    // 优先 rel → 同源 /images/<rel>，没有 rel 兜底 url（老 handoff 格式）
    const sourceUrl = rel ? `/images/${rel}` : payload.url?.trim();
    if (!sourceUrl) return;

    void (async () => {
      try {
        const file = await fetchImageAsFile(sourceUrl, `redraw-${Date.now()}.png`);
        const dataUrl = await readFileAsDataUrl(file);
        setReferenceImages((prev) => [
          ...prev,
          { name: file.name, type: file.type || "image/png", dataUrl },
        ]);
        setReferenceImageFiles((prev) => [...prev, file]);
        // prompt 单独处理：可能为空（老数据 / 用户没填），有就灌进去，没有就留空让用户写
        if (payload?.prompt && payload.prompt.trim()) {
          setImagePrompt(payload.prompt);
        }
        toast.success("已加入参考图，调整描述后即可重画");
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取参考图失败";
        toast.error(message);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const storedSize = typeof window !== "undefined" ? window.localStorage.getItem(IMAGE_SIZE_STORAGE_KEY) : null;
        const storedResolution =
          typeof window !== "undefined" ? window.localStorage.getItem(IMAGE_RESOLUTION_STORAGE_KEY) : null;
        const storedCount = typeof window !== "undefined" ? window.localStorage.getItem(IMAGE_COUNT_STORAGE_KEY) : null;
        setImageSize(storedSize || "");
        setImageResolution(storedResolution || "");
        setImageCount(storedCount ? clampImageCount(storedCount, 4) : "1");

        // 滚动位置表只在浏览器侧、首次进入时加载一次
        if (typeof window !== "undefined") {
          try {
            const raw = window.sessionStorage.getItem(SCROLL_POSITION_STORAGE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object") {
                scrollPositionsRef.current = Object.fromEntries(
                  Object.entries(parsed as Record<string, unknown>).filter(
                    ([, value]) => typeof value === "number" && Number.isFinite(value),
                  ),
                ) as Record<string, number>;
              }
            }
          } catch {
            // 解析失败就当作没有
          }
        }

        const items = await listImageConversations();
        const normalizedItems = await recoverConversationHistory(items);
        if (cancelled) {
          return;
        }

        conversationsRef.current = normalizedItems;
        setConversations(normalizedItems);
        const storedConversationId =
          typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY) : null;
        let nextSelectedConversationId: string | null;
        if (storedConversationId === "") {
          // 用户主动通过"新建"进入空状态，刷新后保留空状态
          nextSelectedConversationId = null;
        } else if (
          storedConversationId &&
          normalizedItems.some((conversation) => conversation.id === storedConversationId)
        ) {
          nextSelectedConversationId = storedConversationId;
        } else {
          nextSelectedConversationId = pickFallbackConversationId(normalizedItems);
        }
        setSelectedConversationId(nextSelectedConversationId);
        initialLoadCompleteRef.current = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取会话记录失败";
        toast.error(message);
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);



  const loadQuota = useCallback(async () => {
    if (isAdmin) {
      // 管理员密钥层面是全档不限额，画图能力的真实瓶颈在号池而非密钥额度。
      // 顶部展示的是"我自己这把密钥的画图额度"，所以直接显示 ∞——
      // 号池可用量在「号池管理」页有更准确的视图。
      setCanUseHighResolution(true);
      setAvailableQuota("∞");
      return;
    }
    // 普通用户：显示自己密钥的剩余画图额度。三档（日/月/总）任一不限即视作 ∞，
    // 否则取最小剩余作为可用画图张数——这样按钮禁用与上游 402 分支保持一致。
    try {
      const { identity } = await fetchMyIdentity();
      const canHighResolution = Boolean(
        identity.role === "admin" ||
          identity.can_use_high_resolution ||
          identity.can_use_paid_image_accounts ||
          identity.account_tier === "premium",
      );
      setCanUseHighResolution(canHighResolution);
      if (!canHighResolution) {
        setImageResolution((prev) => (isHighResolution(prev) ? "" : prev));
      }
      const candidates: number[] = [];
      if (!identity.image_daily_unlimited) {
        candidates.push(
          identity.image_daily_remaining ??
            Math.max(0, identity.image_daily_quota - identity.image_daily_used),
        );
      }
      if (!identity.image_monthly_unlimited) {
        candidates.push(
          identity.image_monthly_remaining ??
            Math.max(0, identity.image_monthly_quota - identity.image_monthly_used),
        );
      }
      if (!identity.image_total_unlimited) {
        candidates.push(
          identity.image_total_remaining ??
            Math.max(0, identity.image_total_quota - identity.image_total_used),
        );
      }
      if (candidates.length === 0) {
        setAvailableQuota("∞");
      } else {
        setAvailableQuota(String(Math.min(...candidates)));
      }
    } catch {
      setAvailableQuota((prev) => (prev === "加载中..." ? "--" : prev));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (didLoadQuotaRef.current) {
      return;
    }
    didLoadQuotaRef.current = true;

    const handleFocus = () => {
      void loadQuota();
    };

    void loadQuota();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [isAdmin, loadQuota]);

  // 滚动行为：
  // 1) 切换/打开会话首帧 → 同步落到上次记忆的 scrollTop（落不到就到底，无动画）
  // 2) 用户提交新一轮（turns.length 增加）或本轮生成完成（活跃数从 >0 → 0）→ smooth 滚到底
  // 3) 其他时候（图片状态在轮询、对话内容微调）不再强制滚动，用户可以正常向上看历史
  useLayoutEffect(() => {
    const viewport = resultsViewportRef.current;
    if (!viewport) {
      return;
    }

    // 进入"空状态"（点新建 / 删完对话）：把上一会话残留的 scrollTop 清掉，
    // 否则 h-full 的 aurora 视觉中心会被之前的滚动位置顶上去。
    if (!selectedConversation) {
      viewport.scrollTo({ top: 0, behavior: "auto" });
      restoredConversationIdRef.current = null;
      lastTurnCountRef.current = 0;
      lastActiveCountRef.current = 0;
      setShowBottomFade(false);
      return;
    }

    const conversationId = selectedConversation.id;
    const turnsLength = selectedConversation.turns.length;
    const stats = getImageConversationStats(selectedConversation);
    const activeCount = stats.queued + stats.running;

    // 第一次看到这个会话：恢复滚动位置
    if (restoredConversationIdRef.current !== conversationId) {
      restoredConversationIdRef.current = conversationId;
      const savedTop = scrollPositionsRef.current[conversationId];
      if (typeof savedTop === "number" && Number.isFinite(savedTop)) {
        // 内容此时可能还没完全 layout 出来，先 jump 一次再下一帧补一次
        viewport.scrollTo({ top: savedTop, behavior: "auto" });
        requestAnimationFrame(() => {
          viewport.scrollTo({ top: savedTop, behavior: "auto" });
        });
      } else {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
      }
      lastTurnCountRef.current = turnsLength;
      lastActiveCountRef.current = activeCount;
      return;
    }

    const turnAdded = turnsLength > lastTurnCountRef.current;
    const finishedGenerating = lastActiveCountRef.current > 0 && activeCount === 0;

    if (turnAdded || finishedGenerating) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }

    // 内容变化时同步重算渐隐：滚动事件不会因 turn 增减自动触发，
    // 必须在 layout 阶段亲自量一次，否则新增内容被 composer 遮住时灰雾不会出现。
    const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setShowBottomFade(remaining > 8);

    lastTurnCountRef.current = turnsLength;
    lastActiveCountRef.current = activeCount;
  }, [selectedConversation]);

  // 切走会话时立即把当前滚动位置落盘，避免下次回来还没来得及保存
  useEffect(() => {
    return () => {
      const viewport = resultsViewportRef.current;
      const conversationId = restoredConversationIdRef.current;
      if (viewport && conversationId) {
        scrollPositionsRef.current[conversationId] = viewport.scrollTop;
        if (typeof window !== "undefined") {
          try {
            window.sessionStorage.setItem(
              SCROLL_POSITION_STORAGE_KEY,
              JSON.stringify(scrollPositionsRef.current),
            );
          } catch {
            // 容量满或被禁用时静默
          }
        }
      }
    };
  }, [selectedConversationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    // 初次加载完成前不写入，避免覆盖掉本地原有有效值
    if (!initialLoadCompleteRef.current) {
      return;
    }

    if (selectedConversationId) {
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, selectedConversationId);
    } else {
      // 空串作为"用户主动进入空状态"的标记，区别于从未设置的 null
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, "");
    }
  }, [selectedConversationId]);



  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (imageSize) {
      window.localStorage.setItem(IMAGE_SIZE_STORAGE_KEY, imageSize);
      return;
    }
    window.localStorage.removeItem(IMAGE_SIZE_STORAGE_KEY);
  }, [imageSize]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!canUseHighResolution && isHighResolution(imageResolution)) {
      window.localStorage.removeItem(IMAGE_RESOLUTION_STORAGE_KEY);
      return;
    }
    if (imageResolution) {
      window.localStorage.setItem(IMAGE_RESOLUTION_STORAGE_KEY, imageResolution);
      return;
    }
    window.localStorage.removeItem(IMAGE_RESOLUTION_STORAGE_KEY);
  }, [canUseHighResolution, imageResolution]);

  useEffect(() => {
    if (!canUseHighResolution && isHighResolution(imageResolution)) {
      setImageResolution("");
    }
  }, [canUseHighResolution, imageResolution]);

  useEffect(() => {
    if (typeof window !== "undefined" && parsedCount > 0) {
      window.localStorage.setItem(IMAGE_COUNT_STORAGE_KEY, String(parsedCount));
    }
  }, [parsedCount]);

  useEffect(() => {
    if (selectedConversationId && !conversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(pickFallbackConversationId(conversations));
    }
  }, [conversations, selectedConversationId]);

  const persistConversation = async (conversation: ImageConversation) => {
    const nextConversations = sortImageConversations([
      conversation,
      ...conversationsRef.current.filter((item) => item.id !== conversation.id),
    ]);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    await saveImageConversation(conversation);
  };

  const updateConversation = useCallback(
    async (
      conversationId: string,
      updater: (current: ImageConversation | null) => ImageConversation,
      options: { persist?: boolean } = {},
    ) => {
      const current = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
      if (!current) {
        // 对话已被删除（或从未存在），不再写回，避免轮询任务"复活"已删数据
        return;
      }
      const nextConversation = updater(current);
      const nextConversations = sortImageConversations([
        nextConversation,
        ...conversationsRef.current.filter((item) => item.id !== conversationId),
      ]);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      if (options.persist !== false) {
        await saveImageConversation(nextConversation);
      }
    },
    [],
  );

  const clearComposerInputs = useCallback(() => {
    setImagePrompt("");
    setImageResolution((prev) => (!canUseHighResolution && isHighResolution(prev) ? "" : prev));
    setReferenceImageFiles([]);
    setReferenceImages([]);
    setReplyTarget(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [canUseHighResolution]);

  const resetComposer = useCallback(() => {
    clearComposerInputs();
  }, [clearComposerInputs]);

  const handleCreateDraft = () => {
    setSelectedConversationId(null);
    resetComposer();
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = async (id: string) => {
    const target = conversationsRef.current.find((item) => item.id === id);
    const taskIdsToCancel = target ? collectLoadingTaskIds(target) : [];
    const pathsToDelete = target
      ? target.turns.flatMap((turn) =>
          turn.images.flatMap((img) => {
            const path = getPathFromUrl(img.url);
            return path ? [path] : [];
          })
        )
      : [];

    const nextConversations = conversations.filter((item) => item.id !== id);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    if (selectedConversationId === id) {
      setSelectedConversationId(pickFallbackConversationId(nextConversations));
      resetComposer();
    }

    void cancelTaskIdsSilently(taskIdsToCancel);
    if (pathsToDelete.length > 0) {
      void deleteManagedImages({ paths: pathsToDelete }).catch(() => {});
      setFavorites((prev) => {
        const next = prev.filter(
          (fav) =>
            !pathsToDelete.includes(fav.rel || "") &&
            !pathsToDelete.includes(fav.url || ""),
        );
        try {
          localStorage.setItem("chatgpt2api:favorites", JSON.stringify(next));
        } catch {}
        return next;
      });
    }

    try {
      await deleteImageConversation(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除会话失败";
      toast.error(message);
      const items = await listImageConversations();
      conversationsRef.current = items;
      setConversations(items);
    }
  };

  const handleDeleteTurnPart = async (conversationId: string, turnId: string, part: "prompt" | "results") => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }

    const targetTurn = conversation.turns.find((turn) => turn.id === turnId);
    const pathsToDelete =
      part === "results" && targetTurn
        ? targetTurn.images.flatMap((img) => {
            const path = getPathFromUrl(img.url);
            return path ? [path] : [];
          })
        : [];

    const taskIdsToCancel =
      part === "results"
        ? collectTurnLoadingTaskIds(targetTurn ?? ({ images: [] } as unknown as ImageTurn))
        : [];

    const turns = conversation.turns
      .map((turn) => {
        if (turn.id !== turnId) {
          return turn;
        }
        const nextTurn = {
          ...turn,
          prompt: part === "prompt" ? "" : turn.prompt,
          promptDeleted: part === "prompt" ? true : turn.promptDeleted,
          resultsDeleted: part === "results" ? true : turn.resultsDeleted,
          status: part === "results" && turn.status === "generating" ? "error" as const : turn.status,
          images:
            part === "results"
              ? turn.images.map((image) => ({ id: image.id, status: "error" as const, error: "生成结果已删除" }))
              : turn.images,
        };
        return nextTurn.promptDeleted && nextTurn.resultsDeleted ? null : nextTurn;
      })
      .filter((turn): turn is ImageTurn => Boolean(turn));

    void cancelTaskIdsSilently(taskIdsToCancel);
    if (pathsToDelete.length > 0) {
      void deleteManagedImages({ paths: pathsToDelete }).catch(() => {});
    }

    if (turns.length === 0) {
      await handleDeleteConversation(conversationId);
      return;
    }

    const nextConversation = {
      ...conversation,
      updatedAt: new Date().toISOString(),
      turns,
    };
    await persistConversation(nextConversation);
  };

  const handleClearHistory = async () => {
    const taskIdsToCancel = conversationsRef.current.flatMap(collectLoadingTaskIds);
    const pathsToDelete = conversationsRef.current.flatMap((conv) =>
      conv.turns.flatMap((turn) =>
        turn.images.flatMap((img) => {
          const path = getPathFromUrl(img.url);
          return path ? [path] : [];
        })
      )
    );

    try {
      await clearImageConversations();
      conversationsRef.current = [];
      setConversations([]);
      setSelectedConversationId(null);
      resetComposer();
      void cancelTaskIdsSilently(taskIdsToCancel);
      if (pathsToDelete.length > 0) {
        void deleteManagedImages({ paths: pathsToDelete }).catch(() => {});
        setFavorites((prev) => {
          const next = prev.filter(
            (fav) =>
              !pathsToDelete.includes(fav.rel || "") &&
              !pathsToDelete.includes(fav.url || ""),
          );
          try {
            localStorage.setItem("chatgpt2api:favorites", JSON.stringify(next));
          } catch {}
          return next;
        });
      }
      toast.success("已清空历史记录");
    } catch (error) {
      const message = error instanceof Error ? error.message : "清空历史记录失败";
      toast.error(message);
    }
  };

  const handleRenameConversation = async (id: string, title: string) => {
    const nextConversations = conversations.map((item) =>
      item.id === id ? { ...item, title, updatedAt: new Date().toISOString() } : item,
    );
    conversationsRef.current = sortImageConversations(nextConversations);
    setConversations(conversationsRef.current);
    try {
      await renameImageConversation(id, title);
    } catch (error) {
      const message = error instanceof Error ? error.message : "重命名失败";
      toast.error(message);
    }
  };

  const openDeleteConversationConfirm = (id: string) => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "one", id });
  };

  const openDeletePromptConfirm = useCallback((conversationId: string, turnId: string) => {
    setDeleteConfirm({ type: "prompt", conversationId, turnId });
  }, []);

  const openDeleteResultsConfirm = useCallback((conversationId: string, turnId: string) => {
    setDeleteConfirm({ type: "results", conversationId, turnId });
  }, []);

  const openClearHistoryConfirm = () => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "all" });
  };

  const handleConfirmDelete = async () => {
    const target = deleteConfirm;
    setDeleteConfirm(null);
    if (!target) {
      return;
    }
    if (target.type === "all") {
      await handleClearHistory();
      return;
    }
    if (target.type === "batch") {
      await handleBatchDelete();
      return;
    }
    if (target.type === "prompt" || target.type === "results") {
      await handleDeleteTurnPart(target.conversationId, target.turnId, target.type);
      return;
    }
    await handleDeleteConversation(target.id);
  };

  const appendReferenceImages = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const currentCount = referenceImages.length;
    if (currentCount >= MAX_REFERENCE_IMAGES) {
      toast.error(`最多只允许上传 ${MAX_REFERENCE_IMAGES} 张参考图`);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    let allowedFiles = files;
    if (currentCount + files.length > MAX_REFERENCE_IMAGES) {
      toast.warning(`参考图数量超限，仅为您添加了前 ${MAX_REFERENCE_IMAGES - currentCount} 张`);
      allowedFiles = files.slice(0, MAX_REFERENCE_IMAGES - currentCount);
    }

    try {
      const previews = await Promise.all(
        allowedFiles.map(async (file) => ({
          name: file.name,
          type: file.type || "image/png",
          dataUrl: await readFileAsDataUrl(file),
        })),
      );

      setReferenceImageFiles((prev) => [...prev, ...allowedFiles]);
      setReferenceImages((prev) => [...prev, ...previews]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取参考图失败";
      toast.error(message);
    }
  }, [referenceImages.length]);

  const handleReferenceImageChange = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      await appendReferenceImages(files);
    },
    [appendReferenceImages],
  );

  useEffect(() => {
    const handleGlobalPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }
      if (!event.clipboardData) return;
      const files = Array.from(event.clipboardData.files).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0) return;

      event.preventDefault();
      void appendReferenceImages(files);
      toast.success("已通过剪贴板载入参考图");
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, [appendReferenceImages]);

  const handleRemoveReferenceImage = useCallback((index: number) => {
    setReferenceImageFiles((prev) => {
      const next = prev.filter((_, currentIndex) => currentIndex !== index);
      if (next.length === 0 && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return next;
    });
    setReferenceImages((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  const handleReorderReferenceImages = useCallback((dragIndex: number, hoverIndex: number) => {
    setReferenceImageFiles((prev) => {
      const next = [...prev];
      if (dragIndex < 0 || dragIndex >= next.length || hoverIndex < 0 || hoverIndex >= next.length) {
        return prev;
      }
      const [moved] = next.splice(dragIndex, 1);
      next.splice(hoverIndex, 0, moved);
      return next;
    });
    setReferenceImages((prev) => {
      const next = [...prev];
      if (dragIndex < 0 || dragIndex >= next.length || hoverIndex < 0 || hoverIndex >= next.length) {
        return prev;
      }
      const [moved] = next.splice(dragIndex, 1);
      next.splice(hoverIndex, 0, moved);
      return next;
    });
  }, []);

  const handleContinueEdit = useCallback(
    async (conversationId: string, image: StoredImage | StoredReferenceImage) => {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) {
        toast.error(`最多只允许上传 ${MAX_REFERENCE_IMAGES} 张参考图`);
        return;
      }
      try {
        const nextReference =
          "dataUrl" in image
            ? {
                referenceImage: image,
                file: dataUrlToFile(image.dataUrl, image.name, image.type),
              }
            : await buildReferenceImageFromStoredImage(image, `conversation-${conversationId}-${Date.now()}.png`);
        if (!nextReference) {
          return;
        }

        setSelectedConversationId(conversationId);

        setReferenceImages((prev) => [...prev, nextReference.referenceImage]);
        setReferenceImageFiles((prev) => [...prev, nextReference.file]);
        setImagePrompt("");
        textareaRef.current?.focus();
        toast.success("已加入当前参考图，继续输入描述即可编辑");
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取结果图失败";
        toast.error(message);
      }
    },
    [referenceImages.length],
  );

  // 单图发布到画廊的状态机：image.id → state。
  // 用 Map<string, ImagePublishState> 而不是数组，O(1) 查询；
  // 不持久化到 localforage，刷新页面回落"未发布"——是否发过让"画廊"页自己说了算，
  // 这里只是一次会话内的视觉反馈避免重复点击。
  const [publishStates, setPublishStates] = useState<Map<string, ImagePublishState>>(
    () => new Map(),
  );

  const publishStateOf = useCallback(
    (image: StoredImage): ImagePublishState => {
      // 优先读已记录的状态；没有就按图本身能不能发判断：
      //   - 有 url（http(s)）：可发，初始 idle
      //   - 仅 b64_json：本地编辑产物 / 远端不可寻址，不能用 image_rel 主键 → unsupported
      const recorded = publishStates.get(image.id);
      if (recorded) return recorded;
      if (image.url && /^https?:\/\//i.test(image.url)) return "idle";
      return "unsupported";
    },
    [publishStates],
  );

  /**
   * 从生成结果 url 抠出 image_rel：
   *   http://host:8000/images/2026/05/21/xxx.png?t=123 → 2026/05/21/xxx.png
   * 跟后端 image_owners.json / gallery_service 用同一份 rel 主键。
   */
  const extractImageRel = useCallback((url: string | undefined): string | null => {
    if (!url) return null;
    const marker = "/images/";
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    const tail = url.substring(idx + marker.length);
    const cut = tail.search(/[?#]/);
    const rel = (cut >= 0 ? tail.substring(0, cut) : tail).replace(/^\/+/, "").trim();
    return rel || null;
  }, []);

  const handlePublishImage = useCallback(
    async (conversationId: string, turnId: string, image: StoredImage) => {
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      const turn = conversation?.turns.find((t) => t.id === turnId);
      if (!conversation || !turn) return;

      const rel = extractImageRel(image.url);
      if (!rel) {
        toast.error("当前图片无法发布到画廊");
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.set(image.id, "unsupported");
          return next;
        });
        return;
      }

      // 进入 publishing：UI 上按钮转圈
      setPublishStates((prev) => {
        const next = new Map(prev);
        next.set(image.id, "publishing");
        return next;
      });

      try {
        await publishGalleryItem({
          image_rel: rel,
          prompt: turn.prompt || "",
          model: turn.model || "",
          size: turn.size || "",
        });
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.set(image.id, "published");
          return next;
        });
        toast.success("已发布到画廊");
      } catch (error) {
        // 发布失败回滚成 idle，让用户能重试
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.set(image.id, "idle");
          return next;
        });
        const message = error instanceof Error ? error.message : "发布失败";
        toast.error(message);
      }
    },
    [extractImageRel],
  );

  // 模型反问/拒绝时点"回复"。把 AI 反问 + 上一轮 prompt 都收纳进 replyTarget，
  // 但不动输入框文本——用户写入框里的永远是他自己说的话。
  // 提交时由 handleSubmit / runConversationQueue 把这份上下文偷偷拼进发给模型的 prompt。
  const handleReplyToTurn = useCallback((conversationId: string, turnId: string, aiMessage: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    const sourceTurn = conversation?.turns.find((turn) => turn.id === turnId);
    if (!conversation || !sourceTurn) {
      return;
    }

    setSelectedConversationId(conversationId);
    setReplyTarget({
      conversationId,
      sourceTurnId: turnId,
      sourcePrompt: sourceTurn.prompt,
      aiMessage,
    });

    // 把当前轮的参考图也带过来，否则模型回答的将是空气。
    if (sourceTurn.referenceImages.length > 0) {
      setReferenceImages(sourceTurn.referenceImages);
      setReferenceImageFiles(
        sourceTurn.referenceImages.map((image) => dataUrlToFile(image.dataUrl, image.name, image.type)),
      );
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
    });
  }, []);

  const handleReuseTurnConfig = useCallback(async (conversationId: string, turnId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    const turn = conversation?.turns.find((item) => item.id === turnId);
    if (!conversation || !turn || !turn.prompt.trim()) {
      return;
    }

    setSelectedConversationId(conversationId);
    setImagePrompt(turn.prompt);
    setImageCount(String(Math.max(1, turn.count || turn.images.length || 1)));
    setImageSize(turn.size);
    setImageResolution(!canUseHighResolution && isHighResolution(turn.resolution) ? "" : turn.resolution || "");
    setReferenceImages(turn.referenceImages);
    setReferenceImageFiles(
      turn.referenceImages.map((image) => dataUrlToFile(image.dataUrl, image.name, image.type)),
    );
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    textareaRef.current?.focus();
    toast.success("已复用该卡片的完整配置（包含提示词）");
  }, [canUseHighResolution]);

  const handleApplyParamsOnly = useCallback(async (conversationId: string, turnId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    const turn = conversation?.turns.find((item) => item.id === turnId);
    if (!conversation || !turn) {
      return;
    }

    setImageCount(String(Math.max(1, turn.count || turn.images.length || 1)));
    setImageSize(turn.size);
    setImageResolution(!canUseHighResolution && isHighResolution(turn.resolution) ? "" : turn.resolution || "");
    setReferenceImages(turn.referenceImages);
    setReferenceImageFiles(
      turn.referenceImages.map((image) => dataUrlToFile(image.dataUrl, image.name, image.type)),
    );
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    textareaRef.current?.focus();
    toast.success("已套用该卡片的尺寸和参数配置（保留当前提示词）");
  }, [canUseHighResolution]);

  const handleCancelImage = useCallback(
    async (conversationId: string, imageId: string, taskId?: string) => {
      if (taskId) {
        void cancelTaskIdsSilently([taskId]);
      }
      await updateConversation(conversationId, (current) => {
        if (!current) return current as unknown as ImageConversation;
        return {
          ...current,
          updatedAt: new Date().toISOString(),
          turns: current.turns.map((turn) => {
            const hasTargetImage = turn.images.some((img) => img.id === imageId);
            if (!hasTargetImage) return turn;
            const images = turn.images.map((img) =>
              img.id === imageId ? { ...img, status: "error" as const, error: "用户已取消该任务" } : img
            );
            const derived = deriveTurnStatus({ ...turn, images });
            return {
              ...turn,
              ...derived,
              images,
            };
          }),
        };
      });
      toast.success("已发送取消请求");
    },
    [updateConversation]
  );

  const handleDeleteSingleImage = useCallback(async (conversationId: string, turnId: string, imageId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    if (!conversation) return;

    const targetTurn = conversation.turns.find((turn) => turn.id === turnId);
    const targetImage = targetTurn?.images.find((img) => img.id === imageId);
    const path = getPathFromUrl(targetImage?.url);
    if (path) {
      void deleteManagedImages({ paths: [path] }).catch(() => {});
      setFavorites((prev) => {
        const next = prev.filter(
          (fav) =>
            (fav.rel || fav.url) !== path &&
            (fav.rel || fav.url) !== targetImage?.url,
        );
        try {
          localStorage.setItem("chatgpt2api:favorites", JSON.stringify(next));
        } catch {}
        return next;
      });
    }

    const turns = conversation.turns.map((turn) => {
      if (turn.id !== turnId) return turn;
      
      const nextImages = turn.images.filter((img) => img.id !== imageId);
      return {
        ...turn,
        images: nextImages,
        ...deriveTurnStatus({ ...turn, images: nextImages })
      };
    }).filter(turn => turn.images.length > 0);

    if (turns.length === 0) {
      await handleDeleteConversation(conversationId);
      return;
    }

    const nextConversation = {
      ...conversation,
      updatedAt: new Date().toISOString(),
      turns,
    };
    await persistConversation(nextConversation);
    toast.success("已移除该图片卡片");
  }, [handleDeleteConversation, persistConversation]);

  // Load favorites on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("chatgpt2api:favorites");
      if (raw) {
        setFavorites(JSON.parse(raw));
      }
    } catch (err) {
      console.error("Failed to load favorites:", err);
    }
  }, []);

  const handleToggleFavorite = useCallback((image: StoredImage, turnPrompt: string) => {
    const rel = getPathFromUrl(image.url) || "";
    const key = rel || image.url || "";
    if (!key) return;

    setFavorites((prev) => {
      const already = prev.some((fav) => (fav.rel || fav.url) === key);
      let next: ManagedImage[];
      if (already) {
        next = prev.filter((fav) => (fav.rel || fav.url) !== key);
        toast.success("已取消收藏");
      } else {
        const managed: ManagedImage = {
          rel: rel,
          name: rel ? rel.substring(rel.lastIndexOf('/') + 1) : "image.png",
          date: new Date().toISOString().split('T')[0],
          size: 0,
          url: image.url || "",
          created_at: new Date().toISOString(),
          prompt: turnPrompt,
        };
        next = [managed, ...prev];
        toast.success("已加入收藏");
      }
      try {
        localStorage.setItem("chatgpt2api:favorites", JSON.stringify(next));
      } catch (err) {
        console.error("Failed to save favorites:", err);
      }
      return next;
    });
  }, []);

  const handleToggleSelectImage = useCallback((imageId: string) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  }, []);

  const findStoredImageById = useCallback((id: string): StoredImage | null => {
    if (!selectedConversation) return null;
    for (const turn of selectedConversation.turns) {
      for (const image of turn.images) {
        if (image.id === id) return image;
      }
    }
    return null;
  }, [selectedConversation]);

  const downloadStoredImage = useCallback(async (image: StoredImage, index: number) => {
    let blob: Blob;
    if (image.b64_json) {
      const binary = atob(image.b64_json);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      blob = new Blob([bytes], { type: "image/png" });
    } else if (image.url) {
      const res = await fetch(image.url);
      blob = await res.blob();
    } else {
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batch-image-${index + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleBatchDownload = useCallback(async () => {
    setIsBatchActionLoading(true);
    let downloadedCount = 0;
    try {
      const selectedIdsArray = Array.from(selectedImageIds);
      for (let i = 0; i < selectedIdsArray.length; i++) {
        const id = selectedIdsArray[i];
        const img = findStoredImageById(id);
        if (img && img.status === "success") {
          await downloadStoredImage(img, i);
          downloadedCount++;
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      toast.success(`成功下载 ${downloadedCount} 张图片`);
    } catch (err) {
      console.error("批量下载失败:", err);
      toast.error("批量下载过程中出错");
    } finally {
      setIsBatchActionLoading(false);
    }
  }, [selectedImageIds, findStoredImageById, downloadStoredImage]);

  const handleBatchPublish = useCallback(async () => {
    if (!selectedConversation) return;
    setIsBatchActionLoading(true);
    let successCount = 0;
    let failCount = 0;

    const selectedIdsArray = Array.from(selectedImageIds);

    const imageToTurnMap = new Map<string, { image: StoredImage; turn: ImageTurn }>();
    for (const turn of selectedConversation.turns) {
      for (const img of turn.images) {
        if (selectedImageIds.has(img.id)) {
          imageToTurnMap.set(img.id, { image: img, turn });
        }
      }
    }

    const toPublish = selectedIdsArray
      .map(id => imageToTurnMap.get(id))
      .filter((item): item is { image: StoredImage; turn: ImageTurn } => {
        if (!item || item.image.status !== "success") return false;
        const state = publishStates.get(item.image.id) || "idle";
        return state === "idle";
      });

    if (toPublish.length === 0) {
      toast.info("没有需要发布的图片（可能已发布或无图片链接）");
      setIsBatchActionLoading(false);
      return;
    }

    setPublishStates((prev) => {
      const next = new Map(prev);
      for (const item of toPublish) {
        next.set(item.image.id, "publishing");
      }
      return next;
    });

    const publishPromises = toPublish.map(async (item) => {
      const rel = extractImageRel(item.image.url);
      if (!rel) {
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.set(item.image.id, "unsupported");
          return next;
        });
        failCount++;
        return;
      }

      try {
        await publishGalleryItem({
          image_rel: rel,
          prompt: item.turn.prompt || "",
          model: item.turn.model || "",
          size: item.turn.size || "",
        });
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.set(item.image.id, "published");
          return next;
        });
        successCount++;
      } catch (err) {
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.set(item.image.id, "idle");
          return next;
        });
        failCount++;
      }
    });

    await Promise.allSettled(publishPromises);

    if (successCount > 0) {
      toast.success(`成功发布 ${successCount} 张图片到画廊`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} 张图片发布失败`);
    }

    setIsBatchActionLoading(false);
    setIsBatchMode(false);
    setSelectedImageIds(new Set());
  }, [selectedConversation, selectedImageIds, publishStates, extractImageRel]);

  const openBatchDeleteConfirm = useCallback(() => {
    setDeleteConfirm({ type: "batch" });
  }, []);

  const handleBatchDelete = useCallback(async () => {
    if (!selectedConversation) return;
    setIsBatchActionLoading(true);

    const selectedIdsArray = Array.from(selectedImageIds);

    const pathsToDelete: string[] = [];
    for (const turn of selectedConversation.turns) {
      for (const img of turn.images) {
        if (selectedImageIds.has(img.id)) {
          const path = getPathFromUrl(img.url);
          if (path) {
            pathsToDelete.push(path);
          }
        }
      }
    }

    if (pathsToDelete.length > 0) {
      try {
        await deleteManagedImages({ paths: pathsToDelete });
        setFavorites((prev) => {
          const next = prev.filter(
            (fav) =>
              !pathsToDelete.includes(fav.rel || "") &&
              !pathsToDelete.includes(fav.url || ""),
          );
          try {
            localStorage.setItem("chatgpt2api:favorites", JSON.stringify(next));
          } catch {}
          return next;
        });
      } catch (err) {
        console.error("后端批量删除失败:", err);
      }
    }

    const turns = selectedConversation.turns.map((turn) => {
      const nextImages = turn.images.filter((img) => !selectedImageIds.has(img.id));
      return {
        ...turn,
        images: nextImages,
        ...deriveTurnStatus({ ...turn, images: nextImages })
      };
    }).filter(turn => turn.images.length > 0);

    if (turns.length === 0) {
      await handleDeleteConversation(selectedConversation.id);
    } else {
      const nextConversation = {
        ...selectedConversation,
        updatedAt: new Date().toISOString(),
        turns,
      };
      await persistConversation(nextConversation);
      toast.success(`已删除 ${selectedIdsArray.length} 张图片`);
    }

    setIsBatchActionLoading(false);
    setIsBatchMode(false);
    setSelectedImageIds(new Set());
  }, [selectedConversation, selectedImageIds, handleDeleteConversation, persistConversation]);

  const openLightbox = useCallback((images: ImageLightboxItem[], index: number) => {
    if (images.length === 0) {
      return;
    }

    setLightboxImages(images);
    setLightboxIndex(Math.max(0, Math.min(index, images.length - 1)));
    setLightboxOpen(true);
  }, []);

  const createLoadingImages = (turnId: string, count: number) =>
    Array.from({ length: count }, (_, index) => {
      const imageId = `${turnId}-${index}`;
      return {
        id: imageId,
        taskId: imageId,
        status: "loading" as const,
      };
    });

  /* eslint-disable react-hooks/preserve-manual-memoization */
  const runConversationQueue = useCallback(
    async (conversationId: string) => {
      if (activeConversationQueueIds.has(conversationId)) {
        return;
      }

      const snapshot = conversationsRef.current.find((conversation) => conversation.id === conversationId);
      const activeTurn = snapshot?.turns.find(
        (turn) =>
          (turn.status === "queued" || turn.status === "generating") &&
          turn.images.some((image) => image.status === "loading"),
      );
      if (!snapshot || !activeTurn) {
        return;
      }

      activeConversationQueueIds.add(conversationId);
      const applyTasks = async (tasks: ImageTask[]) => {
        const taskMap = new Map(tasks.map((task) => [task.id, task]));
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          const turns = conversation.turns.map((turn) => {
            if (turn.id !== activeTurn.id) {
              return turn;
            }
            const images = turn.images.map((image) => {
              const taskId = image.taskId || image.id;
              const task = taskMap.get(taskId);
              return task ? taskDataToStoredImage({ ...image, taskId }, task) : image;
            });
            const derived = deriveTurnStatus({ ...turn, status: "generating", images });
            return {
              ...turn,
              ...derived,
              images,
            };
          });
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns,
          };
        });
      };

      try {
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === activeTurn.id
                ? {
                    ...turn,
                    status: "generating",
                    error: undefined,
                    images: turn.images.map((image) =>
                      image.status === "loading" ? { ...image, taskId: image.taskId || image.id } : image,
                    ),
                  }
                : turn,
            ),
          };
        });

        const referenceFiles = activeTurn.referenceImages.map((image, index) =>
          dataUrlToFile(image.dataUrl, image.name || `${activeTurn.id}-${index + 1}.png`, image.type),
        );
        if (activeTurn.mode === "edit" && referenceFiles.length === 0) {
          throw new Error("未找到可用于继续编辑的参考图");
        }

        // 用户视野里 turn.prompt 永远只有自己说过的话；
        // 但调用模型时要把上一轮 prompt + AI 反问拼回去，让模型有上下文判断如何作画。
        const apiPrompt = (() => {
          const ctx = activeTurn.replyContext;
          if (!ctx) {
            return activeTurn.prompt;
          }
          const lines: string[] = [];
          if (ctx.sourcePrompt.trim()) {
            lines.push(`[上一轮我的请求] ${ctx.sourcePrompt.trim()}`);
          }
          if (ctx.aiMessage.trim()) {
            lines.push(`[你上一轮的反问] ${ctx.aiMessage.trim()}`);
          }
          lines.push(`[我的回答] ${activeTurn.prompt}`);
          return lines.join("\n");
        })();

        const pendingImages = activeTurn.images.filter((image) => image.status === "loading");
        const submissionResults = await Promise.all(
          pendingImages.map(async (image) => {
            const taskId = image.taskId || image.id;
            try {
              const task = activeTurn.mode === "edit"
                ? await createImageEditTask(taskId, referenceFiles, apiPrompt, activeTurn.model, activeTurn.size, activeTurn.resolution)
                : await createImageGenerationTask(taskId, apiPrompt, activeTurn.model, activeTurn.size, activeTurn.resolution);
              return { taskId, task, error: null };
            } catch (err) {
              return { taskId, task: null, error: err };
            }
          })
        );

        const successfulTasks = submissionResults.flatMap(r => r.task ? [r.task] : []);
        if (successfulTasks.length > 0) {
          await applyTasks(successfulTasks);
        }

        const failedSubmissions = submissionResults.filter(r => r.error);
        if (failedSubmissions.length > 0) {
          await updateConversation(conversationId, (current) => {
            const conversation = current ?? snapshot;
            return {
              ...conversation,
              updatedAt: new Date().toISOString(),
              turns: conversation.turns.map((turn) => {
                if (turn.id !== activeTurn.id) return turn;
                const images = turn.images.map((image) => {
                  const failed = failedSubmissions.find(r => r.taskId === (image.taskId || image.id));
                  if (failed) {
                    const errMsg = failed.error instanceof Error ? failed.error.message : "提交生图任务失败";
                    return { ...image, status: "error" as const, error: errMsg };
                  }
                  return image;
                });
                const derived = deriveTurnStatus({ ...turn, images });
                return { ...turn, ...derived, images };
              }),
            };
          });
        }

        const resubmitCounts = new Map<string, number>();

        while (true) {
          const latestConversation = conversationsRef.current.find((conversation) => conversation.id === conversationId);
          const latestTurn = latestConversation?.turns.find((turn) => turn.id === activeTurn.id);
          if (!latestConversation || !latestTurn) {
            break;
          }

          const loadingTaskIds =
            latestTurn.images.flatMap((image) =>
              image.status === "loading" && image.taskId ? [image.taskId] : [],
            );
          if (loadingTaskIds.length === 0) {
            break;
          }

          await sleep(2000);

          const postSleepConversation = conversationsRef.current.find((conversation) => conversation.id === conversationId);
          const postSleepTurn = postSleepConversation?.turns.find((turn) => turn.id === activeTurn.id);
          if (!postSleepConversation || !postSleepTurn) {
            break;
          }

          const taskList = await fetchImageTasks(loadingTaskIds);
          if (taskList.items.length > 0) {
            await applyTasks(taskList.items);
          }

          if (taskList.missing_ids.length > 0) {
            const imagesToResubmit: typeof latestTurn.images = [];
            const imagesToFail: typeof latestTurn.images = [];

            const missingImages = postSleepTurn.images.filter(
              (image) => image.status === "loading" && image.taskId && taskList.missing_ids.includes(image.taskId)
            );

            for (const img of missingImages) {
              const id = img.taskId || img.id;
              const count = resubmitCounts.get(id) || 0;
              if (count >= 3) {
                imagesToFail.push(img);
              } else {
                resubmitCounts.set(id, count + 1);
                imagesToResubmit.push(img);
              }
            }

            if (imagesToFail.length > 0) {
              await updateConversation(conversationId, (current) => {
                const conversation = current ?? snapshot;
                return {
                  ...conversation,
                  updatedAt: new Date().toISOString(),
                  turns: conversation.turns.map((turn) => {
                    if (turn.id !== activeTurn.id) return turn;
                    const images = turn.images.map((image) => {
                      const failed = imagesToFail.find(f => (f.taskId || f.id) === (image.taskId || image.id));
                      if (failed) {
                        return { ...image, status: "error" as const, error: "任务在服务器端丢失且重试超限" };
                      }
                      return image;
                    });
                    const derived = deriveTurnStatus({ ...turn, images });
                    return { ...turn, ...derived, images };
                  }),
                };
              });
            }

            if (imagesToResubmit.length > 0) {
              const resubmissionResults = await Promise.all(
                imagesToResubmit.map(async (image) => {
                  const taskId = image.taskId || image.id;
                  try {
                    const task = activeTurn.mode === "edit"
                      ? await createImageEditTask(taskId, referenceFiles, apiPrompt, activeTurn.model, activeTurn.size, activeTurn.resolution)
                      : await createImageGenerationTask(taskId, apiPrompt, activeTurn.model, activeTurn.size, activeTurn.resolution);
                    return { taskId, task, error: null };
                  } catch (err) {
                    return { taskId, task: null, error: err };
                  }
                })
              );

              const successfulResubmitted = resubmissionResults.flatMap(r => r.task ? [r.task] : []);
              if (successfulResubmitted.length > 0) {
                await applyTasks(successfulResubmitted);
              }

              const failedResubmitted = resubmissionResults.filter(r => r.error);
              if (failedResubmitted.length > 0) {
                await updateConversation(conversationId, (current) => {
                  const conversation = current ?? snapshot;
                  return {
                    ...conversation,
                    updatedAt: new Date().toISOString(),
                    turns: conversation.turns.map((turn) => {
                      if (turn.id !== activeTurn.id) return turn;
                      const images = turn.images.map((image) => {
                        const failed = failedResubmitted.find(r => r.taskId === (image.taskId || image.id));
                        if (failed) {
                          const errMsg = failed.error instanceof Error ? failed.error.message : "重试任务提交失败";
                          return { ...image, status: "error" as const, error: errMsg };
                        }
                        return image;
                      });
                      const derived = deriveTurnStatus({ ...turn, images });
                      return { ...turn, ...derived, images };
                    }),
                  };
                });
              }
            }
          }
        }

        await loadQuota();
      } catch (error) {
        const message = error instanceof Error ? error.message : "生成图片失败";
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === activeTurn.id
                ? {
                    ...turn,
                    status: "error",
                    error: message,
                    images: turn.images.map((image) =>
                      image.status === "loading" ? { ...image, status: "error", error: message } : image,
                    ),
                  }
                : turn,
            ),
          };
        });
        toast.error(message);
      } finally {
        activeConversationQueueIds.delete(conversationId);
        for (const conversation of conversationsRef.current) {
          if (
            !activeConversationQueueIds.has(conversation.id) &&
            conversation.turns.some(
              (turn) =>
                (turn.status === "queued" || turn.status === "generating") &&
                turn.images.some((image) => image.status === "loading"),
            )
          ) {
            void runConversationQueue(conversation.id);
          }
        }
      }
    },
    [loadQuota, updateConversation],
  );
  /* eslint-enable react-hooks/preserve-manual-memoization */

  useEffect(() => {
    if (isLoadingHistory) return;
    for (const conversation of conversations) {
      const hasLoading = conversation.turns.some(
        (turn) =>
          (turn.status === "queued" || turn.status === "generating") &&
          turn.images.some((image) => image.status === "loading"),
      );
      if (hasLoading) {
        void runConversationQueue(conversation.id);
      }
    }
  }, [isLoadingHistory, conversations, runConversationQueue]);

  const handleRegenerateTurn = useCallback(
    async (conversationId: string, turnId: string) => {
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      const sourceTurn = conversation?.turns.find((turn) => turn.id === turnId);
      if (!conversation || !sourceTurn || !sourceTurn.prompt.trim()) {
        return;
      }

      const count = Math.max(1, sourceTurn.count || sourceTurn.images.length || 1);
      if (!ensureQuotaForRequest(count)) {
        return;
      }

      const now = new Date().toISOString();
      const nextTurnId = createId();
      const nextTurn: ImageTurn = {
        id: nextTurnId,
        prompt: sourceTurn.prompt,
        model: sourceTurn.model,
        mode: sourceTurn.mode,
        referenceImages: sourceTurn.referenceImages,
        count,
        size: sourceTurn.size,
        images: createLoadingImages(nextTurnId, count),
        createdAt: now,
        status: "queued",
        // 重新生成时保留原 turn 的回复上下文，否则模型会丢失上一轮的对话语境。
        replyContext: sourceTurn.replyContext,
      };
      const nextConversation = {
        ...conversation,
        updatedAt: now,
        turns: [...conversation.turns, nextTurn],
      };

      setSelectedConversationId(conversationId);
      await persistConversation(nextConversation);
      void runConversationQueue(conversationId);
      toast.success("已加入重新生成队列");
    },
    [ensureQuotaForRequest, runConversationQueue],
  );

  const handleRetryImage = useCallback(
    async (conversationId: string, turnId: string, imageId: string) => {
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      if (!conversation) {
        return;
      }

      if (!ensureQuotaForRequest(1)) {
        return;
      }

      const now = new Date().toISOString();
      const retryImageId = `${turnId}-${createId()}`;
      const nextConversation = {
        ...conversation,
        updatedAt: now,
        turns: conversation.turns.map((turn) => {
          if (turn.id !== turnId) {
            return turn;
          }
          if (!turn.prompt.trim()) {
            return turn;
          }

          const images = turn.images.map((image) =>
            image.id === imageId
              ? {
                  id: retryImageId,
                  taskId: retryImageId,
                  status: "loading" as const,
                }
              : image,
          );
          const derived = deriveTurnStatus({ ...turn, status: "queued", images });
          return {
            ...turn,
            ...derived,
            images,
          };
        }),
      };

      setSelectedConversationId(conversationId);
      await persistConversation(nextConversation);
      void runConversationQueue(conversationId);
    },
    [ensureQuotaForRequest, runConversationQueue],
  );

  useEffect(() => {
    for (const conversation of conversations) {
      if (
        !activeConversationQueueIds.has(conversation.id) &&
        conversation.turns.some(
          (turn) =>
            !turn.resultsDeleted &&
            (turn.status === "queued" || turn.status === "generating") &&
            turn.images.some((image) => image.status === "loading"),
        )
      ) {
        void runConversationQueue(conversation.id);
      }
    }
  }, [conversations, runConversationQueue]);

  const handleSubmit = async () => {
    const prompt = imagePrompt.trim();
    if (!prompt) {
      toast.error("请输入提示词");
      return;
    }

    if (!ensureQuotaForRequest(parsedCount)) {
      return;
    }

    const effectiveImageMode: ImageConversationMode = referenceImageFiles.length > 0 ? "edit" : "generate";

    const targetConversation = selectedConversationId
      ? conversationsRef.current.find((conversation) => conversation.id === selectedConversationId) ?? null
      : null;
    const now = new Date().toISOString();
    const conversationId = targetConversation?.id ?? createId();
    const turnId = createId();
    // 仅当回复目标属于当前对话时才挂上下文，避免切换对话后 replyTarget 漏带。
    const activeReplyContext =
      replyTarget && replyTarget.conversationId === conversationId
        ? {
            sourceTurnId: replyTarget.sourceTurnId,
            sourcePrompt: replyTarget.sourcePrompt,
            aiMessage: replyTarget.aiMessage,
          }
        : undefined;
    const draftTurn: ImageTurn = {
      id: turnId,
      prompt,
      model: "gpt-image-2",
      mode: effectiveImageMode,
      referenceImages: effectiveImageMode === "edit" ? referenceImages : [],
      count: parsedCount,
      size: imageSize,
      resolution: canUseHighResolution || !isHighResolution(imageResolution) ? imageResolution : "",
      images: createLoadingImages(turnId, parsedCount),
      createdAt: now,
      status: "queued",
      replyContext: activeReplyContext,
    };

    const baseConversation: ImageConversation = targetConversation
      ? {
          ...targetConversation,
          updatedAt: now,
          turns: [...targetConversation.turns, draftTurn],
        }
      : {
          id: conversationId,
          title: buildConversationTitle(prompt),
          createdAt: now,
          updatedAt: now,
          turns: [draftTurn],
        };

    setSelectedConversationId(conversationId);
    clearComposerInputs();

    await persistConversation(baseConversation);
    void runConversationQueue(conversationId);

    // 不再弹"已发送 / 已创建 / 已加入队列"toast：
    // 用户刚点了发送按钮，下方画布会立刻出现"处理中"占位卡，
    // 状态变化已经可见，再弹一条 toast 反而打断节奏。
  };

  return (
    <>
      <section className="relative mx-auto flex h-[calc(100dvh-3.5rem)] min-h-0 w-full max-w-[1380px] flex-col gap-2 overflow-hidden px-0 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:h-[calc(100dvh-4rem)] sm:gap-3 sm:px-3 sm:pb-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-2 pt-2 sm:px-4 sm:pt-3">
          <div className="pointer-events-auto flex items-center gap-2">
          <Button
            variant="outline"
            className="group h-9 cursor-pointer rounded-lg border-border bg-card/90 px-3 text-foreground shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] backdrop-blur"
            onClick={() => setIsHistoryOpen(true)}
          >
            <History className="size-4 text-muted-foreground" />
            <span className="max-w-[180px] truncate text-[13px] font-medium sm:max-w-[260px]">
              历史对话
            </span>
            <span className="font-data text-[10px] text-muted-foreground">{conversations.length}</span>
          </Button>
          <Button
            className="h-9 cursor-pointer rounded-lg bg-foreground px-3 text-background shadow-[0_4px_16px_-6px_rgba(15,23,42,0.35)] hover:bg-foreground/90"
            onClick={handleCreateDraft}
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline text-[13px]">新建</span>
          </Button>
          {selectedConversation && selectedConversation.turns.some(t => t.images.some(img => img.status === "success")) && (
            <Button
              variant={isBatchMode ? "secondary" : "outline"}
              className={cn(
                "h-9 cursor-pointer rounded-lg border border-border bg-card/90 px-3 text-foreground shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] backdrop-blur transition-all gap-1",
                isBatchMode && "bg-secondary border-primary/30 text-primary"
              )}
              onClick={() => {
                setIsBatchMode(!isBatchMode);
                setSelectedImageIds(new Set());
              }}
            >
              <CheckSquare className="size-4" />
              <span className="hidden sm:inline text-[13px]">{isBatchMode ? "取消管理" : "批量管理"}</span>
              <span className="inline sm:hidden text-[13px]">{isBatchMode ? "取消" : "批量"}</span>
            </Button>
          )}
          </div>
          <div className="pointer-events-auto ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-md border border-border bg-card/90 px-2 py-1 shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] backdrop-blur sm:inline-flex">
              <span className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">额度</span>
              {availableQuota === "∞" ? (
                <InfinityIcon className="size-3.5 text-foreground" strokeWidth={2.25} aria-label="不限额度" />
              ) : (
                <span className="font-data tabular-nums text-[12px] font-semibold text-foreground">{availableQuota}</span>
              )}
            </span>
            <span className="hidden items-center gap-1.5 rounded-md border border-border bg-card/90 px-2 py-1 shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] backdrop-blur sm:inline-flex">
              <span className="font-data text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">运行</span>
              <span className="font-data tabular-nums text-[12px] font-semibold text-foreground">{activeTaskCount}</span>
            </span>
          </div>
        </div>

        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogContent className="flex h-dvh w-[300px] max-w-[85vw] flex-col overflow-hidden rounded-r-2xl rounded-l-none border-r border-border bg-background p-0 fixed top-0 left-0 translate-x-0 translate-y-0 duration-300 ease-out data-[state=open]:animate-drawer-in data-[state=closed]:animate-drawer-out sm:top-[50%] sm:left-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:h-[min(82dvh,720px)] sm:w-[92vw] sm:max-w-[440px] sm:rounded-[24px] sm:data-[state=open]:zoom-in-[0.98] sm:data-[state=open]:slide-in-from-top-1">
            <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4">
              <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                <History className="size-[17px] text-muted-foreground" strokeWidth={2} />
                历史对话
                <span className="ml-1 font-data text-[11px] font-medium text-muted-foreground/70">
                  {conversations.length}
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
              <ImageSidebar
                conversations={conversations}
                isLoadingHistory={isLoadingHistory}
                selectedConversationId={selectedConversationId}
                onCreateDraft={() => {
                  handleCreateDraft();
                  setIsHistoryOpen(false);
                }}
                onClearHistory={openClearHistoryConfirm}
                onSelectConversation={(id) => {
                  setSelectedConversationId(id);
                  setIsHistoryOpen(false);
                }}
                onDeleteConversation={openDeleteConversationConfirm}
                onRenameConversation={handleRenameConversation}
                formatConversationTime={formatConversationTime}
                hideActionButtons
              />
            </div>
          </DialogContent>
        </Dialog>

        <div className="flex min-h-0 flex-1 flex-col">

          <div
            ref={resultsViewportRef}
            onScroll={(event) => {
              const target = event.currentTarget;
              // 同步底部渐隐：剩余可滚距离大于一行高度时才显示，
              // 滚到底/没溢出都让它消失，避免无内容时灰雾常驻。
              const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
              setShowBottomFade(remaining > 8);
              const conversationId = restoredConversationIdRef.current;
              if (!conversationId) return;
              scrollPositionsRef.current[conversationId] = target.scrollTop;
              if (scrollSaveTimerRef.current) {
                clearTimeout(scrollSaveTimerRef.current);
              }
              scrollSaveTimerRef.current = setTimeout(() => {
                if (typeof window === "undefined") return;
                try {
                  window.sessionStorage.setItem(
                    SCROLL_POSITION_STORAGE_KEY,
                    JSON.stringify(scrollPositionsRef.current),
                  );
                } catch {
                  // 容量满或被禁用时静默
                }
              }, 200);
            }}
            className={`hide-scrollbar min-h-0 flex-1 overscroll-contain px-1 pt-14 pb-6 sm:px-4 sm:pt-16 sm:pb-8 ${selectedConversation ? "overflow-y-auto" : "overflow-hidden"}`}
          >
            {isLoadingHistory ? (
              // 历史加载完成前先占位，避免 selectedConversation === null 触发的"空状态"
              // aurora 大屏闪现一下又跳走的视觉抖动。
              <div aria-hidden className="h-full" />
            ) : (
              <ImageResults
                selectedConversation={selectedConversation}
                onOpenLightbox={openLightbox}
                onContinueEdit={handleContinueEdit}
                onDeletePrompt={openDeletePromptConfirm}
                onDeleteResults={openDeleteResultsConfirm}
                onReuseTurnConfig={handleReuseTurnConfig}
                onApplyParamsOnly={handleApplyParamsOnly}
                onCancelImage={handleCancelImage}
                onDeleteSingleImage={handleDeleteSingleImage}
                onRegenerateTurn={handleRegenerateTurn}
                onRetryImage={handleRetryImage}
                onReplyToTurn={handleReplyToTurn}
                onPublishImage={handlePublishImage}
                publishStateOf={publishStateOf}
                formatConversationTime={formatConversationTime}
                isBatchMode={isBatchMode}
                selectedImageIds={selectedImageIds}
                onToggleSelectImage={handleToggleSelectImage}
                favorites={favorites}
                onToggleFavorite={handleToggleFavorite}
              />
            )}
          </div>

          <div className="relative shrink-0 px-1 sm:px-4">
            {selectedConversation && showBottomFade ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-b from-transparent to-background sm:h-14"
              />
            ) : null}
            <div className="mx-auto w-full max-w-[820px]">
              {isBatchMode ? (
                <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/90 px-4 py-3 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.3)] backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <div className="flex items-center justify-between sm:justify-start sm:gap-4">
                    <span className="text-[13px] text-muted-foreground">
                      已选择 <span className="font-semibold text-foreground font-data tabular-nums">{selectedImageIds.size}</span> 张图片
                    </span>
                    {selectedImageIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedImageIds(new Set())}
                        className="text-[12px] text-muted-foreground hover:text-foreground transition underline underline-offset-2"
                      >
                        清除选择
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsBatchMode(false);
                        setSelectedImageIds(new Set());
                      }}
                      className="h-8 rounded-lg text-xs"
                    >
                      取消
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedImageIds.size === 0 || isBatchActionLoading}
                      onClick={handleBatchDownload}
                      className="h-8 rounded-lg text-xs gap-1"
                    >
                      <Download className="size-3.5" />
                      批量下载
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedImageIds.size === 0 || isBatchActionLoading}
                      onClick={handleBatchPublish}
                      className="h-8 rounded-lg text-xs gap-1"
                    >
                      <Share2 className="size-3.5" />
                      批量发布
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={selectedImageIds.size === 0 || isBatchActionLoading}
                      onClick={openBatchDeleteConfirm}
                      className="h-8 rounded-lg text-xs gap-1"
                    >
                      <Trash2 className="size-3.5" />
                      批量删除
                    </Button>
                  </div>
                </div>
              ) : (
                <ImageComposer
                  prompt={imagePrompt}
                  imageCount={imageCount}
                  imageSize={imageSize}
                  imageResolution={imageResolution}
                  canUseHighResolution={canUseHighResolution}
                  availableQuota={availableQuota}
                  activeTaskCount={activeTaskCount}
                  referenceImages={referenceImages}
                  textareaRef={textareaRef}
                  fileInputRef={fileInputRef}
                  lastPrompt={lastPrompt}
                  replyTarget={
                    replyTarget && replyTarget.conversationId === selectedConversationId
                      ? { sourcePrompt: replyTarget.sourcePrompt, aiMessage: replyTarget.aiMessage }
                      : null
                  }
                  onCancelReply={() => {
                    setReplyTarget(null);
                    setReferenceImages([]);
                    setReferenceImageFiles([]);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  onPromptChange={setImagePrompt}
                  onImageCountChange={(value) => setImageCount(value ? clampImageCount(value, maxImageCountLimit) : "")}
                  onImageSizeChange={setImageSize}
                  onImageResolutionChange={setImageResolution}
                  onSubmit={handleSubmit}
                  onPickReferenceImage={() => fileInputRef.current?.click()}
                  onReferenceImageChange={handleReferenceImageChange}
                  onRemoveReferenceImage={handleRemoveReferenceImage}
                  onReorderReferenceImages={handleReorderReferenceImages}
                  countOptions={countOptions}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />

      {deleteConfirm ? (
        <Dialog open onOpenChange={(open) => (!open ? setDeleteConfirm(null) : null)}>
          <DialogContent showCloseButton={false} className="rounded-2xl p-6">
            <DialogHeader className="gap-2">
              <DialogTitle>{deleteConfirmTitle}</DialogTitle>
              <DialogDescription className="text-sm leading-6">
                {deleteConfirmDescription}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                取消
              </Button>
              <Button className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleConfirmDelete()}>
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export default function ImagePage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <ImagePageContent isAdmin={session.role === "admin"} />;
}
