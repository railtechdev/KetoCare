# Перенос на боевой сервер — лист работ

Срок: до понедельника 30.11.2026, 09:00. Решение и причины — [ADR-0095](adr/0095-two-environments-and-data-move.md).

| | Прежний | Боевой | Тестовый |
| --- | --- | --- | --- |
| Имя в `~/.ssh/config` | `ketocare-old` | `ketocare-prod` | `ketocare-demo` |
| Посадочная | `ketocare.railtech.uz` | `ketocare.uz` | `demo.ketocare.uz` |
| Кабинет | `app.ketocare.railtech.uz` | `app.ketocare.uz` | `app.demo.ketocare.uz` |
| Mini App | `tma.ketocare.railtech.uz` | `tma.ketocare.uz` | `tma.demo.ketocare.uz` |
| Данные | настоящие — до переноса | настоящие — после | демо |
| Бот | — | прежний, к нему привязаны семьи | новый |

**Что не теряется.** Пароли, второй фактор, резервные коды, привязки Telegram, карты, документы — переезжают с базой, томами и снимком redis. Секреты приложения боевого прежние, бот прежний.

**Что заметят люди.** Сотрудники один раз войдут заново на новом адресе — паролем и кодом из того же приложения. Семьям в боте и Mini App делать нечего. В ночь переноса система недоступна 20–30 минут.

## 0. Нужно от владельца

- [ ] два сервера (Ubuntu 24.04, процессор x86-64-v2), вход root по ключу, три имени в `~/.ssh/config`;
- [ ] права Admin на репозиторий учётной записи, под которой работает `gh`;
- [ ] A-записи шести новых имён на адреса серверов;
- [ ] новый бот в BotFather для тестового; токен и имя — в окружение `demo` (Settings → Environments), вместе с `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`.

## 1. Окружения в GitHub

Значения секретов не печатаются и на диск не ложатся.

```bash
uv run python infra/scripts/github_environment.py production \
    --domain ketocare.uz --server ketocare-prod --secrets-from ketocare-old
uv run python infra/scripts/github_environment.py demo \
    --domain demo.ketocare.uz --server ketocare-demo
```

Каждая команда печатает открытую часть ключа выката — она нужна на шаге 2.
Выкат в окружение закрыт, пока команда не дошла до конца (переменная
`ENVIRONMENT_READY`): у тестового она дойдёт только после того, как владелец
задал токен бота и администратора, — тогда команду запускают ещё раз.

Пока PR с двумя окружениями не слит, прежний стенд обновляется как раньше.
После слияния `main` едет только на тестовый, прежний стенд остаётся на своём
коммите до переноса — разницу схемы догонят миграции на боевом.

## 2. Настройка серверов

```bash
scp infra/scripts/bootstrap-server.sh ketocare-prod:/tmp/
ssh ketocare-prod "ENVIRONMENT=production BASE_DOMAIN=ketocare.uz \
    LEGACY_DOMAIN=ketocare.railtech.uz STANDBY=1 REPO_REF=<ветка, пока PR не слит> \
    DEPLOY_PUBKEY='<ключ production>' bash /tmp/bootstrap-server.sh"

scp infra/scripts/bootstrap-server.sh ketocare-demo:/tmp/
ssh ketocare-demo "ENVIRONMENT=demo BASE_DOMAIN=demo.ketocare.uz REPO_REF=<ветка, пока PR не слит> \
    DEPLOY_PUBKEY='<ключ demo>' bash /tmp/bootstrap-server.sh"
```

`STANDBY=1` на боевом обязателен: до переноса его бот и воркер не запускаются. Сертификат не выпустился — значит, DNS ещё не разошёлся; запустить скрипт ещё раз.

## 3. Первые выкаты

- [ ] `gh workflow run deploy.yml -f environment=demo` — тестовый;
- [ ] демо-данные на тестовом — команда из `DEPLOY.md`, «Демо-данные»;
- [ ] `gh workflow run deploy.yml -f environment=production` — боевой, тот же коммит; в журнале выката строка «РЕЖИМ ОЖИДАНИЯ»;
- [ ] `https://app.ketocare.uz/` и `https://app.demo.ketocare.uz/` открываются, заголовки безопасности на месте (их проверяет сам выкат).

## 4. Репетиция — воскресенье днём

Прежний сервер работает, семьи ничего не замечают.

```bash
infra/scripts/migrate-server.sh check    ketocare-old ketocare-prod
infra/scripts/migrate-server.sh rehearse ketocare-old ketocare-prod
```

- [ ] «Репетиция пройдена»: строки таблиц совпали или расходятся на записи, сделанные за время копирования; тома — файл в файл; redis не пуст;
- [ ] владелец входит в `https://app.ketocare.uz/` своей учётной записью со вторым фактором и открывает документ пациента.

После репетиции на боевом лежит копия настоящих данных, а бот и воркер по-прежнему выключены.

## 5. Перенос — воскресенье, 22:00

1. [ ] `infra/scripts/migrate-server.sh cutover ketocare-old ketocare-prod` — останавливает прежний сервер, переносит, сверяет, запускает боевой целиком.
2. [ ] Вход сотрудника в `https://app.ketocare.uz/`, ответ бота в привязанном чате, Mini App из кнопки меню, документ пациента, «Модели и расход» — ключ ИИ на месте.
3. [ ] DNS прежних трёх имён — на адрес боевого сервера.
4. [ ] Сертификат на прежние имена (на боевом, когда DNS разойдётся):
   `certbot --nginx -d ketocare.railtech.uz -d app.ketocare.railtech.uz -d tma.ketocare.railtech.uz --redirect`
5. [ ] Прежние адреса перенаправляют на новые; кнопка Mini App в **старом** сообщении бота открывает приложение.
6. [ ] `uv run python infra/scripts/github_environment.py --finish production` — секреты приложения убраны с уровня репозитория.

**Откат** — пока DNS прежних имён не переключён: `infra/scripts/migrate-server.sh rollback ketocare-old ketocare-prod`. Прежний сервер запускается, боевой возвращается в ожидание.

## 6. После переноса

- [ ] прежний сервер стоит выключенным одну-две недели, затем диск стирается вместе с `/srv/backups` — на нём настоящие данные;
- [ ] временный вход root убирается со всех трёх серверов;
- [ ] `ketocare-backup.key` — подтвердить, что приватный ключ копий цел: без него ночные копии боевого не расшифровать;
- [ ] сотрудникам — новый адрес кабинета.
