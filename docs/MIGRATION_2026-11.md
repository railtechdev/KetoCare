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

**Что не теряется.** Пароли, второй фактор, резервные коды, привязки Telegram, карты, документы — переезжают с базой, томами и снимком redis. Бот прежний; ключ, которым зашифрованы настройки кабинета, переезжает с сервера на сервер.

**Секреты.** Человек не вводит их нигде: служебные ключи создаёт сам сервер, в GitHub у окружения только доступ выката к серверу. Настройки — в кабинете.

**Что заметят люди.** Сотрудники один раз войдут заново на новом адресе — паролем и кодом из того же приложения. Семьям в боте и Mini App делать нечего. В ночь переноса система недоступна 20–30 минут.

## 0. Нужно от владельца

- [ ] два сервера (Ubuntu 24.04, процессор x86-64-v2), вход root по ключу, три имени в `~/.ssh/config`;
- [ ] права Admin на репозиторий учётной записи, под которой работает `gh`;
- [ ] A-записи шести новых имён на адреса серверов;
- [ ] новый бот в BotFather для тестового — токен вводится в кабинете тестового, когда там появится раздел интеграций.

## 1. Окружения в GitHub

Адрес сервера, ключ выката и несекретные настройки. Секретов приложения здесь нет.

```bash
uv run python infra/scripts/github_environment.py production \
    --domain ketocare.uz --server ketocare-prod
uv run python infra/scripts/github_environment.py demo \
    --domain demo.ketocare.uz --server ketocare-demo
uv run python infra/scripts/github_environment.py production --finish
```

Первые две команды печатают открытую часть ключа выката — она нужна на шаге 2.
Выкат в окружение закрыт, пока команда не дошла до конца (переменная
`ENVIRONMENT_READY`). Третья убирает прежние секреты с уровня репозитория: с
этой минуты прежний стенд из GitHub не обновляется и остаётся на своём коммите
до переноса — разницу схемы догонят миграции на боевом. Только после неё
сливается PR с двумя окружениями.

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
- [ ] первый администратор тестового — `create_admin.py` на сервере (`DEPLOY.md`, «Первый администратор»): временный пароль действует до первого входа; на боевом администратор приедет с данными;
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

**Откат** — пока DNS прежних имён не переключён: `infra/scripts/migrate-server.sh rollback ketocare-old ketocare-prod`. Прежний сервер запускается, боевой возвращается в ожидание.

## 6. После переноса

- [ ] прежний сервер стоит выключенным одну-две недели, затем диск стирается вместе с `/srv/backups` — на нём настоящие данные;
- [ ] временный вход root убирается со всех трёх серверов;
- [ ] `ketocare-backup.key` — подтвердить, что приватный ключ копий цел: без него ночные копии боевого не расшифровать;
- [ ] сотрудникам — новый адрес кабинета.
