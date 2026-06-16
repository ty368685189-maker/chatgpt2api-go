"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, MessageSquarePlus, Pencil, Search, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getImageConversationStats, type ImageConversation } from "@/store/image-conversations";

function getConversationThumbnail(conversation: ImageConversation): string | null {
  for (const turn of conversation.turns) {
    if (turn.resultsDeleted) continue;
    for (const img of turn.images) {
      if (img.status === "success") {
        if (img.b64_json) {
          return `data:image/png;base64,${img.b64_json}`;
        }
        if (img.url) {
          const match = img.url.match(/\/images\/(.+)$/);
          const rel = match ? match[1] : img.url.replace(/^\/images\//, "");
          if (rel && !rel.startsWith("http")) {
            return `/image-thumbnails/${rel}`;
          }
          return img.url;
        }
      }
    }
  }
  return null;
}

type ImageSidebarProps = {
  conversations: ImageConversation[];
  isLoadingHistory: boolean;
  selectedConversationId: string | null;
  onCreateDraft: () => void;
  onClearHistory: () => void | Promise<void>;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void | Promise<void>;
  onRenameConversation: (id: string, title: string) => void | Promise<void>;
  formatConversationTime: (value: string) => string;
  hideActionButtons?: boolean;
};

export function ImageSidebar({
  conversations,
  isLoadingHistory,
  selectedConversationId,
  onCreateDraft,
  onClearHistory,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  formatConversationTime,
  hideActionButtons = false,
}: ImageSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const query = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(query) ||
        c.turns.some((t) => t.prompt.toLowerCase().includes(query))
    );
  }, [conversations, searchQuery]);

  const stats = useMemo(() => {
    let total = 0;
    let success = 0;
    for (const conv of conversations) {
      for (const turn of conv.turns) {
        if (turn.resultsDeleted) continue;
        for (const img of turn.images) {
          total++;
          if (img.status === "success") {
            success++;
          }
        }
      }
    }
    const rate = total > 0 ? Math.round((success / total) * 100) : 0;
    return { total, success, rate };
  }, [conversations]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startRename = useCallback((conversation: ImageConversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  }, []);

  const commitRename = useCallback(() => {
    const trimmed = editingTitle.trim();
    if (editingId && trimmed) {
      void onRenameConversation(editingId, trimmed);
    }
    setEditingId(null);
    setEditingTitle("");
  }, [editingId, editingTitle, onRenameConversation]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditingTitle("");
  }, []);
  return (
    <aside className="h-full min-h-0 overflow-hidden flex flex-col justify-between">
      <div className="flex flex-1 min-h-0 flex-col gap-2 py-1 sm:gap-3 sm:py-2">
        {!hideActionButtons && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button className="h-10 flex-1 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={onCreateDraft}>
                <MessageSquarePlus className="size-4" />
                新建对话
              </Button>
            </div>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索历史会话或提示词..."
                className="w-full h-9 rounded-lg border border-input bg-background pl-8 pr-8 text-xs outline-none text-foreground focus:ring-1 focus:ring-ring focus:border-ring placeholder:text-muted-foreground/60"
              />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 flex items-center justify-center rounded-full text-muted-foreground/50 hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        )}

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(120,113,108,.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-400/45 [&::-webkit-scrollbar-track]:bg-transparent",
            hideActionButtons ? "space-y-1 pr-0" : "space-y-2 pr-1",
          )}
        >
          {isLoadingHistory ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在读取会话记录
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="px-2 py-3 text-sm leading-6 text-muted-foreground">
              {searchQuery ? "未找到相关的会话记录" : "还没有图片记录，输入提示词后会在这里显示。"}
            </div>
          ) : (
            filteredConversations.map((conversation) => {
              const active = conversation.id === selectedConversationId;
              const stats = getImageConversationStats(conversation);
              const thumbnailUrl = getConversationThumbnail(conversation);
              return (
                <div
                  key={conversation.id}
                  className={cn(
                    "group relative w-full border-l-2 text-left transition",
                    hideActionButtons ? "px-4 py-3.5" : "px-3 py-2 sm:py-3",
                    active
                      ? "border-primary bg-secondary text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectConversation(conversation.id)}
                    className="flex items-center gap-2.5 w-full pr-8 text-left"
                  >
                    <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted border border-border/40 flex items-center justify-center select-none">
                      {thumbnailUrl ? (
                        <img
                          src={thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40 font-medium">无图</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={cn("truncate font-semibold", hideActionButtons ? "text-base" : "text-sm")}>
                        {editingId === conversation.id ? (
                          <input
                            ref={editInputRef}
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename();
                              if (e.key === "Escape") cancelRename();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full truncate rounded border border-input bg-background px-1 py-0.5 text-sm outline-none text-foreground focus:ring-1 focus:ring-ring"
                          />
                        ) : (
                          <span className="truncate">{conversation.title}</span>
                        )}
                      </div>
                      <div className={cn("mt-1 text-xs", active ? "text-muted-foreground" : "text-muted-foreground/60")}>
                        {conversation.turns.length} 轮 · {formatConversationTime(conversation.updatedAt)}
                      </div>
                      {stats.running > 0 || stats.queued > 0 ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                          {stats.running > 0 ? (
                            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-500 dark:text-blue-400">处理中 {stats.running}</span>
                          ) : null}
                          {stats.queued > 0 ? (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-500 dark:text-amber-400">排队 {stats.queued}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </button>
                  <div className="absolute top-2.5 right-1.5 flex items-center gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => startRename(conversation, e)}
                      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="重命名会话"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteConversation(conversation.id)}
                      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-rose-500"
                      aria-label="删除会话"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      {(conversations.length > 0 || !hideActionButtons) && (
        <div className="pt-2 border-t border-border/40 shrink-0 flex flex-col gap-2">
          {conversations.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-muted/40 p-2.5 backdrop-blur-sm">
              <div className="text-[10px] font-semibold text-muted-foreground/80 mb-1.5 px-0.5">历史生图数据</div>
              <div className="grid grid-cols-3 gap-1 text-center">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-foreground font-data tabular-nums">{stats.total}</span>
                  <span className="text-[9px] text-muted-foreground/75">总生图数</span>
                </div>
                <div className="flex flex-col border-x border-border/40">
                  <span className="text-sm font-bold text-emerald-500 font-data tabular-nums">{stats.success}</span>
                  <span className="text-[9px] text-muted-foreground/75">成功张数</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-blue-500 font-data tabular-nums">{stats.rate}%</span>
                  <span className="text-[9px] text-muted-foreground/75">成功率</span>
                </div>
              </div>
            </div>
          )}
          {!hideActionButtons && conversations.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => void onClearHistory()}
              className="w-full justify-start h-8 px-3 text-xs text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-lg"
            >
              <Trash2 className="size-3.5 mr-2" />
              清空所有对话历史
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
