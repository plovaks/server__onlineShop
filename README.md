# Серверная часть интернет-магазина по продаже источников питания

Бэкенд-часть для интернет-магазина Power Store. 

## Стек
* **Runtime:** Node.js
* **Фреймворк:** Express.js
* **База данных:** PostgreSQL 
* **Аутентификация:** JWT (Access/Refresh токены в HttpOnly Cookie)
* **Уведомления:** Nodemailer (Интеграция с Gmail SMTP)

## Эндпоинты 

### Авторизация (`/api/auth`)
* `POST /api/auth/register` — Регистрация нового пользователя (валидация ФИО, email)
* `POST /api/auth/login` — Вход в систему (выдача JWT токенов)
* `POST /api/auth/refresh` — Обновление истёкшего Access-токена
* `POST /api/auth/logout` — Выход из системы

### Профиль(требуется авторизация) (`/api/customer`) 
* `GET /api/customer/me` — Получение данных текущего пользователя
* `PATCH /api/customer/me` — Обновление ФИО
* `GET /api/customer/orders` — История заказов пользователя

### Заказы(требуется авторизация) (`/api/orders`) 
* `POST /api/orders` — Создание заказа (с проверкой остатков на складе и отправкой email-чека)

### Товары и Категории (`/api/products`, `/api/categories`)
* `GET /api/products` — Получить список всех товаров с характеристиками и изображениями
* `GET /api/products/:id` — Получить детальную информацию о товаре по ID
* `GET /api/categories` — Получить список категорий
* `GET /api/categories/:id/products` — Получить товары конкретной категории

### Панель Администратора(требуется авторизация) (`/api/admin`) 
* `GET /api/admin/users` — Список всех пользователей
* `PATCH /api/admin/users/:id/toggle-admin` — Выдача/отзыв прав администратора
* `GET /api/admin/orders` — Просмотр всех заказов в магазине
* `POST /api/admin/products` — Добавление нового товара
* `PUT /api/admin/products/:id` — Редактирование товара
* `DELETE /api/admin/products/:id` — Удаление товара

---
