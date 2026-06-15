"use client";

import { useEffect, useState, useMemo } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { fetchLocalUsers, type LocalUser } from "@/lib/api";

export default function UsersPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);
  const [items, setItems] = useState<LocalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((u) => u.username.toLowerCase().includes(q) || (u.bound_key_id && u.bound_key_id.toLowerCase().includes(q)));
  }, [items, searchQuery]);

  useEffect(() => {
    if (session?.role === "admin") {
      fetchLocalUsers()
        .then((res) => setItems(res.items))
        .catch(() => toast.error("加载失败"))
        .finally(() => setLoading(false));
    }
  }, [session]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Users</p>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-950">注册用户</h1>
          <p className="text-sm text-stone-500">
            通过邀请码注册的用户列表。调整额度请到「用户密钥」页面。
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-stone-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索用户名或密钥 ID..."
            className="pl-9 h-10 rounded-xl"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </div>
      ) : filteredItems.length === 0 ? (
        <p className="text-center text-stone-400 py-12">未找到匹配的用户</p>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((u) => (
            <Card key={u.id} className="rounded-2xl">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-full bg-stone-950 text-white text-sm font-bold">
                  {(u.username[0] || "U").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-stone-900">{u.username}</p>
                  <p className="text-[12px] text-stone-400">
                    密钥 ID: {u.bound_key_id} · 注册: {u.created_at.slice(0, 10)}
                  </p>
                </div>
                <a
                  href="/keys"
                  className="text-[13px] text-stone-500 hover:text-stone-900 transition-colors"
                >
                  管理密钥 →
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
