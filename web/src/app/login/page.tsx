"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { login, loginWithPassword } from "@/lib/api";
import { primeAuthSessionCache } from "@/lib/auth-session";
import { useRedirectIfAuthenticated } from "@/lib/use-auth-guard";
import { getDefaultRouteForRole, setStoredAuthSession } from "@/store/auth";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "key">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authKey, setAuthKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isCheckingAuth } = useRedirectIfAuthenticated();

  const doLogin = async (key: string) => {
    const data = await login(key);
    const nextSession = {
      key,
      role: data.role,
      subjectId: data.subject_id,
      name: data.name,
    };
    await setStoredAuthSession(nextSession);
    primeAuthSessionCache(nextSession);
    router.replace(getDefaultRouteForRole(data.role));
  };

  const handlePasswordLogin = async () => {
    if (!username.trim() || !password.trim()) {
      toast.error("请输入用户名和密码");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await loginWithPassword({
        username: username.trim(),
        password: password.trim(),
      });
      await doLogin(res.bound_raw_key);
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyLogin = async () => {
    const normalizedAuthKey = authKey.trim();
    if (!normalizedAuthKey) {
      toast.error("请输入密钥");
      return;
    }
    setIsSubmitting(true);
    try {
      await doLogin(normalizedAuthKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
      <Card className="w-full max-w-[400px] rounded-[30px] border-white/80 bg-white/95 shadow-[0_28px_90px_rgba(28,25,23,0.10)]">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="space-y-4 text-center">
            <div className="mx-auto inline-flex size-14 items-center justify-center rounded-[18px] bg-stone-950 text-white shadow-sm">
              <LockKeyhole className="size-5" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-stone-950">欢迎回来</h1>
              <p className="text-sm leading-6 text-stone-500">
                {mode === "password" ? "输入账号密码继续使用。" : "输入密钥后继续使用。"}
              </p>
            </div>
          </div>

          {/* 模式切换 */}
          <div className="flex rounded-xl bg-stone-100 p-1 text-[13px] font-medium">
            <button
              className={`flex-1 rounded-lg py-1.5 transition-colors cursor-pointer ${
                mode === "password" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500"
              }`}
              onClick={() => setMode("password")}
            >
              账号密码
            </button>
            <button
              className={`flex-1 rounded-lg py-1.5 transition-colors cursor-pointer ${
                mode === "key" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500"
              }`}
              onClick={() => setMode("key")}
            >
              密钥登录
            </button>
          </div>

          <div className="space-y-4">
            {mode === "password" ? (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-stone-700">用户名</label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="请输入用户名"
                    className="h-12 rounded-2xl border-stone-200 bg-white px-4"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-stone-700">密码</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handlePasswordLogin();
                    }}
                    placeholder="请输入密码"
                    className="h-12 rounded-2xl border-stone-200 bg-white px-4"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-700">密钥</label>
                <Input
                  type="password"
                  value={authKey}
                  onChange={(e) => setAuthKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleKeyLogin();
                  }}
                  placeholder="请输入密钥"
                  className="h-12 rounded-2xl border-stone-200 bg-white px-4"
                />
              </div>
            )}
          </div>

          <Button
            className="h-12 w-full rounded-2xl bg-stone-950 text-white hover:bg-stone-800"
            onClick={() => (mode === "password" ? void handlePasswordLogin() : void handleKeyLogin())}
            disabled={isSubmitting}
          >
            {isSubmitting ? <LoaderCircle className="size-4 animate-spin mr-2" /> : null}
            登录
          </Button>

          <div className="text-center text-sm">
            <Link href="/register" className="text-stone-500 hover:text-stone-900 transition-colors">
              没有账号？点击注册
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
