import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface ConfirmApi { confirm: (options: ConfirmOptions) => Promise<boolean> }

const ConfirmContext = createContext<ConfirmApi>({ confirm: async () => false });

export function useConfirm(): ConfirmApi {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (value: boolean) => void } | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ options, resolve })), []);
  const api = useMemo(() => ({ confirm }), [confirm]);
  const close = (value: boolean) => { state?.resolve(value); setState(null); };

  return <ConfirmContext.Provider value={api}>
    {children}
    {state ? <Dialog open onOpenChange={(open) => { if (!open) close(false); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{state.options.title}</DialogTitle>
        {state.options.description ? <p>{state.options.description}</p> : null}
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => close(false)}>Cancel</Button>
          <Button variant={state.options.danger ? "destructive" : "default"} type="button" onClick={() => close(true)}>{state.options.confirmLabel ?? "Confirm"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog> : null}
  </ConfirmContext.Provider>;
}
