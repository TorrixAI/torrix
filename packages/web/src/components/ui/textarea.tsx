import type * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[74px] w-full rounded-md border border-input bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-foreground shadow-none transition-[border-color,box-shadow] outline-none",
        "placeholder:text-placeholder selection:bg-primary selection:text-primary-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        "resize-y",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
