import type * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Variants mirror the console's legacy `.btn` (pill, display font, 8x15 padding)
// so the migration is visually neutral; the tokens come from index.css.
const buttonVariants = cva(
  "inline-flex items-center gap-[7px] whitespace-nowrap rounded-md border border-transparent font-display text-[12.5px] font-semibold tracking-[-.005em] transition-[background,color,border-color,filter] active:brightness-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:brightness-[1.06]",
        outline: "bg-surface text-text-2 border-line-2 hover:bg-surface-2 hover:text-text",
        secondary: "bg-surface-2 text-text-2 border-line-2 hover:bg-surface-3 hover:text-text",
        ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
        destructive: "btn-danger border-bad-line bg-bad-dim text-bad hover:brightness-[.97]",
        link: "text-brand hover:underline",
      },
      size: {
        default: "px-[15px] py-2",
        sm: "px-3 py-1.5 text-[12px]",
        lg: "px-5 py-2.5",
        icon: "p-1.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
