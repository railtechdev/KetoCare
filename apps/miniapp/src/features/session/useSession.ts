import { useMutation } from "@tanstack/react-query";

import { api, errorDetailsOf, setTokens } from "../../lib/api";
import { applyLanguage, currentLanguage, knownLanguage } from "../../lib/i18n";
import { launchData } from "../../lib/telegram";

/** Ребёнок, которого ведёт этот Telegram (ADR-0048). */
export interface SessionChild {
  patientId: string;
  name: string;
}

export interface Session {
  patientId: string;
  patientName: string;
  /**
   * Все дети этого Telegram, включая открытого. Переключатель показывается,
   * только когда их два и больше; сессия при этом всегда сужена до одного.
   */
  children: SessionChild[];
  /** Адрес веб-кабинета. Приходит с сервера: своей переменной сборки нет. */
  webUrl: string;
  /** Заведён ли вход по почте. `false` — учётная запись из Telegram. */
  hasWebCredentials: boolean;
}

/** Почему приложение не открылось. Каждое состояние ведёт к своему экрану. */
export type SessionProblem =
  /** Открыто не из Telegram: строки запуска нет. */
  | "outside_telegram"
  /** Telegram есть, привязки нет — нужен код из кабинета. */
  | "not_linked"
  /** Подпись не сошлась или сервер недоступен. */
  | "failed";

/** Что открыть: по умолчанию — ребёнка, выбранного в прошлый раз. */
export interface OpenSessionRequest {
  /** Переключиться на этого ребёнка из уже открытой сессии. */
  switchTo?: string;
}

const CHOSEN_CHILD_KEY = "ketocare.miniapp.child";

/**
 * Какого ребёнка семья выбрала в прошлый раз — удобство одного телефона.
 *
 * Только предпочтение, а не доступ: сервер открывает сессию лишь для ребёнка
 * с живой привязкой этого Telegram и иначе отвечает отказом, после которого
 * открывается первый ребёнок. Хранилище бывает недоступно (закрытый режим,
 * запрет данных сайта) — тогда просто открывается первый.
 */
function rememberedChild(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(CHOSEN_CHILD_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberChild(patientId: string): void {
  try {
    globalThis.localStorage?.setItem(CHOSEN_CHILD_KEY, patientId);
  } catch {
    // Не запомнили — в следующий раз откроется первый ребёнок, не более.
  }
}

interface SessionBody {
  access_token: string;
  refresh_token: string;
  patient_id: string;
  patient_name: string;
  children?: { patient_id: string; name: string }[];
  web_url: string;
  has_web_credentials: boolean;
  /** Язык человека (ADR-0052). Нет у сервера до ADR-0052 — тогда прежний. */
  language?: string | null;
}

function toSession(data: SessionBody): Session {
  setTokens({ access: data.access_token, refresh: data.refresh_token });
  rememberChild(data.patient_id);
  // Язык — свойство человека и приходит с сервера: выбор, сделанный в боте,
  // сильнее языка клиента Telegram, по которому экран открылся (ADR-0052).
  applyLanguage(knownLanguage(data.language) ?? currentLanguage());
  return {
    patientId: data.patient_id,
    patientName: data.patient_name,
    children: (data.children ?? []).map((child) => ({
      patientId: child.patient_id,
      name: child.name,
    })),
    webUrl: data.web_url,
    hasWebCredentials: data.has_web_credentials,
  };
}

/**
 * Переключение на другого ребёнка того же чата (ADR-0048).
 *
 * Идёт по текущей сессии, а не по подписи Telegram: подпись живёт час, а
 * семья переключает ребёнка и через два. Отказ (ребёнка отвязали, сессия
 * кончилась) — не тупик: вызывающий откроет приложение заново по подписи.
 */
async function switchChild(patientId: string): Promise<Session | null> {
  const result = await api
    .POST("/api/v1/auth/miniapp/switch", { body: { patient_id: patientId } })
    .catch(() => {
      throw "failed" satisfies SessionProblem;
    });
  return result.data === undefined ? null : toSession(result.data);
}

async function launch(initData: string, patientId?: string): Promise<Session> {
  // Без сети запрос отказывает сразу (ADR-0034), и отказ не должен выйти
  // за три известных экрану состояния: «не открылось» — это `failed`, его
  // экран и говорит «проверьте связь».
  const { data, error, response } = await api
    .POST("/api/v1/auth/telegram-init", {
      body: { init_data: initData, patient_id: patientId ?? null },
    })
    .catch(() => {
      throw "failed" satisfies SessionProblem;
    });

  if (error !== undefined || data === undefined) {
    // Запомненного ребёнка у этого Telegram больше нет — открыть первого,
    // а не показывать «не привязан» тому, у кого есть другой ребёнок.
    if (
      patientId !== undefined &&
      errorDetailsOf(error)?.reason === "child_not_linked"
    ) {
      return launch(initData);
    }
    // 404 — привязки нет. Отличается от прочих отказов тем, что семья
    // может это исправить сама, и приложение должно сказать как.
    throw (
      response.status === 404 ? "not_linked" : "failed"
    ) satisfies SessionProblem;
  }

  return toSession(data);
}

/**
 * Обмен строки запуска на сессию (раздел 5.2 ТЗ, ADR-0017).
 *
 * Пароль не спрашивается: личность подтверждает Telegram подписью, а право на
 * ребёнка — привязка чата, заведённая в кабинете. Поэтому «не привязан» — это
 * не отказ, а состояние с понятным продолжением, и оно отделено от ошибки.
 *
 * Чат может вести нескольких детей (ADR-0048): открывается выбранный в
 * прошлый раз, а `switchTo` переключает открытую сессию на другого.
 */
export function useOpenSession() {
  return useMutation<Session, SessionProblem, OpenSessionRequest | void>({
    mutationFn: async (request) => {
      const switchTo = request ? request.switchTo : undefined;
      if (switchTo !== undefined) {
        const switched = await switchChild(switchTo);
        if (switched !== null) return switched;
      }

      const initData = launchData();
      if (initData === null) throw "outside_telegram" satisfies SessionProblem;
      return launch(initData, switchTo ?? rememberedChild());
    },
  });
}
