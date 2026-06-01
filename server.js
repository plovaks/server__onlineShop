const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refreshsecret';

// Настройки CORS для VK Mini App
const allowedOrigins = [
    'https://plovaks.github.io',
    'https://power-store-frontend.username.amvera.io',
    'https://vk.com',
    'https://m.vk.com',
    'https://localhost:5173',  // для разработки
    /\.railway\.app$/  // для railway доменов
];

app.use(cors({
    origin: function(origin, callback) {
        // Разрешаем запросы без origin (например, из Postman)
        if (!origin) return callback(null, true);
        
        // Проверяем, разрешен ли origin
        const isAllowed = allowedOrigins.some(allowed => {
            if (typeof allowed === 'string') return origin === allowed;
            if (allowed instanceof RegExp) return allowed.test(origin);
            return false;
        });
        
        if (isAllowed) {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// Логирование всех входящих запросов
app.use((req, res, next) => {
    console.log(` [${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(` Body:`, JSON.stringify(req.body, null, 2));
    }
    next();
});


// // ─── ТЕСТОВЫЙ ЭНДПОИНТ ДЛЯ ПРОВЕРКИ КОНФИГУРАЦИИ ─────────────────────────────
// app.get('/api/debug/config', (req, res) => {
//     res.json({
//         node_env: process.env.NODE_ENV || 'not set',
//         email_user_set: !!process.env.EMAIL_USER,
//         email_user_length: process.env.EMAIL_USER?.length || 0,
//         email_pass_set: !!process.env.EMAIL_PASS,
//         email_pass_length: process.env.EMAIL_PASS?.length || 0,
//         database_url_set: !!process.env.DATABASE_URL,
//         port: PORT,
//         env_vars: Object.keys(process.env).filter(k => !k.includes('PASS') && !k.includes('SECRET'))
//     });
// });

// // ─── ТЕСТОВЫЙ ЭНДПОИНТ ДЛЯ ПРОВЕРКИ ПОЧТЫ ────────────────────────────────────
// app.post('/api/debug/test-email', async (req, res) => {
//     const { email } = req.body;
    
//     console.log('\n🔍 === ДИАГНОСТИКА ПОЧТЫ ===');
//     console.log('1. EMAIL_USER из .env:', process.env.EMAIL_USER ? '✅ ЗАДАН' : ' НЕ ЗАДАН');
//     console.log('2. EMAIL_PASS из .env:', process.env.EMAIL_PASS ? '✅ ЗАДАН' : ' НЕ ЗАДАН');
//     console.log('3. Адрес получателя:', email || ' НЕ УКАЗАН');
    
//     if (!email) {
//         return res.status(400).json({ error: 'Укажите email в поле "email"' });
//     }
    
//     if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
//         console.error(' Ошибка: EMAIL_USER или EMAIL_PASS не заданы в .env!');
//         return res.status(500).json({ 
//             error: 'Почта не настроена: EMAIL_USER или EMAIL_PASS отсутствуют',
//             details: {
//                 email_user: !!process.env.EMAIL_USER,
//                 email_pass: !!process.env.EMAIL_PASS
//             }
//         });
//     }
    
//     try {
//         console.log('4. Попытка подключения к SMTP...');
        
//         const info = await transporter.sendMail({
//             from: `"Power Store Battery Shop" <${process.env.EMAIL_USER}>`,
//             to: email,
//             subject: 'Тестовое письмо от Power Store',
//             text: `Здравствуйте!

// Это тестовое письмо от вашего интернет-магазина Power Store.

// Если вы получили это письмо — почта настроена правильно и работает!

// Сообщение отправлено: ${new Date().toLocaleString()}

// Спасибо что выбрали Power Store!`,
//             html: `
//                 <div style="font-family: Arial, sans-serif; padding: 20px;">
//                     <h2 style="color: #F0D300;">Power Store</h2>
//                     <p>Здравствуйте!</p>
//                     <p>Это <b>тестовое письмо</b> от вашего интернет-магазина аккумуляторов.</p>
//                     <p> Если вы получили это письмо — <b style="color: green;">почта настроена правильно и работает!</b></p>
//                     <hr>
//                     <p style="color: #666; font-size: 12px;">Сообщение отправлено: ${new Date().toLocaleString()}</p>
//                 </div>
//             `
//         });
        
//         console.log('5.  Письмо УСПЕШНО отправлено!');
//         console.log('6. Message ID:', info.messageId);
//         console.log('7. Ответ сервера:', info.response);
        
//         res.json({
//             success: true,
//             messageId: info.messageId,
//             response: info.response,
//             to: email,
//             from: process.env.EMAIL_USER,
//             sentAt: new Date().toISOString()
//         });
        
//     } catch (err) {
//         console.error(' ОШИБКА ПРИ ОТПРАВКЕ ПИСЬМА:');
//         console.error('Код ошибки:', err.code);
//         console.error('Сообщение:', err.message);
//         console.error('Полный стек:', err);
        
//         res.status(500).json({
//             success: false,
//             error: err.message,
//             code: err.code,
//             details: {
//                 email_user: process.env.EMAIL_USER,
//                 email_pass_length: process.env.EMAIL_PASS?.length || 0
//             }
//         });
//     }
// });

// // ─── ТЕСТОВЫЙ ЭНДПОИНТ ДЛЯ ПРОВЕРКИ ПОДКЛЮЧЕНИЯ К БД ──────────────────────────
// app.get('/api/debug/database', async (req, res) => {
//     try {
//         const result = await pool.query('SELECT NOW() as time, version() as pg_version');
//         res.json({
//             connected: true,
//             timestamp: result.rows[0].time,
//             postgres_version: result.rows[0].pg_version
//         });
//     } catch (err) {
//         console.error('Ошибка БД:', err);
//         res.status(500).json({
//             connected: false,
//             error: err.message
//         });
//     }
// });




// ─── База данных ───────────────────────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.stack);
    } else {
        console.log('Подключено к PostgreSQL');
        release();
    }
});



// ─── Почта (Gmail SMTP с паролем приложения) ───────────────────────────────────
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    family: 4  
});

// Проверка подключения к почте
transporter.verify((error, success) => {
    if (error) {
        console.error('Ошибка настройки почты:', error);
    } else {
        console.log('Почтовый сервер Gmail готов к отправке');
        console.log('Отправитель:', process.env.EMAIL_USER);
    }
});

// ─── Middleware: проверка JWT ──────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Недействительный токен' });
    }
}
app.get('/', (req, res) => {
    res.json({ message: 'API работает', status: 'ok' });
});

// авторизация
app.post('/api/auth/register', async (req, res) => {
    const { full_name, email, password } = req.body;
    if (!full_name || !email || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    }
    if (!email.includes('@')) {
        return res.status(400).json({ error: 'Некорректный email' });
    }
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO customers (full_name, email, password)
             VALUES ($1, $2, $3)
             RETURNING id, full_name, email, created_at`,
            [full_name, email, hash]
        );
        const customer = result.rows[0];
        const token = jwt.sign(
            { id: customer.id, email: customer.email },
            JWT_SECRET,
            { expiresIn: '15m' }
        );
        const refreshToken = jwt.sign(
            { id: customer.id, email: customer.email },
            JWT_REFRESH_SECRET,
            { expiresIn: '30d' }
        );
        res.status(201).json({ token, refreshToken, customer });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
        }
        console.error('Ошибка регистрации:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    try {
        const result = await pool.query(
            'SELECT * FROM customers WHERE email = $1', [email]
        );
        const customer = result.rows[0];
        if (!customer) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }
        const valid = await bcrypt.compare(password, customer.password);
        if (!valid) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }
        const token = jwt.sign(
            { id: customer.id, email: customer.email },
            JWT_SECRET,
            { expiresIn: '15m' }
        );
        const refreshToken = jwt.sign(
            { id: customer.id, email: customer.email },
            JWT_REFRESH_SECRET,
            { expiresIn: '30d' }
        );
        res.json({
            token,
            refreshToken,
            customer: {
                id: customer.id,
                full_name: customer.full_name,
                email: customer.email,
                created_at: customer.created_at
            }
        });
    } catch (err) {
        console.error('Ошибка входа:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(401).json({ error: 'Нет refresh токена' });
    }
    try {
        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        const newToken = jwt.sign(
            { id: decoded.id, email: decoded.email },
            JWT_SECRET,
            { expiresIn: '15m' }
        );
        res.json({ token: newToken });
    } catch {
        res.status(401).json({ error: 'Refresh токен недействителен' });
    }
});

// ─── ПРОФИЛЬ ──────────────────────────────────────────────────────────────────

app.get('/api/customer/me', authMiddleware, async (req, res) => {
    console.log(' ЗАПРОС НА ЗАКАЗ ПОЛУЧЕН! ');
    try {
        const result = await pool.query(
            'SELECT id, full_name, email, created_at FROM customers WHERE id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка получения профиля:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.patch('/api/customer/me', authMiddleware, async (req, res) => {
    const { full_name } = req.body;
    if (!full_name || !full_name.trim()) {
        return res.status(400).json({ error: 'Имя не может быть пустым' });
    }
    try {
        const result = await pool.query(
            'UPDATE customers SET full_name = $1 WHERE id = $2 RETURNING id, full_name, email, created_at',
            [full_name.trim(), req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка обновления профиля:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── ЗАКАЗЫ ───────────────────────────────────────────────────────────────────

app.get('/api/customer/orders', authMiddleware, async (req, res) => {
    try {
        const ordersResult = await pool.query(
            `SELECT * FROM orders WHERE customer_id = $1 ORDER BY order_date DESC`,
            [req.user.id]
        );
        const orders = await Promise.all(ordersResult.rows.map(async (order) => {
            const itemsResult = await pool.query(
                `SELECT * FROM order_items WHERE order_id = $1`,
                [order.id]
            );
            return { ...order, items: itemsResult.rows };
        }));
        res.json(orders);
    } catch (err) {
        console.error('Ошибка получения заказов:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/orders', authMiddleware, async (req, res) => {
    const { items, total_amount } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ error: 'Корзина пуста' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const orderResult = await client.query(
            `INSERT INTO orders (customer_id, total_amount, status)
             VALUES ($1, $2, 'pending') RETURNING *`,
            [req.user.id, total_amount]
        );
        const order = orderResult.rows[0];

        for (const item of items) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, name, quantity, price)
                 VALUES ($1, $2, $3, $4, $5)`,
                [order.id, item.product_id, item.name, item.quantity, item.price]
            );
        }

        await client.query('COMMIT');

        // Формируем список товаров для письма
        const itemsList = items.map(item =>
            `• ${item.name} — ${item.quantity} шт. × ${item.price} ₽ = ${item.quantity * item.price} ₽`
        ).join('\n');

        // Отправляем письмо через Gmail SMTP
        console.log('Отправляем письмо на:', req.user.email);
        try {
            await transporter.sendMail({
                from: `"Power Store" <${process.env.EMAIL_USER}>`,
                to: req.user.email,
                subject: `Заказ №${order.id} оформлен — Power Store`,
                text: `Здравствуйте!

                Ваш заказ №${order.id} успешно оформлен.

                Состав заказа:
                ${itemsList}

                Итого: ${total_amount} ₽

                С вами свяжутся для подтверждения заказа и уточнения деталей доставки.

                Спасибо что выбрали Power Store!`
            });
            console.log('Письмо отправлено!');
        } catch (mailErr) {
            console.error('Ошибка отправки письма:', mailErr.message);
        }

        res.status(201).json({ order });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ошибка создания заказа:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
        client.release();
    }
});

// ─── ТОВАРЫ ───────────────────────────────────────────────────────────────────

app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*,
                COALESCE((SELECT json_agg(json_build_object(
                    'url', pi.image_url,'is_main', pi.is_main,'sort_order', pi.sort_order
                ) ORDER BY pi.sort_order) FROM product_images pi WHERE pi.product_id = p.id),'[]'::json) AS images,
                COALESCE((SELECT json_agg(json_build_object(
                    'name', s.name,'value', ps.value,'unit', s.unit
                )) FROM product_specifications ps JOIN specifications s ON ps.spec_id = s.id WHERE ps.product_id = p.id),'[]'::json) AS specs
            FROM products p ORDER BY p.id
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка при получении товаров:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT p.*,
                COALESCE((SELECT json_agg(json_build_object(
                    'url', pi.image_url,'is_main', pi.is_main,'sort_order', pi.sort_order
                ) ORDER BY pi.sort_order) FROM product_images pi WHERE pi.product_id = p.id),'[]'::json) AS images,
                COALESCE((SELECT json_agg(json_build_object(
                    'name', s.name,'value', ps.value,'unit', s.unit
                )) FROM product_specifications ps JOIN specifications s ON ps.spec_id = s.id WHERE ps.product_id = p.id),'[]'::json) AS specs
            FROM products p WHERE p.id = $1
        `, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка при получении товара:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── КАТЕГОРИИ ────────────────────────────────────────────────────────────────

app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка при получении категорий:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/categories/:id/products', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT p.*,
                COALESCE((SELECT json_agg(json_build_object(
                    'url', pi.image_url,'is_main', pi.is_main,'sort_order', pi.sort_order
                ) ORDER BY pi.sort_order) FROM product_images pi WHERE pi.product_id = p.id),'[]'::json) AS images
            FROM products p WHERE p.category_id = $1 ORDER BY p.id
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка при получении товаров по категории:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── Запуск ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Проверь: http://localhost:${PORT}/api/products`);
    console.log(`Статус: http://localhost:${PORT}/`);
});