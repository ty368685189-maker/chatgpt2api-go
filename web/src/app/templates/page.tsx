"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Plus, Save, Trash2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

type PromptTemplate = {
  id: string;
  name: string;
  content: string;
};

const STORAGE_KEY = "chatgpt2api:prompt_templates";

export default function TemplatesPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin", "user"]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  
  // 用于追踪哪一个模板处于编辑状态及临时编辑内容
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          setTemplates(JSON.parse(raw));
        } else {
          setTemplates([]);
        }
      } catch {
        setTemplates([]);
      }
    }
  }, []);

  const saveToStorage = (list: PromptTemplate[]) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newContent.trim()) {
      toast.error("模板名称和提示词内容不能为空");
      return;
    }
    const newItem: PromptTemplate = {
      id: `custom-${Date.now()}`,
      name: newName.trim(),
      content: newContent.trim(),
    };
    const updated = [newItem, ...templates];
    setTemplates(updated);
    saveToStorage(updated);
    setNewName("");
    setNewContent("");
    toast.success("成功添加模板");
  };

  const handleDelete = (id: string) => {
    const updated = templates.filter((t) => t.id !== id);
    setTemplates(updated);
    saveToStorage(updated);
    if (editingId === id) {
      setEditingId(null);
    }
    toast.success("模板已删除");
  };

  const startEdit = (tpl: PromptTemplate) => {
    setEditingId(tpl.id);
    setEditName(tpl.name);
    setEditContent(tpl.content);
  };

  const handleUpdate = (id: string) => {
    if (!editName.trim() || !editContent.trim()) {
      toast.error("模板名称和提示词内容不能为空");
      return;
    }
    const updated = templates.map((t) =>
      t.id === id ? { ...t, name: editName.trim(), content: editContent.trim() } : t,
    );
    setTemplates(updated);
    saveToStorage(updated);
    setEditingId(null);
    toast.success("模板修改成功");
  };

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-1 sm:px-0">
      {/* 头部区域 */}
      <section className="mt-4 mb-6 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-data text-[10px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">
              Image · Prompt Templates
            </span>
            <span className="h-px w-8 bg-border" />
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground flex items-center gap-2">
            <BookOpen className="size-6 text-primary" />
            提示词模板管理
          </h1>
          <p className="text-[13px] text-muted-foreground">
            在这里增补、修改或删除您的自定义生图提示词模板。添加后的模板将自动出现在画图工作台的“模板”快捷下拉菜单中。
          </p>
        </div>
        <Link
          href="/image"
          className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition hover:bg-secondary/80 sm:h-10 sm:px-4"
        >
          <ArrowLeft className="size-4" />
          <span>返回生图</span>
        </Link>
      </section>

      {/* 主体布局 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 左侧：添加新模板表单 */}
        <section className="lg:col-span-1">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_4px_rgba(15,23,42,0.02)] flex flex-col gap-4">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Plus className="size-4 text-primary" />
              <h2 className="text-[15px] font-semibold text-foreground">添加新模板</h2>
            </div>
            <form onSubmit={handleAdd} className="flex flex-col gap-4">
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">模板名称</label>
                <input
                  type="text"
                  placeholder="例如：3D 动漫风格"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full h-10 rounded-lg border border-input bg-transparent px-3 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">提示词内容</label>
                <textarea
                  rows={6}
                  placeholder="输入提示词预设内容，例如：Beautiful 3D anime character..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full rounded-lg border border-input bg-transparent p-3 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none hide-scrollbar"
                />
              </div>
              <button
                type="submit"
                disabled={!newName.trim() || !newContent.trim()}
                className="w-full h-10 shrink-0 cursor-pointer rounded-lg bg-primary font-medium text-primary-foreground hover:bg-primary/95 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5 text-[13px]"
              >
                <Plus className="size-4" />
                <span>保存新模板</span>
              </button>
            </form>
          </div>
        </section>

        {/* 右侧：现有模板列表 */}
        <section className="lg:col-span-2 flex flex-col gap-4">
          {templates.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
              <BookOpen className="size-8 text-muted-foreground/30 mb-3" />
              <h3 className="text-[14px] font-semibold text-foreground">暂无提示词模板</h3>
              <p className="mt-1 text-[12px] text-muted-foreground max-w-sm">
                左侧表单可以添加自定义模板，方便在画图输入框中一键套用，提升生图效率。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {templates.map((tpl) => {
                const isEditing = editingId === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    className={cn(
                      "rounded-2xl border p-4 shadow-[0_2px_4px_rgba(15,23,42,0.01)] flex flex-col gap-3 transition-all bg-card",
                      isEditing ? "border-primary/50 ring-1 ring-primary/20" : "border-border hover:border-border/80 hover:shadow-md",
                    )}
                  >
                    {isEditing ? (
                      // 编辑态
                      <div className="flex flex-col gap-3 flex-1">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full h-9 rounded-md border border-input bg-transparent px-2.5 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <textarea
                          rows={4}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full rounded-md border border-input bg-transparent p-2.5 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none hide-scrollbar flex-1"
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setEditingId(null)}
                            className="h-8 px-3 rounded-md border border-border text-[12px] font-medium text-foreground hover:bg-secondary/85 transition"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => handleUpdate(tpl.id)}
                            className="h-8 px-3 rounded-md bg-primary text-[12px] font-medium text-primary-foreground hover:bg-primary/90 transition flex items-center gap-1"
                          >
                            <Save className="size-3.5" />
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      // 浏览态
                      <div className="flex flex-col gap-2.5 flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-[14px] font-semibold text-foreground truncate leading-normal" title={tpl.name}>
                            {tpl.name}
                          </h3>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => startEdit(tpl)}
                              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
                              title="编辑模板"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="size-3.5"
                              >
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDelete(tpl.id)}
                              className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                              title="删除模板"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-[12px] text-muted-foreground/90 leading-relaxed break-words line-clamp-4 flex-1">
                          {tpl.content}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
