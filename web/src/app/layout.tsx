import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { PageTransition } from "@/components/page-transition";
import { RouteProgress } from "@/components/route-progress";
import { TopNav } from "@/components/top-nav";
import { AnnouncementModal } from "@/components/announcement-modal";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dual 公益站",
  description: "Dual 公益站 - 免费 AI 画图 & 对话",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fbfbfd" }, { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const saved = localStorage.getItem('theme');
                  const isDark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
                  if (isDark) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {}
              })();
            `
          }}
        />
      </head>
      <body
        className="antialiased font-sans"
        style={{
          fontFamily:
            'var(--font-sans), "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif',
        }}
      >
        <Toaster position="top-center" richColors offset={48} />
        <RouteProgress />
        <TopNav />
        <AnnouncementModal />
        <main className="h-screen overflow-x-hidden overflow-y-auto px-4 pt-12 pb-2 text-foreground [scrollbar-gutter:stable_both-edges] sm:px-6 sm:pt-14 lg:px-8">
          <div className="mx-auto box-border flex max-w-[1440px] flex-col pt-[env(safe-area-inset-top)]">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </body>
    </html>
  );
}
