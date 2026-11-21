/**
 * Насколько сдвинуть полосу вбок, чтобы кнопка оказалась внутри неё целиком
 * («nearest»): уже видна — ноль, ушла влево или вправо — до ближнего края.
 */
export function horizontalShift(
  container: Pick<DOMRect, "left" | "right">,
  button: Pick<DOMRect, "left" | "right">,
): number {
  if (button.left < container.left) return button.left - container.left;
  if (button.right > container.right) return button.right - container.right;
  return 0;
}
