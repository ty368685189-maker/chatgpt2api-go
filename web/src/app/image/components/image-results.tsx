"use client";

import { useEffect, useState, memo } from "react";
import {
  AlertCircle,
  Check,
  Clock3,
  Download,
  Info,
  LoaderCircle,
  Reply,
  RotateCcw,
  Share2,
  Sparkles,
  Trash2,
  WalletCards,
  RefreshCw,
  X,
  Star,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { ImageConversation, ImageTurnStatus, StoredImage, StoredReferenceImage, ImageTurn } from "@/store/image-conversations";
import type { ManagedImage } from "@/lib/api";

export type ImageLightboxItem = {
  id: string;
  src: string;
  sizeLabel?: string;
  dimensions?: string;
  prompt?: string;
  revisedPrompt?: string;
  referenceSrc?: string;
};

export type ImagePublishState = "idle" | "publishing" | "published" | "unsupported";

type ImageResultsProps = {
  selectedConversation: ImageConversation | null;
  onOpenLightbox: (images: ImageLightboxItem[], index: number) => void;
  onContinueEdit: (conversationId: string, image: StoredImage | StoredReferenceImage) => void;
  onDeletePrompt: (conversationId: string, turnId: string) => void;
  onDeleteResults: (conversationId: string, turnId: string) => void;
  onReuseTurnConfig: (conversationId: string, turnId: string) => void | Promise<void>;
  onApplyParamsOnly: (conversationId: string, turnId: string) => void | Promise<void>;
  onRegenerateTurn: (conversationId: string, turnId: string) => void | Promise<void>;
  onRetryImage: (conversationId: string, turnId: string, imageId: string) => void | Promise<void>;
  onReplyToTurn?: (conversationId: string, turnId: string, aiMessage: string) => void;
  onCancelImage?: (conversationId: string, imageId: string, taskId?: string) => void | Promise<void>;
  onDeleteSingleImage?: (conversationId: string, turnId: string, imageId: string) => void | Promise<void>;
  onPublishImage?: (conversationId: string, turnId: string, image: StoredImage) => void | Promise<void>;
  publishStateOf?: (image: StoredImage) => ImagePublishState;
  formatConversationTime: (value: string) => string;
  isBatchMode?: boolean;
  selectedImageIds?: Set<string>;
  onToggleSelectImage?: (imageId: string) => void;
  favorites?: ManagedImage[];
  onToggleFavorite?: (image: StoredImage, turnPrompt: string) => void;
};

function getStoredImageSrc(image: StoredImage) {
  if (image.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  return image.url || "";
}

function isQuotaError(message: string | undefined | null) {
  if (!message) return false;
  return message.includes("额度不足");
}

async function downloadStoredImage(image: StoredImage, index: number) {
  let blob: Blob;
  if (image.b64_json) {
    const binary = atob(image.b64_json);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    blob = new Blob([bytes], { type: "image/png" });
  } else if (image.url) {
    const rel = getPathFromUrl(image.url);
    const fetchUrl = rel ? `/images/${rel}` : image.url;
    const res = await fetch(fetchUrl);
    blob = await res.blob();
  } else {
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `image-${index + 1}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getPathFromUrl(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/\/images\/(.+)$/);
  return match ? match[1] : null;
}

function ErrorMessageBlock({ message }: { message: string }) {
  return (
    <div
      className={cn(
        "text-[12px] leading-5 break-words text-stone-600 sm:text-[13px] sm:leading-6 dark:text-stone-400",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1 whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline decoration-primary/30 underline-offset-2 transition hover:text-primary/80"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
          li: ({ children }) => <li className="leading-5 sm:leading-6">{children}</li>,
          h1: ({ children }) => <h1 className="my-1.5 text-[14px] font-semibold text-foreground sm:text-base">{children}</h1>,
          h2: ({ children }) => <h2 className="my-1 text-[13px] font-semibold text-foreground sm:text-sm">{children}</h2>,
          h3: ({ children }) => <h3 className="my-1 text-[12px] font-semibold text-foreground sm:text-[13px]">{children}</h3>,
          h4: ({ children }) => <h4 className="my-1 text-[12px] font-semibold text-foreground sm:text-[13px]">{children}</h4>,
          h5: ({ children }) => <h5 className="my-1 text-[12px] font-semibold text-foreground sm:text-[13px]">{children}</h5>,
          h6: ({ children }) => <h6 className="my-1 text-[12px] font-semibold text-foreground sm:text-[13px]">{children}</h6>,
          blockquote: ({ children }) => (
            <blockquote className="my-1 border-l-2 border-muted pl-2 text-muted-foreground">{children}</blockquote>
          ),
          hr: () => <hr className="my-2 border-border" />,
          code: ({ className, children, ...props }) => {
            const isInline = !/language-/.test(className || "");
            if (isInline) {
              return (
                <code
                  className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono text-foreground sm:text-[12px]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cn("font-mono text-[11px] sm:text-[12px]", className)} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-1 overflow-x-auto rounded-lg bg-muted px-2 py-1.5 text-[11px] leading-5 text-foreground sm:text-[12px]">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-1 overflow-x-auto">
              <table className="w-full border-collapse text-[11px] sm:text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-stone-200 bg-stone-50 px-2 py-1 text-left font-medium text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{children}</th>
          ),
          td: ({ children }) => <td className="border border-stone-200 dark:border-stone-800 px-2 py-1">{children}</td>,
        }}
      />
    </div>
  );
}

function ProgressiveImage({ src, alt, className, onLoadDimensions }: {
  src: string;
  alt: string;
  className?: string;
  onLoadDimensions?: (w: number, h: number) => void;
}) {
  const [loadingState, setLoadingState] = useState<"loading" | "loaded" | "error">("loading");
  const [retryKey, setRetryKey] = useState(0);

  return (
    <div className="relative h-full w-full bg-muted/20 overflow-hidden rounded-2xl flex items-center justify-center">
      {loadingState === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-stone-200 dark:bg-stone-800" />
      )}

      {loadingState === "error" ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground p-3 text-center">
          <AlertCircle className="size-5 text-rose-500" />
          <span className="text-xs">图片加载失败</span>
          <button 
            type="button" 
            onClick={() => { setLoadingState("loading"); setRetryKey(k => k + 1); }}
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <RefreshCw className="size-3" /> 重新加载
          </button>
        </div>
      ) : (
        <img
          key={retryKey}
          src={src}
          alt={alt}
          className={cn(
            className,
            "transition-opacity duration-300",
            loadingState === "loaded" ? "opacity-100" : "opacity-0"
          )}
          onLoad={(e) => {
            setLoadingState("loaded");
            onLoadDimensions?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
          }}
          onError={() => setLoadingState("error")}
        />
      )}
    </div>
  );
}

function LoadingCard({
  createdAt,
  status,
  onCancel,
}: {
  createdAt: string;
  status: ImageTurnStatus;
  onCancel?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(createdAt).getTime();
    if (Number.isNaN(start)) return;

    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
      setElapsed(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [createdAt]);

  const estimatedTotal = 30; // 30 seconds average wait
  const remaining = Math.max(1, estimatedTotal - elapsed);

  return (
    <div className="relative aspect-square group break-inside-avoid overflow-hidden rounded-2xl bg-muted/30 border border-border/50">
      {status === "queued" ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-2 py-3 text-center text-muted-foreground select-none">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-secondary text-muted-foreground shadow-sm sm:size-8">
            <Clock3 className="size-3.5 sm:size-4" />
          </span>
          <p className="text-[11px] font-medium sm:text-[13px]">排队中</p>
          <p className="text-[10px] text-muted-foreground/60 select-none">已等待 {elapsed}s</p>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-2 py-3 text-center text-muted-foreground select-none">
          <div aria-hidden className="dot-grid-loader absolute inset-0 opacity-40 animate-pulse" />
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-secondary text-primary shadow-sm sm:size-8 animate-spin">
            <LoaderCircle className="size-3.5 sm:size-4" />
          </span>
          <p className="text-[11px] font-medium text-foreground sm:text-[13px]">正在创建图片</p>
          <div className="z-10 flex flex-col items-center text-[10px] text-muted-foreground/70 select-none">
            <span>已等待 {elapsed}s</span>
            {elapsed < estimatedTotal ? (
              <span className="text-muted-foreground/50">预计还需 ~{remaining}s</span>
            ) : (
              <span className="text-muted-foreground/50">正在加速处理中…</span>
            )}
          </div>
        </div>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-2 bottom-2 hidden group-hover:inline-flex h-6 items-center gap-1 rounded-full bg-rose-50 px-2 text-[10px] font-semibold text-rose-600 ring-1 ring-rose-200/80 transition hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-400 dark:ring-rose-900/50 z-10"
          title="取消此生图任务"
          aria-label="取消任务"
        >
          取消
        </button>
      )}
    </div>
  );
}

export const ImageResults = memo(function ImageResults({
  selectedConversation,
  onOpenLightbox,
  onContinueEdit,
  onDeletePrompt,
  onDeleteResults,
  onReuseTurnConfig,
  onApplyParamsOnly,
  onRegenerateTurn,
  onRetryImage,
  onReplyToTurn,
  onCancelImage,
  onDeleteSingleImage,
  onPublishImage,
  publishStateOf,
  formatConversationTime,
  isBatchMode = false,
  selectedImageIds = new Set(),
  onToggleSelectImage,
  favorites = [],
  onToggleFavorite,
}: ImageResultsProps) {
  const [imageDimensions, setImageDimensions] = useState<Record<string, string>>({});

  const updateImageDimensions = (id: string, width: number, height: number) => {
    const dimensions = formatImageDimensions(width, height);
    setImageDimensions((current) => {
      if (current[id] === dimensions) {
        return current;
      }
      return { ...current, [id]: dimensions };
    });
  };

  if (!selectedConversation) {
    return (
      <div className="relative flex h-full items-center justify-center text-center">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
          style={{
            maskImage:
              "radial-gradient(ellipse 60% 70% at 50% 50%, #000 18%, rgba(0,0,0,0.6) 55%, transparent 95%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 60% 70% at 50% 50%, #000 18%, rgba(0,0,0,0.6) 55%, transparent 95%)",
          }}
        >
          <div
            className="aurora-drift-a absolute top-[-10%] left-[-8%] size-[720px] blur-[130px]"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, oklch(0.74 0.11 250 / 0.40), transparent 70%)",
            }}
          />
          <div
            className="aurora-drift-b absolute right-[-8%] bottom-[-8%] size-[720px] blur-[130px]"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, oklch(0.80 0.09 60 / 0.36), transparent 70%)",
            }}
          />
          <div
            className="aurora-drift-b absolute top-[-6%] right-[8%] size-[520px] blur-[120px]"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, oklch(0.82 0.07 60 / 0.24), transparent 70%)",
            }}
          />
          <div
            className="aurora-drift-a absolute bottom-[-6%] left-[10%] size-[520px] blur-[120px]"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, oklch(0.76 0.09 250 / 0.26), transparent 70%)",
            }}
          />
          <div
            className="aurora-spin absolute top-1/2 left-1/2 size-[960px] -translate-x-1/2 -translate-y-1/2 opacity-50 blur-2xl"
            style={{
              background:
                "conic-gradient(from 90deg at 50% 50%, transparent 0deg, oklch(0.85 0.06 250 / 0.18) 70deg, transparent 150deg, oklch(0.86 0.06 60 / 0.16) 250deg, transparent 330deg)",
            }}
          />
        </div>

        <div className="relative w-full max-w-4xl px-6">
          <div className="mb-5 flex items-center justify-center gap-3 sm:mb-6">
            <span className="h-px w-10 bg-border" />
            <span className="font-data text-[10px] font-semibold tracking-[0.32em] text-muted-foreground uppercase">
              Generative · Atelier
            </span>
            <span className="h-px w-10 bg-border" />
          </div>

          <h1
            className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl md:text-5xl"
            style={{
              fontFamily: '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            Turn ideas into images
          </h1>
          <p
            className="mx-auto mt-3 max-w-[280px] text-sm italic tracking-[0.01em] text-muted-foreground sm:mt-4 sm:max-w-none sm:text-[15px]"
            style={{
              fontFamily: '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            在同一窗口里保留本地历史与任务状态，并从已有结果图继续发起新的无状态编辑。
          </p>

          <div className="mt-7 flex items-center justify-center gap-3 sm:mt-9">
            <span className="font-data text-[10px] font-semibold tracking-[0.28em] text-muted-foreground/80 tabular-nums">
              01
            </span>
            <span className="h-px w-12 bg-border/80" />
            <span className="font-data text-[10px] font-semibold tracking-[0.28em] text-muted-foreground/80 uppercase">
              Sketch → Render
            </span>
            <span className="h-px w-12 bg-border/80" />
            <span className="font-data text-[10px] font-semibold tracking-[0.28em] text-muted-foreground/80 tabular-nums">
              02
            </span>
          </div>
        </div>
      </div>
    );
  }

  const allSuccessfulImages: ImageLightboxItem[] = selectedConversation.turns.flatMap((turn) =>
    turn.images.flatMap((image) => {
      const src = image.status === "success" ? getStoredImageSrc(image) : "";
      if (!src) return [];
      const referenceSrc = turn.referenceImages[0]?.dataUrl || undefined;
      return [
        {
          id: image.id,
          src,
          sizeLabel: image.b64_json ? formatBase64ImageSize(image.b64_json) : undefined,
          dimensions: imageDimensions[image.id],
          prompt: turn.prompt,
          revisedPrompt: image.revised_prompt,
          referenceSrc,
        },
      ];
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 sm:gap-8 animate-in fade-in duration-300">
      {selectedConversation.turns.map((turn, turnIndex) => {
        const referenceLightboxImages = turn.referenceImages.map((image, index) => ({
          id: `${turn.id}-reference-${index}`,
          src: image.dataUrl,
        }));
        const hasRenderableImages = turn.images.some((image) => image.status === "success" || image.status === "error");
        const hasLoadingImages = turn.images.some((image) => image.status === "loading");
        const showImageGrid = hasRenderableImages || hasLoadingImages;

        return (
          <div key={turn.id} className="flex flex-col gap-3 sm:gap-4">
            {!turn.promptDeleted ? (
              <div className="flex justify-end">
                <div className="group max-w-[92%] sm:max-w-[78%]">
                  <div className="mb-1.5 flex flex-wrap justify-end gap-2 px-1 text-[11px] text-muted-foreground/80">
                    <span className="font-data tabular-nums">第 {turnIndex + 1} 轮</span>
                    <span>{turn.mode === "edit" ? "编辑图" : "文生图"}</span>
                    <span>{formatConversationTime(turn.createdAt)}</span>
                  </div>
                  <div className="rounded-[22px] rounded-tr-md border border-border bg-card/90 dark:bg-stone-900/90 px-4 py-3 text-left text-[14px] leading-6 text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-18px_rgba(15,23,42,0.22)] backdrop-blur sm:rounded-[26px] sm:rounded-tr-md sm:px-5 sm:py-3.5 sm:text-[15px] sm:leading-7">
                    <div className="whitespace-pre-wrap break-words">{turn.prompt}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5 opacity-80 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => void onReuseTurnConfig(selectedConversation.id, turn.id)}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-white/80 dark:bg-stone-800 px-2.5 text-[11px] font-medium text-stone-600 dark:text-stone-300 ring-1 ring-stone-200/80 dark:ring-stone-700/80 transition hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-white"
                    >
                      复用配置
                    </button>
                    {onApplyParamsOnly && (
                      <button
                        type="button"
                        onClick={() => void onApplyParamsOnly(selectedConversation.id, turn.id)}
                        className="inline-flex h-7 items-center gap-1 rounded-full bg-white/80 dark:bg-stone-800 px-2.5 text-[11px] font-medium text-stone-600 dark:text-stone-300 ring-1 ring-stone-200/80 dark:ring-stone-700/80 transition hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-white"
                        title="仅应用此卡片的尺寸与模型参数，保留当前输入框手写提示词"
                      >
                        仅套用参数
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeletePrompt(selectedConversation.id, turn.id)}
                      className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground/60 transition hover:bg-muted hover:text-foreground"
                      aria-label="删除提示词记录"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {!turn.resultsDeleted ? (
              <div className="flex justify-start">
                <div className="w-full p-1">
                  {turn.referenceImages.length > 0 ? (
                    <div className="mb-4 flex flex-col items-start">
                      <div className="mb-2 text-[11px] font-medium text-muted-foreground sm:text-xs">本轮参考图</div>
                      <div className="flex flex-wrap gap-2 sm:gap-3">
                        {turn.referenceImages.map((image, index) => (
                          <div key={`${turn.id}-${image.name}-${index}`} className="flex flex-col items-start gap-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenLightbox(referenceLightboxImages, index)}
                              className="group relative size-20 overflow-hidden rounded-2xl border border-border bg-muted/30 transition hover:border-muted-foreground/30 sm:size-24"
                              aria-label={`预览参考图 ${image.name || index + 1}`}
                            >
                              <img
                                src={image.dataUrl}
                                alt={image.name || `参考图 ${index + 1}`}
                                className="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => onContinueEdit(selectedConversation.id, image)}
                              className="inline-flex items-center gap-1 rounded-full bg-secondary dark:bg-stone-800 px-2.5 py-1 text-[11px] font-medium text-stone-600 dark:text-stone-300 transition hover:bg-stone-200 dark:hover:bg-stone-700 hover:text-stone-900 dark:hover:text-white"
                            >
                              <Sparkles className="size-3" />
                              加入编辑
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {showImageGrid ? (
                    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground sm:mb-4 sm:gap-2 sm:text-xs">
                      <span className="rounded-full bg-secondary text-secondary-foreground px-3 py-1">{turn.count} 张</span>
                      <span className="rounded-full bg-secondary text-secondary-foreground px-3 py-1">{getTurnStatusLabel(turn.status)}</span>
                      {turn.status === "queued" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary text-muted-foreground px-3 py-1">
                          <Clock3 className="size-3 text-muted-foreground/60" />
                          等待前序任务完成
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {showImageGrid ? (
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      {turn.images.map((image, index) => {
                        const imageSrc = image.status === "success" ? getStoredImageSrc(image) : "";
                        if (image.status === "success" && imageSrc) {
                          const currentIndex = allSuccessfulImages.findIndex((item) => item.id === image.id);
                          const sizeLabel = image.b64_json ? formatBase64ImageSize(image.b64_json) : "";
                          const dimensions = imageDimensions[image.id];
                          const imageMeta = [sizeLabel, dimensions].filter(Boolean).join(" · ");
                          const isSelected = selectedImageIds.has(image.id);
                          const imageRel = getPathFromUrl(image.url) || "";
                          const isFav = favorites.some((fav) => (fav.rel || fav.url) === (imageRel || image.url || ""));

                          return (
                            <div key={image.id} className="break-inside-avoid animate-in fade-in zoom-in-95 duration-200">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isBatchMode && onToggleSelectImage) {
                                    onToggleSelectImage(image.id);
                                  } else {
                                    onOpenLightbox(allSuccessfulImages, currentIndex);
                                  }
                                }}
                                className="group relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border/30 shadow-sm"
                              >
                                <ProgressiveImage
                                  src={imageSrc}
                                  alt={`Generated result ${index + 1}`}
                                  className={cn(
                                    "block h-full w-full object-cover transition duration-200 group-hover:brightness-90",
                                    isBatchMode && isSelected && "scale-[0.96]"
                                  )}
                                  onLoadDimensions={(w, h) => {
                                    updateImageDimensions(image.id, w, h);
                                  }}
                                />
                                {isBatchMode && (
                                  <div className={cn(
                                    "absolute inset-0 flex items-start justify-end p-2.5 transition-colors duration-200 select-none pointer-events-none",
                                    isSelected ? "bg-primary/10" : "bg-black/20"
                                  )}>
                                    <div className={cn(
                                      "size-5 rounded-full border flex items-center justify-center transition-all duration-200 shadow-md backdrop-blur-sm",
                                      isSelected
                                        ? "bg-primary border-primary text-primary-foreground scale-110"
                                        : "border-white/60 bg-black/40 text-transparent"
                                    )}>
                                      <Check className="size-3.5 stroke-[3]" />
                                    </div>
                                  </div>
                                )}
                              </button>
                              
                              <div className="flex items-center gap-2 px-0.5 py-1.5 text-[10px] sm:px-1 sm:py-2 sm:text-xs">
                                <div className="min-w-0 flex-1 truncate whitespace-nowrap text-stone-400">
                                  <span>结果 {index + 1}</span>
                                  {imageMeta ? <span className="ml-2">{imageMeta}</span> : null}
                                </div>
                                {!isBatchMode && (
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => onContinueEdit(selectedConversation.id, image)}
                                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 transition hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                      aria-label="加入编辑"
                                      title="加入编辑"
                                    >
                                      <Sparkles className="size-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void downloadStoredImage(image, index)}
                                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 transition hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                      aria-label="下载"
                                      title="下载"
                                    >
                                      <Download className="size-3.5" />
                                    </button>
                                    {onToggleFavorite && (
                                      <button
                                        type="button"
                                        onClick={() => onToggleFavorite(image, turn.prompt)}
                                        className={cn(
                                          "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition",
                                          isFav
                                            ? "bg-amber-50 text-amber-500 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:hover:bg-amber-900/40"
                                            : "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                        )}
                                        title={isFav ? "取消收藏" : "加入收藏"}
                                        aria-label={isFav ? "取消收藏" : "加入收藏"}
                                      >
                                        <Star className={cn("size-3.5", isFav && "fill-amber-500 dark:fill-amber-400")} />
                                      </button>
                                    )}
                                    {(() => {
                                      const state = publishStateOf?.(image) ?? "idle";
                                      const disabled = state !== "idle";
                                      const Icon =
                                        state === "publishing"
                                          ? LoaderCircle
                                          : state === "published"
                                            ? Check
                                            : Share2;
                                      const label =
                                        state === "publishing"
                                          ? "发布中"
                                          : state === "published"
                                            ? "已发布"
                                            : "发布画廊";
                                      return (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onPublishImage?.(selectedConversation.id, turn.id, image)
                                          }
                                          disabled={disabled}
                                          title={
                                            state === "unsupported"
                                              ? "本地图片暂无法发布到画廊"
                                              : state === "published"
                                                ? "已发布到画廊"
                                                : "发布到画廊"
                                          }
                                          className={cn(
                                            "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition",
                                            state === "published"
                                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                              : state === "unsupported"
                                                ? "cursor-not-allowed bg-stone-50 text-stone-300 dark:bg-stone-800 dark:text-stone-600"
                                                : "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                                            disabled && state !== "published" && "opacity-70",
                                          )}
                                          aria-label={label}
                                        >
                                          <Icon
                                            className={cn(
                                              "size-3.5",
                                              state === "publishing" && "animate-spin",
                                            )}
                                          />
                                        </button>
                                      );
                                    })()}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }

                        if (image.status === "error") {
                          const errorMessage = image.error || "生成失败";
                          if (isQuotaError(errorMessage)) {
                            return (
                              <div
                                key={image.id}
                                className="relative break-inside-avoid rounded-xl border border-amber-200/70 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20"
                              >
                                <button
                                  type="button"
                                  onClick={() => onDeleteResults(selectedConversation.id, turn.id)}
                                  className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full text-amber-500/70 transition hover:bg-secondary hover:text-rose-500"
                                  aria-label="删除生成结果"
                                >
                                  <Trash2 className="size-3" />
                                </button>
                                <div className="flex flex-col items-center gap-2 px-3 py-4 text-center sm:gap-3 sm:px-5 sm:py-5">
                                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-secondary text-amber-500 shadow-sm sm:size-8">
                                    <WalletCards className="size-3.5 sm:size-4" />
                                  </span>
                                  <p className="text-[12px] leading-5 font-medium text-amber-900 dark:text-amber-200 sm:text-[13px] sm:leading-6">
                                    {errorMessage}
                                  </p>
                                  <p className="text-[11px] leading-4 text-amber-700/80 dark:text-amber-300/80 sm:text-[12px] sm:leading-5">
                                    请联系管理员追加额度后再继续生成
                                  </p>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={image.id}
                              className="relative break-inside-avoid rounded-xl border border-border bg-muted/20"
                            >
                              {onDeleteSingleImage && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteSingleImage(selectedConversation.id, turn.id, image.id)}
                                  className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full text-muted-foreground/40 transition hover:bg-rose-50 hover:text-rose-500"
                                  title="忽略并移除此错误卡片"
                                  aria-label="移除错误卡片"
                                >
                                  <X className="size-3.5" />
                                </button>
                              )}
                              <div className="flex flex-col gap-2 px-3 py-4 sm:gap-3 sm:px-5 sm:py-5">
                                <div className="flex justify-center">
                                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-secondary text-muted-foreground shadow-sm sm:size-8">
                                    <AlertCircle className="size-3.5 sm:size-4" />
                                  </span>
                                </div>
                                <ErrorMessageBlock message={errorMessage} />
                                <div className="flex flex-wrap items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void onRetryImage(selectedConversation.id, turn.id, image.id)}
                                    className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:bg-primary/90 sm:px-3 sm:text-xs"
                                  >
                                    <RotateCcw className="size-3" />
                                    重试
                                  </button>
                                  {onReplyToTurn && image.error ? (
                                    <div className="relative inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => onReplyToTurn(selectedConversation.id, turn.id, image.error || "")}
                                        className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground ring-1 ring-border transition hover:bg-muted sm:px-3 sm:text-xs"
                                        aria-label="基于该提问继续回复"
                                      >
                                        <Reply className="size-3" />
                                        回复
                                      </button>
                                      <span
                                        tabIndex={0}
                                        role="button"
                                        aria-label="为什么需要点回复"
                                        className="peer inline-flex size-5 cursor-help items-center justify-center rounded-full text-muted-foreground ring-1 ring-border transition hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground focus:outline-none"
                                      >
                                        <Info className="size-3" />
                                      </span>
                                      <div
                                        role="tooltip"
                                        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-60 -translate-x-1/2 rounded-xl border border-border bg-card px-3 py-2 text-left text-[11px] leading-5 text-muted-foreground opacity-0 shadow-[0_2px_4px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.25)] transition peer-hover:opacity-100 peer-focus:opacity-100 sm:text-[12px]"
                                      >
                                        <p className="mb-1 font-medium text-foreground">为什么要点"回复"？</p>
                                        <p>
                                          图片接口本身没有上下文。点"回复"会把这一轮的提问与参考图一起带给模型；
                                          如果直接在下方输入框回答，模型只会当成一次新的画图请求，不知道你在回应它的反问。
                                        </p>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <LoadingCard
                            key={image.id}
                            createdAt={turn.createdAt}
                            status={turn.status}
                            onCancel={
                              onCancelImage
                                ? () => void onCancelImage(selectedConversation.id, image.id, image.taskId)
                                : undefined
                            }
                          />
                        );
                      })}
                    </div>
                  ) : null}

                  {turn.status === "error" && turn.error && !isQuotaError(turn.error) ? (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-stone-100 dark:bg-stone-800 px-3 py-1 text-[11px] text-stone-500 dark:text-stone-400 sm:mt-4 sm:text-xs">
                      <AlertCircle className="size-3 text-stone-400" />
                      <span>{turn.error}</span>
                    </div>
                  ) : null}

                  {isQuotaError(turn.error) || !hasRenderableImages ? null : (
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] sm:mt-4">
                      <button
                        type="button"
                        onClick={() => void onRegenerateTurn(selectedConversation.id, turn.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-white"
                      >
                        <RotateCcw className="size-3" />
                        全部重新生成
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const successImages = turn.images.filter((img) => img.status === "success");
                          if (successImages.length === 0) return;
                          toast.info("已触发批量下载本轮成功的图片");
                          successImages.forEach((img, idx) => {
                            void downloadStoredImage(img, idx);
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-white"
                        title="批量下载这一轮生成的全部成功图片"
                      >
                        <Download className="size-3" />
                        全部下载
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteResults(selectedConversation.id, turn.id)}
                        className="inline-flex size-6 items-center justify-center rounded-full text-stone-300 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30"
                        aria-label="删除生成结果"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

function getTurnStatusLabel(status: ImageTurnStatus) {
  if (status === "queued") {
    return "排队中";
  }
  if (status === "generating") {
    return "处理中";
  }
  if (status === "success") {
    return "已完成";
  }
  return "失败";
}

function formatBase64ImageSize(base64: string) {
  const normalized = base64.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const bytes = Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);

  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatImageDimensions(width: number, height: number) {
  return `${width} x ${height}`;
}
