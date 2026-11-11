import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import productsRu from "../../locales/ru/products.json";
import { currentAddress } from "../../test/address";
import { SectionRouter } from "../../test/SectionRouter";
import type { SectionSearch } from "../../routes/search";
import { defaultSources } from "./mergeSources";
import { StandardsSection } from "./StandardsSection";
import type {
  CatalogueMergeField,
  CatalogueMergeResult,
  CatalogueMergeRow,
  FoodStandard,
} from "./useFoodStandards";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "u-1", role: "dietitian" } }),
}));

i18n.addResourceBundle("ru", "products", productsRu, true, true);

const labels = productsRu.merge;

const CLINIC: FoodStandard = {
  id: "00000000-0000-7000-8000-000000000001",
  name: "Справочник клиники",
  publisher: null,
  document: null,
  version: null,
  effective_on: null,
  kind: "clinic",
  diet_type: "ketogenic",
  carbs_convention: "total",
  locked_at: null,
  is_active: true,
  products: 10,
  created_at: "2026-11-09T00:00:00Z",
};
const USDA: FoodStandard = {
  ...CLINIC,
  id: "11111111-1111-4111-8111-111111111111",
  name: "USDA SR Legacy",
  kind: "reference",
  locked_at: "2026-11-11T00:00:00Z",
};
const MZ: FoodStandard = {
  ...USDA,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Руководство по питанию",
  publisher: "Минздрав РУз",
  carbs_convention: "unknown",
};

function field(
  value: number | null,
  source: FoodStandard | null,
  extra: Partial<CatalogueMergeField> = {},
): CatalogueMergeField {
  return {
    value,
    source_standard_id: source?.id ?? null,
    source_standard_name: source?.name ?? null,
    source_product_id: null,
    manual: false,
    untracked: false,
    conflict: false,
    merged: null,
    net_plus_fiber: false,
    ...extra,
  };
}

const CABBAGE: CatalogueMergeRow = {
  food_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name_ru: "Капуста белокочанная",
  product_id: null,
  status: "new",
  write: true,
  accepted: false,
  fiber_known: true,
  anomalies: [],
  missing: [],
  fields: {
    kcal_100g: field(28, MZ),
    fat_100g: field(0.1, MZ),
    protein_100g: field(1.8, MZ),
    carbs_100g: field(7.2, MZ, { net_plus_fiber: true }),
    fiber_100g: field(2.5, USDA),
    waste_pct: field(20, MZ),
  },
};
const ODD: CatalogueMergeRow = {
  ...CABBAGE,
  food_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name_ru: "Сыр плавленый",
  status: "needs_review",
  write: false,
  anomalies: ["kcal_mismatch"],
};
const BUTTER: CatalogueMergeRow = {
  ...CABBAGE,
  food_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name_ru: "Масло сливочное",
  product_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  status: "conflict",
  fields: {
    ...CABBAGE.fields,
    fat_100g: field(82.5, null, { manual: true, conflict: true, merged: 81 }),
  },
};

const PREVIEW: CatalogueMergeResult = {
  target_id: CLINIC.id,
  sources: [
    { id: MZ.id, name: MZ.name },
    { id: USDA.id, name: USDA.name },
  ],
  applied: false,
  rows: [CABBAGE, ODD, BUTTER],
  totals: {
    new: 1,
    update: 0,
    unchanged: 0,
    needs_review: 1,
    no_data: 0,
    conflict: 1,
    written: 2,
  },
};

function renderSection(search: SectionSearch) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SectionRouter section="products" search={search}>
        <StandardsSection onOpen={vi.fn()} />
      </SectionRouter>
    </QueryClientProvider>,
  );
}

function mergeBodies(): {
  source_ids: string[];
  accept: string[];
  dry_run: boolean;
}[] {
  return (api.POST as Mock).mock.calls
    .filter(([path]) => path === "/api/v1/food-standards/{standard_id}/merge")
    .map(([, options]) => (options as { body: never }).body);
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockResolvedValue({
    data: [CLINIC, USDA, MZ],
    response: { status: 200 },
  });
  (api.POST as Mock).mockResolvedValue({
    data: PREVIEW,
    response: { status: 200 },
  });
});

describe("сборка рабочего справочника", () => {
  it("по умолчанию Минздрав первым, USDA вторым", () => {
    expect(defaultSources([USDA, MZ])).toEqual([MZ.id, USDA.id]);
    expect(defaultSources([USDA])).toEqual([USDA.id]);
    expect(defaultSources([])).toEqual([]);
  });

  it("действие стоит у стандарта клиники и открывает экран по адресу", async () => {
    const user = userEvent.setup();
    renderSection({ tab: "standards" });

    await screen.findByText(USDA.name);
    const action = `${productsRu.standards.actions.merge}: `;
    expect(
      screen.queryByRole("button", { name: `${action}${USDA.name}` }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: `${action}${CLINIC.name}` }),
    );

    await waitFor(() =>
      expect(currentAddress()).toMatchObject({
        kind: "merge",
        standard: CLINIC.id,
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: labels.title.replace("{{name}}", CLINIC.name),
      }),
    ).toBeInTheDocument();
  });

  it("показывает число, его источник и итог строки", async () => {
    renderSection({ tab: "standards", kind: "merge", standard: CLINIC.id });

    const row = (await screen.findByText(CABBAGE.name_ru)).closest(
      "tr",
    ) as HTMLElement;
    expect(mergeBodies()[0]).toEqual({
      source_ids: [MZ.id, USDA.id],
      accept: [],
      dry_run: true,
    });
    expect(within(row).getByText("7,2")).toBeInTheDocument();
    expect(
      within(row).getByText(labels.note.plusFiber.replace("{{name}}", MZ.name)),
    ).toBeInTheDocument();
    expect(within(row).getByText(USDA.name)).toBeInTheDocument();
    expect(within(row).getByText(labels.status.new)).toBeInTheDocument();

    const butter = screen
      .getByText(BUTTER.name_ru)
      .closest("tr") as HTMLElement;
    expect(
      within(butter).getByText(labels.status.conflict),
    ).toBeInTheDocument();
    expect(
      within(butter).getByText(
        labels.note.manualConflict.replace("{{value}}", "81,0"),
      ),
    ).toBeInTheDocument();
  });

  it("порядок источников уходит в адрес", async () => {
    renderSection({
      tab: "standards",
      kind: "merge",
      standard: CLINIC.id,
      sources: `${USDA.id}`,
    });

    await screen.findByText(CABBAGE.name_ru);
    expect(mergeBodies()[0]?.source_ids).toEqual([USDA.id]);
  });

  it("строку на проверку записывает только отметка диетолога", async () => {
    const user = userEvent.setup();
    renderSection({ tab: "standards", kind: "merge", standard: CLINIC.id });

    const odd = (await screen.findByText(ODD.name_ru)).closest(
      "tr",
    ) as HTMLElement;
    expect(
      within(odd).getByText(labels.anomaly.kcal_mismatch),
    ).toBeInTheDocument();
    const cabbage = screen
      .getByText(CABBAGE.name_ru)
      .closest("tr") as HTMLElement;
    expect(within(cabbage).queryByRole("checkbox")).not.toBeInTheDocument();

    await user.click(
      within(odd).getByRole("checkbox", {
        name: labels.acceptRow.replace("{{name}}", ODD.name_ru),
      }),
    );
    await user.click(screen.getByRole("button", { name: labels.apply }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: labels.apply }),
    );

    await waitFor(() =>
      expect(mergeBodies()).toContainEqual({
        source_ids: [MZ.id, USDA.id],
        accept: [ODD.food_id],
        dry_run: false,
      }),
    );
  });
});
