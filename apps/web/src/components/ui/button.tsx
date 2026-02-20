import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "default" | "outline" | "ghost";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition duration-200",
          variant === "default" && "bg-violet-600 text-white shadow-[0_0_20px_rgba(124,58,237,0.45)] hover:bg-violet-500",
          variant === "outline" && "border border-white/20 bg-white/5 text-slate-100 hover:bg-white/10",
          variant === "ghost" && "text-slate-200 hover:bg-white/10",
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
