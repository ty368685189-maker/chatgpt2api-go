"use client";

import { useEffect, useState } from "react";
import { X, LoaderCircle, RefreshCw } from "lucide-react";
import { fetchSystemAnnouncement, fetchSystemPoolStatus, type AnnouncementConfig, type SystemPoolStatus } from "@/lib/api";
import { usePathname } from "next/navigation";

const STORAGE_KEY_VERSION = "announcement_dismissed_version";
const STORAGE_KEY_TODAY = "announcement_dismissed_today";

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function useAnnouncement() {
  const [ann, setAnn] = useState<AnnouncementConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSystemAnnouncement()
      .then((data) => setAnn(data))
      .catch((err) => console.error("Failed to load announcement:", err))
      .finally(() => setLoading(false));
  }, []);

  return { ann, loading };
}

function PoolStatusWidget() {
  const [status, setStatus] = useState<SystemPoolStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = () => {
    setRefreshing(true);
    fetchSystemPoolStatus()
      .then(setStatus)
      .catch(console.error)
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    loadStatus();
  }, []);

  if (!status) return null;

  const { total_1h, success_1h, avg_latency_ms } = status;
  const successRatio = total_1h > 0 ? success_1h / total_1h : 1;
  const percentage = Math.round(successRatio * 100);
  
  let indicatorColor = "bg-green-500";
  if (total_1h > 0 && successRatio < 0.5) indicatorColor = "bg-red-500";
  else if (total_1h > 0 && successRatio < 0.8) indicatorColor = "bg-orange-500";

  return (
    <div className="flex items-center justify-between bg-stone-50 rounded-xl p-3 border border-stone-100 group">
      <div className="flex items-center gap-2">
        <div className="relative flex h-3 w-3">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${indicatorColor}`}></span>
          <span className={`relative inline-flex rounded-full h-3 w-3 ${indicatorColor}`}></span>
        </div>
        <span className="text-[13px] font-medium text-stone-700">生图成功率 (一小时内)</span>
      </div>
      <div className="text-[12px] text-stone-500 flex items-center gap-3">
        <span>调用: <span className="text-stone-700 font-semibold">{total_1h}</span></span>
        <span>成功: <span className="text-stone-700 font-semibold">{success_1h}</span></span>
        <span>成功率: <span className="text-stone-700 font-semibold">{percentage}%</span></span>
        <span>耗时: <span className="text-stone-700 font-semibold">{avg_latency_ms >= 1000 ? `${(avg_latency_ms / 1000).toFixed(1)}s` : `${avg_latency_ms}ms`}</span></span>
        <button
          onClick={loadStatus}
          disabled={refreshing}
          className="p-1 rounded-md hover:bg-stone-200 text-stone-400 hover:text-stone-700 transition-colors disabled:opacity-50"
          title="刷新数据"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}

/** 公告内容（弹窗和详情页共用） */
export function AnnouncementContent({ ann }: { ann: AnnouncementConfig }) {
  if (!ann) return null;

  return (
    <div className="space-y-4">
      {/* 账号池状态监控 */}
      <PoolStatusWidget />
      
      {/* 公告内容 */}
      {ann.content ? (
        <p className="text-[14px] leading-relaxed text-stone-600 whitespace-pre-line">
          {ann.content}
        </p>
      ) : (
        <div className="space-y-2.5">
          {ann.items?.map((item, i) => (
            <p key={i} className="text-[14px] leading-relaxed text-stone-600 whitespace-pre-line">
              {item}
            </p>
          ))}
        </div>
      )}

      {/* QQ 群 */}
      {ann.qq_group?.number && (
        <div className="pt-3 border-t border-stone-100">
          <p className="text-[13px] text-stone-400 mb-3 text-center">
            QQ 群号：<span className="font-semibold text-stone-700">{ann.qq_group.number}</span>　扫码加入
          </p>
          {ann.qq_group.image && (
            <a 
              href={ann.qq_group.image} 
              target="_blank" 
              rel="noreferrer"
              className="block mx-auto w-[160px] h-[160px] rounded-xl overflow-hidden bg-stone-50 hover:opacity-90 transition-opacity cursor-zoom-in"
              title="点击查看大图"
            >
              <img src={ann.qq_group.image} alt="QQ群二维码" className="w-full h-full object-contain" />
            </a>
          )}
        </div>
      )}

      {/* 致谢 */}
      {ann.github?.url && (
        <div className="pt-3 border-t border-stone-100 text-center">
          <p className="text-[12px] text-stone-400">
            基于开源项目{" "}
            <a
              href={ann.github.url}
              target="_blank"
              rel="noreferrer"
              className="text-stone-600 underline underline-offset-2 hover:text-stone-900 transition-colors"
            >
              ChatGPT2API
            </a>{" "}
            by{" "}
            <a
              href={ann.github.url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-stone-700 hover:text-stone-900 transition-colors"
            >
              {ann.github.author}
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

/** 弹窗（登录后自动弹出） */
export function AnnouncementModal() {
  const [open, setOpen] = useState(false);
  const { ann, loading } = useAnnouncement();

  const pathname = usePathname();

  useEffect(() => {
    if (loading || !ann) return;
    if (typeof window === "undefined") return;
    if (pathname === "/login" || pathname === "/register" || pathname === "/") return;

    // 永久关闭：版本号一致就不弹
    const dismissedVersion = localStorage.getItem(STORAGE_KEY_VERSION);
    if (dismissedVersion === String(ann.version)) return;

    // 今日关闭：日期是今天就不弹
    const dismissedToday = localStorage.getItem(STORAGE_KEY_TODAY);
    if (dismissedToday === getTodayStr()) return;

    const timer = setTimeout(() => setOpen(true), 300);
    return () => clearTimeout(timer);
  }, [ann, loading, pathname]);

  if (!open || !ann) return null;

  const handleCloseToday = () => {
    localStorage.setItem(STORAGE_KEY_TODAY, getTodayStr());
    setOpen(false);
  };

  const handleCloseForever = () => {
    localStorage.setItem(STORAGE_KEY_VERSION, String(ann.version));
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleCloseToday} />

      {/* 弹窗 */}
      <div className="relative w-full max-w-[420px] max-h-[85vh] overflow-y-auto rounded-[24px] bg-white shadow-[0_32px_100px_rgba(0,0,0,0.15)]">
        {/* 关闭按钮 */}
        <button
          onClick={handleCloseToday}
          className="absolute top-4 right-4 p-1.5 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
        >
          <X className="size-4" />
        </button>

        <div className="p-6 sm:p-8 space-y-5">
          {/* 标题 */}
          <h2 className="text-xl font-semibold text-stone-950">{ann.title || "公告"}</h2>

          {/* 内容 */}
          <AnnouncementContent ann={ann} />

          {/* 底部按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCloseToday}
              className="flex-1 h-11 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50 hover:text-stone-700 transition-colors cursor-pointer"
            >
              今日关闭
            </button>
            <button
              onClick={handleCloseForever}
              className="flex-1 h-11 rounded-xl bg-stone-950 text-[13px] font-medium text-white hover:bg-stone-800 transition-colors cursor-pointer"
            >
              我知道了
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
