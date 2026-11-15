import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./toast";
import { ConfirmProvider } from "./confirm";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles/index.css";

const App = lazy(() => import("./App"));
const SharePage = lazy(() => import("./pages/SharePage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <ToastProvider>
            <ConfirmProvider>
              <Suspense fallback={<div className="startup"><span>Loading…</span></div>}>
                <Routes>
                  <Route path="/share/:token" element={<SharePage />} />
                  <Route path="/ui/login" element={<LoginPage />} />
                  <Route path="*" element={<App />} />
                </Routes>
              </Suspense>
            </ConfirmProvider>
          </ToastProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
