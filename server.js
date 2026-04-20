const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;


app.use(cors());
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// Настройка базы данных
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Проверка подключения к БД
pool.connect((err, client, release) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.stack);
    } else {
        console.log('Подключено к PostgreSQL');
        release();
    }
});

// Корневой маршрут
app.get('/', (req, res) => {
    res.json({ message: 'API работает', status: 'ok' });
});

// Получить все товары 
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.*,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'url', pi.image_url,
                        'is_main', pi.is_main,
                        'sort_order', pi.sort_order
                    ) ORDER BY pi.sort_order)
                     FROM product_images pi 
                     WHERE pi.product_id = p.id),
                    '[]'::json
                ) AS images,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'name', s.name,
                        'value', ps.value,
                        'unit', s.unit
                    ))
                     FROM product_specifications ps
                     JOIN specifications s ON ps.spec_id = s.id
                     WHERE ps.product_id = p.id),
                    '[]'::json
                ) AS specs
            FROM products p
            ORDER BY p.id
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка при получении товаров:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить один товар по ID
app.get('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT 
                p.*,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'url', pi.image_url,
                        'is_main', pi.is_main,
                        'sort_order', pi.sort_order
                    ) ORDER BY pi.sort_order)
                     FROM product_images pi 
                     WHERE pi.product_id = p.id),
                    '[]'::json
                ) AS images,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'name', s.name,
                        'value', ps.value,
                        'unit', s.unit
                    ))
                     FROM product_specifications ps
                     JOIN specifications s ON ps.spec_id = s.id
                     WHERE ps.product_id = p.id),
                    '[]'::json
                ) AS specs
            FROM products p
            WHERE p.id = $1
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

// Получить все категории
app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка при получении категорий:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить товары по категории
app.get('/api/categories/:id/products', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT p.*,
                   COALESCE(
                       (SELECT json_agg(json_build_object(
                           'url', pi.image_url,
                           'is_main', pi.is_main,
                           'sort_order', pi.sort_order
                       ) ORDER BY pi.sort_order)
                        FROM product_images pi 
                        WHERE pi.product_id = p.id),
                       '[]'::json
                   ) AS images
            FROM products p
            WHERE p.category_id = $1
            ORDER BY p.id
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка при получении товаров по категории:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});


app.listen(PORT, '0.0.0.0', () => {
    console.log(` Сервер запущен на http://localhost:${PORT}`);
    console.log(`Проверь: http://localhost:${PORT}/api/products`);
    console.log(` Статус: http://localhost:${PORT}/`);
});