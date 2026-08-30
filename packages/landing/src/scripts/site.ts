/**
 * Вся интерактивность лендинга. Ванильный TypeScript, без фреймворка:
 * страница статическая, и тащить в браузер React ради четырёх виджетов
 * незачем.
 *
 * Общий принцип — прогрессивное улучшение: разметка полна и осмысленна без
 * скриптов, а этот файл только добавляет поведение. Поэтому здесь есть
 * места, которые СНАЧАЛА прячут содержимое (свёрнутые ответы, сообщения
 * бота) — до их выполнения посетитель видит всё.
 */

import { calculate, formatNumber, type Ingredient } from "../lib/keto";

// Отмечаемся сразу: страховочный таймер в <head> ждёт именно этого признака
// и без него через 3 секунды сам покажет всё скрытое содержимое.
document.documentElement.dataset.siteReady = "1";

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/* ---------- Мобильное меню ---------- */

function initNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-nav-toggle]");
  const nav = document.querySelector<HTMLElement>("#site-nav");
  const label = document.querySelector<HTMLElement>("[data-nav-toggle-label]");
  if (!toggle || !nav || !label) return;

  const setOpen = (open: boolean): void => {
    nav.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    label.textContent = open
      ? (toggle.dataset.labelClose ?? "")
      : (toggle.dataset.labelOpen ?? "");
  };

  setOpen(false);
  toggle.addEventListener("click", () =>
    setOpen(toggle.getAttribute("aria-expanded") !== "true"),
  );

  // Esc закрывает меню и возвращает фокус на кнопку — иначе фокус остаётся
  // на невидимой ссылке.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      toggle.focus();
    }
  });

  // Переход по якорю внутри страницы должен закрывать меню.
  nav.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) setOpen(false);
  });
}

/* ---------- Появление блоков при прокрутке ---------- */

function initReveal(): void {
  const items = document.querySelectorAll<HTMLElement>(".reveal");
  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
  );

  items.forEach((el) => observer.observe(el));
}

/* ---------- Частые вопросы ---------- */

function initFaq(): void {
  const root = document.querySelector<HTMLElement>("[data-faq]");
  if (!root) return;

  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-faq-q]"),
  );

  const setExpanded = (button: HTMLButtonElement, expanded: boolean): void => {
    button.setAttribute("aria-expanded", String(expanded));
    const id = button.getAttribute("aria-controls");
    const panel = id ? document.getElementById(id) : null;
    if (panel) panel.hidden = !expanded;
  };

  // Свёрнуты все, кроме первого: в разметке они раскрыты ради посетителей
  // без скриптов и ради индексации ответов поисковиком.
  buttons.forEach((button, i) => setExpanded(button, i === 0));

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const willOpen = button.getAttribute("aria-expanded") !== "true";
      buttons.forEach((other) =>
        setExpanded(other, other === button && willOpen),
      );
    });
  });
}

/* ---------- Демонстрационный калькулятор ---------- */

interface CalcConfig {
  ingredients: Ingredient[];
  target: number;
  tolerance: number;
  locale: string;
  grams: string;
  verdict: { ok: string; low: string; high: string };
}

function initCalculator(): void {
  const root = document.querySelector<HTMLElement>("[data-calc]");
  const configEl = root?.querySelector<HTMLScriptElement>("[data-calc-config]");
  if (!root || !configEl?.textContent) return;

  const config = JSON.parse(configEl.textContent) as CalcConfig;
  const inputs = Array.from(
    root.querySelectorAll<HTMLInputElement>("[data-calc-input]"),
  );
  const grams = config.ingredients.map((ing) => ing.initial);

  const kcalEl = root.querySelector<HTMLElement>("[data-calc-kcal]");
  const verdictEl = root.querySelector<HTMLElement>("[data-calc-verdict]");
  const verdictTextEl = root.querySelector<HTMLElement>(
    "[data-calc-verdict-text]",
  );
  const ratioEl = root.querySelector<HTMLElement>("[data-calc-ratio]");

  const render = (): void => {
    const r = calculate(grams);

    inputs.forEach((_input, i) => {
      const out = root.querySelector<HTMLElement>(`[data-calc-grams="${i}"]`);
      if (out) out.textContent = `${grams[i]} ${config.grams}`;
    });

    if (kcalEl) {
      // Единица измерения уже стоит в разметке рядом; здесь только число.
      const unit =
        kcalEl.textContent?.replace(/[\d\s\u00a0]+/, "").trim() ?? "";
      kcalEl.textContent = `${Math.round(r.kcal)} ${unit}`;
    }

    (
      [
        ["fat", r.fat, r.fatPct],
        ["protein", r.protein, r.proteinPct],
        ["carbs", r.carbs, r.carbsPct],
      ] as const
    ).forEach(([key, value, pct]) => {
      const bar = root.querySelector<HTMLElement>(`[data-calc-bar="${key}"]`);
      if (bar) bar.style.width = `${pct.toFixed(1)}%`;
      const macro = root.querySelector<HTMLElement>(
        `[data-calc-macro="${key}"]`,
      );
      if (macro)
        macro.textContent = `${formatNumber(value, config.locale)}\u00a0${config.grams}`;
    });

    if (ratioEl) {
      ratioEl.textContent = `${formatNumber(r.ratio, config.locale, 2)} : 1`;
      ratioEl.classList.toggle("ratio-badge--off", r.state !== "ok");
    }
    if (verdictEl) verdictEl.dataset.state = r.state === "ok" ? "ok" : "off";
    if (verdictTextEl) verdictTextEl.textContent = config.verdict[r.state];
  };

  inputs.forEach((input, i) => {
    input.addEventListener("input", () => {
      grams[i] = Number(input.value);
      render();
    });
  });
}

/* ---------- Демонстрация диалога с ботом ---------- */

function initChat(): void {
  const root = document.querySelector<HTMLElement>("[data-chat]");
  if (!root) return;

  const messages = Array.from(
    root.querySelectorAll<HTMLElement>("[data-chat-msg]"),
  );
  const typing = root.querySelector<HTMLElement>("[data-chat-typing]");
  const replay = root.querySelector<HTMLButtonElement>("[data-chat-replay]");
  if (messages.length === 0) return;

  // Без анимации показывать нечего: переписка уже в разметке целиком.
  if (prefersReducedMotion) {
    replay?.remove();
    return;
  }

  let timers: number[] = [];
  let played = false;

  const clear = (): void => {
    timers.forEach((id) => window.clearTimeout(id));
    timers = [];
  };

  const play = (): void => {
    clear();
    messages.forEach((m) => (m.hidden = true));
    if (typing) typing.hidden = true;

    let delay = 400;
    messages.forEach((message, i) => {
      const isBot = !message.classList.contains("chat__msg--user");
      if (isBot && typing) {
        // Пауза «бот печатает» перед ответом — иначе диалог выглядит так,
        // будто оба собеседника пишут одновременно.
        const showTypingAt = delay;
        timers.push(
          window.setTimeout(() => (typing.hidden = false), showTypingAt),
        );
        delay += 800;
        timers.push(
          window.setTimeout(() => {
            typing.hidden = true;
            message.hidden = false;
          }, delay),
        );
      } else {
        timers.push(window.setTimeout(() => (message.hidden = false), delay));
      }
      delay += i === messages.length - 1 ? 0 : 900;
    });
  };

  replay?.addEventListener("click", play);

  if (!("IntersectionObserver" in window)) {
    play();
    return;
  }

  // Диалог начинается, когда блок появился на экране: проигранная в фоне
  // анимация — это анимация, которую никто не увидел.
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting) || played) return;
      played = true;
      play();
      observer.disconnect();
    },
    { threshold: 0.35 },
  );
  observer.observe(root);
}

/* ---------- Формы заявок ---------- */

function initLeadForms(): void {
  document
    .querySelectorAll<HTMLFormElement>("[data-lead-form]")
    .forEach((form) => {
      const fields = form.querySelector<HTMLElement>("[data-lead-fields]");
      const done = form.querySelector<HTMLElement>("[data-lead-done]");
      const error = form.querySelector<HTMLElement>("[data-lead-error]");
      const messages = form.querySelector<HTMLElement>("[data-lead-messages]");
      const input = form.querySelector<HTMLInputElement>('input[type="email"]');
      const submit = form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      const honeypot = form.querySelector<HTMLInputElement>(
        'input[name="website"]',
      );
      if (!fields || !done || !error || !messages || !input || !submit) return;

      const submitLabel = submit.textContent ?? "";

      const showError = (text: string): void => {
        error.textContent = text;
        error.hidden = false;
      };

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        error.hidden = true;

        // Заполненная приманка — это бот. Показываем обычный успех: сообщать
        // спамеру, что он распознан, значит помогать ему подобрать обход.
        if (honeypot?.value) {
          fields.hidden = true;
          done.hidden = false;
          return;
        }

        const email = input.value.trim();
        submit.disabled = true;
        submit.textContent = messages.dataset.sending ?? submitLabel;

        void fetch(form.action, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            audience: form.dataset.variant,
            locale: document.documentElement.lang,
          }),
        })
          .then((response) => {
            if (response.ok) {
              done.textContent = (done.dataset.template ?? "").replace(
                "{email}",
                email,
              );
              fields.hidden = true;
              done.hidden = false;
              return;
            }
            if (response.status === 429) {
              showError(messages.dataset.errorRate ?? "");
            } else if (response.status === 422 || response.status === 400) {
              showError(messages.dataset.errorEmail ?? "");
            } else {
              showError(messages.dataset.errorNetwork ?? "");
            }
          })
          .catch(() => showError(messages.dataset.errorNetwork ?? ""))
          .finally(() => {
            submit.disabled = false;
            submit.textContent = submitLabel;
          });
      });
    });
}

initNav();
initReveal();
initFaq();
initCalculator();
initChat();
initLeadForms();
