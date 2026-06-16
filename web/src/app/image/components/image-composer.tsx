"use client";
import { ArrowUp, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, CornerDownRight, ImagePlus, Infinity as InfinityIcon, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
} from "react";

import { ImageLightbox } from "@/components/image-lightbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

type SizeOption = { value: string; label: string; desc: string; w: number; h: number };
const SIZE_OPTIONS: SizeOption[] = [
  { value: "", label: "未指定", desc: "由模型自动决定", w: 0, h: 0 },
  { value: "1:1", label: "1:1", desc: "正方形", w: 22, h: 22 },
  { value: "16:9", label: "16:9", desc: "横版", w: 28, h: 16 },
  { value: "4:3", label: "4:3", desc: "横版", w: 24, h: 18 },
  { value: "3:4", label: "3:4", desc: "竖版", w: 18, h: 24 },
  { value: "9:16", label: "9:16", desc: "竖版", w: 16, h: 28 },
];

type ResolutionOption = { value: string; label: string; desc: string };
const RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: "", label: "自动", desc: "由上游决定" },
  { value: "1k", label: "1K", desc: "约 1024px" },
  { value: "2k", label: "2K", desc: "约 2048px" },
  { value: "4k", label: "4K", desc: "尽量超清" },
];

const TEXTAREA_MIN_HEIGHT = 96;
const TEXTAREA_MAX_HEIGHT = 360;

const hasImageItem = (event: DragEvent<HTMLDivElement>) => {
  const items = event.dataTransfer?.items;
  if (items && items.length > 0) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        return true;
      }
    }
    return false;
  }
  // Fallback：某些浏览器在 dragenter 阶段无法读 items.type，按 file 类型放行
  return Array.from(event.dataTransfer?.types || []).includes("Files");
};

type PromptTemplate = {
  id: string;
  name: string;
  content: string;
};

type ReplyTarget = {
  sourcePrompt: string;
  aiMessage: string;
};

type ImageComposerProps = {
  prompt: string;
  imageCount: string;
  imageSize: string;
  imageResolution: string;
  canUseHighResolution: boolean;
  availableQuota: string;
  activeTaskCount: number;
  referenceImages: Array<{ name: string; dataUrl: string }>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  replyTarget?: ReplyTarget | null;
  lastPrompt?: string;
  onCancelReply?: () => void;
  onPromptChange: (value: string) => void;
  onImageCountChange: (value: string) => void;
  onImageSizeChange: (value: string) => void;
  onImageResolutionChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onPickReferenceImage: () => void;
  onReferenceImageChange: (files: File[]) => void | Promise<void>;
  onRemoveReferenceImage: (index: number) => void;
  onReorderReferenceImages: (dragIndex: number, hoverIndex: number) => void;
  countOptions?: number[];
};

export function ImageComposer({
  prompt,
  imageCount,
  imageSize,
  imageResolution,
  canUseHighResolution,
  availableQuota,
  activeTaskCount,
  referenceImages,
  textareaRef,
  fileInputRef,
  replyTarget,
  lastPrompt,
  onCancelReply,
  onPromptChange,
  onImageCountChange,
  onImageSizeChange,
  onImageResolutionChange,
  onSubmit,
  onPickReferenceImage,
  onReferenceImageChange,
  onRemoveReferenceImage,
  onReorderReferenceImages,
  countOptions = [1, 2, 3, 4],
}: ImageComposerProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isSizeMenuOpen, setIsSizeMenuOpen] = useState(false);
  const [sizeMenuPos, setSizeMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [isResolutionMenuOpen, setIsResolutionMenuOpen] = useState(false);
  const [resolutionMenuPos, setResolutionMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [isCountMenuOpen, setIsCountMenuOpen] = useState(false);
  const [countMenuPos, setCountMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStartItem = useCallback((e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }, []);

  const handleDragOverItem = useCallback((e: React.DragEvent, index: number) => {
    if (draggedIndex === null) return;
    e.preventDefault();
    setDragOverIndex((prev) => (prev !== index ? index : prev));
  }, [draggedIndex]);

  const handleDragLeaveItem = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDropItem = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      return;
    }
    onReorderReferenceImages(draggedIndex, targetIndex);
    setDraggedIndex(null);
  }, [draggedIndex, onReorderReferenceImages]);

  const handleDragEndItem = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const dragCounterRef = useRef(0);
  const sizeMenuRef = useRef<HTMLDivElement>(null);
  const sizeMenuBtnRef = useRef<HTMLButtonElement>(null);
  const resolutionMenuRef = useRef<HTMLDivElement>(null);
  const resolutionMenuBtnRef = useRef<HTMLButtonElement>(null);
  const countMenuRef = useRef<HTMLDivElement>(null);
  const countMenuBtnRef = useRef<HTMLButtonElement>(null);

  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [templateMenuPos, setTemplateMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [newTemplateName, setNewTemplateName] = useState("");
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const templateMenuBtnRef = useRef<HTMLButtonElement>(null);

  const STORAGE_KEY = "chatgpt2api:prompt_templates";

  const DEFAULT_TEMPLATES: PromptTemplate[] = [];

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          setTemplates(JSON.parse(raw));
        } else {
          setTemplates([]);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
        }
      } catch {
        setTemplates([]);
      }
    }
  }, []);

  const saveTemplate = useCallback(() => {
    if (!prompt.trim() || !newTemplateName.trim()) return;
    const newTpl: PromptTemplate = {
      id: `custom-${Date.now()}`,
      name: newTemplateName.trim(),
      content: prompt.trim(),
    };
    const updated = [...templates, newTpl];
    setTemplates(updated);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
    setNewTemplateName("");
  }, [prompt, newTemplateName, templates]);

  const deleteTemplate = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = templates.filter((t) => t.id !== id);
    setTemplates(updated);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  }, [templates]);

  useEffect(() => {
    if (!isTemplateMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!templateMenuRef.current?.contains(event.target as Node)) {
        setIsTemplateMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isTemplateMenuOpen]);
  const lightboxImages = useMemo(
    () => referenceImages.map((image, index) => ({ id: `${image.name}-${index}`, src: image.dataUrl })),
    [referenceImages],
  );
  const selectedSize = SIZE_OPTIONS.find((option) => option.value === imageSize) ?? SIZE_OPTIONS[0];
  const selectedResolution = RESOLUTION_OPTIONS.find((option) => option.value === imageResolution) ?? RESOLUTION_OPTIONS[0];
  const parsedCount = Math.max(1, Math.min(8, Number(imageCount) || 1));
  const isResolutionDisabled = (value: string) => !canUseHighResolution && (value === "2k" || value === "4k");

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(
      textarea.scrollHeight,
      TEXTAREA_MAX_HEIGHT,
    );
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [prompt, replyTarget, referenceImages.length, textareaRef]);

  useEffect(() => {
    if (!isSizeMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!sizeMenuRef.current?.contains(event.target as Node)) {
        setIsSizeMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isSizeMenuOpen]);

  useEffect(() => {
    if (!isResolutionMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!resolutionMenuRef.current?.contains(event.target as Node)) {
        setIsResolutionMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isResolutionMenuOpen]);

  useEffect(() => {
    if (!isCountMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!countMenuRef.current?.contains(event.target as Node)) {
        setIsCountMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isCountMenuOpen]);

  useEffect(() => {
    const handleScroll = () => {
      setIsSizeMenuOpen(false);
      setIsResolutionMenuOpen(false);
      setIsCountMenuOpen(false);
      setIsTemplateMenuOpen(false);
    };
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, []);

  const handleTextareaPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    void onReferenceImageChange(imageFiles);
  }, [onReferenceImageChange]);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasImageItem(event)) {
      return;
    }
    event.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingOver(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasImageItem(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (dragCounterRef.current === 0) {
      return;
    }
    event.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    const imageFiles = Array.from(event.dataTransfer?.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    void onReferenceImageChange(imageFiles);
  }, [onReferenceImageChange]);

  return (
    <div className="shrink-0 flex justify-center px-1 sm:px-0">
      <div className="relative" style={{ width: "min(980px, 100%)" }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void onReferenceImageChange(Array.from(event.target.files || []));
          }}
        />

        {/* 缩略图行用 absolute 浮在 composer 输入框正上方，不占文档高度。
            否则空状态下加参考图会让 composer 区从 ~200px 长到 ~280px，
            results (flex-1) 被压缩 ~80px，items-center 居中的 hero 文案就被顶上去了。
            外层 relative 由父级 image-composer wrapper 提供（rounded-[28px] bg-white 那块）。
            移动端 (sm 以下) 横向滚动；桌面端 sm: 起 flex-wrap。 */}
        {referenceImages.length > 0 && !replyTarget ? (
          <div className="pointer-events-none absolute right-1 bottom-full left-1 z-10 sm:right-0 sm:left-0">
            <div className="pointer-events-auto mb-2 flex gap-2 overflow-x-auto px-1 pb-1 sm:mb-3 sm:flex-wrap sm:overflow-visible sm:pb-0">
              {referenceImages.map((image, index) => {
                const isDragged = draggedIndex === index;
                const isOver = dragOverIndex === index;
                return (
                  <div
                    key={`${image.name}-${index}`}
                    draggable={true}
                    onDragStart={(e) => handleDragStartItem(e, index)}
                    onDragOver={(e) => handleDragOverItem(e, index)}
                    onDragLeave={handleDragLeaveItem}
                    onDrop={(e) => handleDropItem(e, index)}
                    onDragEnd={handleDragEndItem}
                    className={cn(
                      "relative size-14 shrink-0 sm:size-16 transition-all duration-200 cursor-grab active:cursor-grabbing select-none",
                      isDragged && "opacity-30 scale-90",
                      isOver && "scale-105 ring-2 ring-primary ring-offset-2 ring-offset-background z-20 rounded-2xl"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setLightboxIndex(index);
                        setLightboxOpen(true);
                      }}
                      className="group size-14 overflow-hidden rounded-2xl border border-border bg-muted/30 transition hover:border-muted-foreground/30 sm:size-16"
                      aria-label={`预览参考图 ${image.name || index + 1}`}
                    >
                      <img
                        src={image.dataUrl}
                        alt={image.name || `参考图 ${index + 1}`}
                        className="h-full w-full object-cover pointer-events-none"
                      />
                    </button>
                    {referenceImages.length > 1 && index > 0 && (
                      <button
                        type="button"
                        draggable={false}
                        onDragStart={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onReorderReferenceImages(index, index - 1);
                        }}
                        className="absolute left-0.5 top-1/2 -translate-y-1/2 flex size-4.5 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80 active:scale-90 z-20 shadow-[0_2px_4px_rgba(0,0,0,0.2)]"
                        title="向前移动"
                      >
                        <ChevronLeft className="size-3" />
                      </button>
                    )}
                    {referenceImages.length > 1 && index < referenceImages.length - 1 && (
                      <button
                        type="button"
                        draggable={false}
                        onDragStart={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onReorderReferenceImages(index, index + 1);
                        }}
                        className="absolute right-0.5 top-1/2 -translate-y-1/2 flex size-4.5 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80 active:scale-90 z-20 shadow-[0_2px_4px_rgba(0,0,0,0.2)]"
                        title="向后移动"
                      >
                        <ChevronRight className="size-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      draggable={false}
                      onDragStart={(e) => e.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveReferenceImage(index);
                      }}
                      className="absolute -right-1 -top-1 inline-flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:bg-secondary hover:text-foreground relative after:absolute after:inset-[-8px] after:content-['']"
                      aria-label={`移除参考图 ${image.name || index + 1}`}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "relative overflow-hidden rounded-[28px] bg-card border border-border/60 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_24px_rgba(15,23,42,0.08)] transition sm:rounded-[32px]",
            activeTaskCount > 0 && "image-composer-running",
            isDraggingOver && "ring-2 ring-ring ring-offset-2 ring-offset-background",
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div
            className="relative cursor-text"
            onClick={() => {
              textareaRef.current?.focus();
            }}
          >
            <ImageLightbox
              images={lightboxImages}
              currentIndex={lightboxIndex}
              open={lightboxOpen}
              onOpenChange={setLightboxOpen}
              onIndexChange={setLightboxIndex}
            />
            {replyTarget ? (
              <div
                className="mx-3 mt-3 flex items-start gap-2 rounded-2xl border border-border bg-secondary/30 px-3 py-2 sm:mx-5 sm:mt-4"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-border">
                  <CornerDownRight className="size-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <span>正在回复 AI 的提问</span>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="text-muted-foreground/60">无需粘贴原文，模型会自动收到上下文</span>
                  </div>
                  {replyTarget.aiMessage ? (
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-foreground/80 sm:text-[13px]">
                      {replyTarget.aiMessage}
                    </p>
                  ) : null}
                </div>
                {onCancelReply ? (
                  <button
                    type="button"
                    onClick={onCancelReply}
                    className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground relative after:absolute after:inset-[-8px] after:content-['']"
                    aria-label="取消回复"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ) : null}
            {referenceImages.length > 0 && !replyTarget ? (
              <div
                className="mx-3 mt-3 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-500/10 px-3 py-2 sm:mx-5 sm:mt-4 text-amber-700 dark:text-amber-400 dark:border-amber-900/50"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-card text-amber-600 dark:text-amber-400 ring-1 ring-border">
                  <Sparkles className="size-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium">
                    <span>已开启编辑模式 (图生图)</span>
                    <span className="text-amber-500/30">·</span>
                    <span className="text-muted-foreground/60">将基于上方参考图修改画面</span>
                  </div>
                </div>
                {onCancelReply ? (
                  <button
                    type="button"
                    onClick={onCancelReply}
                    className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground relative after:absolute after:inset-[-8px] after:content-['']"
                    title="取消编辑"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ) : null}
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onPaste={handleTextareaPaste}
              maxLength={1000}
              placeholder={
                replyTarget
                  ? "输入你的回答…"
                  : referenceImages.length > 0
                    ? "描述你希望如何修改参考图"
                    : "输入你想要生成的画面，也可直接粘贴图片"
              }
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                
                if (event.key === "ArrowUp" && !prompt) {
                  event.preventDefault();
                  if (lastPrompt) {
                    onPromptChange(lastPrompt);
                  }
                  return;
                }

                if (event.key === "Enter") {
                  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
                  const isForceSubmit = event.ctrlKey || event.metaKey;
                  
                  if (isForceSubmit || (!event.shiftKey && !isMobile)) {
                    event.preventDefault();
                    void onSubmit();
                  }
                }
              }}
              className="hide-scrollbar min-h-[82px] resize-none overflow-hidden rounded-[24px] border-0 bg-transparent pl-4 pr-10 pt-4 pb-4 text-base sm:text-[15px] leading-6 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 sm:min-h-[96px] sm:rounded-[32px] sm:pl-6 sm:pr-12 sm:pt-6 sm:pb-4 sm:leading-7"
            />
            {prompt ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPromptChange("");
                  textareaRef.current?.focus();
                }}
                className="absolute right-4 top-4 z-10 flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground/40 hover:bg-secondary hover:text-foreground transition-colors sm:right-6 sm:top-6 relative after:absolute after:inset-[-8px] after:content-['']"
                aria-label="清空提示词"
              >
                <X className="size-4" />
              </button>
            ) : null}

            <div className="rounded-b-[24px] border-t border-border bg-card px-3 pb-3 pt-2 sm:border-t-0 sm:px-6 sm:pb-5 sm:pt-3" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-end justify-between gap-2 sm:gap-3">
                <div className="hide-scrollbar flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:gap-3 sm:overflow-visible sm:pb-0">
                  <button
                    type="button"
                    className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-secondary px-3 text-[12px] font-medium text-secondary-foreground transition hover:bg-secondary/80 sm:h-10 sm:gap-2 sm:px-4 sm:text-[13px]"
                    onClick={onPickReferenceImage}
                    aria-label={referenceImages.length > 0 ? "添加参考图" : "上传参考图"}
                  >
                    <ImagePlus className="size-3.5 sm:size-4" strokeWidth={2} />
                    <span>{referenceImages.length > 0 ? "添加" : "上传"}</span>
                  </button>
                  <span className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-secondary px-3 text-[12px] font-medium text-muted-foreground sm:h-10 sm:px-3.5 sm:text-[13px]">
                    <span className="hidden sm:inline">剩余</span>
                    {availableQuota === "∞" ? (
                      <InfinityIcon className="size-3.5 text-foreground sm:size-4" strokeWidth={2.25} aria-label="不限额度" />
                    ) : (
                      <span className="font-data tabular-nums text-foreground">{availableQuota}</span>
                    )}
                  </span>
                  
                  <div className="relative shrink-0">
                    <button
                      ref={templateMenuBtnRef}
                      type="button"
                      className={cn(
                        "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition sm:h-10 sm:gap-2 sm:px-4 sm:text-[13px]",
                        isTemplateMenuOpen
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                      )}
                      onClick={() => {
                        setIsSizeMenuOpen(false);
                        setIsResolutionMenuOpen(false);
                        setIsCountMenuOpen(false);
                        if (!isTemplateMenuOpen && templateMenuBtnRef.current) {
                          const rect = templateMenuBtnRef.current.getBoundingClientRect();
                          const menuWidth = Math.min(280, window.innerWidth - 32);
                          setTemplateMenuPos({
                            top: rect.top - 8,
                            left: Math.max(16, Math.min(rect.left, window.innerWidth - menuWidth - 16)),
                          });
                        }
                        setIsTemplateMenuOpen((open) => !open);
                      }}
                    >
                      <BookOpen className="size-3.5 shrink-0 opacity-80" strokeWidth={2} />
                      <span>模板</span>
                      <ChevronDown
                        className={cn(
                          "size-3.5 shrink-0 opacity-60 transition",
                          isTemplateMenuOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {isTemplateMenuOpen ? (
                      <div
                        ref={templateMenuRef}
                        className="fixed z-[80] rounded-2xl border border-border bg-card p-3 shadow-[0_2px_4px_rgba(15,23,42,0.04),0_24px_48px_-16px_rgba(15,23,42,0.18)] flex flex-col gap-2.5 max-h-[50dvh] overflow-y-auto hide-scrollbar"
                        style={{
                          top: templateMenuPos.top,
                          left: templateMenuPos.left,
                          transform: "translateY(-100%)",
                          width: "min(280px, calc(100vw - 2rem))",
                        }}
                      >
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[11px] font-medium text-muted-foreground">提示词模板</span>
                          <Link
                            href="/templates"
                            className="text-[11px] font-medium text-primary hover:underline transition-colors"
                            onClick={() => setIsTemplateMenuOpen(false)}
                          >
                            管理模板
                          </Link>
                        </div>
                        <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto pr-1 hide-scrollbar">
                          {templates.length === 0 ? (
                            <div className="text-[12px] text-muted-foreground py-4 text-center">
                              暂无模板，在下方保存新模板
                            </div>
                          ) : (
                            templates.map((tpl) => (
                              <div
                                key={tpl.id}
                                className="group/item flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-secondary text-left transition cursor-pointer"
                                onClick={() => {
                                  onPromptChange(tpl.content);
                                  setIsTemplateMenuOpen(false);
                                  textareaRef.current?.focus();
                                }}
                              >
                                <div className="min-w-0 flex-1 pr-2">
                                  <div className="text-[13px] font-medium text-foreground truncate">{tpl.name}</div>
                                  <div className="text-[11px] text-muted-foreground truncate leading-normal">{tpl.content}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => deleteTemplate(tpl.id, e)}
                                  className="opacity-0 group-hover/item:opacity-100 p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all shrink-0"
                                  title="删除模板"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                        <div className="border-t border-border pt-2.5 mt-0.5 flex flex-col gap-2">
                          <div className="text-[11px] font-medium text-muted-foreground px-1">保存当前输入为模板</div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="模板名称"
                              value={newTemplateName}
                              onChange={(e) => setNewTemplateName(e.target.value)}
                              className="flex-1 h-8 rounded-lg border border-input bg-transparent px-2.5 text-[12px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  saveTemplate();
                                }
                              }}
                            />
                            <button
                              type="button"
                              disabled={!prompt.trim() || !newTemplateName.trim()}
                              onClick={saveTemplate}
                              className="h-8 shrink-0 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="relative shrink-0">
                    <button
                      ref={countMenuBtnRef}
                      type="button"
                      className={cn(
                        "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition sm:h-10 sm:gap-2 sm:px-4 sm:text-[13px]",
                        isCountMenuOpen
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                      )}
                      onClick={() => {
                        setIsSizeMenuOpen(false);
                        setIsResolutionMenuOpen(false);
                        setIsTemplateMenuOpen(false);
                        if (!isCountMenuOpen && countMenuBtnRef.current) {
                          const rect = countMenuBtnRef.current.getBoundingClientRect();
                          const menuWidth = Math.min(212, window.innerWidth - 32);
                          setCountMenuPos({
                            top: rect.top - 8,
                            left: Math.max(16, Math.min(rect.left, window.innerWidth - menuWidth - 16)),
                          });
                        }
                        setIsCountMenuOpen((open) => !open);
                      }}
                    >
                      <span className={cn("hidden sm:inline", isCountMenuOpen ? "text-primary-foreground/75" : "text-muted-foreground")}>张数</span>
                      <span className="font-data tabular-nums">{parsedCount}</span>
                      <ChevronDown
                        className={cn(
                          "size-3.5 shrink-0 opacity-60 transition",
                          isCountMenuOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {isCountMenuOpen ? (
                      <div
                        ref={countMenuRef}
                        className="fixed z-[80] rounded-2xl border border-border bg-card p-2 shadow-[0_2px_4px_rgba(15,23,42,0.04),0_24px_48px_-16px_rgba(15,23,42,0.18)]"
                        style={{
                          top: countMenuPos.top,
                          left: countMenuPos.left,
                          transform: "translateY(-100%)",
                          width: "min(212px, calc(100vw - 2rem))",
                        }}
                      >
                        <div className="mb-1.5 px-1.5 pt-0.5 text-[11px] font-medium text-muted-foreground">生成数量</div>
                        <div className="grid grid-cols-4 gap-1.5">
                           {countOptions.map((value) => {
                             const active = value === parsedCount;
                             return (
                               <button
                                 key={value}
                                 type="button"
                                 className={cn(
                                   "flex h-9 cursor-pointer items-center justify-center rounded-lg font-data text-[13px] tabular-nums transition",
                                   active
                                     ? "bg-primary font-semibold text-primary-foreground"
                                     : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                                 )}
                                 onClick={() => {
                                   onImageCountChange(String(value));
                                   setIsCountMenuOpen(false);
                                 }}
                               >
                                {value}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="relative shrink-0">
                    <button
                      ref={sizeMenuBtnRef}
                      type="button"
                      className={cn(
                        "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition sm:h-10 sm:gap-2 sm:px-4 sm:text-[13px]",
                        isSizeMenuOpen
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                      )}
                      onClick={() => {
                        setIsCountMenuOpen(false);
                        setIsResolutionMenuOpen(false);
                        setIsTemplateMenuOpen(false);
                        if (!isSizeMenuOpen && sizeMenuBtnRef.current) {
                          const rect = sizeMenuBtnRef.current.getBoundingClientRect();
                          const menuWidth = Math.min(300, window.innerWidth - 32);
                          setSizeMenuPos({
                            top: rect.top - 8,
                            left: Math.max(16, Math.min(rect.left, window.innerWidth - menuWidth - 16)),
                          });
                        }
                        setIsSizeMenuOpen((open) => !open);
                      }}
                    >
                      <span className={cn("hidden sm:inline", isSizeMenuOpen ? "text-primary-foreground/75" : "text-muted-foreground")}>比例</span>
                      {selectedSize.value ? (
                        <span
                          className={cn(
                            "inline-block shrink-0 rounded-[3px] border",
                            isSizeMenuOpen ? "border-primary-foreground/60 bg-primary-foreground/20" : "border-muted-foreground/60 bg-muted",
                          )}
                          style={{
                            width: `${selectedSize.w * 0.45}px`,
                            height: `${selectedSize.h * 0.45}px`,
                          }}
                          aria-hidden
                        />
                      ) : null}
                      <span className="font-data tabular-nums">{selectedSize.value || "未指定"}</span>
                      <ChevronDown
                        className={cn(
                          "size-3.5 shrink-0 opacity-60 transition",
                          isSizeMenuOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {isSizeMenuOpen ? (
                      <div
                        ref={sizeMenuRef}
                        className="fixed z-[80] rounded-2xl border border-border bg-card p-2.5 shadow-[0_2px_4px_rgba(15,23,42,0.04),0_24px_48px_-16px_rgba(15,23,42,0.18)]"
                        style={{
                          top: sizeMenuPos.top,
                          left: sizeMenuPos.left,
                          transform: "translateY(-100%)",
                          width: "min(300px, calc(100vw - 2rem))",
                        }}
                      >
                        <div className="mb-2 px-1 text-[11px] font-semibold text-muted-foreground">画面比例</div>
                        <div className="grid grid-cols-3 gap-2">
                          {SIZE_OPTIONS.map((option) => {
                            const active = option.value === imageSize;
                            return (
                              <button
                                key={option.label}
                                type="button"
                                className={cn(
                                  "relative flex flex-col items-center justify-center rounded-xl p-2 transition border cursor-pointer",
                                  active
                                    ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                    : "border-border/60 bg-secondary/35 text-foreground hover:bg-secondary hover:text-foreground",
                                )}
                                onClick={() => {
                                  onImageSizeChange(option.value);
                                  setIsSizeMenuOpen(false);
                                }}
                              >
                                {/* aspect ratio shape preview */}
                                <div className="flex h-11 w-full items-center justify-center mb-1.5">
                                  {option.value ? (
                                    <div
                                      className={cn(
                                        "rounded-[4px] border shadow-sm transition-all duration-200",
                                        active
                                          ? "border-primary-foreground bg-primary-foreground/20 scale-105"
                                          : "border-muted-foreground/60 bg-muted-foreground/5",
                                      )}
                                      style={{
                                        width: `${option.w * 1.1}px`,
                                        height: `${option.h * 1.1}px`,
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className={cn(
                                        "size-6 rounded-[4px] border border-dashed transition-all",
                                        active ? "border-primary-foreground/85 scale-105" : "border-stone-400/70",
                                      )}
                                    />
                                  )}
                                </div>
                                <span className="font-data text-[12px] font-bold tracking-tight">{option.label}</span>
                                <span
                                  className={cn(
                                    "text-[9px] mt-0.5 opacity-80 whitespace-nowrap",
                                    active ? "text-primary-foreground/90" : "text-muted-foreground",
                                  )}
                                >
                                  {option.desc}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="relative shrink-0">
                    <button
                      ref={resolutionMenuBtnRef}
                      type="button"
                      className={cn(
                        "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition sm:h-10 sm:gap-2 sm:px-4 sm:text-[13px]",
                        isResolutionMenuOpen
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                      )}
                      onClick={() => {
                        setIsCountMenuOpen(false);
                        setIsSizeMenuOpen(false);
                        setIsTemplateMenuOpen(false);
                        if (!isResolutionMenuOpen && resolutionMenuBtnRef.current) {
                          const rect = resolutionMenuBtnRef.current.getBoundingClientRect();
                          const menuWidth = Math.min(220, window.innerWidth - 32);
                          setResolutionMenuPos({
                            top: rect.top - 8,
                            left: Math.max(16, Math.min(rect.left, window.innerWidth - menuWidth - 16)),
                          });
                        }
                        setIsResolutionMenuOpen((open) => !open);
                      }}
                    >
                      <span className={cn("hidden sm:inline", isResolutionMenuOpen ? "text-primary-foreground/75" : "text-muted-foreground")}>清晰度</span>
                      <span className="font-data tabular-nums">{selectedResolution.label}</span>
                      <ChevronDown
                        className={cn(
                          "size-3.5 shrink-0 opacity-60 transition",
                          isResolutionMenuOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {isResolutionMenuOpen ? (
                      <div
                        ref={resolutionMenuRef}
                        className="fixed z-[80] max-h-[55dvh] overflow-y-auto rounded-2xl border border-border bg-card p-1.5 shadow-[0_2px_4px_rgba(15,23,42,0.04),0_24px_48px_-16px_rgba(15,23,42,0.18)]"
                        style={{
                          top: resolutionMenuPos.top,
                          left: resolutionMenuPos.left,
                          transform: "translateY(-100%)",
                          width: "min(220px, calc(100vw - 2rem))",
                        }}
                      >
                        <div className="mb-1 px-2 pt-1 text-[11px] font-medium text-muted-foreground">目标清晰度</div>
                        {RESOLUTION_OPTIONS.map((option) => {
                          const active = option.value === imageResolution;
                          const disabled = isResolutionDisabled(option.value);
                          return (
                            <button
                              key={option.label}
                              type="button"
                              disabled={disabled}
                              className={cn(
                                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition",
                                disabled && "cursor-not-allowed opacity-40",
                                !disabled && "cursor-pointer",
                                active ? "bg-primary text-primary-foreground" : "text-foreground",
                                !active && !disabled && "hover:bg-secondary",
                              )}
                              onClick={() => {
                                if (disabled) return;
                                onImageResolutionChange(option.value);
                                setIsResolutionMenuOpen(false);
                              }}
                            >
                              <span
                                className={cn(
                                  "font-data flex h-8 w-10 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold tabular-nums",
                                  active ? "bg-white/10 text-white" : "bg-secondary text-foreground",
                                )}
                              >
                                {option.label}
                              </span>
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="text-[13px] font-semibold">{option.label}</span>
                                <span
                                  className={cn(
                                    "truncate text-[11px]",
                                    active ? "text-primary-foreground/75" : "text-muted-foreground",
                                  )}
                                >
                                  {option.desc}
                                </span>
                              </span>
                              {active ? <Check className="size-3.5 shrink-0" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                </div>

                <div className="flex items-center gap-2">
                  {prompt.length > 0 && (
                    <span className="mb-2 mr-1 text-[11px] tabular-nums text-muted-foreground select-none sm:mb-2.5 sm:mr-2">
                      {prompt.length} / 1000
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void onSubmit()}
                    disabled={!prompt.trim() || prompt.length > 1000}
                    className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(15,23,42,0.1),0_4px_12px_-2px_rgba(15,23,42,0.2)] transition hover:bg-primary/90 hover:shadow-[0_1px_2px_rgba(15,23,42,0.1),0_8px_20px_-4px_rgba(15,23,42,0.3)] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                    aria-label={referenceImages.length > 0 ? "编辑图片" : "生成图片"}
                  >
                    <ArrowUp className="size-3.5 sm:size-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="hidden sm:flex items-center justify-center gap-1.5 mt-2 text-[11px] text-muted-foreground/60 select-none">
          <span>Enter 发送</span>
          <span>·</span>
          <span>Shift+Enter 换行</span>
          <span>·</span>
          <span>↑ 召回上次提示词</span>
        </div>
      </div>
    </div>
  );
}
