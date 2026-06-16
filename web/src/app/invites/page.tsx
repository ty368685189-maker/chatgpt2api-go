"use client";

import { useEffect, useState } from "react";
import { Copy, LoaderCircle, Plus, Trash2, Image as ImageIcon, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { fetchInviteCodes, createInviteCode, deleteInviteCode, type InviteCode } from "@/lib/api";

export default function InvitesPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);
  const [items, setItems] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    maxUses: "100",
    imageDaily: "10",
    imageDailyUnl: false,
    imageMonthly: "310",
    imageMonthlyUnl: false,
    imageTotal: "100",
    imageTotalUnl: true,
    chatDaily: "0",
    chatDailyUnl: true,
    chatMonthly: "0",
    chatMonthlyUnl: true,
    chatTotal: "0",
    chatTotalUnl: true,
  });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const res = await fetchInviteCodes();
      setItems(res.items);
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.role === "admin") void load();
  }, [session]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await createInviteCode({
        max_uses: parseInt(form.maxUses) || 0,
        image_daily_quota: parseInt(form.imageDaily) || 0,
        image_daily_unlimited: form.imageDailyUnl,
        image_monthly_quota: parseInt(form.imageMonthly) || 0,
        image_monthly_unlimited: form.imageMonthlyUnl,
        image_total_quota: parseInt(form.imageTotal) || 0,
        image_total_unlimited: form.imageTotalUnl,
        chat_daily_quota: parseInt(form.chatDaily) || 0,
        chat_daily_unlimited: form.chatDailyUnl,
        chat_monthly_quota: parseInt(form.chatMonthly) || 0,
        chat_monthly_unlimited: form.chatMonthlyUnl,
        chat_total_quota: parseInt(form.chatTotal) || 0,
        chat_total_unlimited: form.chatTotalUnl,
      });
      setItems(res.items);
      setShowCreate(false);
      toast.success("邀请码已创建");
    } catch {
      toast.error("创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除这个邀请码？")) return;
    try {
      const res = await deleteInviteCode(id);
      setItems(res.items);
      toast.success("已删除");
    } catch {
      toast.error("删除失败");
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("已复制邀请码");
  };

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Invite Codes</p>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-950">邀请码管理</h1>
          <p className="text-sm text-stone-500">创建邀请码分享给用户，用户用邀请码注册后自动获得画图额度。</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)} className="rounded-xl">
          <Plus className="size-4 mr-1" />
          创建
        </Button>
      </div>

      {showCreate && (
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-4">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">最大使用次数</label>
                <Input
                  type="number"
                  value={form.maxUses}
                  onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                  className="h-10 rounded-xl max-w-xs border-input bg-background text-foreground"
                />
              </div>

              {/* 画图额度 */}
              <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex size-8 items-center justify-center rounded-full bg-card shadow-sm border border-border">
                    <ImageIcon className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">画图额度</h3>
                    <p className="text-xs text-muted-foreground">按生成图片张数计数。</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">日限额</label>
                    <div className="flex items-center gap-2">
                      <Input type="number" value={form.imageDaily} onChange={e => setForm({...form, imageDaily: e.target.value})} disabled={form.imageDailyUnl} className="h-9 rounded-lg border-input bg-background text-foreground" />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 cursor-pointer"><Checkbox checked={form.imageDailyUnl} onCheckedChange={c => setForm({...form, imageDailyUnl: !!c})} /> 不限</label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">月限额</label>
                    <div className="flex items-center gap-2">
                      <Input type="number" value={form.imageMonthly} onChange={e => setForm({...form, imageMonthly: e.target.value})} disabled={form.imageMonthlyUnl} className="h-9 rounded-lg border-input bg-background text-foreground" />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 cursor-pointer"><Checkbox checked={form.imageMonthlyUnl} onCheckedChange={c => setForm({...form, imageMonthlyUnl: !!c})} /> 不限</label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">总额度</label>
                    <div className="flex items-center gap-2">
                      <Input type="number" value={form.imageTotal} onChange={e => setForm({...form, imageTotal: e.target.value})} disabled={form.imageTotalUnl} className="h-9 rounded-lg border-input bg-background text-foreground" />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 cursor-pointer"><Checkbox checked={form.imageTotalUnl} onCheckedChange={c => setForm({...form, imageTotalUnl: !!c})} /> 不限</label>
                    </div>
                  </div>
                </div>
              </div>

              {/* 对话额度 */}
              <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex size-8 items-center justify-center rounded-full bg-card shadow-sm border border-border">
                    <MessageSquare className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">对话额度</h3>
                    <p className="text-xs text-muted-foreground">POST /api/chat/stream 每次请求扣 1。</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">日限额</label>
                    <div className="flex items-center gap-2">
                      <Input type="number" value={form.chatDaily} onChange={e => setForm({...form, chatDaily: e.target.value})} disabled={form.chatDailyUnl} className="h-9 rounded-lg border-input bg-background text-foreground" />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 cursor-pointer"><Checkbox checked={form.chatDailyUnl} onCheckedChange={c => setForm({...form, chatDailyUnl: !!c})} /> 不限</label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">月限额</label>
                    <div className="flex items-center gap-2">
                      <Input type="number" value={form.chatMonthly} onChange={e => setForm({...form, chatMonthly: e.target.value})} disabled={form.chatMonthlyUnl} className="h-9 rounded-lg border-input bg-background text-foreground" />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 cursor-pointer"><Checkbox checked={form.chatMonthlyUnl} onCheckedChange={c => setForm({...form, chatMonthlyUnl: !!c})} /> 不限</label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">总额度</label>
                    <div className="flex items-center gap-2">
                      <Input type="number" value={form.chatTotal} onChange={e => setForm({...form, chatTotal: e.target.value})} disabled={form.chatTotalUnl} className="h-9 rounded-lg border-input bg-background text-foreground" />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 cursor-pointer"><Checkbox checked={form.chatTotalUnl} onCheckedChange={c => setForm({...form, chatTotalUnl: !!c})} /> 不限</label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <Button onClick={() => void handleCreate()} disabled={creating} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 mt-4">
              {creating ? <LoaderCircle className="size-4 animate-spin mr-1" /> : null}
              确认创建
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-stone-400 py-12">暂无邀请码</p>
      ) : (
        <div className="space-y-3">
          {items.map((ic) => (
            <Card key={ic.id} className="rounded-2xl">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-[15px] font-bold font-mono text-stone-900">{ic.code}</code>
                    <button
                      onClick={() => copyCode(ic.code)}
                      className="p-1 rounded-md hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                  <p className="text-[12px] text-stone-400 mt-1">
                    已用 {ic.used_count} / {ic.max_uses} 次 · 每日 {ic.image_daily_quota} 张画图
                  </p>
                </div>
                <button
                  onClick={() => void handleDelete(ic.id)}
                  className="p-2 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <Trash2 className="size-4" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
