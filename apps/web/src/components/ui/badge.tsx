import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-200", className)}
      {...props}
    />
  );
}
