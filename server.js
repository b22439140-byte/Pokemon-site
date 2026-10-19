const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Optional local .env (Render/cloud zet env vars in het dashboard)
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, 'utf8').split(/\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq < 1) continue;
            const key = trimmed.slice(0, eq).trim();
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
            let value = trimmed.slice(eq + 1).trim();
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        }
    }
} catch (_) {
    /* ignore unreadable .env */
}

const { createBunqClient } = require('./lib/bunq');
const email = require('./lib/email');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'pokevault';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const BUNQ_API_KEY = String(process.env.BUNQ_API_KEY || '').trim();
const BUNQ_SANDBOX = /^(1|true|yes)$/i.test(String(process.env.BUNQ_SANDBOX || '').trim());
const BUNQ_MONETARY_ACCOUNT_ID = String(process.env.BUNQ_MONETARY_ACCOUNT_ID || '').trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
const SHIPPING_FEE_DOMESTIC = 6.95;
const SHIPPING_FEE_INTERNATIONAL = 14.95;
const FREE_SHIPPING_FROM_DOMESTIC = 100;
const FREE_SHIPPING_FROM_INTERNATIONAL = 150;
const DOMESTIC_COUNTRIES = new Set(['NL', 'BE']);
const ALLOWED_COUNTRIES = new Set([
    'NL', 'BE', 'DE', 'AT', 'FR', 'LU', 'GB', 'IE', 'IT', 'ES', 'PT', 'PL',
    'SE', 'NO', 'DK', 'FI', 'CH', 'US', 'CA', 'AU', 'JP', 'SG', 'OTHER'
]);
const CRYPTO_WALLET_ADDRESS = String(process.env.CRYPTO_WALLET_ADDRESS || '').trim();
const CRYPTO_WALLET_NETWORK = String(process.env.CRYPTO_WALLET_NETWORK || 'BTC / ETH / USDT').trim();

function shippingFor(subtotal, countryCode) {
    const country = String(countryCode || 'NL').toUpperCase();
    if (DOMESTIC_COUNTRIES.has(country)) {
        return subtotal >= FREE_SHIPPING_FROM_DOMESTIC ? 0 : SHIPPING_FEE_DOMESTIC;
    }
    return subtotal >= FREE_SHIPPING_FROM_INTERNATIONAL ? 0 : SHIPPING_FEE_INTERNATIONAL;
}
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
const CONTACTS_FILE = path.join(PERSIST_DIR, 'contacts.json');
const ORDERS_FILE = path.join(PERSIST_DIR, 'orders.json');
const UPLOADS_DIR = path.join(PERSIST_DIR, 'uploads');

let bunqClient = null;
function getBunqClient() {
    if (!BUNQ_API_KEY) {
        throw new Error('Betalingen zijn niet geconfigureerd (BUNQ_API_KEY ontbreekt).');
    }
    if (!bunqClient) {
        bunqClient = createBunqClient({
            apiKey: BUNQ_API_KEY,
            persistDir: PERSIST_DIR,
            sandbox: BUNQ_SANDBOX,
            monetaryAccountId: BUNQ_MONETARY_ACCOUNT_ID || null
        });
    }
    return bunqClient;
}

if (!fs.existsSync(DATA_FILE)) {
    const seed = fs.existsSync(SEED_FILE)
        ? fs.readFileSync(SEED_FILE, 'utf8')
        : '[]';
    fs.writeFileSync(DATA_FILE, seed);
}

if (!fs.existsSync(CONTACTS_FILE)) {
    fs.writeFileSync(CONTACTS_FILE, '[]');
}

if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, '[]');
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

const ALLOWED_PURCHASE_MODES = ['cart', 'contact'];
const CONTACT_SUBJECT_LABELS = {
    order: 'Vraag over bestelling',
    product: 'Vraag over product / conditie',
    return: 'Retour of ruil',
    wholesale: 'Groothandel / bulk',
    interest: 'Interesse in product',
    other: 'Overig'
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

    let purchaseMode = product.purchaseMode;
    if (!ALLOWED_PURCHASE_MODES.includes(purchaseMode)) {
        const label = String(product.buttonLabel || '').toLowerCase();
        purchaseMode = /contact|neem contact/i.test(label) ? 'contact' : 'cart';
    }
    const buttonLabel = purchaseMode === 'contact' ? 'Neem contact op' : 'In winkelwagen';

    return { ...product, category, psa, purchaseMode, buttonLabel };
}

function readProducts() {
    const products = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(products) ? products.map(normalizeProduct) : products;
}

function writeProducts(products) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2));
}

function readContacts() {
    try {
        const contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
        return Array.isArray(contacts) ? contacts : [];
    } catch {
        return [];
    }
}

function writeContacts(contacts) {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

function readOrders() {
    try {
        const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
        return Array.isArray(orders) ? orders : [];
    } catch {
        return [];
    }
}

function writeOrders(orders) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

function formatMoney(amount) {
    return Number(amount).toFixed(2);
}

function publicOrderView(order) {
    const paymentMethod = order.paymentMethod === 'crypto' ? 'crypto' : 'bunq';
    return {
        id: order.id,
        status: order.status,
        createdAt: order.createdAt,
        paidAt: order.paidAt || null,
        customer: {
            name: order.customer?.name || null,
            email: order.customer?.email || null
        },
        items: order.items,
        subtotal: order.subtotal,
        shipping: order.shipping,
        total: order.total,
        paymentUrl: order.paymentUrl || null,
        paymentMethod,
        crypto: paymentMethod === 'crypto'
            ? {
                network: CRYPTO_WALLET_NETWORK,
                address: CRYPTO_WALLET_ADDRESS || null
            }
            : null,
        currency: 'EUR'
    };
}

async function refreshOrderPaymentStatus(order) {
    if (!order || order.status === 'paid' || !order.bunqMeTabId) {
        return order;
    }

    const bunq = getBunqClient();
    const tab = await bunq.getBunqMeTab(order.bunqMeTabId);
    order.bunqStatus = tab.status;
    if (tab.shareUrl) order.paymentUrl = tab.shareUrl;

    if (bunq.isTabPaid(tab)) {
        order.status = 'paid';
        order.paidAt = order.paidAt || new Date().toISOString();
    } else if (tab.status === 'CANCELLED' || tab.status === 'EXPIRED') {
        order.status = order.status === 'paid' ? 'paid' : String(tab.status).toLowerCase();
    }

    return order;
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

    let purchaseMode = String(body.purchaseMode || '').trim();
    if (!ALLOWED_PURCHASE_MODES.includes(purchaseMode)) {
        const legacyLabel = String(body.buttonLabel || existing?.buttonLabel || '').toLowerCase();
        purchaseMode = /contact|neem contact/i.test(legacyLabel) ? 'contact' : 'cart';
    }
    const buttonLabel = purchaseMode === 'contact' ? 'Neem contact op' : 'In winkelwagen';

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
        purchaseMode,
        buttonLabel
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

app.post('/api/contact', (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        const email = String(req.body?.email || '').trim();
        const phone = String(req.body?.phone || '').trim();
        const subject = String(req.body?.subject || '').trim();
        const order = String(req.body?.order || '').trim();
        const message = String(req.body?.message || '').trim();
        const productId = String(req.body?.productId || '').trim();
        const productTitle = String(req.body?.productTitle || '').trim();

        if (!name || name.length > 120) {
            return res.status(400).json({ error: 'Vul een geldige naam in.' });
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
            return res.status(400).json({ error: 'Vul een geldig e-mailadres in.' });
        }
        if (phone && phone.length > 40) {
            return res.status(400).json({ error: 'Telefoonnummer is te lang.' });
        }
        if (!Object.prototype.hasOwnProperty.call(CONTACT_SUBJECT_LABELS, subject)) {
            return res.status(400).json({ error: 'Kies een geldig onderwerp.' });
        }
        if (!message || message.length < 5 || message.length > 4000) {
            return res.status(400).json({ error: 'Schrijf een bericht van minimaal 5 tekens.' });
        }
        if (order.length > 80) {
            return res.status(400).json({ error: 'Bestelnummer is te lang.' });
        }

        let resolvedProduct = null;
        if (productId) {
            resolvedProduct = readProducts().find((p) => p.id === productId) || null;
        }

        const contact = {
            id: crypto.randomBytes(12).toString('hex'),
            createdAt: new Date().toISOString(),
            name,
            email,
            phone: phone || null,
            subject,
            subjectLabel: CONTACT_SUBJECT_LABELS[subject],
            order: order || null,
            message,
            productId: resolvedProduct?.id || productId || null,
            productTitle: resolvedProduct?.title || productTitle || null,
            productImage: resolvedProduct?.image || null,
            productPrice: resolvedProduct?.price ?? null,
            status: 'new'
        };

        const contacts = readContacts();
        contacts.unshift(contact);
        writeContacts(contacts);
        res.status(201).json({ ok: true, id: contact.id });
    } catch (err) {
        res.status(400).json({ error: err.message || 'Kon bericht niet opslaan.' });
    }
});

app.post('/api/checkout', async (req, res) => {
    try {
        const paymentMethod = String(req.body?.paymentMethod || 'bunq').trim().toLowerCase() === 'crypto'
            ? 'crypto'
            : 'bunq';

        if (paymentMethod === 'bunq' && !BUNQ_API_KEY) {
            return res.status(503).json({ error: 'Betalingen zijn nog niet geconfigureerd.' });
        }

        const baseUrl = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
        const itemsInput = Array.isArray(req.body?.items) ? req.body.items : [];
        if (!itemsInput.length) {
            return res.status(400).json({ error: 'Je winkelwagen is leeg.' });
        }

        const customer = req.body?.customer || {};
        const name = String(customer.name || '').trim();
        const email = String(customer.email || '').trim();
        const phone = String(customer.phone || '').trim();
        const country = String(customer.address?.country || customer.country || 'NL')
            .trim()
            .toUpperCase() || 'NL';
        const address = {
            line1: String(customer.address?.line1 || customer.street || '').trim(),
            line2: String(customer.address?.line2 || '').trim(),
            postalCode: String(customer.address?.postalCode || customer.postalCode || '').trim(),
            city: String(customer.address?.city || customer.city || '').trim(),
            country: ALLOWED_COUNTRIES.has(country) ? country : 'OTHER'
        };

        if (!name || name.length > 120) {
            return res.status(400).json({ error: 'Vul een geldige naam in.' });
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
            return res.status(400).json({ error: 'Vul een geldig e-mailadres in.' });
        }
        if (phone && phone.length > 40) {
            return res.status(400).json({ error: 'Telefoonnummer is te lang.' });
        }
        if (!address.line1 || address.line1.length > 200) {
            return res.status(400).json({ error: 'Vul een geldig adres in.' });
        }
        if (!address.postalCode || address.postalCode.length > 20) {
            return res.status(400).json({ error: 'Vul een geldige postcode in.' });
        }
        if (!address.city || address.city.length > 100) {
            return res.status(400).json({ error: 'Vul een geldige plaats in.' });
        }

        const products = readProducts();
        const byId = new Map(products.map((p) => [p.id, p]));
        const lineItems = [];

        for (const raw of itemsInput) {
            const productId = String(raw?.productId || raw?.id || '').trim();
            const qty = Math.max(1, Math.min(99, parseInt(raw?.qty || raw?.quantity || 1, 10) || 1));
            const product = byId.get(productId);
            if (!product) {
                return res.status(400).json({ error: `Product niet gevonden: ${productId || '?'}` });
            }
            if (product.purchaseMode === 'contact') {
                return res.status(400).json({
                    error: `"${product.title}" kan niet via de winkelwagen besteld worden.`
                });
            }
            const price = Number(product.price);
            if (!Number.isFinite(price) || price < 0) {
                return res.status(400).json({ error: `Ongeldige prijs voor ${product.title}.` });
            }
            lineItems.push({
                productId: product.id,
                title: product.title,
                image: product.image || productImages(product)[0] || null,
                price,
                quantity: qty,
                lineTotal: Number(formatMoney(price * qty))
            });
        }

        const subtotal = Number(formatMoney(lineItems.reduce((sum, item) => sum + item.lineTotal, 0)));
        const shipping = Number(formatMoney(shippingFor(subtotal, address.country)));
        const total = Number(formatMoney(subtotal + shipping));
        if (total <= 0) {
            return res.status(400).json({ error: 'Totaalbedrag moet groter dan €0 zijn.' });
        }

        const orderId = crypto.randomBytes(12).toString('hex');
        const orderUrl = `${baseUrl}/bestelling?order=${encodeURIComponent(orderId)}`;
        const description = `PokeVault #${orderId.slice(0, 8)}`;

        let order = {
            id: orderId,
            createdAt: new Date().toISOString(),
            status: 'pending',
            paidAt: null,
            paymentMethod,
            customer: { name, email, phone: phone || null, address },
            items: lineItems,
            subtotal,
            shipping,
            total,
            bunqMeTabId: null,
            bunqStatus: null,
            paymentUrl: null,
            description
        };

        if (paymentMethod === 'bunq') {
            const bunq = getBunqClient();
            const tab = await bunq.createBunqMeTab({
                amount: total,
                description,
                redirectUrl: orderUrl
            });

            if (!tab.shareUrl) {
                return res.status(502).json({ error: 'bunq gaf geen betaallink terug.' });
            }

            order.bunqMeTabId = tab.id;
            order.bunqStatus = tab.status;
            order.paymentUrl = tab.shareUrl;
        }

        const orders = readOrders();
        orders.unshift(order);
        writeOrders(orders);

        try {
            await email.notifyOrderPlaced(order, { orderUrl });
            orders[0] = order;
            writeOrders(orders);
        } catch (err) {
            console.error('Order e-mails mislukt:', err.message || err);
        }

        res.status(201).json({
            orderId: order.id,
            paymentUrl: order.paymentUrl,
            orderUrl,
            paymentMethod: order.paymentMethod,
            total: order.total,
            status: order.status
        });
    } catch (err) {
        console.error('Checkout fout:', err.message || err);
        res.status(502).json({ error: err.message || 'Kon betaling niet starten.' });
    }
});

app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
    const orders = readOrders();
    const index = orders.findIndex((o) => o.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Bestelling niet gevonden.' });

    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!['paid', 'pending', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Ongeldige status.' });
    }

    const previousStatus = orders[index].status;
    orders[index].status = status;
    if (status === 'paid') {
        orders[index].paidAt = orders[index].paidAt || new Date().toISOString();
    } else if (status === 'pending') {
        orders[index].paidAt = null;
    }

    if (status === 'paid' && previousStatus !== 'paid') {
        const baseUrl = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
        const orderUrl = email.orderPageUrl(orders[index], baseUrl);
        try {
            await email.notifyOrderPaid(orders[index], { orderUrl });
        } catch (err) {
            console.error('Betalingsbevestiging e-mail mislukt:', err.message || err);
        }
    }

    writeOrders(orders);
    res.json(orders[index]);
});

app.get('/api/orders/:id', async (req, res) => {
    try {
        const orders = readOrders();
        const index = orders.findIndex((o) => o.id === req.params.id);
        if (index === -1) {
            return res.status(404).json({ error: 'Bestelling niet gevonden.' });
        }

        let order = orders[index];
        const wasPaid = order.status === 'paid';
        if (order.status === 'pending' && order.bunqMeTabId && BUNQ_API_KEY) {
            try {
                order = await refreshOrderPaymentStatus(order);
                orders[index] = order;
                writeOrders(orders);

                if (!wasPaid && order.status === 'paid') {
                    const baseUrl = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
                    const orderUrl = email.orderPageUrl(order, baseUrl);
                    try {
                        await email.notifyOrderPaid(order, { orderUrl });
                        orders[index] = order;
                        writeOrders(orders);
                    } catch (err) {
                        console.error('Betalingsbevestiging e-mail mislukt:', err.message || err);
                    }
                }
            } catch (err) {
                console.warn('bunq status check mislukt:', err.message || err);
            }
        }

        res.json(publicOrderView(order));
    } catch (err) {
        res.status(500).json({ error: err.message || 'Kon bestelling niet laden.' });
    }
});

app.get('/api/admin/orders', requireAdmin, (_req, res) => {
    res.json(readOrders());
});

app.get('/api/admin/contacts', requireAdmin, (_req, res) => {
    res.json(readContacts());
});

app.patch('/api/admin/contacts/:id', requireAdmin, (req, res) => {
    const contacts = readContacts();
    const index = contacts.findIndex((c) => c.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Bericht niet gevonden.' });

    const status = String(req.body?.status || '').trim();
    if (!['new', 'done'].includes(status)) {
        return res.status(400).json({ error: 'Ongeldige status.' });
    }

    contacts[index] = { ...contacts[index], status };
    writeContacts(contacts);
    res.json(contacts[index]);
});

app.delete('/api/admin/contacts/:id', requireAdmin, (req, res) => {
    const contacts = readContacts();
    const index = contacts.findIndex((c) => c.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Bericht niet gevonden.' });
    contacts.splice(index, 1);
    writeContacts(contacts);
    res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
    let productCount = 0;
    let contactCount = 0;
    let orderCount = 0;
    try {
        productCount = readProducts().length;
    } catch (_) {
        productCount = -1;
    }
    try {
        contactCount = readContacts().length;
    } catch (_) {
        contactCount = -1;
    }
    try {
        orderCount = readOrders().length;
    } catch (_) {
        orderCount = -1;
    }
    res.json({
        ok: true,
        admin: '/admin',
        persist: PERSIST_DIR,
        productCount,
        contactCount,
        orderCount,
        bunqConfigured: Boolean(BUNQ_API_KEY),
        bunqSandbox: BUNQ_SANDBOX,
        deployCheck: 'disk-persist-v1'
    });
});

app.get(['/admin', '/admin/'], (_req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get(['/home', '/home/'], (_req, res) => {
    res.redirect(301, '/');
});

// Clean URLs: /contact.html → /contact (preserve query string)
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!req.path.endsWith('.html')) return next();
    let clean = req.path.slice(0, -'.html'.length);
    if (clean === '/index' || clean === '') clean = '/';
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, clean + qs);
});

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname, { extensions: ['html'] }));

app.use((req, res) => {
    res.status(404).type('text').send(
        `Pagina niet gevonden: ${req.method} ${req.path}\n` +
        'Tip: open /admin — start de server met: npm start'
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
    if (BUNQ_API_KEY) {
        console.log(`bunq checkout: aan (${BUNQ_SANDBOX ? 'sandbox' : 'production'})`);
    } else {
        console.log('bunq checkout: uit — stel BUNQ_API_KEY in om betalingen te activeren');
    }
    if (email.isConfigured()) {
        console.log('Order e-mails: aan (SMTP geconfigureerd)');
    } else {
        console.log('Order e-mails: uit — stel SMTP_HOST, SMTP_USER, SMTP_PASS en MAIL_FROM in');
    }
});
