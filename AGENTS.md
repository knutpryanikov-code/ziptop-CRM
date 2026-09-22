# AGENTS.md — сайт ЗИПТОП (зиптоп.рф)

## Проект

**ЗИПТОП** — сайт экосистемы запчастей и ремонта бытовой техники: каталог (`/`), взрыв-схемы (`/scheme/`), AI-подбор (`/ai/`), экосистема (`/ecosystem/`), партнёрам (`/partner/`), вызов мастера (`/master/`), контакты (`/contacts/`) и CRM (`/crm/`).

Пока это статический шаблон интерфейса. Интеграции с БД, авторизацией и внешними сервисами добавляются после согласования требований. Не выдавать демо-данные за реальные.

## Стек

- **Astro 5** — статическая сборка и маршрутизация.
- **TypeScript** — типизация компонентов и клиентского кода.
- **Tailwind CSS** — стили и дизайн-система.
- **Yandex Cloud Object Storage** — production-хостинг в bucket `xn--g1acsdbq.xn--p1ai`, деплой в корень bucket.

## Маршрутизация и публикация

- Production URL: `https://зиптоп.рф/` (разделы: `/`, `/scheme/`, `/ai/`, `/ecosystem/`, `/partner/`, `/master/`, `/contacts/`, `/crm/`).
- Astro base path — `/`.
- Сайт публикуется в корень `s3://xn--g1acsdbq.xn--p1ai/`; устаревшие объекты прежнего сайта (вне `dist/`) удалять только отдельной подтверждённой операцией.
- `npm run build` и `npm run build:prod` — сборка с base `/`.
- `npm run deploy:prod` — build и загрузка через Yandex Cloud CLI.

## CI/CD

Workflow `.github/workflows/deploy.yml` запускается при push в `main` и вручную. Ему нужен GitHub secret `YC_SA_JSON_CREDENTIALS`: JSON-ключ service account с правом записи в указанный bucket. Никогда не коммитить ключи, токены, ID сессий или пароли.

Перед изменением pipeline убедитесь, что деплой идёт в корень bucket `xn--g1acsdbq.xn--p1ai` без префикса.

### Обновление статических файлов

1. Изменить страницы, компоненты, стили или файлы в `public/`. Все разделы сайта собираются из этого репозитория.
2. Локально проверить изменения:

   ```bash
   npm run check
   npm run build:prod
   ```

   Production build должен завершиться без ошибок и создать `dist/` со ссылками от корня сайта.

3. Для локальной публикации в авторизованном окружении выполнить `npm run deploy:prod`. Скрипт загружает объекты в корень `s3://xn--g1acsdbq.xn--p1ai/` (пустой `DEPLOY_PREFIX`); задавать другой префикс только для осознанного стейджинга.
4. Обычная публикация выполняется автоматически после push в `main`; также workflow **Deploy site** можно запустить вручную в GitHub Actions. Он использует `YC_SA_JSON_CREDENTIALS` и ограниченный IAM-ролью `storage.uploader` аккаунт `zipstop-sa`.
5. После завершения workflow открыть `https://зиптоп.рф/` и проверить нужные страницы. HTML не кешируется надолго, но ассеты в `_astro/` могут иметь immutable cache: после изменения они должны получать новые хешированные имена.

Не удалять объекты в bucket без необходимости. Если нужно удалить устаревший файл (например, оставшийся от прежнего сайта), сначала подтвердить точный object key и выполнить отдельную безопасную операцию: текущий CI загружает новые или изменённые файлы, но не очищает bucket.

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
