import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { onlineManager } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { watchConnectivity } from "./connectivity";
import { createQueryClient } from "./queryClient";

/**
 * Стык, ради которого сделан источник: запрос, вставший на паузу без сети,
 * продолжается, когда приложение снова на экране. Модульные тесты закрывают
 * сам источник, но не то, что пауза действительно снимается и что источник
 * переживает двойное подключение StrictMode.
 */
function Screen() {
  const query = useQuery({
    queryKey: ["ping"],
    queryFn: () => Promise.resolve("данные"),
  });
  return <p>{query.data ?? `ждём: ${query.fetchStatus}`}</p>;
}

beforeEach(() => {
  watchConnectivity();
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe("сеть и запросы Mini App", () => {
  it("пауза без сети снимается возвращением на экран", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    const client = createQueryClient();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }

    render(
      <StrictMode>
        <Screen />
      </StrictMode>,
      { wrapper: Wrapper },
    );

    expect(await screen.findByText("ждём: paused")).toBeInTheDocument();

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(screen.getByText("данные")).toBeInTheDocument();
    });
  });
});
