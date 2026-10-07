import { useRouterState } from "@tanstack/react-router";

/**
 * Текущая строка параметров адреса — для проверок «правка ушла в адрес».
 *
 * Скрытый элемент, а не доступ к роутеру снаружи: тест смотрит на то же, что
 * увидел бы человек после F5, — на адрес, а не на внутреннее состояние.
 */
export function AddressProbe() {
  const search = useRouterState({ select: (state) => state.location.search });
  return (
    <output data-testid="address" hidden>
      {JSON.stringify(search)}
    </output>
  );
}

/** Параметры адреса, отрисованные тестовым роутером. */
export function currentAddress(): Record<string, unknown> {
  const probe = document.querySelector('[data-testid="address"]');
  return JSON.parse(probe?.textContent ?? "{}") as Record<string, unknown>;
}
