import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../lib/api";
import i18n from "../lib/i18n";
import doctorRu from "../locales/ru/doctor.json";
import { SessionProvider } from "../features/auth/session";
import { PatientRoute } from "./PatientRoute";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

function renderCard(patientId: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/app",
    component: Outlet,
  });
  const sectionRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "$section",
    component: () => null,
  });
  const patientRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "patients/$patientId",
    component: PatientRoute,
  });
  const viewRoute = createRoute({
    getParentRoute: () => patientRoute,
    path: "$view",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([
        sectionRoute,
        patientRoute.addChildren([viewRoute]),
      ]),
    ]),
    history: createMemoryHistory({
      initialEntries: [`/app/patients/${patientId}/summary`],
    }),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

describe("карта пациента по адресу", () => {
  it("чужая или несуществующая — заголовок и путь в список, а не «Повторить»", async () => {
    (api.POST as Mock).mockResolvedValue({ error: { error: { code: "x" } } });
    (api.GET as Mock).mockResolvedValue({
      error: { error: { code: "forbidden", message: "Нет доступа." } },
    });
    renderCard("p-missing");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: doctorRu.workspace.missing.title,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: doctorRu.workspace.missing.toList }),
    ).toHaveAttribute("href", "/app/patients");
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
  });
});
