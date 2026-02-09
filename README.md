# Music App (React + PostgreSQL API)

Стек:
- Frontend: `Vite + React`
- Backend: `Express + pg`
- База данных: `PostgreSQL`

## 1. Установка

```bash
npm install
```

## 2. Настройка окружения

Скопируй `.env.example` в `.env` и заполни значения:

```env
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=music_app
PGUSER=postgres
PGPASSWORD=your_password_here

API_HOST=127.0.0.1
API_PORT=4000
```

Для PowerShell можно задать пароль так:

```powershell
$env:PGPASSWORD="your_password_here"
```

## 3. Миграции и сиды

Схема БД теперь поднимается явными миграциями.

```bash
npm run db:migrate
npm run db:seed
```

Или одной командой:

```bash
npm run db:setup
```

## 4. Запуск backend

```bash
npm run server
```

API будет доступен по адресу `http://127.0.0.1:4000` (или по `API_HOST/API_PORT`).

## 5. Запуск frontend

В отдельном терминале:

```bash
npm run dev
```

Vite проксирует `/api/*` на backend (`127.0.0.1:4000`).

## 6. Тесты, линт, сборка

```bash
npm run test
npm run lint
npm run build
```

После `npm run build` backend автоматически раздает `dist` (если файл `dist/index.html` существует).

## 7. Авторизация (seed user)

После `npm run db:seed` создается тестовый пользователь (по умолчанию):

- `username`: `roman`
- `password`: `roman123`

Переопределяется через `.env`:

```env
SEED_USERNAME=your_login
SEED_PASSWORD=your_password
SEED_DISPLAY_NAME=Ваше имя
```

## 8. Docker (PostgreSQL + API + Frontend)

```bash
docker compose up --build
```

Сервис поднимет:

- `db` (PostgreSQL, порт `5432`)
- `app` (миграции + сиды + API + собранный frontend, порт `4000`)

Приложение будет доступно на `http://localhost:4000`.

## 9. CI

В проект добавлен workflow `CI` (`.github/workflows/ci.yml`), который на `push`/`pull_request` запускает:

```bash
npm ci
npm run lint
npm run test
npm run build
```

## Скрипты

- `npm run dev` - frontend dev server
- `npm run dev:client` - frontend dev server
- `npm run dev:server` - backend dev run
- `npm run server` - backend run
- `npm run db:migrate` - применить SQL-миграции
- `npm run db:seed` - заполнить/синхронизировать каталог
- `npm run db:setup` - миграции + сиды
- `npm run audio:import` - импорт аудио в `public/audio/tracks`
- `npm run test` - тесты (`node:test`)
- `npm run lint` - eslint
- `npm run build` - production build frontend
- `npm run preview` - preview production build

## Backend-структура

- `server/app.js` - сборка express-приложения
- `server/routes/apiRoutes.js` - API-роуты
- `server/services/catalogService.js` - бизнес-логика и DB-операции
- `server/middleware/*` - middleware
- `server/db/migrations/*` - SQL-миграции
