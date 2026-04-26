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

app.use(cors());
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// База данных 
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

// Почта 
const transporter = nodemailer.createTransport({
    host: 'smtp.yandex.ru',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// проверка JWT 
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

//авторизация

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
            { expiresIn: '7d' }
        );
        res.status(201).json({ token, customer });
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
            { expiresIn: '7d' }
        );
        res.json({
            token,
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

// профиль

app.get('/api/customer/me', authMiddleware, async (req, res) => {
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

// заказы

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

// Создать заказ + отправить письмо
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

        // Отправить письмо пользователю
        const itemsList = items.map(item =>
            `• ${item.name} — ${item.quantity} шт. × ${item.price} ₽ = ${item.quantity * item.price} ₽`
        ).join('\n');

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

По всем вопросам вы можете написать нам:
📧 ${process.env.EMAIL_USER}

Спасибо что выбрали Power Store!`
            });
        } catch (mailErr) {
           
            console.error('Ошибка отправки письма:', mailErr);
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

// товары

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

//категории

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


app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Проверь: http://localhost:${PORT}/api/products`);
    console.log(`Статус: http://localhost:${PORT}/`);
});