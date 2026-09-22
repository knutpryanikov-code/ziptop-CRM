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

## Разработка

- Dev-сервер: `astro dev --background`; управление: `astro dev status`, `astro dev logs`, `astro dev stop`.
- Перед публикацией запустить `npm run check` и `npm run build:prod`.
- Поддерживать семантическую разметку, keyboard navigation, focus-состояния и контраст.
