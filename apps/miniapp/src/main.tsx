import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@ketocare/ui/styles.css";

import { App } from "./App";
import { watchConnectivity } from "./lib/connectivity";
import "./lib/i18n";
import { createQueryClient } from "./lib/queryClient";

// До первого запроса: иначе он встал бы на паузу по стандартному источнику сети,
// который во WebView Telegram может не узнать о её возвращении (ADR-0036).
watchConnectivity();
const queryClient = createQueryClient();

const container = document.getElementById("root");
if (container === null) throw new Error("Root element #root not found");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
