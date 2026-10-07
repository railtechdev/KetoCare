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
    // Подпись утверждает происхождение: «ответ по материалам приложения». Под
    // отказом ответа по материалам не было, и утверждение ложно.
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
});
