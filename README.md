# Music App (React + PostgreSQL API)

Проект переведен с моков на реальный backend:
- frontend: `Vite + React`
- backend: `Express + pg`
- БД: `PostgreSQL`

## 1. Установка

```bash
npm install
```

## 2. Подготовка PostgreSQL

Ожидаемые параметры по умолчанию:
- `PGHOST=127.0.0.1`
- `PGPORT=5432`
- `PGDATABASE=music_app`
- `PGUSER=postgres`
- `PGPASSWORD=<твой_пароль>`

Если база и таблицы уже созданы вручную, можно сразу запускать сервер.
Если чего-то не хватает, backend сам создаст недостающие таблицы и дозаполнит релизы.

## 3. Запуск backend

PowerShell:

```powershell
$env:PGPASSWORD=\"your_password_here\"
npm run server
```

Сервер поднимется на `http://127.0.0.1:4000`.

## 4. Запуск frontend

В отдельном терминале:

```bash
npm run dev
```

Vite проксирует запросы `/api/*` на backend (`127.0.0.1:4000`).

## Скрипты

- `npm run dev` - frontend dev server
- `npm run dev:client` - frontend dev server
- `npm run dev:server` - backend dev run
- `npm run server` - backend run
- `npm run build` - production build frontend
- `npm run preview` - preview build frontend
