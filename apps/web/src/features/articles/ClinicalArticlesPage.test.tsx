import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import { SectionRouter } from "../../test/SectionRouter";
import { currentAddress } from "../../test/address";
import { ClinicalArticlesPage } from "./ClinicalArticlesPage";
import type { ArticleDetail, ArticleVersion } from "./types";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } };
});

const ID = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

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

function version(overrides: Partial<ArticleVersion> = {}): ArticleVersion {
  return {
    id: "v1",
    number: 1,
    title: "Кетоны в моче",
    body_md: "## Как мерить\n\nУтром, **натощак**.",
    sources: null,
    author_id: "author",
    author_name: "Иванова А. А.",
    created_at: "2026-11-20T08:00:00Z",
    updated_at: "2026-11-20T08:00:00Z",
    submitted_at: null,
    reviewed_by: null,
    approver_name: null,
    approved_at: null,
    returned_by: null,
    returned_by_name: null,
    returned_at: null,
    return_comment: null,
    source_file_name: null,
    content_hash: HASH,
    is_live: false,
    ...overrides,
  };
}

function article(
  overrides: Partial<ArticleDetail> = {},
  working: Partial<ArticleVersion> = {},
): ArticleDetail {
  const workingVersion = version(working);
  return {
    id: ID,
    slug: "ketony-v-moche",
    kind: "clinical",
    origin: "cabinet",
    status: "draft",
    hidden: false,
    title: workingVersion.title,
    is_live: false,
    live_version_number: null,
    working_version_number: workingVersion.number,
    working_author_id: "author",
    working_author_name: "Иванова А. А.",
    live_approver_name: null,
    live_approved_at: null,
    submitted_at: null,
    updated_at: "2026-11-20T08:00:00Z",
    awaiting_my_review: false,
    working_version: workingVersion,
    versions: [workingVersion],
    warnings: [],
    can: { ...NONE },
    ...overrides,
  };
}

function ok<T>(data: T) {
  return Promise.resolve({ data, response: { status: 200 } });
}

function refused(status: number, code: string, message: string) {
  return Promise.resolve({
    error: { error: { code, message, details: {} } },
    response: { status },
  });
}

function mockArticle(detail: ArticleDetail, count = 0) {
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.endsWith("/review-count")) return ok({ count });
    if (path.endsWith("{article_id}")) return ok(detail);
    return ok({ items: [detail], total: 1 });
  });
}

function renderPage(search: Record<string, string> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="articles" search={search}>
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<ClinicalArticlesPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockArticle(article());
});

describe("список статей", () => {
  it("отбор живёт в адресе и уходит в запрос", async () => {
    renderPage({ tab: "review" });

    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/clinical-articles",
        expect.objectContaining({
          params: {
            query: expect.objectContaining({ awaiting_my_review: true }),
          },
        }),
      ),
    );
    expect(
      screen.getByRole("radio", { name: "Ждут моей проверки" }),
    ).toBeChecked();
  });

  it("у опубликованной статьи — кто проверил, а не подпись выпуска", async () => {
    // An imported clinical article: written for the release, signed by the
    // clinic. «Автор: KetoCare» alone would misstate who stands behind it.
    mockArticle(
      article({
        status: "published",
        is_live: true,
        live_version_number: 1,
        working_author_id: null,
        working_author_name: "KetoCare",
        live_approver_name: "Клиника",
        live_approved_at: "2026-10-22T00:00:00Z",
      }),
    );
    renderPage();

    expect(
      await screen.findByText(
        /Проверил\(а\) и опубликовал\(а\): Клиника, 22\.10\.2026/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Автор: KetoCare/)).toBeNull();
  });

  it("смена отбора пишется в адрес", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("radio", { name: "Черновики" }));

    await waitFor(() => expect(currentAddress().tab).toBe("drafts"));
  });

  it("статьи, ждущие проверки, видны сверху раздела", async () => {
    // В навигации счётчиков нет: проверяющий узнаёт о них здесь.
    mockArticle(article(), 2);
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText("Ждут вашей проверки: 2"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Показать" }));
    await waitFor(() => expect(currentAddress().tab).toBe("review"));
  });

  it("открытая статья живёт в адресе и переживает F5", async () => {
    renderPage({ item: ID });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Кетоны в моче" }),
    ).toBeInTheDocument();
  });
});

describe("новая статья", () => {
  it("сохраняет черновик и открывает его", async () => {
    (api.POST as Mock).mockImplementation(() => ok(article()));
    const user = userEvent.setup();
    renderPage({ item: "new" });

    await user.type(await screen.findByLabelText("Заголовок"), "Кетоны в моче");
    await user.type(screen.getByLabelText(/^Текст/), "Утром натощак.");
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/clinical-articles",
        {
          body: {
            title: "Кетоны в моче",
            body_md: "Утром натощак.",
            sources: null,
            source_file_name: null,
          },
        },
      ),
    );
    await waitFor(() => expect(currentAddress().item).toBe(ID));
  });

  it("пустую форму не отправляет и называет поля", async () => {
    const user = userEvent.setup();
    renderPage({ item: "new" });

    await user.click(
      await screen.findByRole("button", { name: "Сохранить черновик" }),
    );

    expect(await screen.findAllByText("Напишите заголовок")).not.toHaveLength(
      0,
    );
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("«Как увидит семья» показывает разметку, но не HTML", async () => {
    const user = userEvent.setup();
    renderPage({ item: "new" });

    await user.type(
      await screen.findByLabelText(/^Текст/),
      "**натощак** <b>жирно</b>",
    );

    const preview = screen
      .getByRole("heading", { name: "Как увидит семья" })
      .closest('[data-slot="card"]') as HTMLElement;
    expect(within(preview).getByText("натощак").tagName).toBe("STRONG");
    expect(preview.querySelector("b")).toBeNull();
    expect(within(preview).getByText(/<b>жирно<\/b>/)).toBeInTheDocument();
  });

  it("текст из Word встаёт в поле, а набранный заменяется только после подтверждения", async () => {
    (api.POST as Mock).mockImplementation(() =>
      ok({
        title: "Из файла",
        body_md: "## Раздел\n\nТекст из файла.",
        source_file_name: "statya.docx",
      }),
    );
    const user = userEvent.setup();
    renderPage({ item: "new" });

    const body = await screen.findByLabelText(/^Текст/);
    await user.type(body, "Набранный текст");
    await user.upload(
      screen.getByLabelText(/Загрузить из Word/),
      new File(["x"], "statya.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/article-text",
        expect.anything(),
      ),
    );
    // В поле был текст — без подтверждения он не пропадает.
    const dialog = await screen.findByRole("alertdialog");
    expect(body).toHaveValue("Набранный текст");
    await user.click(
      within(dialog).getByRole("button", { name: "Заменить текст" }),
    );

    expect(body).toHaveValue("## Раздел\n\nТекст из файла.");
    expect(screen.getByLabelText("Заголовок")).toHaveValue("Из файла");
  });

  it("отказ разбора файла показывает слова с выходом", async () => {
    (api.POST as Mock).mockImplementation(() =>
      refused(
        422,
        "validation_error",
        "Сохраните файл как .docx или вставьте текст.",
      ),
    );
    const user = userEvent.setup();
    renderPage({ item: "new" });

    await user.upload(
      await screen.findByLabelText(/Загрузить из Word/),
      new File(["x"], "statya.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );

    expect(
      await screen.findByText("Сохраните файл как .docx или вставьте текст."),
    ).toBeInTheDocument();
  });
});

describe("проверка двумя людьми", () => {
  it("отправка на проверку показывает, что помощник не перескажет", async () => {
    mockArticle(article({ can: { ...NONE, edit: true, submit: true } }));
    (api.POST as Mock).mockImplementation(() =>
      ok(
        article({
          status: "review",
          can: { ...NONE, edit: true },
          warnings: [
            {
              section: "Как мерить",
              sentence: "Давать по 5 мл два раза в день.",
              kind: "dosing",
              rule: "dose_amount",
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderPage({ item: ID });

    await user.click(
      await screen.findByRole("button", { name: "Отправить на проверку" }),
    );

    expect(
      await screen.findByText("Помощник не сможет пересказать эти предложения"),
    ).toBeInTheDocument();
    expect(screen.getByText("Похоже на дозировку")).toBeInTheDocument();
    expect(
      screen.getByText("Давать по 5 мл два раза в день."),
    ).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/knowledge-base/clinical-articles/{article_id}/submit",
      { params: { path: { article_id: ID } } },
    );
  });

  it("автор свою версию не публикует: кнопки нет, сказано, кто проверит", async () => {
    mockArticle(article({ status: "review", can: { ...NONE, edit: true } }));
    renderPage({ item: ID });

    expect(
      await screen.findByText(/Ждёт проверки другим специалистом/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Опубликовать" }),
    ).not.toBeInTheDocument();
  });

  it("проверяющий публикует ту версию, которую читал", async () => {
    mockArticle(
      article({
        status: "review",
        awaiting_my_review: true,
        can: { ...NONE, publish: true, return_to_author: true },
      }),
    );
    (api.POST as Mock).mockImplementation(() =>
      ok(article({ status: "published", is_live: true })),
    );
    const user = userEvent.setup();
    renderPage({ item: ID });

    await user.click(
      await screen.findByRole("button", { name: "Опубликовать" }),
    );

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/clinical-articles/{article_id}/publish",
        { params: { path: { article_id: ID } }, body: { content_hash: HASH } },
      ),
    );
  });

  it("отказ публикации показывает слова отказа", async () => {
    mockArticle(
      article({
        status: "review",
        can: { ...NONE, publish: true, return_to_author: true },
      }),
    );
    (api.POST as Mock).mockImplementation(() =>
      refused(409, "conflict", "Текст изменился, пока вы его читали."),
    );
    const user = userEvent.setup();
    renderPage({ item: ID });

    await user.click(
      await screen.findByRole("button", { name: "Опубликовать" }),
    );

    expect(
      await screen.findByText("Текст изменился, пока вы его читали."),
    ).toBeInTheDocument();
  });

  it("вернуть автору без комментария нельзя", async () => {
    mockArticle(
      article({
        status: "review",
        can: { ...NONE, publish: true, return_to_author: true },
      }),
    );
    (api.POST as Mock).mockImplementation(() => ok(article()));
    const user = userEvent.setup();
    renderPage({ item: ID });

    await user.click(
      await screen.findByRole("button", { name: "Вернуть автору" }),
    );
    const sheet = await screen.findByRole("dialog");
    await user.click(
      within(sheet).getByRole("button", { name: "Вернуть автору" }),
    );

    expect(
      (await within(sheet).findAllByText("Напишите, что поправить")).length,
    ).toBeGreaterThan(0);
    expect(api.POST).not.toHaveBeenCalled();

    await user.type(
      within(sheet).getByLabelText("Что поправить"),
      "Уточнить время",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Вернуть автору" }),
    );

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/clinical-articles/{article_id}/return",
        {
          params: { path: { article_id: ID } },
          body: { content_hash: HASH, comment: "Уточнить время" },
        },
      ),
    );
  });

  it("возвращённый черновик показывает автору комментарий", async () => {
    mockArticle(
      article(
        { can: { ...NONE, edit: true, submit: true } },
        {
          returned_by_name: "Петров П. П.",
          returned_at: "2026-11-20T09:00:00Z",
          return_comment: "Уточнить время",
        },
      ),
    );
    renderPage({ item: ID });

    expect(
      await screen.findByText(/Возвращена автору: Петров П. П./),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Уточнить время").length).toBeGreaterThan(0);
  });
});

describe("опубликованная статья", () => {
  const published = () =>
    article(
      {
        status: "published",
        is_live: true,
        live_version_number: 1,
        can: { ...NONE, withdraw: true, new_version: true },
      },
      {
        is_live: true,
        approver_name: "Клиника",
        approved_at: "2026-10-22T09:00:00Z",
        author_name: "Клиника",
      },
    );

  it("снимается только после подтверждения, называющего статью", async () => {
    mockArticle(published());
    (api.POST as Mock).mockImplementation(() =>
      ok(article({ status: "withdrawn" })),
    );
    const user = userEvent.setup();
    renderPage({ item: ID });

    await user.click(
      await screen.findByRole("button", { name: "Снять с публикации" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Снять статью «Кетоны в моче» с публикации?"),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: "Снять с публикации" }),
    );
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/clinical-articles/{article_id}/withdraw",
        { params: { path: { article_id: ID } } },
      ),
    );
  });

  it("«Изменить» заводит новую версию и открывает её правку", async () => {
    mockArticle(published());
    (api.POST as Mock).mockImplementation(() =>
      ok(article({ can: { ...NONE, edit: true, submit: true } })),
    );
    const user = userEvent.setup();
    renderPage({ item: ID });

    await user.click(await screen.findByRole("button", { name: "Изменить" }));

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/clinical-articles/{article_id}/new-version",
        { params: { path: { article_id: ID } } },
      ),
    );
    await waitFor(() => expect(currentAddress().item).toBe(`edit:${ID}`));
  });

  it("перенесённая из файла версия подписана клиникой", async () => {
    mockArticle(published());
    renderPage({ item: ID });

    expect(await screen.findByText("Клиника, 22.10.2026")).toBeInTheDocument();
    expect(screen.getByText("Сейчас у помощника")).toBeInTheDocument();
  });
});

describe("находки ревью ADR-0093", () => {
  const onReview = (hash: string, body = "## Как мерить\n\nУтром.") =>
    article(
      {
        status: "review",
        awaiting_my_review: true,
        can: { ...NONE, publish: true, return_to_author: true },
      },
      { content_hash: hash, body_md: body },
    );

  it("фоновое обновление не подменяет текст, который проверяющий прочитал", async () => {
    const READ_HASH = "b".repeat(64);
    const NEW_HASH = "c".repeat(64);
    let current = onReview(READ_HASH, "## Как мерить\n\nПрочитанный текст.");
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path.endsWith("/review-count")) return ok({ count: 0 });
      if (path.endsWith("{article_id}")) return ok(current);
      return ok({ items: [current], total: 1 });
    });
    (api.POST as Mock).mockImplementation(() =>
      ok(article({ status: "published", is_live: true })),
    );
    const user = userEvent.setup();
    renderPage({ item: ID });
    expect(await screen.findByText("Прочитанный текст.")).toBeInTheDocument();

    // Автор поправил статью, проверяющий вернулся во вкладку.
    current = onReview(NEW_HASH, "## Как мерить\n\nДругой текст.");
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);

    expect(
      await screen.findByText("Текст изменился, пока страница была открыта"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Опубликовать" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Вернуть автору" }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "Я прочитал(а) новый текст" }),
    );
    await user.click(screen.getByRole("button", { name: "Опубликовать" }));

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/clinical-articles/{article_id}/publish",
        {
          params: { path: { article_id: ID } },
          body: { content_hash: NEW_HASH },
        },
      ),
    );
    expect(api.POST).toHaveBeenCalledTimes(1);
  });

  it("брошенный черновик новой версии удаляется после подтверждения", async () => {
    const live = version({
      id: "v1",
      number: 1,
      is_live: true,
      approved_at: "2026-10-22T09:00:00Z",
      approver_name: "Клиника",
      body_md: "## Как мерить\n\nОпубликованный текст.",
    });
    const draft = version({
      id: "v2",
      number: 2,
      title: "Черновой заголовок",
      body_md: "## Как мерить\n\nЧерновой текст.",
    });
    mockArticle(
      article({
        title: "Черновой заголовок",
        is_live: true,
        live_version_number: 1,
        working_version_number: 2,
        working_version: draft,
        versions: [draft, live],
        can: { ...NONE, withdraw: true, discard: true },
      }),
    );
    (api.POST as Mock).mockImplementation(() =>
      ok({
        deleted: false,
        article: article({ status: "published", is_live: true }),
      }),
    );
    const user = userEvent.setup();
    renderPage({ item: ID });

    // Шапка — название живой версии; два текста подписаны, какой у семьи.
    expect(
      await screen.findByRole("heading", { level: 1, name: "Кетоны в моче" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Черновик версии 2 — семья его не видит",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Как видит семья сейчас (версия 1)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Опубликованный текст.")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Как увидит семья" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Отменить новую версию" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Отменить версию 2 статьи «Черновой заголовок»?",
      ),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "Удалить черновик" }),
    );

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/clinical-articles/{article_id}/discard-draft",
        { params: { path: { article_id: ID } } },
      ),
    );
  });

  it("удалённая целиком статья возвращает к списку", async () => {
    mockArticle(article({ can: { ...NONE, edit: true, discard: true } }));
    (api.POST as Mock).mockImplementation(() =>
      ok({ deleted: true, article: null }),
    );
    const user = userEvent.setup();
    renderPage({ item: ID });

    await user.click(
      await screen.findByRole("button", { name: "Удалить черновик" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Удалить черновик" }),
    );

    await waitFor(() => expect(currentAddress().item).toBeUndefined());
  });

  it("«У помощника» спрашивает живые статьи, а не состояние черновика", async () => {
    renderPage({ tab: "published" });

    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/clinical-articles",
        { params: { query: { live: true, limit: 200 } } },
      ),
    );
  });

  it("пустой раздел предлагает написать первую статью", async () => {
    (api.GET as Mock).mockImplementation((path: string) =>
      path.endsWith("/review-count")
        ? ok({ count: 0 })
        : ok({ items: [], total: 0 }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Статей пока нет");
    const buttons = screen.getAllByRole("button", { name: "Новая статья" });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1] as HTMLElement);

    await waitFor(() => expect(currentAddress().item).toBe("new"));
  });

  it("главная кнопка редактора стоит над текстом, а не под предпросмотром", async () => {
    renderPage({ item: "new" });

    const finish = await screen.findByRole("button", {
      name: "Отправить на проверку",
    });
    const body = screen.getByLabelText(/^Текст/);
    expect(
      finish.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("предупреждения помощника читаются до отправки на проверку", async () => {
    const saved = article({
      can: { ...NONE, edit: true, submit: true },
      warnings: [
        {
          section: "Как мерить",
          sentence: "Давать по 5 мл два раза в день.",
          kind: "dosing",
          rule: "dose_amount",
        },
      ],
    });
    (api.POST as Mock).mockImplementation(() => ok(saved));
    const user = userEvent.setup();
    renderPage({ item: "new" });

    await user.type(await screen.findByLabelText("Заголовок"), "Кетоны");
    await user.type(screen.getByLabelText(/^Текст/), "Давать по 5 мл.");
    await user.click(
      screen.getByRole("button", { name: "Отправить на проверку" }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Похоже на дозировку")).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledTimes(1);
    expect(api.POST).not.toHaveBeenCalledWith(
      "/api/v1/knowledge-base/clinical-articles/{article_id}/submit",
      expect.anything(),
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Отправить на проверку" }),
    );
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/knowledge-base/clinical-articles/{article_id}/submit",
        { params: { path: { article_id: ID } } },
      ),
    );
  });

  it("отказ от отправки оставляет автора в правке сохранённого черновика", async () => {
    const saved = article({
      can: { ...NONE, edit: true, submit: true },
      warnings: [
        {
          section: "Как мерить",
          sentence: "Давать по 5 мл два раза в день.",
          kind: "dosing",
          rule: "dose_amount",
        },
      ],
    });
    (api.POST as Mock).mockImplementation(() => ok(saved));
    mockArticle(saved);
    const user = userEvent.setup();
    renderPage({ item: "new" });

    await user.type(await screen.findByLabelText("Заголовок"), "Кетоны");
    await user.type(screen.getByLabelText(/^Текст/), "Давать по 5 мл.");
    await user.click(
      screen.getByRole("button", { name: "Отправить на проверку" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Поправить текст" }),
    );

    await waitFor(() => expect(currentAddress().item).toBe(`edit:${ID}`));
    expect(api.POST).toHaveBeenCalledTimes(1);
  });

  it("автору статьи на проверке — ссылка для коллеги и кто может опубликовать", async () => {
    mockArticle(article({ status: "review", can: { ...NONE, edit: true } }));
    const user = userEvent.setup();
    // After `setup()`: user-event puts its own clipboard stub in place.
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderPage({ item: ID });

    expect(
      await screen.findByText(/любой другой врач или диетолог/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Скопировать ссылку для коллеги" }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(window.location.href),
    );
  });
});
