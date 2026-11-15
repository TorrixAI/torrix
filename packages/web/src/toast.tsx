import { Button } from "@/components/ui/button";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

interface ToastAction { label: string; onClick: () => void }
interface ToastOptions { type?: "info" | "success" | "error"; duration?: number; action?: ToastAction }
interface ToastItem { id: number; message: string; type: "info" | "success" | "error"; action?: ToastAction }
interface ToastApi { toast: (message: string, options?: ToastOptions) => void }

const ToastContext = createContext<ToastApi>({ toast: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((item) => item.id !== id)), []);
  const toast = useCallback((message: string, options?: ToastOptions) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, message, type: options?.type ?? "info", action: options?.action }]);
    const duration = options?.duration ?? 4000;
    if (duration > 0) window.setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const api = useMemo(() => ({ toast }), [toast]);
  return <ToastContext.Provider value={api}>
    {children}
    <div className="toast-wrap">
      {items.map((item) => <div key={item.id} className={`toast${item.type === "success" ? " success" : item.type === "error" ? " error" : ""}`}>
        <span>{item.message}</span>
        {item.action ? <Button variant="ghost" type="button" onClick={() => { item.action?.onClick(); dismiss(item.id); }}>{item.action.label}</Button> : null}
        <Button variant="ghost" type="button" aria-label="Dismiss" onClick={() => dismiss(item.id)}>×</Button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}
