/**
 * Системный `<select>` за оформленным списком кита (`SelectField`).
 *
 * Подпись поля указывает на кнопку списка — её видит и объявляет человек.
 * Значение живёт в скрытом системном списке рядом с ней (`<id>-native`), и
 * тест выбирает вариант в нём: открывать всплывающее меню Radix в jsdom
 * значит проверять jsdom, а не форму.
 */
export function nativeSelect(element: HTMLElement): HTMLSelectElement {
  if (element instanceof HTMLSelectElement) return element;
  const native =
    element.id === "" ? null : document.getElementById(`${element.id}-native`);
  if (!(native instanceof HTMLSelectElement)) {
    throw new Error(
      `No native select behind #${element.id || element.tagName}`,
    );
  }
  return native;
}

/**
 * Элемент, у которого есть значение: системный список за кнопкой
 * `SelectField` или само поле. Для `toHaveValue`, когда в одном тесте
 * сверяются и списки, и поля ввода.
 */
export function valueControl(element: HTMLElement): HTMLElement {
  const native =
    element.id === "" ? null : document.getElementById(`${element.id}-native`);
  return native instanceof HTMLSelectElement ? native : element;
}
