"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LoaderCircle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { login, registerUser, fetchSystemPublicConfig } from "@/lib/api";
import { primeAuthSessionCache } from "@/lib/auth-session";
import { useRedirectIfAuthenticated } from "@/lib/use-auth-guard";
import { getDefaultRouteForRole, setStoredAuthSession } from "@/store/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [siteKey, setSiteKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isCheckingAuth } = useRedirectIfAuthenticated();

  useEffect(() => {
    fetchSystemPublicConfig().then((res) => {
      if (res.turnstile_site_key) {
        setSiteKey(res.turnstile_site_key);
      }
    }).catch(console.error);
  }, []);

  const handleRegister = async () => {
    if (!username.trim() || !password.trim()) {
      toast.error("请输入用户名和密码");
      return;
    }
    if (!inviteCode.trim()) {
      toast.error("请输入邀请码");
      return;
    }
    if (password.length < 6) {
      toast.error("密码至少 6 个字符");
      return;
    }
    if (siteKey && !turnstileToken) {
      toast.error("请先完成人机验证");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await registerUser({
        username: username.trim(),
        password: password.trim(),
        invite_code: inviteCode.trim(),
        turnstile_token: turnstileToken,
      });
      // 注册成功，用返回的 key 自动登录
      const data = await login(res.key);
      const nextSession = {
        key: res.key,
        role: data.role,
        subjectId: data.subject_id,
        name: data.name,
      };
      await setStoredAuthSession(nextSession);
      primeAuthSessionCache(nextSession);
      toast.success("注册成功！");
      router.replace(getDefaultRouteForRole(data.role));
    } catch (error) {
      const message = error instanceof Error ? error.message : "注册失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
      <Card className="w-full max-w-[400px] rounded-[30px] border-border bg-card shadow-[0_28px_90px_rgba(0,0,0,0.2)]">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="space-y-4 text-center">
            <div className="mx-auto inline-flex size-14 items-center justify-center rounded-[18px] bg-primary text-primary-foreground shadow-sm">
              <UserPlus className="size-5" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                加入 Dual 公益站
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                输入邀请码注册，获取免费画图额度。
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-muted-foreground">邀请码</label>
              <Input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="请输入邀请码"
                className="h-12 rounded-2xl border-border bg-background px-4"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-muted-foreground">用户名</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className="h-12 rounded-2xl border-border bg-background px-4"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-muted-foreground">密码</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRegister();
                }}
                placeholder="请输入密码（至少6位）"
                className="h-12 rounded-2xl border-border bg-background px-4"
              />
            </div>
          </div>

          {siteKey ? (
            <div className="flex justify-center py-2">
              <Turnstile
                siteKey={siteKey}
                onSuccess={(token) => setTurnstileToken(token)}
                onError={() => toast.error("人机验证加载失败")}
                onExpire={() => setTurnstileToken("")}
              />
            </div>
          ) : null}

          <Button
            className="h-12 w-full rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => void handleRegister()}
            disabled={isSubmitting}
          >
            {isSubmitting ? <LoaderCircle className="size-4 animate-spin mr-2" /> : null}
            注册
          </Button>

          <div className="text-center text-sm">
            <a href="/login" className="text-muted-foreground hover:text-foreground transition-colors">
              已有账号？返回登录
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
