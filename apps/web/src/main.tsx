import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { Toasts } from "./components/ui";
import { refreshAccess } from "./lib/api";
import { useSession } from "./stores/session";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Boot() {
  const ready = useSession((state) => state.ready);
  const setReady = useSession((state) => state.setReady);
  useEffect(() => {
    refreshAccess().finally(() => setReady(true));
  }, [setReady]);
  if (!ready) return <p className="p-8 text-sm text-muted">Loading Northstar…</p>;
  return (
    <>
      <App />
      <Toasts />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Boot />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
