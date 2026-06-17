"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Download,
  ImageIcon,
  Images,
  LoaderCircle,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  X,
  Star,
  CheckSquare,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteManagedImages,
  downloadSingleImage,
  downloadImages,
  fetchMyWorks,
  getMyPublishedBatch,
  publishGalleryItem,
  type ManagedImage,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

/**
 * sessionStorage 移交给画图页的 key。
 * 格式：{ url: string; prompt: string }
 * 画图页 mount 时读一次，立刻清掉，避免下次刷新又触发。
 */
const REDRAW_HANDOFF_KEY = "chatgpt2api:redraw_handoff";

function imageKey(item: ManagedImage) {
  return item.rel || item.url;
}

function formatRelative(value: string) {
  if (!value) return "";
  const ts = new Date(value.replace(" ", "T")).getTime();
  if (Number.isNaN(ts)) return value;
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return value.slice(0, 10);
}

function WorksPageContent() {
  const [items, setItems] = useState<ManagedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [focused, setFocused] = useState<ManagedImage | null>(null);

  const [favorites, setFavorites] = useState<ManagedImage[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "favorites">("all");

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("chatgpt2api:favorites");
        if (raw) {
          setFavorites(JSON.parse(raw));
        }
      } catch (err) {
        console.error("Failed to load favorites:", err);
      }
    }
  }, []);

  const saveFavorites = useCallback((list: ManagedImage[]) => {
    setFavorites(list);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("chatgpt2api:favorites", JSON.stringify(list));
      } catch (err) {
        console.error("Failed to save favorites:", err);
      }
    }
  }, []);

  const isFavorited = useCallback((item: ManagedImage) => {
    const key = imageKey(item);
    return favorites.some((fav) => imageKey(fav) === key);
  }, [favorites]);

  const handleToggleFavorite = useCallback((item: ManagedImage) => {
    const key = imageKey(item);
    const already = favorites.some((fav) => imageKey(fav) === key);
    let next: ManagedImage[];
    if (already) {
      next = favorites.filter((fav) => imageKey(fav) !== key);
      toast.success("已取消收藏");
    } else {
      next = [item, ...favorites];
      toast.success("已添加收藏");
    }
    saveFavorites(next);
  }, [favorites, saveFavorites]);

  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const [searchQuery, setSearchQuery] = useState("");
  const [ratioFilter, setRatioFilter] = useState<"all" | "square" | "landscape" | "portrait">("all");

  const [isDownloading, setIsDownloading] = useState(false);
  const [isBatchPublishing, setIsBatchPublishing] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);

  const togglePaths = useCallback((paths: string[], checked: boolean) => {
    setSelectedPaths((current) =>
      checked
        ? Array.from(new Set([...current, ...paths]))
        : current.filter((path) => !paths.includes(path))
    );
  }, []);

  const displayedItems = useMemo(() => {
    let result = activeTab === "all" ? items : favorites;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) => (item.prompt || "").toLowerCase().includes(q));
    }
    if (ratioFilter !== "all") {
      result = result.filter((item) => {
        if (!item.width || !item.height) return ratioFilter === "square"; // 兜底
        if (item.width === item.height) return ratioFilter === "square";
        if (item.width > item.height) return ratioFilter === "landscape";
        return ratioFilter === "portrait";
      });
    }
    return result;
  }, [items, favorites, activeTab, searchQuery, ratioFilter]);

  // Pinterest 风格 masonry：列宽 flex-1 边到边等分容器（不留白），列数随容器宽度走。
  //   - 列数 = round((容器宽 + gap) / (目标列宽 240 + gap))
  //   - 关键是 round 而不是 floor：floor 必须装满整数列才加新列，
  //     往往在 N+0.9 列还停在 N 列，单列特别宽 (≈1.7×目标宽)，看起来是大块卡片不是 masonry；
  //     round 在 N+0.5 列就跳到 N+1 列，单列宽稳定在 [0.7, 1.3]×目标宽，
  //     跨列数边界时单列宽只变 ~15% (不像断点 25-33% 突变那么硬)
  //   - 移动端 (<480px) 兜底 2 列，避免单列大图占满屏
  //   - 列数变化时整体过渡用 CSS transition 软化
  // ResizeObserver 监听容器，比 window.resize 更准（侧栏开合也响应）；
  // rAF 节流避免拖动时 setState 高频抖动。
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(0); // 0 = 还没测量

  const masonryColumns = useMemo(() => {
    if (columnCount <= 0) return [];
    const cols = columnCount;
    const buckets: ManagedImage[][] = Array.from({ length: cols }, () => []);
    // 列内累计"高度"近似值：用 1/ratio (= height/width) 做单位列宽下的相对高度
    const heights = new Array(cols).fill(0);
    for (const item of displayedItems) {
      const w = item.width && item.width > 0 ? item.width : 1;
      const h = item.height && item.height > 0 ? item.height : 1;
      const relativeH = h / w;
      // 选当前最短列
      let target = 0;
      for (let i = 1; i < cols; i++) {
        if (heights[i] < heights[target]) target = i;
      }
      buckets[target].push(item);
      heights[target] += relativeH;
    }
    return buckets;
  }, [displayedItems, columnCount]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const TARGET_W = 240;
    const GAP = 16;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const w = el.clientWidth;
      if (!w) return;
      let n: number;
      if (w < 360) n = 1;
      else if (w < 520) n = 2;
      else n = Math.max(2, Math.round((w + GAP) / (TARGET_W + GAP)));
      setColumnCount((prev) => (prev === n ? prev : n));
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(calc);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // 发布画廊弹窗：当一张图没有 prompt 时（老数据），需要让用户手填后再 publish。
  // pendingPublish 持有正在发布的目标，promptDraft 是输入框文本。
  const [pendingPublish, setPendingPublish] = useState<ManagedImage | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [publishing, setPublishing] = useState(false);
  // 单图当前发布态视觉反馈：rel → "publishing" | "published"
  const [publishStates, setPublishStates] = useState<Map<string, "publishing" | "published">>(
    () => new Map(),
  );

  // 删除二次确认
  const [pendingDelete, setPendingDelete] = useState<ManagedImage | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const resp = await fetchMyWorks();
      setItems(resp.items);
      // 播种 publishStates：刷新页面后 publishStates Map 会被重置为空，
      // 已发布角标会丢。reload 时一次性问后端"这批 rel 我发过哪些"，
      // 把命中的写回 state，避免逐张发单条 /api/gallery/published 撑爆并发数。
      const rels = resp.items.map((it) => it.rel).filter(Boolean) as string[];
      if (rels.length > 0) {
        try {
          const { items: published } = await getMyPublishedBatch(rels);
          setPublishStates((prev) => {
            const next = new Map(prev);
            for (const [rel, info] of Object.entries(published)) {
              if (info.published) {
                next.set(rel, "published");
              }
            }
            return next;
          });
        } catch {
          // 静默失败：拉不到发布状态不阻塞列表加载，下次 reload 再试
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载作品失败";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 用此图重画：把 rel + prompt 写进 sessionStorage，跳到画图页。
   * 故意传 rel 不传 item.url：后端拼的 item.url 是绝对地址（含 http://...:port），
   * 跟前端页面跨源时 <img> 能加载、fetch 会被 CORS 拦掉报 "Failed to fetch"。
   * 画图页拿到 rel 后用 `/images/${rel}` 同源拉取，永远不会撞 CORS。
   * url 字段保留作为兜底（rel 缺失时的老 handoff 格式）。
   */
  const handleRedraw = useCallback((item: ManagedImage) => {
    if (typeof window === "undefined") return;
    const rel = item.rel || item.path || "";
    const params = new URLSearchParams();
    if (rel) params.set("redraw_rel", rel);
    if (item.url) params.set("redraw_url", item.url);
    if (item.prompt) params.set("redraw_prompt", item.prompt);
    try {
      window.sessionStorage.setItem(
        REDRAW_HANDOFF_KEY,
        JSON.stringify({
          rel,
          url: item.url, // 兜底：rel 没拿到时用绝对地址
          prompt: item.prompt || "",
        }),
      );
    } catch {
      // sessionStorage 写失败一般是隐私模式 / 配额满，不阻断跳转
    }
    window.location.assign(`/image/?${params.toString()}`);
  }, []);

  const handleCopyPrompt = useCallback(async (text: string) => {
    if (!text.trim()) {
      toast.error("此图没有保留 prompt");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制 prompt");
    } catch {
      toast.error("复制失败");
    }
  }, []);

  const handleDownload = useCallback(async (item: ManagedImage) => {
    const path = item.rel || item.path;
    if (!path) {
      toast.error("当前图片无法下载");
      return;
    }
    try {
      await downloadSingleImage(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : "下载失败";
      toast.error(message);
    }
  }, []);

  /**
   * 发布按钮入口。
   *  - 已有 prompt：直接走 publish 接口，过敏感词 → 成功 → 给绿对勾视觉
   *  - 没有 prompt：弹个对话框让用户手填，提交时再走 publish
   */
  const handlePublish = useCallback(
    async (item: ManagedImage, promptOverride?: string) => {
      const rel = item.rel || item.path;
      if (!rel) {
        toast.error("当前图片无法发布");
        return;
      }
      // promptOverride !== undefined 表示用户已通过补齐弹窗确认（即便是空串），
      // 此时尊重用户选择直接发布；undefined 表示从卡片入口直接点的发布按钮。
      let prompt: string;
      if (promptOverride !== undefined) {
        prompt = promptOverride.trim();
      } else {
        prompt = (item.prompt ?? "").trim();
        if (!prompt) {
          // 卡片自身没 prompt → 弹窗让用户决定加不加（可选，留空也能发）
          setPendingPublish(item);
          setPromptDraft("");
          return;
        }
      }
      setPublishStates((prev) => new Map(prev).set(rel, "publishing"));
      try {
        await publishGalleryItem({
          image_rel: rel,
          prompt,
          model: "",
          size: "",
          width: item.width || 0,
          height: item.height || 0,
        });
        setPublishStates((prev) => new Map(prev).set(rel, "published"));
        toast.success("已发布到画廊");
      } catch (error) {
        // 失败回滚状态让用户可重试
        setPublishStates((prev) => {
          const next = new Map(prev);
          next.delete(rel);
          return next;
        });
        const message = error instanceof Error ? error.message : "发布失败";
        toast.error(message);
      }
    },
    [],
  );

  const handleConfirmPendingPublish = useCallback(async () => {
    if (!pendingPublish) return;
    // 允许空 prompt——是否补齐由用户决定，后端已支持空值发布
    const text = promptDraft.trim();
    setPublishing(true);
    try {
      await handlePublish(pendingPublish, text);
      setPendingPublish(null);
      setPromptDraft("");
    } finally {
      setPublishing(false);
    }
  }, [handlePublish, pendingPublish, promptDraft]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const path = pendingDelete.rel || pendingDelete.path;
    if (!path) {
      setPendingDelete(null);
      return;
    }
    setDeleting(true);
    try {
      const resp = await deleteManagedImages({ paths: [path] });
      if (!resp.removed) {
        toast.error("删除失败：该图不在你名下或已不存在");
      } else {
        toast.success("已删除");
        const key = imageKey(pendingDelete);
        setItems((prev) => prev.filter((it) => imageKey(it) !== key));
        if (focused && imageKey(focused) === key) setFocused(null);
      }
      setPendingDelete(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败";
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }, [focused, pendingDelete]);

  const handleBatchDownload = useCallback(async () => {
    if (selectedPaths.length === 0) return;
    setIsDownloading(true);
    try {
      await downloadImages(selectedPaths);
      toast.success("已开始下载打包图片");
    } catch {
      toast.error("批量下载失败");
    } finally {
      setIsDownloading(false);
    }
  }, [selectedPaths]);

  const handleBatchFavorite = useCallback(() => {
    if (selectedPaths.length === 0) return;
    const selectedItems = displayedItems.filter((item) => selectedSet.has(imageKey(item)));
    const allFav = selectedItems.every((item) => isFavorited(item));
    let nextFavorites = [...favorites];
    if (allFav) {
      const keysToRemove = new Set(selectedPaths);
      nextFavorites = favorites.filter((fav) => !keysToRemove.has(imageKey(fav)));
      toast.success("已批量取消收藏");
    } else {
      const existingKeys = new Set(favorites.map(imageKey));
      const toAdd = selectedItems.filter((item) => !existingKeys.has(imageKey(item)));
      nextFavorites = [...toAdd, ...favorites];
      toast.success("已批量添加收藏");
    }
    saveFavorites(nextFavorites);
    setSelectedPaths([]);
    setIsBatchMode(false);
  }, [selectedPaths, displayedItems, selectedSet, isFavorited, favorites]);

  const handleBatchPublish = useCallback(async () => {
    if (selectedPaths.length === 0) return;
    setIsBatchPublishing(true);
    let successCount = 0;
    let failCount = 0;
    try {
      const selectedItems = displayedItems.filter((item) => selectedSet.has(imageKey(item)));
      const results = await Promise.allSettled(
        selectedItems.map(async (item) => {
          const rel = item.rel || item.path;
          if (!rel) throw new Error("No rel");
          const prompt = (item.prompt ?? "").trim();
          await publishGalleryItem({
            image_rel: rel,
            prompt,
            model: "",
            size: "",
            width: item.width || 0,
            height: item.height || 0,
          });
          setPublishStates((prev) => new Map(prev).set(rel, "published"));
        })
      );
      results.forEach((res) => {
        if (res.status === "fulfilled") {
          successCount++;
        } else {
          failCount++;
        }
      });
      if (successCount > 0) {
        toast.success(`成功发布 ${successCount} 张图片到画廊`);
      }
      if (failCount > 0) {
        toast.error(`${failCount} 张图片发布失败`);
      }
      setSelectedPaths([]);
      setIsBatchMode(false);
    } catch {
      toast.error("批量发布失败");
    } finally {
      setIsBatchPublishing(false);
    }
  }, [selectedPaths, displayedItems, selectedSet]);

  const handleConfirmBatchDelete = useCallback(async () => {
    if (selectedPaths.length === 0) return;
    setIsBatchDeleting(true);
    try {
      const resp = await deleteManagedImages({ paths: selectedPaths });
      if (resp.removed > 0) {
        toast.success(`已删除 ${resp.removed} 张图片`);
        setItems((prev) => prev.filter((item) => !selectedSet.has(imageKey(item))));
        const nextFavorites = favorites.filter((fav) => !selectedSet.has(imageKey(fav)));
        saveFavorites(nextFavorites);
      } else {
        toast.error("删除失败");
      }
      setSelectedPaths([]);
      setIsBatchMode(false);
      setIsBatchDeleteOpen(false);
    } catch {
      toast.error("删除操作失败");
    } finally {
      setIsBatchDeleting(false);
    }
  }, [selectedPaths, selectedSet, favorites]);

  const goPrev = useCallback(() => {
    if (!focused) return;
    const idx = displayedItems.findIndex((it) => imageKey(it) === imageKey(focused));
    if (idx > 0) setFocused(displayedItems[idx - 1]);
  }, [focused, displayedItems]);

  const goNext = useCallback(() => {
    if (!focused) return;
    const idx = displayedItems.findIndex((it) => imageKey(it) === imageKey(focused));
    if (idx !== -1 && idx < displayedItems.length - 1) setFocused(displayedItems[idx + 1]);
  }, [focused, displayedItems]);

  useEffect(() => {
    if (!focused) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focused, goPrev, goNext]);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartRef.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    
    // 阈值设为 80px，且横向移动必须大于纵向移动的 2.5 倍，并且纵向移动不能超过 30px，以防上下滚动误触切图
    if (Math.abs(deltaX) > 80 && Math.abs(deltaX) > Math.abs(deltaY) * 2.5 && Math.abs(deltaY) < 30) {
      if (deltaX > 0) {
        goPrev();
      } else {
        goNext();
      }
    }
  };

  const visibleCount = displayedItems.length;

  // 关闭弹窗时，focused 立刻置 null 会让 {focused ? ... : null} 内容瞬间从 DOM 消失，
  // 剩下空的 DialogContent 在 Radix 200ms 淡出缩放里收缩成一条白线（用户反馈的"中间闪白线"）。
  // 用 lastFocused 缓存最后一次的内容，关闭过渡跑完前继续渲染同一份图片/按钮，
  // 整块跟着外壳一起淡出，不会先空掉。
  const [lastFocused, setLastFocused] = useState<ManagedImage | null>(null);
  useEffect(() => {
    if (focused) setLastFocused(focused);
  }, [focused]);
  const focusedView = focused ?? lastFocused;

  const focusedIdx = focusedView ? displayedItems.findIndex((it) => imageKey(it) === imageKey(focusedView)) : -1;
  const hasPrev = focusedIdx > 0;
  const hasNext = focusedIdx !== -1 && focusedIdx < displayedItems.length - 1;

  const focusedPublishState = focused ? publishStates.get(imageKey(focused)) : undefined;

  return (
    <>
      <section className="mt-4 flex flex-col gap-4 sm:mt-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
            My Works
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">我的作品</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "正在加载…"
              : visibleCount === 0
                ? "还没有生成过图片"
                : `共 ${visibleCount} 张 · 点击卡片查看大图`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={isBatchMode ? "default" : "outline"}
            className={cn(
              "h-10 rounded-xl border-border px-4 transition",
              isBatchMode
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-card/80 text-foreground hover:bg-secondary"
            )}
            onClick={() => {
              setIsBatchMode(!isBatchMode);
              setSelectedPaths([]);
            }}
            disabled={isLoading}
          >
            <CheckSquare className="size-4" />
            {isBatchMode ? "退出管理" : "批量管理"}
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-xl border-border bg-card/80 px-4 text-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => void reload()}
            disabled={isLoading || isBatchMode}
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
            刷新
          </Button>
        </div>
      </section>

      {/* 搜索与比例筛选排 */}
      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索提示词关键词..."
            className="h-10 w-full rounded-xl border border-border bg-card/80 pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-foreground focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute top-1/2 right-2.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select value={ratioFilter} onValueChange={(v) => setRatioFilter(v as typeof ratioFilter)}>
            <SelectTrigger className="h-10 w-[140px] rounded-xl border-border bg-card/80 text-xs text-foreground focus:ring-0">
              <SelectValue placeholder="比例筛选" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border bg-card">
              <SelectItem value="all" className="text-xs">全部比例</SelectItem>
              <SelectItem value="square" className="text-xs">正方形 (1:1)</SelectItem>
              <SelectItem value="landscape" className="text-xs">横版图 (宽 &gt; 高)</SelectItem>
              <SelectItem value="portrait" className="text-xs">竖版图 (宽 &lt; 高)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs Selector */}
      <div className="mt-4 flex gap-1.5 border-b border-border/50 pb-px">
        <button
          type="button"
          onClick={() => setActiveTab("all")}
          className={cn(
            "relative px-4 py-2 text-sm font-medium transition cursor-pointer",
            activeTab === "all" ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
          )}
        >
          全部作品
          {activeTab === "all" && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("favorites")}
          className={cn(
            "relative px-4 py-2 text-sm font-medium transition cursor-pointer",
            activeTab === "favorites" ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
          )}
        >
          我的收藏
          {activeTab === "favorites" && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
          )}
        </button>
      </div>

      {isLoading && displayedItems.length === 0 ? (
        <Card className="mt-6 rounded-2xl border-border bg-card shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="rounded-xl bg-secondary p-3 text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
            <p className="text-sm text-muted-foreground">从云端拉取你的图片…</p>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && displayedItems.length === 0 ? (
        <Card className="mt-6 rounded-2xl border-border bg-card shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="rounded-xl bg-secondary p-3 text-muted-foreground">
              <Images className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">这里还很空</p>
              <p className="text-sm text-muted-foreground">去画图页生成第一张吧</p>
            </div>
            <Button
              variant="outline"
              className="mt-2 h-9 rounded-xl border-border bg-card px-4 text-foreground hover:bg-secondary"
              onClick={() => window.location.assign("/image")}
            >
              <Sparkles className="size-4" />
              去画图
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div
        ref={containerRef}
        className="mt-6 flex gap-3"
        style={{ alignItems: "flex-start" }}
      >
        {columnCount > 0 && masonryColumns.map((bucket, colIdx) => (
          <div
            key={colIdx}
            className="flex flex-1 flex-col gap-3"
            style={{ minWidth: 0 }}
          >
            {bucket.map((item) => {
              const ratio =
                item.width && item.height && item.width > 0 && item.height > 0
                  ? item.width / item.height
                  : 1;
              const state = publishStates.get(imageKey(item));
              return (
                <button
                  key={imageKey(item)}
                  type="button"
                  onClick={() => {
                    if (isBatchMode) {
                      const key = imageKey(item);
                      togglePaths([key], !selectedSet.has(key));
                    } else {
                      setFocused(item);
                    }
                  }}
                  className="group relative w-full overflow-hidden rounded-xl bg-card border border-border/40 hover:border-border/80 transition-colors shadow-sm select-none"
                  style={{ aspectRatio: String(ratio) }}
                >
                  {isBatchMode && (
                    <div
                      className="absolute top-2 left-2 z-20"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selectedSet.has(imageKey(item))}
                        onCheckedChange={(checked) => togglePaths([imageKey(item)], Boolean(checked))}
                        className="size-5 rounded-md border-white/60 bg-black/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                    </div>
                  )}
                  {/* Star icon overlay */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavorite(item);
                    }}
                    className={cn(
                        "absolute top-2 right-2 z-10 grid size-8 cursor-pointer place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-opacity duration-200",
                        isFavorited(item) ? "opacity-100 text-yellow-400" : "opacity-0 group-hover:opacity-100 hover:bg-black/60",
                      )}
                      title={isFavorited(item) ? "取消收藏" : "加入收藏"}
                    >
                      <Star className={cn("size-3.5", isFavorited(item) && "fill-yellow-400")} />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={item.prompt?.slice(0, 30) || item.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {state === "published" ? (
                      <div className={cn("absolute top-2 rounded-md bg-emerald-500/95 px-2 py-1 text-[10.5px] font-semibold text-white shadow-sm z-10", isBatchMode ? "left-9" : "left-2")}>
                        已发布
                      </div>
                    ) : null}
                    {/* Pinterest 风格：默认干净纯图，hover 才浮现 prompt + 元信息 */}
                    <div className="pointer-events-none absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <p className="line-clamp-2 text-[12.5px] leading-snug">
                        {item.prompt?.trim() || "—"}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10.5px] text-white/80">
                        <span>{formatRelative(item.created_at)}</span>
                        {item.width && item.height ? (
                          <span className="shrink-0 font-data">
                            {item.width}×{item.height}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
      </div>

      {/* 详情 Dialog */}
      <Dialog open={focused !== null} onOpenChange={(open) => (!open ? setFocused(null) : null)}>
        <DialogContent
          showCloseButton={false}
          className="hide-scrollbar max-h-[92vh] overflow-y-auto rounded-2xl p-0 sm:max-w-[760px]"
        >
          {focusedView ? (
            <div className="flex flex-col">
              {/* 图片 + 右上悬浮操作（关闭/下载/删除）。
                  把次要操作收到角落，底部只留 3 个主 CTA，避免按钮换行。
                  容器底色用 stone-900 兜底；图按容器宽度撑满，高度按比例自然展开，
                  高图由外层 DialogContent 的 max-h-[92vh] + overflow-y-auto 消化滚动。 */}
              <div
                className="relative bg-stone-900 select-none overflow-hidden"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={focusedView.url}
                  alt={focusedView.prompt?.slice(0, 30) || focusedView.name}
                  className="block h-auto w-full pointer-events-none"
                />
                {hasPrev ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      goPrev();
                    }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65 active:scale-90"
                    title="上一张 (←)"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                ) : null}
                {hasNext ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      goNext();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65 active:scale-90"
                    title="下一张 (→)"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                ) : null}
                <div className="absolute top-3 right-3 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleDownload(focusedView)}
                    aria-label="下载"
                    title="下载"
                    className="grid size-9 cursor-pointer place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75"
                  >
                    <Download className="size-4" />
                  </button>
                  {focusedView && (
                    <button
                      type="button"
                      onClick={() => handleToggleFavorite(focusedView)}
                      aria-label="收藏"
                      title={isFavorited(focusedView) ? "取消收藏" : "收藏"}
                      className={cn(
                        "grid size-9 cursor-pointer place-items-center rounded-full bg-black/55 backdrop-blur-sm transition hover:bg-black/75",
                        isFavorited(focusedView) ? "text-yellow-400" : "text-white"
                      )}
                    >
                      <Star className={cn("size-4", isFavorited(focusedView) && "fill-yellow-400")} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingDelete(focusedView)}
                    aria-label="删除"
                    title="删除"
                    className="grid size-9 cursor-pointer place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-rose-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocused(null)}
                    aria-label="关闭"
                    title="关闭"
                    className="grid size-9 cursor-pointer place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-3 p-5">
                <DialogHeader className="gap-1.5 space-y-0">
                  <DialogTitle className="text-base font-semibold">作品详情</DialogTitle>
                  <DialogDescription className="sr-only">单张作品的 prompt 与操作</DialogDescription>
                </DialogHeader>

                {focusedView.prompt ? (
                  <div className="rounded-xl bg-secondary/50 p-3 text-[13px] leading-6 text-foreground">
                    {focusedView.prompt}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-secondary/30 p-3 text-[12px] leading-6 text-muted-foreground">
                    此图未保留生成时的 prompt（可能是早期版本生成的）。发布到画廊时会让你手填。
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatRelative(focusedView.created_at)}</span>
                  {focusedView.width && focusedView.height ? (
                    <span className="font-data">
                      · {focusedView.width}×{focusedView.height}
                    </span>
                  ) : null}
                </div>

                {/* 底部 3 主 CTA 等分宽度，永远不换行；
                    下载/删除已移到图片右上角悬浮按钮。 */}
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Button
                    onClick={() => handleRedraw(focusedView)}
                    className="h-10 w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 px-3"
                  >
                    <Sparkles className="size-4" />
                    用此图重画
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 w-full rounded-xl border-border bg-card px-3 text-foreground hover:bg-secondary"
                    onClick={() => void handleCopyPrompt(focusedView.prompt || "")}
                    disabled={!focusedView.prompt}
                  >
                    <Copy className="size-4" />
                    复制 prompt
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 w-full rounded-xl border-border bg-card px-3 text-foreground hover:bg-secondary"
                    onClick={() => void handlePublish(focusedView)}
                    disabled={focusedPublishState === "publishing" || focusedPublishState === "published"}
                  >
                    {focusedPublishState === "publishing" ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Share2 className="size-4" />
                    )}
                    {focusedPublishState === "published" ? "已发布" : "发布到画廊"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 老数据 / 图生图无 prompt 的图发布前选择性补段描述（可选，留空也能发） */}
      <Dialog
        open={pendingPublish !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPublish(null);
            setPromptDraft("");
          }
        }}
      >
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle>给这张图加段 prompt（可选）</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              此图没有保留生成时的 prompt。补一段描述能让其他用户复用提示词，留空也可直接发布。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            placeholder="比如：一只穿宇航服的猫，蹲在月球表面"
            className="mt-2 min-h-[120px] rounded-xl"
          />
          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => {
                setPendingPublish(null);
                setPromptDraft("");
              }}
              disabled={publishing}
            >
              取消
            </Button>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => void handleConfirmPendingPublish()}
              disabled={publishing}
            >
              {publishing ? <LoaderCircle className="size-4 animate-spin" /> : null}
              确认发布
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除二次确认 */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => (!open ? setPendingDelete(null) : null)}
      >
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle>删除这张作品？</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              服务器上的图片会一起被删除，画廊里发布过的对应条目也会被移除，已下载到本地的不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              取消
            </Button>
            <Button
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => void handleConfirmDelete()}
              disabled={deleting}
            >
              {deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量操作悬浮条 */}
      {isBatchMode && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-background/85 px-4 py-3 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.15)] backdrop-blur-md max-w-[95vw] sm:max-w-xl">
          <div className="mr-2 text-xs font-medium text-muted-foreground whitespace-nowrap">
            已选 <span className="font-semibold text-foreground font-data tabular-nums">{selectedPaths.length}</span> 张
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg text-xs"
            onClick={() => {
              const allKeys = displayedItems.map(imageKey);
              const allSelected = displayedItems.length > 0 && displayedItems.every((item) => selectedSet.has(imageKey(item)));
              togglePaths(allKeys, !allSelected);
            }}
          >
            {displayedItems.length > 0 && displayedItems.every((item) => selectedSet.has(imageKey(item))) ? "取消全选" : "全选"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={selectedPaths.length === 0 || isDownloading}
            className="h-8 rounded-lg text-xs gap-1 border-border"
            onClick={handleBatchDownload}
          >
            {isDownloading ? <LoaderCircle className="size-3 animate-spin" /> : <Download className="size-3" />}
            下载
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={selectedPaths.length === 0}
            className="h-8 rounded-lg text-xs gap-1 border-border"
            onClick={handleBatchFavorite}
          >
            <Star className="size-3" />
            收藏
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={selectedPaths.length === 0 || isBatchPublishing}
            className="h-8 rounded-lg text-xs gap-1 border-border"
            onClick={handleBatchPublish}
          >
            {isBatchPublishing ? <LoaderCircle className="size-3 animate-spin" /> : <Share2 className="size-3" />}
            发布
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={selectedPaths.length === 0}
            className="h-8 rounded-lg text-xs gap-1 border-rose-200/50 text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/20"
            onClick={() => setIsBatchDeleteOpen(true)}
          >
            <Trash2 className="size-3" />
            删除
          </Button>
        </div>
      )}

      {/* 批量删除二次确认 */}
      <Dialog open={isBatchDeleteOpen} onOpenChange={setIsBatchDeleteOpen}>
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle>确定删除选中的 {selectedPaths.length} 张图片？</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              此操作将从云端彻底删除选中的图片，且不可恢复。确认删除吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsBatchDeleteOpen(false)} disabled={isBatchDeleting}>
              取消
            </Button>
            <Button
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={handleConfirmBatchDelete}
              disabled={isBatchDeleting}
            >
              {isBatchDeleting ? <LoaderCircle className="size-4 animate-spin mr-1.5" /> : null}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function WorksPage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <WorksPageContent />;
}
