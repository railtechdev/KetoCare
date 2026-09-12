import { describe, expect, it } from "vitest";

import { productNameState } from "./productName";

const QUIET = { isError: false, isPaused: false };

describe("productNameState", () => {
  it("пришедшее имя так и называется", () => {
    expect(productNameState({ name: "Масло", ...QUIET })).toEqual({
      kind: "name",
      name: "Масло",
    });
  });

  it("ответ «такого продукта нет» — это удаление, а не сбой", () => {
    // 404 — ответ справочника. Смешать его с недоставленным ответом значит
    // обещать имя, которое никогда не придёт.
    expect(productNameState({ name: null, ...QUIET })).toEqual({
      kind: "missing",
    });
  });

  it("отказ — это «не загрузилось», а не «удалён»", () => {
    expect(productNameState({ isError: true, isPaused: false })).toEqual({
      kind: "unavailable",
    });
  });

  it("пауза без сети — тоже «не загрузилось»", () => {
    // Запрос даже не уходил, и ждать его бессмысленно: об этом надо сказать.
    expect(productNameState({ isError: false, isPaused: true })).toEqual({
      kind: "unavailable",
    });
  });

  it("пока ответа нет — ожидание", () => {
    expect(productNameState(QUIET)).toEqual({ kind: "pending" });
  });

  it("пришедшее имя сильнее отказа фонового обновления", () => {
    // Карточка уже получена, а повторный запрос упал: имя есть, и подменять
    // его словами «не загрузилось» нельзя.
    expect(
      productNameState({ name: "Масло", isError: true, isPaused: true }),
    ).toEqual({ kind: "name", name: "Масло" });
  });
});
