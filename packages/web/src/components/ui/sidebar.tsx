import { Slot } from "@radix-ui/react-slot";
import type * as React from "react";
import { cn } from "@/lib/utils";

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" className={cn("flex flex-col gap-px", className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={cn("relative", className)} {...props} />;
}

function SidebarMenuButton({ asChild, isActive, className, ...props }: React.ComponentProps<"button"> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive ? "true" : "false"}
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2.5 py-[7px] text-[13px] font-[450] text-side-text-2 transition-colors",
        "hover:bg-side-hover hover:text-side-text",
        "data-[active=true]:border-brand-line data-[active=true]:bg-brand-dim data-[active=true]:font-semibold data-[active=true]:text-brand-text data-[active=true]:shadow-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        "[&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:opacity-90 data-[active=true]:[&_svg]:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuCaption({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="sidebar-menu-caption" className={cn("nav-cap pl-[11px] pr-2 pb-1.5 font-sans text-[11px] font-semibold text-side-text-2", className)} {...props} />;
}

export { SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuCaption };
