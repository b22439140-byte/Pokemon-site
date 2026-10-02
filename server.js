const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'pokevault';
const SEED_FILE = path.join(__dirname, 'data', 'products.json');

function resolvePersistDir() {
    const candidates = [
        process.env.PERSIST_DIR,
        path.join(__dirname, 'persist')
    ].filter(Boolean);

    for (const dir of candidates) {
        try {
            fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
            return dir;
        } catch (err) {
            console.warn(`Kan data-map niet gebruiken (${dir}): ${err.message}`);
        }
    }

    throw new Error('Geen schrijfbare map voor producten/uploads.');
}

const PERSIST_DIR = resolvePersistDir();
const DATA_FILE = path.join(PERSIST_DIR, 'products.json');
const UPLOADS_DIR = path.join(PERSIST_DIR, 'uploads');

if (!fs.existsSync(DATA_FILE)) {
    const seed = fs.existsSync(SEED_FILE)
        ? fs.readFileSync(SEED_FILE, 'utf8')
        : '[]';
    fs.writeFileSync(DATA_FILE, seed);
}

const app = express();
const sessions = new Map();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
            cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
        }
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
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

function resolveUploadFile(imageUrl) {
    if (!imageUrl || !imageUrl.startsWith('/uploads/')) return null;
    return path.join(UPLOADS_DIR, path.basename(imageUrl));
}

function productImages(product) {
    if (!product) return [];
    if (Array.isArray(product.images) && product.images.length) {
        return product.images.filter(Boolean);
    }
    return product.image ? [product.image] : [];
}

function unlinkUploads(paths) {
    for (const filePath of paths) {
        if (filePath) fs.unlink(filePath, () => {});
    }
}

function unlinkUploadedFiles(files) {
    unlinkUploads((files || []).map((f) => f.path));
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

function parseProductBody(body, files, existing) {
    const title = String(body.title || '').trim();
    if (!title) throw new Error('Titel is verplicht.');

    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw new Error('Ongeldige prijs.');

    let oldPrice = body.oldPrice === '' || body.oldPrice == null ? null : Number(body.oldPrice);
    if (oldPrice !== null && (!Number.isFinite(oldPrice) || oldPrice < 0)) {
        throw new Error('Ongeldige oude prijs.');
    }

    let keepImages = [];
    try {
        keepImages = JSON.parse(body.keepImages || '[]');
    } catch {
        keepImages = [];
    }
    if (!Array.isArray(keepImages)) keepImages = [];
    keepImages = keepImages.map((url) => String(url).trim()).filter(Boolean);

    // Editing without an explicit keepImages list: preserve existing photos.
    if (!Object.prototype.hasOwnProperty.call(body, 'keepImages') && existing) {
        keepImages = productImages(existing);
    }

    const uploaded = (files || []).map((file) => `/uploads/${file.filename}`);
    const images = [...keepImages, ...uploaded];

    const imageUrl = body.imageUrl && String(body.imageUrl).trim();
    if (imageUrl && !images.includes(imageUrl)) {
        images.push(imageUrl);
    }

    if (!images.length) {
        throw new Error('Voeg minstens één afbeelding toe of plak een afbeeldings-URL.');
    }

    if (images.length > 10) {
        throw new Error('Maximaal 10 afbeeldingen per product.');
    }

    const badgeRaw = body.badge === '' || body.badge == null ? null : String(body.badge);
    const badge = ['sale', 'preorder', 'en'].includes(badgeRaw) ? badgeRaw : null;
    const maxQty = Number(body.maxQty);
    const inStock = body.inStock === true || body.inStock === 'true' || body.inStock === 'on' || body.inStock === '1';
    const allowedCategories = [
        'single', 'sealed', 'accessory',
        'psa-1', 'psa-2', 'psa-3', 'psa-4', 'psa-5',
        'psa-6', 'psa-7', 'psa-8', 'psa-9', 'psa-10'
    ];

    const product = {
        id: existing?.id,
        title,
        brand: String(body.brand || 'Pokémon TCG').trim(),
        price,
        oldPrice,
        badge,
        image: images[0],
        images,
        category: allowedCategories.includes(body.category)
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

    if (body.imageOpacity !== '' && body.imageOpacity != null) {
        const opacity = Number(body.imageOpacity);
        if (Number.isFinite(opacity)) product.imageOpacity = opacity;
    }

    return product;
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
    sessions.delete(req.headers.authorization.slice(7));
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
    if (!product) return res.status(404).json({ error: 'Product niet gevonden.' });
    res.json(product);
});

app.post('/api/products', requireAdmin, upload.array('images', 10), (req, res) => {
    try {
        const products = readProducts();
        const product = parseProductBody(req.body, req.files, null);
        product.id = uniqueId(String(req.body.id || '').trim() || slugify(product.title), products);
        products.push(product);
        writeProducts(products);
        res.status(201).json(product);
    } catch (err) {
        unlinkUploadedFiles(req.files);
        res.status(400).json({ error: err.message || 'Kon product niet opslaan.' });
    }
});

app.put('/api/products/:id', requireAdmin, upload.array('images', 10), (req, res) => {
    try {
        const products = readProducts();
        const index = products.findIndex((p) => p.id === req.params.id);
        if (index === -1) {
            unlinkUploadedFiles(req.files);
            return res.status(404).json({ error: 'Product niet gevonden.' });
        }

        const existing = products[index];
        const product = parseProductBody(req.body, req.files, existing);
        product.id = existing.id;

        const kept = new Set(product.images);
        for (const url of productImages(existing)) {
            if (!kept.has(url)) {
                const oldPath = resolveUploadFile(url);
                if (oldPath) fs.unlink(oldPath, () => {});
            }
        }

        products[index] = product;
        writeProducts(products);
        res.json(product);
    } catch (err) {
        unlinkUploadedFiles(req.files);
        res.status(400).json({ error: err.message || 'Kon product niet bijwerken.' });
    }
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
    const products = readProducts();
    const index = products.findIndex((p) => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Product niet gevonden.' });

    const [removed] = products.splice(index, 1);
    for (const url of productImages(removed)) {
        const oldPath = resolveUploadFile(url);
        if (oldPath) fs.unlink(oldPath, () => {});
    }
    writeProducts(products);
    res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, admin: '/admin', persist: PERSIST_DIR });
});

app.get(['/admin', '/admin/'], (_req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin.html', (_req, res) => {
    res.redirect(301, '/admin');
});

app.get(['/home', '/home/'], (_req, res) => {
    res.redirect(301, '/');
});

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname, { extensions: ['html'] }));

app.use((req, res) => {
    res.status(404).type('text').send(
        `Pagina niet gevonden: ${req.method} ${req.path}\n` +
        'Tip: open /admin of /admin.html — start de server met: npm start'
    );
});

app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Afbeelding is te groot (max 25 MB).' });
        }
        return res.status(400).json({ error: err.message });
    }
    if (err) {
        return res.status(400).json({ error: err.message || 'Er ging iets mis.' });
    }
    res.status(500).json({ error: 'Serverfout.' });
});

app.listen(PORT, () => {
    console.log(`PokeVault draait op http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin`);
    console.log(`Data: ${PERSIST_DIR}`);
    console.log(`Wachtwoord: ${ADMIN_PASSWORD === 'pokevault' ? 'pokevault (wijzig via ADMIN_PASSWORD)' : '(uit ADMIN_PASSWORD)'}`);
});
