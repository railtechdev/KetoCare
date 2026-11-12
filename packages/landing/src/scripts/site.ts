/**
 * Вся интерактивность сайта. Ванильный TypeScript, без фреймворка: страница
 * статическая, и тащить в браузер React ради трёх виджетов незачем.
 *
 * Принцип — прогрессивное улучшение: разметка полна и осмысленна без
 * скриптов, этот файл только добавляет поведение. Без него меню раскрыто,
 * вместо формы видна почта, а калькулятор показывает расчёт по умолчанию.
 */

import { calculate, formatNumber } from "../lib/keto";

// Отмечаемся сразу: страховочный таймер в `boot.js` ждёт именно этого признака
// и без него через 3 секунды вернёт страницу в вид «без скриптов».
document.documentElement.dataset.siteReady = "1";

/* ---------- Меню-значок ---------- */

function initNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-nav-toggle]");
  const nav = document.querySelector<HTMLElement>("#site-nav");
  const label = document.querySelector<HTMLElement>("[data-nav-toggle-label]");
  if (!toggle || !nav || !label) return;

  const isOpen = (): boolean => toggle.getAttribute("aria-expanded") === "true";
  const setOpen = (open: boolean): void => {
    nav.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    label.textContent = open
      ? (toggle.dataset.labelClose ?? "")
      : (toggle.dataset.labelOpen ?? "");
  };

  setOpen(false);
  toggle.addEventListener("click", () => setOpen(!isOpen()));

  // Esc закрывает меню и возвращает фокус на кнопку — иначе фокус остаётся
  // на невидимой ссылке.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });

  // Переход по якорю внутри страницы («Оставить заявку») закрывает меню.
  nav.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) setOpen(false);
  });

  // Окно расширили до полной строки — открытое меню не должно остаться
  // висеть в состоянии, которого на этой ширине нет.
  window.matchMedia("(min-width: 1200px)").addEventListener("change", (e) => {
    if (e.matches) setOpen(false);
  });
}

/* ---------- Тема оформления ---------- */

function initTheme(): void {
  const toggle = document.querySelector<HTMLButtonElement>(
    "[data-theme-toggle]",
  );
  if (!toggle) return;

  const root = document.documentElement;
  const sync = (): void =>
    toggle.setAttribute(
      "aria-pressed",
      String(root.getAttribute("data-theme") === "dark"),
    );

  sync();
  toggle.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("kc-theme", next);
    } catch {
      // Хранилище недоступно — тема действует до перезагрузки.
    }
    sync();
  });
}

/* ---------- Демонстрационный калькулятор ---------- */

interface CalcConfig {
  locale: string;
  grams: string;
  kcal: string;
  netCarbs: string;
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
  const grams = inputs.map((input) => Number(input.value));
  const g = (value: number): string =>
    `${formatNumber(value, config.locale)}\u00a0${config.grams}`;

  const set = (selector: string, text: string): void => {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) el.textContent = text;
  };

  const render = (): void => {
    const r = calculate(grams);

    grams.forEach((value, i) =>
      set(`[data-calc-grams="${i}"]`, `${value}\u00a0${config.grams}`),
    );
    set("[data-calc-kcal]", `${Math.round(r.kcal)}\u00a0${config.kcal}`);
    set("[data-calc-ratio]", `${formatNumber(r.ratio, config.locale, 2)} : 1`);
    set("[data-calc-verdict-text]", config.verdict[r.state]);
    set(
      "[data-calc-net-carbs]",
      config.netCarbs.replace("{value}", g(r.netCarbs)),
    );

    const verdict = root.querySelector<HTMLElement>("[data-calc-verdict]");
    if (verdict) verdict.dataset.state = r.state;

    (
      [
        ["fat", r.fat, r.fatPct],
        ["protein", r.protein, r.proteinPct],
        ["carbs", r.carbs, r.carbsPct],
      ] as const
    ).forEach(([key, value, pct]) => {
      const bar = root.querySelector<HTMLElement>(`[data-calc-bar="${key}"]`);
      if (bar) bar.style.width = `${pct.toFixed(1)}%`;
      set(`[data-calc-macro="${key}"]`, g(value));
    });
  };

  inputs.forEach((input, i) => {
    input.addEventListener("input", () => {
      grams[i] = Number(input.value);
      render();
    });
  });
}

/* ---------- Форма заявки ---------- */

function initLeadForms(): void {
  document.querySelectorAll<HTMLElement>("[data-lead]").forEach((box) => {
    const form = box.querySelector<HTMLFormElement>("[data-lead-form]");
    const done = box.querySelector<HTMLElement>("[data-lead-done]");
    const doneText = box.querySelector<HTMLElement>("[data-lead-done-text]");
    const again = box.querySelector<HTMLButtonElement>("[data-lead-again]");
    const error = box.querySelector<HTMLElement>("[data-lead-error]");
    const input = box.querySelector<HTMLInputElement>('input[type="email"]');
    const submit = box.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    const honeypot = box.querySelector<HTMLInputElement>(
      'input[name="website"]',
    );
    if (!form || !done || !doneText || !again || !error || !input || !submit)
      return;

    const messages = form.dataset;
    const submitLabel = submit.textContent ?? "";
    const contact = messages.contactEmail ?? "";

    const showError = (template: string | undefined): void => {
      error.textContent = (template ?? "").replace("{email}", contact);
      error.hidden = false;
    };

    // Успех: форма уступает место короткому «что дальше», и фокус переходит
    // на него — иначе читалка экрана молчит, а фокус остаётся на исчезнувшей
    // кнопке.
    const showDone = (email: string): void => {
      doneText.textContent = (doneText.dataset.template ?? "").replace(
        "{email}",
        email,
      );
      form.hidden = true;
      done.hidden = false;
      done.focus();
    };

    again.addEventListener("click", () => {
      done.hidden = true;
      form.hidden = false;
      input.value = "";
      input.focus();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.hidden = true;
      const email = input.value.trim();

      // Заполненная приманка — это бот. Показываем обычный успех: сообщать
      // спамеру, что он распознан, значит помогать ему подобрать обход.
      if (honeypot?.value) {
        showDone(email);
        return;
      }

      const audience =
        form.querySelector<HTMLInputElement>('input[name="audience"]:checked')
          ?.value ?? "doctor";
      submit.disabled = true;
      submit.textContent = messages.sending ?? submitLabel;

      void fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          audience,
          locale: document.documentElement.lang,
        }),
      })
        .then((response) => {
          if (response.ok) {
            showDone(email);
          } else if (response.status === 429) {
            // Окно лимита — час (LEADS_RATE_LIMIT). Срок не обещаем: вместо
            // него — работающий обход, почта.
            showError(messages.errorRate);
          } else if (response.status === 422 || response.status === 400) {
            showError(messages.errorEmail);
          } else {
            showError(messages.errorNetwork);
          }
        })
        .catch(() => showError(messages.errorNetwork))
        .finally(() => {
          submit.disabled = false;
          submit.textContent = submitLabel;
        });
    });
  });
}

initNav();
initTheme();
initCalculator();
initLeadForms();
