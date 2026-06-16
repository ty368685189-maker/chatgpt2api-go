"use client";

import { LoaderCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AnnouncementContent, useAnnouncement } from "@/components/announcement-modal";

export default function AnnouncementPage() {
  const { ann, loading } = useAnnouncement();

  return (
    <div className="flex justify-center py-6 px-4">
      <Card className="w-full max-w-[480px] rounded-[24px] border-border bg-card shadow-[0_16px_60px_rgba(0,0,0,0.2)]">
        <CardContent className="p-6 sm:p-8 min-h-[300px] flex flex-col justify-center">
          {loading ? (
            <div className="flex items-center justify-center text-muted-foreground">
              <LoaderCircle className="size-6 animate-spin" />
            </div>
          ) : ann ? (
            <>
              <h1 className="text-xl font-semibold text-foreground mb-5">{ann.title || "公告"}</h1>
              <AnnouncementContent ann={ann} />
            </>
          ) : (
            <div className="text-center text-muted-foreground">无法加载公告内容</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
