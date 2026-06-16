"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Download, X, Copy, Check } from "lucide-react";

import { cn } from "@/lib/utils";

type LightboxImage = {
  id: string;
  src: string;
  sizeLabel?: string;
  dimensions?: string;
  prompt?: string;
  revisedPrompt?: string;
  referenceSrc?: string;
};

type ImageLightboxProps = {
  images: LightboxImage[];
  currentIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIndexChange: (index: number) => void;
};

type ImageTransform = {
  scale: number;
  x: number;
  y: number;
};

type TouchGesture =
  | {
      type: "swipe";
      startX: number;
      startY: number;
    }
  | {
      type: "pan";
      startX: number;
      startY: number;
      startTransform: ImageTransform;
    }
  | {
      type: "pinch";
      startDistance: number;
      startCenterX: number;
      startCenterY: number;
      startTransform: ImageTransform;
    };

const minScale = 1;
const maxScale = 4;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getTouchDistance(touches: React.TouchList) {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function getTouchCenter(touches: React.TouchList) {
  const first = touches[0];
  const second = touches[1];
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

function normalizeTransform(transform: ImageTransform) {
  if (transform.scale <= minScale) {
    return { scale: minScale, x: 0, y: 0 };
  }

  const maxX = window.innerWidth * (transform.scale - 1) * 0.5;
  const maxY = window.innerHeight * (transform.scale - 1) * 0.5;
  return {
    scale: transform.scale,
    x: clamp(transform.x, -maxX, maxX),
    y: clamp(transform.y, -maxY, maxY),
  };
}

export function ImageLightbox({
  images,
  currentIndex,
  open,
  onOpenChange,
  onIndexChange,
}: ImageLightboxProps) {
  const [copied, setCopied] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [sliderPosition, setSliderPosition] = useState(50);

  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    setIsComparing(false);
    setAspectRatio(null);
  }, [currentIndex]);

  useEffect(() => {
    if (!open) {
      setIsComparing(false);
      setAspectRatio(null);
    }
  }, [open]);
  
  const handleCopyPrompt = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const gestureRef = useRef<TouchGesture | null>(null);
  const lastTapRef = useRef(0);
  const wheelLockRef = useRef(0);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pendingTransformRef = useRef<ImageTransform | null>(null);
  const rafRef = useRef<number | null>(null);
  const [transform, setTransform] = useState<ImageTransform>({ scale: 1, x: 0, y: 0 });
  const [isGesturing, setIsGesturing] = useState(false);
  const current = images[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  const cancelScheduledTransform = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingTransformRef.current = null;
  }, []);

  const scheduleTransform = useCallback((next: ImageTransform) => {
    pendingTransformRef.current = next;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingTransformRef.current;
      pendingTransformRef.current = null;
      if (pending) {
        setTransform(pending);
      }
    });
  }, []);

  const flushScheduledTransform = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingTransformRef.current;
    pendingTransformRef.current = null;
    if (pending) {
      setTransform(pending);
    }
  }, []);

  const resetTransform = useCallback(() => {
    cancelScheduledTransform();
    setTransform({ scale: 1, x: 0, y: 0 });
    setIsGesturing(false);
    gestureRef.current = null;
  }, [cancelScheduledTransform]);

  const goPrev = useCallback(() => {
    if (hasPrev) onIndexChange(currentIndex - 1);
  }, [hasPrev, currentIndex, onIndexChange]);

  const goNext = useCallback(() => {
    if (hasNext) onIndexChange(currentIndex + 1);
  }, [hasNext, currentIndex, onIndexChange]);

  useEffect(() => {
    resetTransform();
  }, [current?.id, open, resetTransform]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;

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
  }, [open, goPrev, goNext]);

  // 缩略图带：当前项滚动进可视区
  useEffect(() => {
    if (!open) return;
    const node = thumbRefs.current[currentIndex];
    if (node) {
      node.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [currentIndex, open]);

  // 鼠标滚轮切换：缩放态下不接管，节流到每 ~280ms 一次，避免触摸板瞬间狂切
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (transform.scale > minScale) return;
      const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (Math.abs(delta) < 8) return;
      const now = Date.now();
      if (now - wheelLockRef.current < 280) return;
      wheelLockRef.current = now;
      if (delta > 0) {
        goNext();
      } else {
        goPrev();
      }
    },
    [transform.scale, goPrev, goNext],
  );

  const handleDownload = useCallback(() => {
    if (!current) return;
    const link = document.createElement("a");
    link.href = current.src;
    link.download = `image-${current.id}.png`;
    link.click();
  }, [current]);

  const toggleZoom = useCallback(() => {
    setTransform((currentTransform) =>
      currentTransform.scale > minScale ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 },
    );
  }, []);

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        const startDistance = getTouchDistance(event.touches);
        if (startDistance < 1) {
          gestureRef.current = null;
          return;
        }
        const center = getTouchCenter(event.touches);
        cancelScheduledTransform();
        setIsGesturing(true);
        gestureRef.current = {
          type: "pinch",
          startDistance,
          startCenterX: center.x,
          startCenterY: center.y,
          startTransform: transform,
        };
        return;
      }

      if (event.touches.length !== 1) {
        gestureRef.current = null;
        return;
      }

      const touch = event.touches[0];
      if (transform.scale > minScale) {
        cancelScheduledTransform();
        setIsGesturing(true);
        gestureRef.current = {
          type: "pan",
          startX: touch.clientX,
          startY: touch.clientY,
          startTransform: transform,
        };
      } else {
        gestureRef.current = {
          type: "swipe",
          startX: touch.clientX,
          startY: touch.clientY,
        };
      }
    },
    [transform, cancelScheduledTransform],
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (!gesture) return;

      if (gesture.type === "pinch" && event.touches.length === 2) {
        event.preventDefault();
        const targetScale = clamp(
          (getTouchDistance(event.touches) / gesture.startDistance) * gesture.startTransform.scale,
          minScale,
          maxScale,
        );
        const effectiveRatio = targetScale / gesture.startTransform.scale;
        const center = getTouchCenter(event.touches);
        const viewportCenterX = window.innerWidth / 2;
        const viewportCenterY = window.innerHeight / 2;
        const nextX =
          center.x -
          viewportCenterX -
          (gesture.startCenterX - viewportCenterX - gesture.startTransform.x) * effectiveRatio;
        const nextY =
          center.y -
          viewportCenterY -
          (gesture.startCenterY - viewportCenterY - gesture.startTransform.y) * effectiveRatio;
        scheduleTransform(
          normalizeTransform({ scale: targetScale, x: nextX, y: nextY }),
        );
        return;
      }

      if (gesture.type === "pan" && event.touches.length === 1) {
        event.preventDefault();
        const touch = event.touches[0];
        scheduleTransform(
          normalizeTransform({
            scale: gesture.startTransform.scale,
            x: gesture.startTransform.x + touch.clientX - gesture.startX,
            y: gesture.startTransform.y + touch.clientY - gesture.startY,
          }),
        );
        return;
      }

      if (event.touches.length !== 1) {
        gestureRef.current = null;
      }
    },
    [scheduleTransform],
  );

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      flushScheduledTransform();
      setIsGesturing(false);

      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture) return;

      if (gesture.type !== "swipe" || event.changedTouches.length !== 1) {
        return;
      }

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      const now = Date.now();

      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10 && now - lastTapRef.current < 280) {
        event.preventDefault();
        lastTapRef.current = 0;
        toggleZoom();
        return;
      }
      lastTapRef.current = now;

      if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) {
        return;
      }

      if (deltaX > 0) {
        goPrev();
      } else {
        goNext();
      }
    },
    [goPrev, goNext, toggleZoom, flushScheduledTransform],
  );

  const handleTouchCancel = useCallback(() => {
    cancelScheduledTransform();
    setIsGesturing(false);
    gestureRef.current = null;
  }, [cancelScheduledTransform]);

  if (!current) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            图片预览
          </DialogPrimitive.Title>

          <div className="absolute top-[calc(env(safe-area-inset-top)+1rem)] right-4 z-10 flex items-center gap-2">
            {current.sizeLabel || current.dimensions ? (
              <span className="rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white/90">
                {[current.sizeLabel, current.dimensions].filter(Boolean).join(" · ")}
              </span>
            ) : null}
            {images.length > 1 && (
              <span className="rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white/90">
                {currentIndex + 1} / {images.length}
              </span>
            )}
            {current.referenceSrc && (
              <button
                type="button"
                onClick={() => {
                  setIsComparing((prev) => !prev);
                  setTransform({ scale: minScale, x: 0, y: 0 });
                }}
                className={cn(
                  "inline-flex h-9 px-3 items-center justify-center gap-1.5 rounded-full text-xs font-semibold transition shadow-md cursor-pointer",
                  isComparing
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-black/50 text-white/90 hover:bg-black/70",
                )}
                aria-label="对比原图"
              >
                <span>对比原图</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex size-9 items-center justify-center rounded-full bg-black/50 text-white/90 transition hover:bg-black/70"
              aria-label="下载图片"
            >
              <Download className="size-4" />
            </button>
            <DialogPrimitive.Close className="inline-flex size-9 items-center justify-center rounded-full bg-black/50 text-white/90 transition hover:bg-black/70">
              <X className="size-4" />
              <span className="sr-only">关闭</span>
            </DialogPrimitive.Close>
          </div>

          {images.length > 1 && (
            <div
              className="hide-scrollbar absolute top-1/2 left-3 z-10 hidden max-h-[80vh] w-[88px] -translate-y-1/2 flex-col gap-2 overflow-y-auto rounded-2xl bg-black/40 p-2 shadow-lg backdrop-blur-sm sm:flex"
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              {images.map((item, index) => (
                <button
                  key={item.id}
                  ref={(node) => {
                    thumbRefs.current[index] = node;
                  }}
                  type="button"
                  onClick={() => onIndexChange(index)}
                  className={cn(
                    "relative aspect-square w-full shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 transition",
                    index === currentIndex
                      ? "border-white/90"
                      : "border-transparent opacity-70 hover:opacity-100",
                  )}
                  aria-label={`第 ${index + 1} 张`}
                  aria-current={index === currentIndex}
                >
                  <img
                    src={item.src}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </button>
              ))}
            </div>
          )}

          <div
            className="flex h-full w-full touch-none items-center justify-center overflow-hidden"
            onClick={() => onOpenChange(false)}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
          >
            {isComparing && current.referenceSrc ? (
              <div
                className="relative max-h-[90vh] max-w-[90vw] w-full select-none overflow-hidden rounded-lg border border-white/10"
                style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : { aspectRatio: "1/1" }}
                onClick={(e) => e.stopPropagation()}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
                  setSliderPosition(pct);
                }}
                onTouchMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const touch = e.touches[0];
                  if (!touch) return;
                  const x = touch.clientX - rect.left;
                  const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
                  setSliderPosition(pct);
                }}
              >
                {/* Generated Image (After) - Underneath */}
                <img
                  src={current.src}
                  alt="After"
                  onLoad={(e) => {
                    setAspectRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight);
                  }}
                  className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                  draggable={false}
                />

                {/* Reference Image (Before) - On top, clipped */}
                <img
                  src={current.referenceSrc}
                  alt="Before"
                  className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                  style={{
                    clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`,
                  }}
                  draggable={false}
                />

                {/* Split Divider line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white cursor-ew-resize z-10 shadow-[0_0_10px_rgba(0,0,0,0.5)]"
                  style={{ left: `${sliderPosition}%` }}
                >
                  {/* Handle icon */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded-full bg-white text-black shadow-md border border-gray-200 text-xs font-bold font-sans select-none">
                    ↔
                  </div>
                </div>
              </div>
            ) : (
              <img
                src={current.src}
                alt=""
                className={cn(
                  "max-h-[90vh] max-w-[90vw] rounded-lg object-contain will-change-transform",
                  isGesturing ? "" : "transition-transform duration-150 ease-out",
                  transform.scale > minScale ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
                )}
                style={{
                  transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
                }}
                onLoad={(e) => {
                  setAspectRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight);
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  toggleZoom();
                }}
                draggable={false}
              />
            )}
          </div>

          {current.prompt && (
            <div
              className="absolute bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] left-1/2 z-10 w-[90vw] max-w-[640px] -translate-x-1/2 rounded-2xl bg-black/60 p-4 text-white shadow-lg backdrop-blur-md border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-1.5">
                <p className="text-xs font-semibold text-white/50">提示词 (Prompt)</p>
                <button
                  type="button"
                  onClick={() => handleCopyPrompt(current.prompt || "")}
                  className="inline-flex items-center gap-1 rounded bg-white/15 hover:bg-white/25 px-2 py-0.5 text-[10px] font-medium text-white transition cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="size-2.5" />
                      已复制
                    </>
                  ) : (
                    <>
                      <Copy className="size-2.5" />
                      复制
                    </>
                  )}
                </button>
              </div>
              <p className="text-[13px] leading-5 max-h-[80px] overflow-y-auto break-words select-text pr-1 text-white/90">
                {current.prompt}
              </p>
              {current.revisedPrompt && (
                <div className="mt-2 pt-2 border-t border-white/10">
                  <p className="text-xs font-semibold text-emerald-400/80 mb-1">优化后提示词 (Revised)</p>
                  <p className="text-xs leading-5 max-h-[60px] overflow-y-auto break-words italic select-text pr-1 text-white/80">
                    {current.revisedPrompt}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
