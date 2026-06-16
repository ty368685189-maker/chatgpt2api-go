"use client";

export function SettingsHeader() {
  return (
    <section className="mt-4 flex flex-col gap-4 sm:mt-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-1">
        <div className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">Settings</div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">设置</h1>
      </div>
    </section>
  );
}
