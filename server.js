const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'pokevault';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
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

// Remove built-in demo products once; keep anything added via admin.
const DEMO_PRODUCT_IDS = new Set([
    'paldean-fates-etb',
    'pikachu-crown-zenith',
    'charizard-ex-obsidian',
    'mew-ex-151',
    'umbreon-vmax-evolving',
    'lucario-vstar-crown',
    'gardevoir-ex-sv',
    'blastoise-base-set',
    'pokemon-151-booster',
    'paradox-rift-bb',
    'temporal-forces-etb',
    'rayquaza-vmax-evolving',
    'giratina-vstar-lost-origin',
    'miraidon-ex-sv',
    'dragon-shield-sleeves',
    'charizard-base-set'
]);

try {
    const existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(existing) && existing.some((p) => DEMO_PRODUCT_IDS.has(p.id))) {
        const cleaned = existing.filter((p) => !DEMO_PRODUCT_IDS.has(p.id));
        fs.writeFileSync(DATA_FILE, JSON.stringify(cleaned, null, 2));
        console.log(`Demo producten verwijderd (${existing.length - cleaned.length}). Over: ${cleaned.length}.`);
    }
} catch (_) {
    /* ignore corrupt file; API will surface errors */
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

const ALLOWED_CATEGORIES = [
    'pokemon', 'boxen', 'boosters', 'tins', 'blisters',
    'losse-kaarten', 'accessoires', 'andere-tcg', 'lego', 'sale'
];

const LEGACY_CATEGORY_MAP = {
    single: 'losse-kaarten',
    sealed: 'boxen',
    accessory: 'accessoires'
};

function normalizeProduct(product) {
    if (!product || typeof product !== 'object') return product;

    let category = product.category;
    let psa = product.psa == null || product.psa === '' ? null : String(product.psa);

    const psaMatch = typeof category === 'string' && category.match(/^psa-(\d{1,2})$/);
    if (psaMatch) {
        psa = psaMatch[1];
        category = 'losse-kaarten';
    } else if (LEGACY_CATEGORY_MAP[category]) {
        category = LEGACY_CATEGORY_MAP[category];
    }

    if (!ALLOWED_CATEGORIES.includes(category)) {
        category = 'pokemon';
    }

    if (psa && !/^(10|[1-9])$/.test(psa)) {
        psa = null;
    }

    return { ...product, category, psa };
}

function readProducts() {
    const products = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(products) ? products.map(normalizeProduct) : products;
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
    const psaRaw = body.psa === '' || body.psa == null ? null : String(body.psa);
    const psa = psaRaw && /^(10|[1-9])$/.test(psaRaw) ? psaRaw : null;

    const product = {
        id: existing?.id,
        title,
        brand: String(body.brand || 'Pokémon TCG').trim(),
        price,
        oldPrice,
        badge,
        image: images[0],
        images,
        category: ALLOWED_CATEGORIES.includes(body.category)
            ? body.category
            : 'pokemon',
        psa,
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

const SCAN_ALLOWED_BADGES = ['sale', 'preorder', 'en'];

function extractJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('Lege AI-respons.');

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Kon geen JSON in AI-respons vinden.');
    }
    return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeScanFields(parsed) {
    const data = parsed && typeof parsed === 'object' ? parsed : {};
    let category = String(data.category || '').trim();
    if (LEGACY_CATEGORY_MAP[category]) category = LEGACY_CATEGORY_MAP[category];
    if (!ALLOWED_CATEGORIES.includes(category)) category = 'pokemon';

    const psaRaw = data.psa == null || data.psa === '' ? '' : String(data.psa).trim();
    const psa = /^(10|[1-9])$/.test(psaRaw) ? psaRaw : '';

    const badgeRaw = data.badge == null || data.badge === '' ? '' : String(data.badge).trim();
    const badge = SCAN_ALLOWED_BADGES.includes(badgeRaw) ? badgeRaw : '';

    return {
        title: String(data.title || '').trim(),
        brand: String(data.brand || 'Pokémon TCG').trim() || 'Pokémon TCG',
        category,
        psa,
        set: data.set == null || data.set === '' ? '' : String(data.set).trim(),
        type: data.type == null || data.type === '' ? '' : String(data.type).trim(),
        condition: data.condition == null || data.condition === '' ? '' : String(data.condition).trim(),
        badge,
        description: String(data.description || '').trim()
    };
}

async function scanCardWithOpenRouter(imagePath, mimeType) {
    if (!OPENROUTER_API_KEY) {
        throw new Error(
            'OPENROUTER_API_KEY ontbreekt. Stel deze env-variabele in en herstart de server.'
        );
    }

    const buffer = fs.readFileSync(imagePath);
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${buffer.toString('base64')}`;

    const categoriesList = ALLOWED_CATEGORIES.join(', ');
    const prompt = [
        'You are helping a Dutch Pokémon TCG shop fill product admin fields from a product photo.',
        'Identify the product (single card, sealed product, accessory, LEGO, etc.).',
        'Return STRICT JSON only — no markdown, no commentary — with exactly these keys:',
        'title, brand, category, psa, set, type, condition, badge, description',
        `category MUST be one of: ${categoriesList}`,
        'psa: string "1"–"10" if a PSA slab grade is clearly visible, otherwise ""',
        'badge: one of "sale", "preorder", "en", or ""',
        'brand: usually "Pokémon TCG" unless clearly another TCG/brand',
        'type: rarity or product type (e.g. Secret Rare, ETB, Booster Box)',
        'condition: only if clearly readable (e.g. Near Mint); else ""',
        'description: short Dutch product description (1–2 sentences)',
        'title: clear Dutch/English shop title including set name when known',
        'Do NOT invent a price. Do not include price fields.'
    ].join('\n');

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://pokevault.local',
            'X-Title': 'PokeVault Admin'
        },
        body: JSON.stringify({
            model: OPENROUTER_MODEL,
            temperature: 0.2,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: dataUrl } }
                    ]
                }
            ]
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail =
            payload?.error?.message ||
            payload?.message ||
            `OpenRouter fout (${response.status})`;
        throw new Error(detail);
    }

    const content = payload?.choices?.[0]?.message?.content;
    const parsed = extractJsonObject(content);
    return normalizeScanFields(parsed);
}

app.post('/api/admin/scan-card', requireAdmin, upload.single('image'), async (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'Upload één afbeelding om te scannen.' });
    }

    try {
        const fields = await scanCardWithOpenRouter(file.path, file.mimetype);
        res.json({ fields });
    } catch (err) {
        res.status(400).json({ error: err.message || 'Kaart herkennen mislukt.' });
    } finally {
        fs.unlink(file.path, () => {});
    }
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
    let productCount = 0;
    try {
        productCount = readProducts().length;
    } catch (_) {
        productCount = -1;
    }
    res.json({
        ok: true,
        admin: '/admin',
        persist: PERSIST_DIR,
        productCount,
        deployCheck: 'disk-persist-v1'
    });
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
    if (OPENROUTER_API_KEY) {
        console.log(`AI scan: aan (model ${OPENROUTER_MODEL})`);
    } else {
        console.log('AI scan: uit — stel OPENROUTER_API_KEY in om kaarten te herkennen');
    }
});
