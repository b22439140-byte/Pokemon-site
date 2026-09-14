const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'pokevault';
const DATA_FILE = path.join(__dirname, 'data', 'products.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]');
}

const app = express();
const sessions = new Map();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        const safe = crypto.randomBytes(12).toString('hex');
        cb(null, `${Date.now()}-${safe}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Alleen JPEG, PNG, WebP of GIF toegestaan.'));
        }
    }
});

function readProducts() {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeProducts(products) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2));
}

function slugify(text) {
    return String(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || `product-${Date.now()}`;
}

function uniqueId(base, products, excludeId) {
    let id = base;
    let n = 2;
    while (products.some((p) => p.id === id && p.id !== excludeId)) {
        id = `${base}-${n}`;
        n += 1;
    }
    return id;
}

function parseProductBody(body, file, existing) {
    const title = String(body.title || '').trim();
    if (!title) {
        throw new Error('Titel is verplicht.');
    }

    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
        throw new Error('Ongeldige prijs.');
    }

    let oldPrice = body.oldPrice === '' || body.oldPrice == null ? null : Number(body.oldPrice);
    if (oldPrice !== null && (!Number.isFinite(oldPrice) || oldPrice < 0)) {
        throw new Error('Ongeldige oude prijs.');
    }

    let image = existing?.image || '';
    if (file) {
        image = `/uploads/${file.filename}`;
    } else if (body.imageUrl && String(body.imageUrl).trim()) {
        image = String(body.imageUrl).trim();
    }

    if (!image) {
        throw new Error('Voeg een afbeelding toe of plak een afbeeldings-URL.');
    }

    const badgeRaw = body.badge === '' || body.badge == null ? null : String(body.badge);
    const badge = badgeRaw === 'sale' || badgeRaw === 'preorder' ? badgeRaw : null;

    const maxQty = Number(body.maxQty);
    const inStock = body.inStock === true || body.inStock === 'true' || body.inStock === 'on' || body.inStock === '1';

    return {
        id: existing?.id,
        title,
        brand: String(body.brand || 'Pokémon TCG').trim(),
        price,
        oldPrice,
        badge,
        image,
        imageOpacity: body.imageOpacity === '' || body.imageOpacity == null
            ? undefined
            : Number(body.imageOpacity),
        category: ['single', 'sealed', 'accessory'].includes(body.category)
            ? body.category
            : 'single',
        set: body.set === '' || body.set == null ? null : String(body.set).trim(),
        type: String(body.type || '').trim() || 'Overig',
        condition: body.condition === '' || body.condition == null
            ? null
            : String(body.condition).trim(),
        description: String(body.description || '').trim(),
        inStock: body.inStock == null ? (existing?.inStock ?? true) : inStock,
        maxQty: Number.isFinite(maxQty) && maxQty > 0 ? Math.floor(maxQty) : 10,
        buttonLabel: String(body.buttonLabel || 'In winkelwagen').trim() || 'In winkelwagen'
    };
}

function requireAdmin(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Niet ingelogd. Log opnieuw in.' });
    }
    next();
}

app.post('/api/admin/login', (req, res) => {
    const password = String(req.body?.password || '');
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Onjuist wachtwoord.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now());
    res.json({ token });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
    const token = req.headers.authorization.slice(7);
    sessions.delete(token);
    res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (_req, res) => {
    res.json({ ok: true });
});

app.get('/api/products', (_req, res) => {
    res.json(readProducts());
});

app.get('/api/products/:id', (req, res) => {
    const product = readProducts().find((p) => p.id === req.params.id);
    if (!product) {
        return res.status(404).json({ error: 'Product niet gevonden.' });
    }
    res.json(product);
});

app.post('/api/products', requireAdmin, upload.single('image'), (req, res) => {
    try {
        const products = readProducts();
        const product = parseProductBody(req.body, req.file, null);
        const requestedId = String(req.body.id || '').trim();
        product.id = uniqueId(requestedId || slugify(product.title), products);
        if (product.imageOpacity !== undefined && !Number.isFinite(product.imageOpacity)) {
            delete product.imageOpacity;
        }
        products.push(product);
        writeProducts(products);
        res.status(201).json(product);
    } catch (err) {
        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }
        res.status(400).json({ error: err.message || 'Kon product niet opslaan.' });
    }
});

app.put('/api/products/:id', requireAdmin, upload.single('image'), (req, res) => {
    try {
        const products = readProducts();
        const index = products.findIndex((p) => p.id === req.params.id);
        if (index === -1) {
            return res.status(404).json({ error: 'Product niet gevonden.' });
        }

        const existing = products[index];
        const product = parseProductBody(req.body, req.file, existing);
        product.id = existing.id;

        if (product.imageOpacity !== undefined && !Number.isFinite(product.imageOpacity)) {
            delete product.imageOpacity;
        } else if (product.imageOpacity === undefined) {
            delete product.imageOpacity;
        }

        if (req.file && existing.image && existing.image.startsWith('/uploads/')) {
            const oldPath = path.join(__dirname, existing.image);
            fs.unlink(oldPath, () => {});
        }

        products[index] = product;
        writeProducts(products);
        res.json(product);
    } catch (err) {
        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }
        res.status(400).json({ error: err.message || 'Kon product niet bijwerken.' });
    }
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
    const products = readProducts();
    const index = products.findIndex((p) => p.id === req.params.id);
    if (index === -1) {
        return res.status(404).json({ error: 'Product niet gevonden.' });
    }

    const [removed] = products.splice(index, 1);
    if (removed.image && removed.image.startsWith('/uploads/')) {
        fs.unlink(path.join(__dirname, removed.image), () => {});
    }
    writeProducts(products);
    res.json({ ok: true });
});

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
    }
    if (err) {
        return res.status(400).json({ error: err.message || 'Er ging iets mis.' });
    }
    res.status(500).json({ error: 'Serverfout.' });
});

app.listen(PORT, () => {
    console.log(`PokeVault draait op http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin.html`);
    console.log(`Wachtwoord: ${ADMIN_PASSWORD === 'pokevault' ? 'pokevault (wijzig via ADMIN_PASSWORD)' : '(uit ADMIN_PASSWORD)'}`);
});
