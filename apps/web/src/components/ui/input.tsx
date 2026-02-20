import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md border border-white/15 bg-[#1A1F2B]/80 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400/70 placeholder:text-slate-400 focus:ring-2",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
