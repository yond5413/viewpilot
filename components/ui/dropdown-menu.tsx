"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type DropdownMenuContextValue = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext() {
  const context = React.useContext(DropdownMenuContext);
  if (!context) {
    throw new Error("Dropdown menu components must be used within DropdownMenu.");
  }
  return context;
}

function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-flex">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

function DropdownMenuTrigger({
  children,
  asChild,
}: {
  children: React.ReactElement<{ onClick?: React.MouseEventHandler<HTMLElement> }>;
  asChild?: boolean;
}) {
  const { setOpen } = useDropdownMenuContext();

  if (!asChild) {
    return (
      <button type="button" onClick={() => setOpen((current) => !current)}>
        {children}
      </button>
    );
  }

  return React.cloneElement(children, {
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      children.props.onClick?.(event);
      setOpen((current) => !current);
    },
  });
}

function DropdownMenuContent({
  children,
  className,
  align = "center",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  const { open, setOpen } = useDropdownMenuContext();

  React.useEffect(() => {
    if (!open) return;

    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "absolute top-full z-50 mt-2 min-w-[10rem] overflow-hidden rounded-md border border-[var(--border)] bg-white p-1 shadow-lg",
        align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2 -translate-x-1/2",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function DropdownMenuItem({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}) {
  const { setOpen } = useDropdownMenuContext();

  return (
    <button
      type="button"
      className={cn(
        "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-[var(--accent-soft)]",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        setOpen(false);
      }}
    >
      {children}
    </button>
  );
}

function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 h-px bg-[var(--border)]", className)} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
};
