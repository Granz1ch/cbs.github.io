# COIN BRAWL

Кликер: +1 монета за клик, прокрут карточек (урон / хил), PvE-волны и дуэли с онлайн-игроками.

## Запуск бэкенда

Порт Node.js: **25314**

```bash
npm install
PORT=25314 npm start
```

Redis: `fi14.bot-hosting.cloud:25299`

Фронт раздаётся с того же сервера (`/`) или GitHub Pages. API по умолчанию:

`http://fi14.bot-hosting.cloud:25314`

Если другой хост:

```js
window.CBS_API = 'https://your-backend';
```
