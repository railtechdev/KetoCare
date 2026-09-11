import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@ketocare/ui/styles.css";

import { App } from "./App";
import "./lib/i18n";
import { createQueryClient } from "./lib/queryClient";
import { initTheme } from "./lib/theme";

const queryClient = createQueryClient();

// Тема применяется до отрисовки: иначе светлая успевает мигнуть перед тёмной.
initTheme();

const container = document.getElementById("root");
if (container === null) throw new Error("Root element #root not found");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
