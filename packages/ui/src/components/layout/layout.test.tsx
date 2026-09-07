import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { Columns } from "./Columns";
import { Fact, FactList } from "./FactList";
import { Metric, MetricRow } from "./MetricRow";
import { SplitView } from "./SplitView";
import { Tiles } from "./Tiles";
import { DensityProvider } from "./density";
import { Section } from "../Section";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Columns", () => {
  it("основное идёт в разметке раньше приставного", () => {
    // Когда колонки складываются в одну (телефон), порядок разметки становится
    // порядком чтения: главное обязано быть первым.
    const { container } = render(
      <Columns
        asideLabel="Справка"
        main={<p>главное</p>}
        aside={<p>сбоку</p>}
      />,
    );

    expect(container.textContent).toBe("главноесбоку");
  });

  it("без приставного содержимого не резервирует под него места", () => {
    // Иначе рядом с содержимым остаётся пустой столбец в 20rem: в меню пустого
    // дня итогов ещё нет, и справа от плана висела пустота шириной с сам план.
    render(<Columns asideLabel="Итоги" main={<p>главное</p>} aside={null} />);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("приставная колонка названа для скринридера", () => {
    render(
      <Columns
        asideLabel="Назначение"
        main={<p>главное</p>}
        aside={<p>сбоку</p>}
      />,
    );

    expect(
      screen.getByRole("complementary", { name: "Назначение" }),
    ).toBeInTheDocument();
  });
});

describe("Tiles", () => {
  it("перечень остаётся списком", () => {
    // Плитки часто перечисляют однородные предметы, и сетка не должна отнимать
    // у них семантику списка: скринридер объявляет «список из трёх».
    render(
      <Tiles as="ul">
        <li>раз</li>
        <li>два</li>
      </Tiles>,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("Tiles", () => {
  it("короткий перечень не растягивает единственную плитку", () => {
    // `auto-fit` схлопывает пустые дорожки, и одна плитка занимает строку
    // целиком: карточка рецепта растягивалась на 1030 px вместе с местом под
    // фотографию. `columns="fill"` дорожки сохраняет.
    const { container } = render(
      <Tiles columns="fill" min="sm">
        <p>одна</p>
      </Tiles>,
    );

    expect(container.firstElementChild?.className).toContain("auto-fill");
  });
});

describe("MetricRow", () => {
  it("показатель без значения показывает прочерк, а не пустоту", () => {
    // Пустая ячейка неотличима от ещё не загруженной: прочерк говорит «сведений
    // нет», а пустое место не говорит ничего.
    render(
      <MetricRow>
        <Metric label="Рост" value={null} />
      </MetricRow>,
    );

    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("FactList", () => {
  it("пара остаётся парой списка определений", () => {
    const { container } = render(
      <FactList>
        <Fact label="Пол" value="мальчик" />
      </FactList>,
    );

    // `Fact` возвращает `dt` и `dd` без обёртки: обёртка вынула бы их из сетки
    // перечня, и две колонки схлопнулись бы в одну.
    expect(container.querySelector("dl > dt")).toHaveTextContent("Пол");
    expect(container.querySelector("dl > dd")).toHaveTextContent("мальчик");
  });
});

describe("SplitView", () => {
  it("на узком экране показывает только открытый предмет", () => {
    // Обе половины в разметке означали бы, что на телефоне перечень остаётся в
    // дереве доступности под открытым предметом: скринридер его читает, поиск
    // по странице находит, `Tab` уводит в него.
    stubMatchMedia(false);

    render(
      <SplitView
        list={<p>полный список</p>}
        rail={<p>перечень</p>}
        detail={<p>карта</p>}
      />,
    );

    expect(screen.getByText("карта")).toBeInTheDocument();
    expect(screen.queryByText("перечень")).not.toBeInTheDocument();
    expect(screen.queryByText("полный список")).not.toBeInTheDocument();
  });

  it("на широком экране показывает перечень рядом с предметом", () => {
    stubMatchMedia(true);

    render(
      <SplitView
        list={<p>полный список</p>}
        rail={<p>перечень</p>}
        detail={<p>карта</p>}
      />,
    );

    expect(screen.getByText("перечень")).toBeInTheDocument();
    expect(screen.getByText("карта")).toBeInTheDocument();
  });

  it("без выбранного предмета показывает полный список на любой ширине", () => {
    // Пустая половина рядом со списком показывала бы место, отведённое под то,
    // чего нет.
    stubMatchMedia(true);

    render(
      <SplitView
        list={<p>полный список</p>}
        rail={<p>перечень</p>}
        detail={null}
      />,
    );

    expect(screen.getByText("полный список")).toBeInTheDocument();
    expect(screen.queryByText("перечень")).not.toBeInTheDocument();
  });
});

describe("плотность", () => {
  it("наследуется блоком от экрана", () => {
    const { container } = render(
      <DensityProvider density="compact">
        <Section title="Блок">содержимое</Section>
      </DensityProvider>,
    );

    // Признак плотного блока — уменьшенные отступы карточки. Правило П26 канона
    // требует их на служебных экранах, и до контекста их приходилось помнить в
    // каждом блоке: из тридцати служебных блоков помнили в трёх.
    expect(container.firstElementChild?.className).toContain("py-block");
  });

  it("явный выбор блока сильнее наследованного", () => {
    const { container } = render(
      <DensityProvider density="compact">
        <Section title="Блок" density="comfortable">
          содержимое
        </Section>
      </DensityProvider>,
    );

    expect(container.firstElementChild?.className).not.toContain("py-block");
  });
});
