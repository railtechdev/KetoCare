/**
 * Копирование в буфер обмена с честным ответом: удалось или нет.
 *
 * «Скопировано» говорится только после того, как браузер подтвердил запись.
 * Раньше в трёх местах из четырёх отказ терялся: `navigator.clipboard`
 * отсутствует на странице без HTTPS и в части встроенных браузеров, а запись
 * отклоняется без разрешения или без фокуса на странице — и экран при этом
 * говорил «Скопировано», а администратор передавал владельцу пустоту вместо
 * временного пароля, который второй раз показать нельзя.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
