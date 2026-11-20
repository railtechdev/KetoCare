import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatMessage } from "./ChatMessage";

describe("ChatMessage", () => {
  it("подпись стоит под ответом помощника", () => {
    // Дисклеймер обязан быть под КАЖДЫМ ответом (раздел 10.4 ТЗ). Собранный на
    // экране, он однажды окажется не под всеми — поэтому живёт в компоненте.
    render(
      <ChatMessage role="assistant" note="Не заменяет врача">
        Кетоны записываются кнопкой «Кетоны».
      </ChatMessage>,
    );

    expect(screen.getByText("Не заменяет врача")).toBeInTheDocument();
  });

  it("под сообщением семьи подписи нет", () => {
    render(
      <ChatMessage role="user" note="Не заменяет врача">
        куда записать кетоны
      </ChatMessage>,
    );

    expect(screen.queryByText("Не заменяет врача")).not.toBeInTheDocument();
  });

  it("время реплики стоит над ней — и у вопроса, и у ответа", () => {
    // Специалист читает чужую переписку и без времени не поймёт, о каком дне
    // вопрос; у отказа время нужно так же, как у ответа.
    render(
      <>
        <ChatMessage role="user" meta="05.10, 09:12">
          можно ли сыр
        </ChatMessage>
        <ChatMessage
          role="assistant"
          refusal
          meta="05.10, 09:13"
          note="Не заменяет врача"
        >
          Этот вопрос нужно обсудить с лечащим врачом.
        </ChatMessage>
      </>,
    );

    expect(screen.getByText("05.10, 09:12")).toBeInTheDocument();
    expect(screen.getByText("05.10, 09:13")).toBeInTheDocument();
  });

  it("ожидание показывается скелетоном, а не словом «загрузка»", () => {
    const { container } = render(<ChatMessage role="assistant" pending />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(/загруз/i)).not.toBeInTheDocument();
  });

  it("ожидание дольше обычного объясняется словами, а не длится молча", () => {
    // Без обработчика ответ не придёт никогда, а скелетон выглядел как «думает».
    render(
      <ChatMessage
        role="assistant"
        pending
        slowNote="Ответ готовится дольше обычного"
        pendingSince={new Date(Date.now() - 60_000)}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Ответ готовится дольше обычного",
    );
  });

  it("свежее ожидание — без слов «дольше обычного»", () => {
    render(
      <ChatMessage
        role="assistant"
        pending
        slowNote="Ответ готовится дольше обычного"
        pendingSince={new Date()}
      />,
    );

    expect(
      screen.queryByText("Ответ готовится дольше обычного"),
    ).not.toBeInTheDocument();
  });

  it("у ожидания не показывается подпись", () => {
    // Иначе дисклеймер стоит под пустым местом и выглядит как ответ.
    render(<ChatMessage role="assistant" pending note="Не заменяет врача" />);

    expect(screen.queryByText("Не заменяет врача")).not.toBeInTheDocument();
  });

  it("под отказом подписи нет", () => {
    // Подпись стоит под каждым ОТВЕТОМ (раздел 10.4 ТЗ). Отказ ответом не
    // является: он сам ведёт к врачу или говорит о службе.
    render(
      <ChatMessage role="assistant" refusal note="Не заменяет врача">
        Этот вопрос нужно обсудить с лечащим врачом.
      </ChatMessage>,
    );

    expect(screen.getByText(/обсудить с лечащим врачом/)).toBeInTheDocument();
    expect(screen.queryByText("Не заменяет врача")).not.toBeInTheDocument();
  });

  it("сам текст отказа остаётся обычным сообщением", () => {
    // Отказ показывается репликой, а не ошибкой (ADR-0022): прячется подпись,
    // а не сообщение.
    const { container } = render(
      <ChatMessage role="assistant" refusal note="Не заменяет врача">
        Помощник сейчас недоступен.
      </ChatMessage>,
    );

    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText("Помощник сейчас недоступен.")).toBeInTheDocument();
  });

  it("ответ помощника без подписи не компилируется", () => {
    // Проверка типов: `@ts-expect-error` падает, если ошибки нет.
    // @ts-expect-error — у ответа помощника подпись обязательна (раздел 10.4 ТЗ)
    const answer = <ChatMessage role="assistant">ответ</ChatMessage>;
    expect(answer).toBeTruthy();
  });

  it("подпись нельзя передать пустой", () => {
    // `note={cond ? t(…) : undefined}` компилировался и давал ответ без
    // подписи при обязательном пропе.
    const empty = (
      // @ts-expect-error — `undefined` вместо подписи не принимается
      <ChatMessage role="assistant" note={undefined}>
        ответ
      </ChatMessage>
    );
    const nothing = (
      // @ts-expect-error — `null` вместо подписи не принимается
      <ChatMessage role="assistant" note={null}>
        ответ
      </ChatMessage>
    );
    expect([empty, nothing]).toHaveLength(2);
  });
});

describe("ChatMessage — переписка на телефоне (аудит Mini App 2026-11)", () => {
  it("ответ помощника показывает жирный, а не звёздочки (П5)", () => {
    const { container } = render(
      <ChatMessage role="assistant" note="Не заменяет консультацию врача.">
        {"**Важно:** отметку ставят в меню."}
      </ChatMessage>,
    );

    expect(container.querySelector("strong")).toHaveTextContent("Важно:");
    expect(container).not.toHaveTextContent("**");
  });

  it("реплика семьи печатается как написана", () => {
    const { container } = render(
      <ChatMessage role="user">{"**не жирный**"}</ChatMessage>,
    );

    expect(container.querySelector("strong")).toBeNull();
    expect(screen.getByText("**не жирный**")).toBeInTheDocument();
  });

  it("источник и оговорка — отдельными строками (П9)", () => {
    render(
      <ChatMessage
        role="assistant"
        note="Не заменяет консультацию врача."
        sources={<span>Источник: Как записать кетоны</span>}
      >
        ответ
      </ChatMessage>,
    );

    const sources = screen.getByText("Источник: Как записать кетоны");
    const note = screen.getByText("Не заменяет консультацию врача.");
    expect(sources.parentElement).not.toBe(note.parentElement);
    expect(sources.parentElement?.className).toContain("text-sm");
  });

  it("под отказом нет ни источников, ни оговорки, но есть следующий шаг (П4)", () => {
    const { container } = render(
      <ChatMessage
        role="assistant"
        refusal
        note="Не заменяет консультацию врача."
        sources={<span>Источник: статья</span>}
        nextStep={<button type="button">Спросить ещё раз</button>}
      >
        Помощник сейчас недоступен.
      </ChatMessage>,
    );

    expect(container.querySelector('[data-refusal="true"]')).not.toBeNull();
    expect(screen.queryByText("Источник: статья")).toBeNull();
    expect(screen.queryByText("Не заменяет консультацию врача.")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Спросить ещё раз" }),
    ).toBeInTheDocument();
  });

  it("следующий шаг под обычным ответом не показывается", () => {
    render(
      <ChatMessage
        role="assistant"
        note="Не заменяет консультацию врача."
        nextStep={<button type="button">Спросить ещё раз</button>}
      >
        ответ
      </ChatMessage>,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ожидание ответа говорит словами и движется только без запрета движения (П6)", () => {
    const { container } = render(
      <ChatMessage
        role="assistant"
        pending
        pendingLabel="Помощник отвечает…"
        slowNote="дольше обычного"
        pendingSince={new Date(Date.now() - 60_000)}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Помощник отвечает…");
    expect(status).toHaveTextContent("дольше обычного");
    const dots = container.querySelectorAll("[data-typing-dot]");
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(dot.className).toContain("motion-safe:animate-bounce");
      expect(dot.className).not.toMatch(/(^|\s)animate-/);
    }
  });
});
