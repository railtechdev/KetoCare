import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import { SectionRouter } from "../../test/SectionRouter";
import { currentAddress } from "../../test/address";
import { ProductArticlesPage } from "./ProductArticlesPage";
import type { ArticleDetail } from "./types";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } };
});

const ID = "33333333-3333-4333-8333-333333333333";
const HASH = "b".repeat(64);

const NONE = {
  edit: false,
  submit: false,
  publish: false,
  return_to_author: false,
  withdraw: false,
  new_version: false,
  hide: false,
  show: false,
  discard: false,
};

function article(overrides: Partial<ArticleDetail> = {}): ArticleDetail {
  const working = {
    id: "v1",
    number: 1,
    title: "Как записать вес",
    body_md: "Откройте «Дневник».",
    sources: null,
    author_id: null,
    author_name: "KetoCare",
    created_at: "2026-11-20T08:00:00Z",
    updated_at: "2026-11-20T08:00:00Z",
    submitted_at: null,
    reviewed_by: null,
    approver_name: "KetoCare",
    approved_at: "2026-11-20T08:00:00Z",
    returned_by: null,
    returned_by_name: null,
    returned_at: null,
    return_comment: null,
    source_file_name: null,
    content_hash: HASH,
    is_live: true,
  };
  return {
    id: ID,
    slug: "kak-zapisat-ves",
    kind: "product",
    origin: "builtin",
    status: "published",
    hidden: false,
    title: working.title,
    is_live: true,
    live_version_number: 1,
    working_version_number: 1,
    working_author_id: null,
    working_author_name: "KetoCare",
    submitted_at: null,
    updated_at: "2026-11-20T08:00:00Z",
    awaiting_my_review: false,
    working_version: working,
    versions: [working],
    warnings: [],
    can: { ...NONE, hide: true },
    ...overrides,
  };
}

function ok<T>(data: T) {
  return Promise.resolve({ data, response: { status: 200 } });
}

function mockArticle(detail: ArticleDetail) {
  (api.GET as Mock).mockImplementation((path: string) =>
    path.endsWith("{article_id}")
      ? ok(detail)
      : ok({ items: [detail], total: 1 }),
  );
}

function renderPage(search: Record<string, string> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="productArticles" search={search}>
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<ProductArticlesPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockArticle(article());
});

describe("статьи о приложении", () => {
  it("по умолчанию показывает встроенные, вкладка «Свои» — в адресе", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/admin/knowledge-base/product-articles",
        { params: { query: { origin: "builtin", limit: 200 } } },
      ),
    );
    await user.click(screen.getByRole("radio", { name: "Свои" }));

    await waitFor(() => expect(currentAddress().tab).toBe("own"));
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/admin/knowledge-base/product-articles",
        { params: { query: { origin: "cabinet", limit: 200 } } },
      ),
    );
  });

  it("встроенная статья на чтение: править нельзя, скрыть — после подтверждения", async () => {
    (api.POST as Mock).mockImplementation(() =>
      ok(
        article({ hidden: true, is_live: false, can: { ...NONE, show: true } }),
      ),
    );
    const user = userEvent.setup();
    renderPage({ item: ID });

    await user.click(
      await screen.findByRole("button", { name: "Скрыть из помощника" }),
    );
    expect(
      screen.queryByRole("button", { name: "Изменить" }),
    ).not.toBeInTheDocument();
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Скрыть статью «Как записать вес» из помощника?",
      ),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Скрыть" }));

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/admin/knowledge-base/product-articles/{article_id}/hide",
        { params: { path: { article_id: ID } } },
      ),
    );
  });

  it("свою статью администратор публикует сам — без проверки", async () => {
    mockArticle(
      article({
        origin: "cabinet",
        status: "draft",
        is_live: false,
        live_version_number: null,
        can: { ...NONE, edit: true, publish: true },
      }),
    );
    (api.POST as Mock).mockImplementation(() => ok(article()));
    const user = userEvent.setup();
    renderPage({ item: ID });

    expect(
      screen.queryByRole("button", { name: "Отправить на проверку" }),
    ).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: "Опубликовать" }),
    );

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/admin/knowledge-base/product-articles/{article_id}/publish",
        { params: { path: { article_id: ID } }, body: { content_hash: HASH } },
      ),
    );
  });

  it("новая статья: сохранение и публикация одной кнопкой", async () => {
    const saved = article({
      origin: "cabinet",
      status: "draft",
      can: { ...NONE, edit: true, publish: true },
    });
    (api.POST as Mock).mockImplementation(() => ok(saved));
    const user = userEvent.setup();
    renderPage({ item: "new" });

    await user.type(
      await screen.findByLabelText("Заголовок"),
      "Как записать вес",
    );
    await user.type(screen.getByLabelText(/^Текст/), "Откройте «Дневник».");
    await user.click(screen.getByRole("button", { name: "Опубликовать" }));

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/admin/knowledge-base/product-articles/{article_id}/publish",
        { params: { path: { article_id: ID } }, body: { content_hash: HASH } },
      ),
    );
    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/admin/knowledge-base/product-articles",
      expect.objectContaining({
        body: expect.objectContaining({ title: "Как записать вес" }),
      }),
    );
    await waitFor(() => expect(currentAddress().item).toBe(ID));
  });
});

describe("находки ревью ADR-0093", () => {
  it("скрытая встроенная статья не называется опубликованной", async () => {
    mockArticle(
      article({ hidden: true, is_live: false, can: { ...NONE, show: true } }),
    );
    renderPage();

    expect(await screen.findByText("Скрыта из помощника")).toBeInTheDocument();
    expect(screen.queryByText("Опубликована")).not.toBeInTheDocument();
  });

  it("пустая вкладка «Свои» предлагает написать статью", async () => {
    (api.GET as Mock).mockImplementation(() => ok({ items: [], total: 0 }));
    const user = userEvent.setup();
    renderPage({ tab: "own" });

    await screen.findByText("Своих статей пока нет");
    const buttons = screen.getAllByRole("button", { name: "Новая статья" });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1] as HTMLElement);

    await waitFor(() => expect(currentAddress().item).toBe("new"));
  });

  it("с предупреждениями помощника статья не публикуется одним нажатием", async () => {
    const saved = article({
      origin: "cabinet",
      status: "draft",
      can: { ...NONE, edit: true, publish: true },
      warnings: [
        {
          section: "Коротко",
          sentence: "Давать по 5 мл.",
          kind: "dosing",
          rule: "dose_amount",
        },
      ],
    });
    (api.POST as Mock).mockImplementation(() => ok(saved));
    const user = userEvent.setup();
    renderPage({ item: "new" });

    await user.type(await screen.findByLabelText("Заголовок"), "Как записать");
    await user.type(screen.getByLabelText(/^Текст/), "Давать по 5 мл.");
    await user.click(screen.getByRole("button", { name: "Опубликовать" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Похоже на дозировку")).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledTimes(1);

    await user.click(
      within(dialog).getByRole("button", { name: "Опубликовать" }),
    );
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/admin/knowledge-base/product-articles/{article_id}/publish",
        { params: { path: { article_id: ID } }, body: { content_hash: HASH } },
      ),
    );
  });

  it("свой черновик удаляется после подтверждения", async () => {
    mockArticle(
      article({
        origin: "cabinet",
        status: "draft",
        is_live: false,
        live_version_number: null,
        can: { ...NONE, edit: true, publish: true, discard: true },
      }),
    );
    (api.POST as Mock).mockImplementation(() =>
      ok({ deleted: true, article: null }),
    );
    const user = userEvent.setup();
    renderPage({ item: ID });

    await user.click(
      await screen.findByRole("button", { name: "Удалить черновик" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Удалить черновик статьи «Как записать вес»?"),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Удалить черновик" }),
    );

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/admin/knowledge-base/product-articles/{article_id}/discard-draft",
        { params: { path: { article_id: ID } } },
      ),
    );
    await waitFor(() => expect(currentAddress().item).toBeUndefined());
  });
});
