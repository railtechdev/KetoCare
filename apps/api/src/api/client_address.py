"""Определение адреса клиента — единственная реализация на всё приложение.

Использовалась в двух местах (ключ ограничения частоты и `audit_log.ip`), и копии
уже начали расходиться, поэтому вынесено сюда.

`X-Forwarded-For` заполняет клиент, а не сеть: доверять ему можно только если
запрос пришёл от известного обратного прокси, который этот заголовок
перезаписывает. Без списка доверенных прокси (`TRUSTED_PROXY_IPS`) заголовок
игнорируется — иначе ротацией одного заголовка обходится ограничение частоты
на `/auth/*`, а в `audit_log.ip` пишется то, что выбрал атакующий.
"""

from __future__ import annotations

from starlette.requests import Request

from core.config import trusted_proxies


def client_address(request: Request) -> str | None:
    peer = request.client.host if request.client else None

    if peer is not None and peer in trusted_proxies():
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first

    return peer
