"""Разбор поля «что ребёнку нельзя» (`patients.allergies`)."""

from __future__ import annotations

import uuid

from core import exclusions

BUTTER = uuid.UUID("11111111-1111-4111-8111-111111111111")
PEANUT = uuid.UUID("22222222-2222-4222-8222-222222222222")


class TestParse:
    def test_splits_products_from_free_labels(self) -> None:
        # Раздел 4.2 ТЗ описывает поле как список идентификаторов продуктов И
        # свободных меток: «орехи вообще» продуктом каталога не выражается.
        products, labels = exclusions.parse([str(BUTTER), "орехи", str(PEANUT)])

        assert products == {BUTTER, PEANUT}
        assert labels == ["орехи"]

    def test_keeps_label_order(self) -> None:
        # Метки показывают человеку, а порядок в карточке задаёт тот, кто её
        # заполнял.
        _, labels = exclusions.parse(["цитрусовые", "орехи", "мёд"])
        assert labels == ["цитрусовые", "орехи", "мёд"]

    def test_ignores_blank_entries(self) -> None:
        products, labels = exclusions.parse(["  ", "", f" {BUTTER} "])
        assert products == {BUTTER}
        assert labels == []


class TestContainsExcluded:
    def test_names_excluded_products_in_composition_order(self) -> None:
        other = uuid.uuid4()
        found = exclusions.contains_excluded(
            [other, PEANUT, BUTTER], [str(BUTTER), str(PEANUT), "орехи"]
        )
        assert found == [PEANUT, BUTTER]

    def test_repeated_product_is_named_once(self) -> None:
        found = exclusions.contains_excluded([PEANUT, PEANUT], [str(PEANUT)])
        assert found == [PEANUT]

    def test_free_labels_never_match_a_product(self) -> None:
        # Сопоставить «орехи» с каталогом нечем — это и есть причина, по которой
        # исключения понадобилось хранить идентификаторами.
        assert exclusions.contains_excluded([PEANUT], ["орехи", "арахис"]) == []
