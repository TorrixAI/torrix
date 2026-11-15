import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Matches the console's segmented control: compact sans, accent when on.
const toggleVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border border-transparent bg-surface-2 px-[11px] py-[5px] font-sans text-[11px] font-[550] text-text-2 transition-colors hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:border-brand-line data-[state=on]:bg-brand-dim data-[state=on]:font-semibold data-[state=on]:text-brand-text",
  {
    variants: {
      variant: { default: "", outline: "border-line-2 bg-transparent" },
      size: { default: "", sm: "px-2 py-1" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Toggle({ className, variant, size, ...props }: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({ variant, size }), className)} {...props} />;
}

export { Toggle, toggleVariants };
