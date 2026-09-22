# AGENTS.md — ZIPTOP CRM

## Проект

**ZIPTOP CRM** — CRM-сайт для сервисного центра по ремонту бытовой техники: заявки, клиенты и техника, планирование выездов мастеров, статусы ремонта и коммуникация с клиентами.

Пока это статический шаблон интерфейса. Интеграции с БД, авторизацией и внешними сервисами добавляются после согласования требований. Не выдавать демо-данные за реальные.

## Стек

- **Astro 5** — статическая сборка и маршрутизация.
- **TypeScript** — типизация компонентов и клиентского кода.
- **Tailwind CSS** — стили и дизайн-система.
- **Yandex Cloud Object Storage** — production-хостинг в bucket `xn--g1acsdbq.xn--p1ai`, изолированный префикс `crm/`.

## Маршрутизация и публикация

- Production URL: `https://зиптоп.рф/crm`.
- Production-сборка использует Astro base path `/crm`.
- CRM публикуется только в `s3://xn--g1acsdbq.xn--p1ai/crm/`; не менять корень bucket или другие префиксы, включая `market/`.
- `npm run build` — локальная сборка с base `/`.
- `npm run build:prod` — сборка для `/crm`.
- `npm run deploy:prod` — build и загрузка через Yandex Cloud CLI.

## CI/CD

Workflow `.github/workflows/deploy.yml` запускается при push в `main` и вручную. Ему нужен GitHub secret `YC_SA_JSON_CREDENTIALS`: JSON-ключ service account с правом записи в указанный bucket. Никогда не коммитить ключи, токены, ID сессий или пароли.

Перед изменением pipeline убедитесь, что deploy prefix остаётся `crm`.

## Backend: Yandex Cloud Functions

Добавлять backend-код в `functions/<function-name>/`. Каждая функция должна собираться и публиковаться независимо: `index.mjs` экспортирует `handler`, рядом находится собственный `package.json`, а в архив не попадают frontend CRM и секреты.

1. Один раз создать функцию (имя — строчные латинские буквы, цифры и дефисы):

   ```bash
   yc serverless function create --name ziptop-crm-api --folder-id <folder-id>
   ```

2. Собрать чистый production-архив из директории функции. Зависимости устанавливать во временную папку; исключать `.env`, тесты, sourcemap-файлы и `node_modules/.cache`.

3. Опубликовать новую версию с явными runtime, handler, памятью и timeout:

   ```bash
   yc serverless function version create \
     --function-name ziptop-crm-api \
     --runtime nodejs22 \
     --entrypoint index.handler \
     --memory 256m \
     --execution-timeout 30s \
     --source-path ./function.zip \
     --service-account-id <runtime-service-account-id>
   ```

4. Проверить публикацию: `yc serverless function version list --function-name ziptop-crm-api`. HTTP API gateway или invoke URL добавлять только после определения API-контракта и модели доступа.

### Безопасность функций и CI

- Разделять service account для **деплоя** и для **runtime**. Runtime-аккаунту выдавать только права на вызываемые им сервисы (например, `storage.viewer` или `storage.uploader` для bucket).
- GitHub-аккаунту деплоя нужны `functions.admin` или эквивалентные минимальные права для создания версий. Текущий `zipstop-sa` настроен только для загрузки статического сайта; не использовать его для публикации функций без отдельного IAM-изменения.
- JSON-ключи и параметры окружения хранить в GitHub Actions secrets. Пароли БД, API-ключи и JWT-секреты не помещать в environment variables функции: использовать Yandex Lockbox или другое хранилище секретов и выдавать runtime-аккаунту только read-доступ.
- Frontend и backend публиковать разными GitHub Actions jobs. Изменение CRM-интерфейса не должно создавать версию функции. Изменение функции должно запускать её тесты, собирать чистый ZIP, публиковать его и выполнять health check.
- IDs функций, cloud/folder IDs, service-account IDs и публичные invoke-права хранить в deployment-конфигурации или GitHub variables, а не в исходном коде. Не делать CRM-функции публичными по умолчанию.

## Разработка

- Dev-сервер: `astro dev --background`; управление: `astro dev status`, `astro dev logs`, `astro dev stop`.
- Перед публикацией запустить `npm run check` и `npm run build:prod`.
- Поддерживать семантическую разметку, keyboard navigation, focus-состояния и контраст.
