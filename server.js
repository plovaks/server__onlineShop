const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refreshsecret';

// Настройки CORS для VK Mini App
const allowedOrigins = [
    'https://plovaks.github.io',
    'https://power-store-frontend-plovaks.amvera.io',
    'https://vk.com',
    'https://m.vk.com',
    'https://localhost:5173',
    'http://localhost:3001',
    'http://localhost:3000',
    /\.railway\.app$/
];

const dns = require('dns').promises;

async function isDomainValid(email) {
    const domain = email.split('@')[1];
    try {
        const mxRecords = await dns.resolveMx(domain);
        return mxRecords && mxRecords.length > 0;
    } catch (error) {
        return false;
    }
}

const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const isValidFullName = (name) => {
    const nameRegex = /^[A-Za-zА-Яа-я\s\-]{2,50}$/;
    return nameRegex.test(name.trim());
};

const isValidPassword = (password) => {
    return password && password.length >= 6;
};

app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);
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
app.use(cookieParser());
app.use('/images', express.static(path.join(__dirname, 'public/images')));

app.use((req, res, next) => {
    console.log(` [${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(` Body:`, JSON.stringify(req.body, null, 2));
    }
    next();
});

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

transporter.verify((error, success) => {
    if (error) {
        console.error('Ошибка настройки почты:', error);
    } else {
        console.log('Почтовый сервер Gmail готов к отправке');
        console.log('Отправитель:', process.env.EMAIL_USER);
    }
});

// Middleware: проверка JWT из кук или из заголовка
function authMiddleware(req, res, next) {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Токен истёк' });
        }
        res.status(401).json({ error: 'Недействительный токен' });
    }
}

async function adminMiddleware(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    try {
        const result = await pool.query(
            'SELECT is_admin FROM customers WHERE id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0 || !result.rows[0].is_admin) {
            return res.status(403).json({ error: 'Доступ запрещён. Требуются права администратора.' });
        }
        next();
    } catch (err) {
        console.error('Ошибка проверки прав администратора:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
}

app.get('/', (req, res) => {
    res.json({ message: 'API работает', status: 'ok' });
});

// ─── АВТОРИЗАЦИЯ ──────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
    const { full_name, email, password } = req.body;
    if (!full_name || !email || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    if (!isValidFullName(full_name)) {
        return res.status(400).json({ error: 'ФИО должно содержать только буквы, пробелы и дефисы (2-50 символов)' });
    }
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Введите корректный email' });
    }
    const isDomainExist = await isDomainValid(email);
    if (!isDomainExist) {
        return res.status(400).json({ error: 'Такой email домен не существует. Проверьте правильность написания email' });
    }
    if (!isValidPassword(password)) {
        return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
    }
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO customers (full_name, email, password)
             VALUES ($1, $2, $3)
             RETURNING id, full_name, email, created_at, is_admin`,
            [full_name.trim(), email.toLowerCase(), hash]
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

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 15 * 60 * 1000
        });
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        res.status(201).json({ customer });
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
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Введите корректный email' });
    }
    try {
        const result = await pool.query(
            'SELECT * FROM customers WHERE email = $1',
            [email.toLowerCase()]
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

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 15 * 60 * 1000
        });
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        res.json({
            customer: {
                id: customer.id,
                full_name: customer.full_name,
                email: customer.email,
                created_at: customer.created_at,
                is_admin: customer.is_admin
            }
        });
    } catch (err) {
        console.error('Ошибка входа:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/auth/refresh', async (req, res) => {
    const refreshToken = req.cookies.refreshToken;
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

        res.cookie('token', newToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 15 * 60 * 1000
        });

        res.json({ success: true });
    } catch {
        res.status(401).json({ error: 'Refresh токен недействителен' });
    }
});

app.post('/api/auth/logout', async (req, res) => {
    res.clearCookie('token');
    res.clearCookie('refreshToken');
    res.json({ success: true });
});

// ─── ПРОФИЛЬ ──────────────────────────────────────────────────────────────────

app.get('/api/customer/me', authMiddleware, async (req, res) => {
    console.log(' ЗАПРОС НА ПРОФИЛЬ ПОЛУЧЕН! ');
    try {
        const result = await pool.query(
            'SELECT id, full_name, email, created_at, is_admin FROM customers WHERE id = $1',
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

        for (const item of items) {
            const productResult = await client.query(
                'SELECT stock FROM products WHERE id = $1',
                [item.product_id]
            );

            if (productResult.rows.length === 0) {
                throw new Error(`Товар с id ${item.product_id} не найден`);
            }

            const currentStock = productResult.rows[0].stock;
            if (currentStock < item.quantity) {
                throw new Error(`Недостаточно товара "${item.name}". В наличии: ${currentStock} шт.`);
            }

            await client.query(
                'UPDATE products SET stock = stock - $1 WHERE id = $2',
                [item.quantity, item.product_id]
            );
        }

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

        const itemsList = items.map(item =>
            `• ${item.name} — ${item.quantity} шт. × ${item.price} ₽ = ${item.quantity * item.price} ₽`
        ).join('\n');

        console.log('Отправляем письмо на:', req.user.email);
        try {
            await transporter.sendMail({
                from: `"Power Store" <${process.env.EMAIL_USER}>`,
                to: req.user.email,
                subject: `Заказ №${order.id} оформлен — Power Store`,
                text: `Здравствуйте!\n\nВаш заказ №${order.id} успешно оформлен.\n\nСостав заказа:\n${itemsList}\n\nИтого: ${total_amount} ₽\n\nС вами свяжутся для подтверждения заказа и уточнения деталей доставки.\n\nСпасибо что выбрали Power Store!`
            });
            console.log('Письмо отправлено!');
        } catch (mailErr) {
            console.error('Ошибка отправки письма:', mailErr.message);
        }

        res.status(201).json({ order });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ошибка создания заказа:', err);
        res.status(400).json({ error: err.message || 'Ошибка сервера' });
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

// ─── АДМИН ПАНЕЛЬ ─────────────────────────────────────────────────────────────

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, full_name, email, created_at, is_admin FROM customers ORDER BY id'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка получения пользователей:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.patch('/api/admin/users/:id/toggle-admin', authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;
    const { is_admin } = req.body;

    if (parseInt(id) === req.user.id && is_admin === false) {
        return res.status(400).json({ error: 'Нельзя снять права администратора с самого себя' });
    }

    try {
        const result = await pool.query(
            'UPDATE customers SET is_admin = $1 WHERE id = $2 RETURNING id, full_name, email, is_admin',
            [is_admin, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка обновления прав:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/admin/orders', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*, c.full_name, c.email
            FROM orders o
            JOIN customers c ON o.customer_id = c.id
            ORDER BY o.order_date DESC
        `);

        const orders = await Promise.all(result.rows.map(async (order) => {
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

// ── POST: добавить товар ──────────────────────────────────────────────────────
app.post('/api/admin/products', authMiddleware, adminMiddleware, async (req, res) => {
    const { name, model, price, type_size, brand, in_stock } = req.body; // ← type_size

    if (!name || !price) {
        return res.status(400).json({ error: 'Название и цена обязательны' });
    }

    const priceValue = parseFloat(price);
    const stockValue = parseInt(in_stock) || 0;

    if (isNaN(priceValue) || priceValue < 0) {
        return res.status(400).json({ error: 'Некорректная цена' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO products (name, model, price, type_size, brand, stock)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [name, model || null, priceValue, type_size || null, brand || null, stockValue] // ← type_size
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка добавления товара:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── PUT: обновить товар ───────────────────────────────────────────────────────
app.put('/api/admin/products/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;
    const { name, model, price, type_size, brand, in_stock } = req.body; // ← type_size

    const priceValue = parseFloat(price);
    const stockValue = parseInt(in_stock);

    if (isNaN(priceValue) || priceValue < 0) {
        return res.status(400).json({ error: 'Некорректная цена' });
    }
    if (isNaN(stockValue) || stockValue < 0) {
        return res.status(400).json({ error: 'Некорректное количество на складе' });
    }

    try {
        const result = await pool.query(
            `UPDATE products
             SET name      = $1,
                 model     = NULLIF($2, ''),
                 price     = $3,
                 type_size = NULLIF($4, ''),
                 brand     = NULLIF($5, ''),
                 stock     = $6
             WHERE id = $7
             RETURNING *`,
            [name, model || '', priceValue, type_size || '', brand || '', stockValue, id] // ← type_size
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Товар не найден' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка обновления товара:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── DELETE: удалить товар ─────────────────────────────────────────────────────
app.delete('/api/admin/products/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        res.json({ message: 'Товар удалён' });
    } catch (err) {
        console.error('Ошибка удаления товара:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ── GET: все товары для админа ────────────────────────────────────────────────
app.get('/api/admin/products', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*,
                COALESCE((SELECT json_agg(json_build_object(
                    'url', pi.image_url, 'is_main', pi.is_main, 'sort_order', pi.sort_order
                ) ORDER BY pi.sort_order) FROM product_images pi WHERE pi.product_id = p.id), '[]'::json) AS images,
                COALESCE((SELECT json_agg(json_build_object(
                    'name', s.name, 'value', ps.value, 'unit', s.unit
                )) FROM product_specifications ps JOIN specifications s ON ps.spec_id = s.id WHERE ps.product_id = p.id), '[]'::json) AS specs
            FROM products p ORDER BY p.id
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка получения товаров:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── Запуск ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Проверь: http://localhost:${PORT}/api/products`);
    console.log(`Статус: http://localhost:${PORT}/`);
});