# Развёртывание пред-прода (VPS)

Стенд для демонстрации клиенту и фокус-группы на временном домене
`ketocare.railtech.uz`. После MVP проект переезжает на сервер клиента —
раздел «Передача клиенту» в конце.

Проверено на: Ubuntu 24.04, 2 vCPU, 2 ГБ RAM, 40 ГБ NVMe.

## Топология

| Адрес | Что отдаёт |
| --- | --- |
| `ketocare.railtech.uz` | посадочная — статика из `/var/www/ketocare-landing`; языки `/`, `/uz/`, `/en/`; путь `/api/v1/leads` проксируется в API ради формы заявок |
| `app.ketocare.railtech.uz` | SPA кабинета из `/var/www/ketocare-app`; `location /api/` → прокси на контейнер API (`127.0.0.1:8001`) |
| — | бот работает по long polling: домен и открытый порт ему не нужны |

На хосте: nginx (TLS, статика, прокси) и node (сборка фронта). В docker
(`infra/docker-compose.prod.yml`): postgres, redis, api, bot, worker.
Наружу из compose опубликован один порт — API на `127.0.0.1:8001`.

Раскладка каталогов:

- `/srv/ketocare` — клон репозитория (compose, `.env`, деплой-скрипт);
- `/var/www/ketocare-landing` — посадочная (собирается из `packages/landing`);
- `/var/www/ketocare-app` — собранный `apps/web/dist`, кладёт `deploy.sh`;
- `/srv/backups` — дампы postgres;
- данные postgres/redis и PDF-отчёты — named volumes docker
  (`ketocare_pgdata`, `ketocare_redisdata`, `ketocare_reports`, `ketocare_attachments`).

## Однократная настройка сервера

1. **Пользователь и SSH.** Не-root пользователь в группах `sudo` и `docker`,
   вход только по ключу (`PasswordAuthentication no`, `PermitRootLogin no`).

2. **Файрвол** — только 22/80/443:

   ```bash
   sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
   ```

3. **Swap 2 ГБ** — на 2 ГБ RAM без него сборка фронта и weasyprint упираются
   в OOM:

   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

4. **Docker** из официального репозитория (docs.docker.com/engine/install/ubuntu),
   включая compose-plugin. Плюс `sudo apt install unattended-upgrades`.

5. **nginx + certbot**: `sudo apt install nginx python3-certbot-nginx`.

6. **Node 22 + pnpm** (сборка фронта; в Ubuntu 24.04 из apt слишком старый node):
   nodesource `setup_22.x`, затем `sudo corepack enable`. Также `rsync` и `git`.

7. **DNS**: A-записи `ketocare.railtech.uz` и `app.ketocare.railtech.uz` → IP VPS.

## Первый запуск

```bash
sudo mkdir -p /srv/ketocare /var/www/ketocare-landing /var/www/ketocare-app /srv/backups
sudo chown "$USER" /srv/ketocare /var/www/ketocare-landing /var/www/ketocare-app /srv/backups
git clone <repo> /srv/ketocare && cd /srv/ketocare
cp .env.example .env   # и заполнить, см. ниже
```

### `.env` на сервере

Правится руками, в git не попадает. Обязательные отличия от `.env.example`:

| Переменная | Значение |
| --- | --- |
| `POSTGRES_PASSWORD` | сгенерировать; строку подключения контейнеры собирают из него сами (`DATABASE_URL`/`REDIS_URL` из `.env` контейнерами перекрываются) |
| `SECRET_KEY` | `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `BOT_TOKEN`, `BOT_USERNAME` | **отдельный** бот BotFather для стенда: один токен нельзя long-poll'ить из двух мест — dev-бот на том же токене начнёт конфликтовать (`terminated by other getUpdates request`) |
| `BOT_API_TOKEN` | сгенерировать так же, как `SECRET_KEY` |
| `TRUSTED_PROXY_IPS` | `172.30.100.1` — шлюз docker-сети, откуда приходит трафик host-nginx (подсеть зафиксирована в compose) |
| `WEB_ORIGIN` | `https://app.ketocare.railtech.uz` |
| `REPORTS_DIR` | не менять: внутри контейнеров задан compose'ом (`/data/reports`) |
| `ATTACHMENTS_DIR` | не менять: внутри контейнеров задан compose'ом (`/data/attachments`). Том обязан попадать в бэкап — см. ниже |
| `ANTHROPIC_API_KEY` | оставить заглушкой — AI-функции появляются на этапе 4 |

### nginx и TLS

```bash
sudo cp infra/nginx/ketocare-landing.conf infra/nginx/ketocare-app.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/ketocare-{landing,app}.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ketocare.railtech.uz -d app.ketocare.railtech.uz --redirect
```

`--redirect` обязателен: refresh-токен живёт в httpOnly-cookie и по чистому
HTTP утекает.

### Сервисы и фронт

```bash
infra/scripts/deploy.sh
```

Скрипт собирает образы, применяет миграции, поднимает compose, собирает кабинет
(`/var/www/ketocare-app`) и посадочную страницу (`/var/www/ketocare-landing`).
Повторный запуск = обновление (`--api-only` — без пересборки фронта).

### Посадочная страница

Собирается тем же `deploy.sh` из `packages/landing` (Astro, [ADR-0012](adr/0012-landing-site-and-leads.md)).
Отдельной выкладки не требует.

Домен, адрес кабинета и контактная почта уходят в сборку переменными — из них
собираются canonical, hreflang, sitemap, ссылки «Войти» и адрес в подвале.
Значения по умолчанию заданы в `deploy.sh`; чтобы их переопределить, объявите
переменные в окружении перед запуском:

```bash
PUBLIC_CONTACT_EMAIL=hello@example.uz infra/scripts/deploy.sh
```

**Проверьте почту и Telegram перед публикацией.** Значения по умолчанию пришли
из макета: `hello@ketocare.uz` и `https://t.me/ketocare`. Неотвечающий контакт
на лендинге хуже отсутствующего.

Заявки с форм принимает `POST /api/v1/leads`; nginx лендинга проксирует именно
этот путь, поэтому запрос остаётся same-origin и CORS не расширяется. Читать
заявки — `GET /api/v1/leads` под учётной записью админа.

### Проверки после первого запуска

1. `docker compose --env-file .env -f infra/docker-compose.prod.yml ps` — все
   пять сервисов healthy/running.
2. Открыть `https://app.ketocare.railtech.uz`, войти, выполнить любое действие
   и убедиться, что в `audit_log.ip` — **реальный адрес клиента**, а не
   `172.30.100.1`: если там адрес шлюза, `TRUSTED_PROXY_IPS` не подхватился, и
   вместе с ним не работает rate-limit на `/auth/*`.
3. Заказать PDF-отчёт — проверяет и воркер, и общий том отчётов.
4. Написать стендовому боту `/start` — проверяет long polling и redis.

## Демо-данные и фокус-группа

Для демонстрации клиенту:

```bash
docker compose --env-file .env -f infra/docker-compose.prod.yml \
  run --rm -e DEMO_PASSWORD='<свой пароль>' api python infra/scripts/seed_demo.py
```

`DEMO_PASSWORD` на стенде обязателен: пароль по умолчанию лежит в открытом
репозитории, и с ним демо-админка (`admin@example.com`) на публичном домене
доступна кому угодно.

**Перед запуском фокус-группы демо-данные снести** — иначе они смешаются с
реальными записями семей и испортят собираемую статистику:

```bash
docker compose --env-file .env -f infra/docker-compose.prod.yml down
docker volume rm ketocare_pgdata
infra/scripts/deploy.sh --api-only   # миграции наполнят справочники заново
```

Учётки врача и админа дальше заводятся приглашениями. Данные фокус-группы —
уже реальные клинические данные: удаление участника по его просьбе —
`docker compose ... run --rm api python -m core.tools.erase_patient <id>`.

## Бэкапы

С момента появления фокус-группы — обязательны. Cron от пользователя-владельца
(`crontab -e`):

```cron
30 2 * * * docker exec ketocare-postgres-1 pg_dump -U ketocare -Fc ketocare > /srv/backups/ketocare-$(date +\%F).dump && find /srv/backups -name '*.dump' -mtime +30 -delete
```

**Дампа базы недостаточно.** `pg_dump` сохраняет строки таблицы `attachments`,
но не байты файлов в томе: восстановление из одного дампа даст базу со ссылками
на отсутствующие документы. Вложение — выписка из стационара, протокол ЭЭГ,
результат анализа — существует в одном экземпляре, его никак не пересобрать
(ADR-0013). Поэтому том `attachments` копируется вместе с дампом:

```cron
0 3 * * * docker run --rm -v ketocare_attachments:/data:ro -v /srv/backups:/out alpine tar czf /out/attachments-$(date +\%F).tar.gz -C /data . && find /srv/backups -name 'attachments-*.tar.gz' -mtime +30 -delete
```

Плюс копия за пределы VPS (rclone/scp — куда угодно, но не на этот же диск):
и дамп, и архив вложений. Том `reports` копировать не нужно — PDF-отчёты
пересобираются из БД.

Один раз проверить восстановление: `pg_restore` дампа в пустую БД на локальной
машине и распаковку архива вложений. Бэкап, который ни разу не восстанавливали,
бэкапом не считается.

## Эксплуатация

- Логи: `docker compose ... logs -f api` (ротация настроена в compose,
  10 МБ × 3 на сервис).
- `SENTRY_DSN` в `.env` — рекомендуется завести до фокус-группы: иначе об
  ошибках вы узнаёте только от участников.
- Внешний uptime-мониторинг на оба домена (например, UptimeRobot).
- Место на диске: старые образы копятся при каждом деплое —
  `docker image prune -f` раз в месяц или в cron.

## Передача клиенту

1. На сервере клиента — «Однократная настройка» + «Первый запуск» этого
   документа; в nginx-конфигах и `WEB_ORIGIN` меняется только домен.
2. Данные: свежий `pg_dump` со стенда → `pg_restore` на сервере клиента;
   при необходимости — том `reports` (`docker run --rm -v ketocare_reports:/r
   -v /srv/backups:/b alpine tar czf /b/reports.tgz -C /r .`).
3. Секреты (`SECRET_KEY`, `BOT_API_TOKEN`, пароль postgres) — **сгенерировать
   заново**, стендовые не переносить. Бот: либо передать клиенту стендового
   бота BotFather, либо завести нового (тогда семьи привязываются заново).
4. DNS переключить, на стенде — `docker compose down`, диск затереть после
   подтверждения переезда: там клинические данные.
