const TOKEN_KEY = 'pokevault-admin-token';
const MAX_IMAGES = 10;

const loginPanel = document.getElementById('login-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const productForm = document.getElementById('product-form');
const formStatus = document.getElementById('form-status');
const tbody = document.getElementById('products-tbody');
const contactsTbody = document.getElementById('contacts-tbody');
const ordersTbody = document.getElementById('orders-tbody');
const productTotal = document.getElementById('product-total');
const contactsTotal = document.getElementById('contacts-total');
const ordersTotal = document.getElementById('orders-total');
const contactsBadge = document.getElementById('contacts-badge');
const ordersBadge = document.getElementById('orders-badge');
const imageInput = document.getElementById('field-image');
const imageGallery = document.getElementById('image-gallery');
const aiScanStatus = document.getElementById('ai-scan-status');
const btnAiScan = document.getElementById('btn-ai-scan');
const viewProducts = document.getElementById('view-products');
const viewContacts = document.getElementById('view-contacts');
const viewOrders = document.getElementById('view-orders');
const viewShipping = document.getElementById('view-shipping');
const tabProducts = document.getElementById('tab-products');
const tabContacts = document.getElementById('tab-contacts');
const tabOrders = document.getElementById('tab-orders');
const tabShipping = document.getElementById('tab-shipping');
const shippingForm = document.getElementById('shipping-form');
const shippingStatus = document.getElementById('shipping-status');

/** @type {string[]} */
let keptImages = [];
/** @type {{ file: File, url: string }[]} */
let pendingImages = [];

function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
}

function setStatus(el, message, type) {
    el.textContent = message || '';
    el.className = 'admin-status' + (type ? ` ${type}` : '');
}

async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = getToken();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Fout (${res.status})`);
    }
    return data;
}

function showDashboard() {
    loginPanel.classList.remove('is-visible');
    dashboardPanel.classList.add('is-visible');
}

function showLogin() {
    dashboardPanel.classList.remove('is-visible');
    loginPanel.classList.add('is-visible');
}

function formatEuro(amount) {
    return '€' + Number(amount).toFixed(2).replace('.', ',');
}

function productImages(product) {
    if (!product) return [];
    if (Array.isArray(product.images) && product.images.length) {
        return product.images.filter(Boolean);
    }
    return product.image ? [product.image] : [];
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const COMPRESS_IF_OVER = 1.5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2000;

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Kon afbeelding niet laden.'));
        };
        img.src = url;
    });
}

async function prepareImageUpload(file) {
    if (!file) return null;

    // Keep GIFs as-is (animation).
    if (file.type === 'image/gif') {
        if (file.size > MAX_UPLOAD_BYTES) {
            throw new Error('Afbeelding is te groot (max 25 MB).');
        }
        return file;
    }

    if (file.size <= COMPRESS_IF_OVER) {
        return file;
    }

    try {
        const img = await loadImageFromFile(file);
        let { width, height } = img;
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.85);
        });

        if (blob && blob.size < file.size) {
            const baseName = file.name.replace(/\.[^.]+$/, '') || 'afbeelding';
            const compressed = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
            if (compressed.size > MAX_UPLOAD_BYTES) {
                throw new Error('Afbeelding is te groot (max 25 MB).');
            }
            return compressed;
        }
    } catch (err) {
        if (err.message?.includes('te groot')) throw err;
        // Fall through and try original file.
    }

    if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error('Afbeelding is te groot (max 25 MB).');
    }
    return file;
}

function clearPendingImages() {
    for (const item of pendingImages) {
        URL.revokeObjectURL(item.url);
    }
    pendingImages = [];
}

function renderImageGallery() {
    const items = [
        ...keptImages.map((src, index) => ({
            src,
            primary: index === 0,
            kind: 'kept',
            index
        })),
        ...pendingImages.map((item, index) => ({
            src: item.url,
            primary: keptImages.length === 0 && index === 0,
            kind: 'pending',
            index
        }))
    ];

    imageGallery.innerHTML = items.map((item) => `
        <div class="image-gallery-item${item.primary ? ' is-primary' : ''}${item.kind === 'pending' ? ' is-pending' : ''}">
            <img src="${escapeHtml(item.src)}" alt="">
            <button type="button" class="btn-remove-image" data-kind="${item.kind}" data-index="${item.index}" aria-label="Foto verwijderen">×</button>
        </div>
    `).join('');
}

function switchView(view) {
    viewProducts.hidden = view !== 'products';
    viewOrders.hidden = view !== 'orders';
    viewContacts.hidden = view !== 'contacts';
    viewShipping.hidden = view !== 'shipping';
    [tabProducts, tabOrders, tabContacts, tabShipping].forEach((tab) => {
        if (!tab) return;
        const active = tab.dataset.view === view;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
    });
}

function formatDateTime(iso) {
    try {
        return new Intl.DateTimeFormat('nl-NL', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(new Date(iso));
    } catch {
        return iso || '';
    }
}

function resetForm() {
    productForm.reset();
    document.getElementById('edit-id').value = '';
    document.getElementById('field-brand').value = 'Pokémon TCG';
    document.getElementById('field-purchase-mode').value = 'cart';
    document.getElementById('field-max-qty').value = '10';
    document.getElementById('field-in-stock').checked = true;
    document.getElementById('btn-save').textContent = 'Product opslaan';
    clearPendingImages();
    keptImages = [];
    imageInput.value = '';
    renderImageGallery();
    setStatus(formStatus, '');
    setStatus(aiScanStatus, '');
}

function openForm(product) {
    productForm.hidden = false;
    if (!product) {
        resetForm();
        productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    document.getElementById('edit-id').value = product.id;
    document.getElementById('field-title').value = product.title || '';
    document.getElementById('field-brand').value = product.brand || '';
    document.getElementById('field-category').value = product.category || 'pokemon';
    document.getElementById('field-psa').value = product.psa || '';
    document.getElementById('field-price').value = product.price ?? '';
    document.getElementById('field-old-price').value = product.oldPrice ?? '';
    document.getElementById('field-badge').value = product.badge || '';
    document.getElementById('field-set').value = product.set || '';
    document.getElementById('field-type').value = product.type || '';
    document.getElementById('field-condition').value = product.condition || '';
    document.getElementById('field-max-qty').value = product.maxQty ?? 10;
    document.getElementById('field-purchase-mode').value = product.purchaseMode === 'contact' ? 'contact' : 'cart';
    document.getElementById('field-in-stock').checked = product.inStock !== false;
    document.getElementById('field-description').value = product.description || '';
    document.getElementById('field-image-url').value = '';
    imageInput.value = '';
    clearPendingImages();
    keptImages = productImages(product);
    renderImageGallery();

    document.getElementById('btn-save').textContent = 'Wijzigingen opslaan';
    setStatus(formStatus, '');
    setStatus(aiScanStatus, '');
    productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderProducts(products) {
    productTotal.textContent = `${products.length} product${products.length !== 1 ? 'en' : ''}`;

    if (!products.length) {
        tbody.innerHTML = '<tr><td colspan="6">Nog geen producten. Voeg er een toe.</td></tr>';
        return;
    }

    tbody.innerHTML = products.map((p) => {
        const images = productImages(p);
        const count = images.length;
        const actionLabel = p.purchaseMode === 'contact' ? 'Contact' : 'Winkelwagen';
        return `
        <tr data-id="${p.id}">
            <td class="admin-cell-photo" data-label="">
                <img class="admin-thumb" src="${escapeHtml(p.image || '')}" alt="">
                ${count > 1 ? `<span class="hint" style="display:block;margin-top:0.25rem">${count} foto’s</span>` : ''}
            </td>
            <td data-label="Product">
                <strong>${escapeHtml(p.title)}</strong><br>
                <span style="color:var(--muted)">${escapeHtml(p.brand || '')}</span>
            </td>
            <td class="admin-cell-cat" data-label="Categorie">${escapeHtml(categoryLabel(p.category))}${p.psa ? ` · ${escapeHtml(psaLabel(p.psa))}` : ''}</td>
            <td class="admin-cell-price" data-label="Prijs">${formatEuro(p.price)}</td>
            <td data-label="Actie">${escapeHtml(actionLabel)}</td>
            <td class="admin-cell-actions" data-label="">
                <div class="admin-row-actions">
                    <button type="button" class="btn-secondary btn-edit">Bewerken</button>
                    <button type="button" class="btn-danger btn-delete">Verwijderen</button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

function orderStatusLabel(status) {
    if (status === 'paid') return 'Betaald';
    if (status === 'cancelled') return 'Geannuleerd';
    return 'Open';
}

function paymentMethodLabel(method) {
    if (method === 'crypto') return 'Crypto';
    if (method === 'bunq') return 'iDEAL / bunq';
    return method || '—';
}

function formatAddress(address) {
    if (!address || typeof address !== 'object') return '';
    const parts = [
        address.line1,
        address.line2,
        [address.postalCode, address.city].filter(Boolean).join(' '),
        address.country
    ].filter(Boolean);
    return parts.join(', ');
}

function renderOrders(orders) {
    const sorted = [...orders].sort((a, b) => {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    const pendingCount = sorted.filter((o) => o.status === 'pending').length;

    ordersTotal.textContent = `${sorted.length} bestelling${sorted.length !== 1 ? 'en' : ''}` +
        (pendingCount ? ` · ${pendingCount} open` : '');

    if (pendingCount > 0) {
        ordersBadge.hidden = false;
        ordersBadge.textContent = String(pendingCount);
    } else {
        ordersBadge.hidden = true;
    }

    if (!sorted.length) {
        ordersTbody.innerHTML = '<tr><td colspan="6">Nog geen bestellingen.</td></tr>';
        return;
    }

    ordersTbody.innerHTML = sorted.map((o) => {
        const status = o.status || 'pending';
        const statusClass = status === 'paid'
            ? 'is-paid'
            : status === 'cancelled'
                ? 'is-cancelled'
                : 'is-pending';
        const items = Array.isArray(o.items) ? o.items : [];
        const itemsHtml = items.length
            ? `<ul class="order-items-list">${items.map((item) => `
                <li>
                    ${escapeHtml(item.title || 'Product')}
                    × ${Number(item.quantity) || 1}
                    <span class="order-meta">${formatEuro(item.lineTotal ?? (item.price * item.quantity))}</span>
                </li>
            `).join('')}</ul>`
            : '<span class="order-meta">Geen producten</span>';

        const customer = o.customer || {};
        const address = formatAddress(customer.address);
        const paidLine = o.paidAt
            ? `<div class="order-meta">Betaald: ${escapeHtml(formatDateTime(o.paidAt))}</div>`
            : '';
        const phoneLine = customer.phone
            ? `<div class="order-meta"><a href="tel:${escapeHtml(customer.phone)}">${escapeHtml(customer.phone)}</a></div>`
            : '';

        return `
        <tr data-order-id="${escapeHtml(o.id)}">
            <td data-label="Datum">
                ${escapeHtml(formatDateTime(o.createdAt))}
                <div class="order-meta">#${escapeHtml(String(o.id || '').slice(0, 8))}</div>
            </td>
            <td data-label="Klant">
                <strong>${escapeHtml(customer.name || '—')}</strong>
                <div class="order-meta"><a href="mailto:${escapeHtml(customer.email || '')}">${escapeHtml(customer.email || '')}</a></div>
                ${phoneLine}
                ${address ? `<div class="order-meta">${escapeHtml(address)}</div>` : ''}
            </td>
            <td data-label="Producten">${itemsHtml}</td>
            <td data-label="Totaal">
                <strong>${formatEuro(o.total)}</strong>
                <div class="order-meta">${escapeHtml(paymentMethodLabel(o.paymentMethod))}</div>
                ${o.shipping ? `<div class="order-meta">Verzending ${formatEuro(o.shipping)}</div>` : ''}
            </td>
            <td data-label="Status">
                <span class="contact-status order-status ${statusClass}">${orderStatusLabel(status)}</span>
                ${paidLine}
            </td>
            <td class="admin-cell-actions" data-label="">
                <div class="admin-row-actions">
                    ${status !== 'paid' ? '<button type="button" class="btn-secondary btn-order-paid">Markeer betaald</button>' : ''}
                    ${status === 'pending' ? '<button type="button" class="btn-danger btn-order-cancel">Annuleren</button>' : ''}
                    ${status === 'cancelled' ? '<button type="button" class="btn-secondary btn-order-reopen">Heropen</button>' : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function renderContacts(contacts) {
    const newCount = contacts.filter((c) => c.status !== 'done').length;
    contactsTotal.textContent = `${contacts.length} bericht${contacts.length !== 1 ? 'en' : ''}` +
        (newCount ? ` · ${newCount} nieuw` : '');

    if (newCount > 0) {
        contactsBadge.hidden = false;
        contactsBadge.textContent = String(newCount);
    } else {
        contactsBadge.hidden = true;
    }

    if (!contacts.length) {
        contactsTbody.innerHTML = '<tr><td colspan="5">Nog geen contactaanvragen.</td></tr>';
        return;
    }

    contactsTbody.innerHTML = contacts.map((c) => {
        const isDone = c.status === 'done';
        const productChip = c.productTitle
            ? `<div class="contact-product-chip">
                   ${c.productImage ? `<img src="${escapeHtml(c.productImage)}" alt="">` : ''}
                   <span>${escapeHtml(c.productTitle)}${c.productPrice != null ? ` · ${formatEuro(c.productPrice)}` : ''}</span>
               </div>`
            : '';
        const phoneLine = c.phone
            ? `<div class="contact-meta"><a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a></div>`
            : '';
        const orderLine = c.order
            ? `<div class="contact-meta">Bestelling: ${escapeHtml(c.order)}</div>`
            : '';

        return `
        <tr data-contact-id="${c.id}">
            <td data-label="Datum">${escapeHtml(formatDateTime(c.createdAt))}</td>
            <td data-label="Contact">
                <strong>${escapeHtml(c.name)}</strong>
                <div class="contact-meta"><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>
                ${phoneLine}
                <div class="contact-meta">${escapeHtml(c.subjectLabel || c.subject || '')}</div>
                ${orderLine}
                ${productChip}
            </td>
            <td data-label="Bericht"><div class="contact-message">${escapeHtml(c.message || '')}</div></td>
            <td data-label="Status">
                <span class="contact-status ${isDone ? 'is-done' : 'is-new'}">${isDone ? 'Afgehandeld' : 'Nieuw'}</span>
            </td>
            <td class="admin-cell-actions" data-label="">
                <div class="admin-row-actions">
                    <button type="button" class="btn-secondary btn-contact-toggle">${isDone ? 'Als nieuw' : 'Afgehandeld'}</button>
                    <button type="button" class="btn-danger btn-contact-delete">Verwijderen</button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function loadProducts() {
    const products = await api('/api/products');
    renderProducts(products);
    return products;
}

async function loadContacts() {
    const contacts = await api('/api/admin/contacts');
    renderContacts(contacts);
    return contacts;
}

async function loadOrders() {
    const orders = await api('/api/admin/orders');
    renderOrders(orders);
    return orders;
}

function fillShippingForm(settings) {
    document.getElementById('ship-fee-domestic').value = settings.feeDomestic;
    document.getElementById('ship-fee-international').value = settings.feeInternational;
    document.getElementById('ship-free-domestic').value = settings.freeFromDomestic;
    document.getElementById('ship-free-international').value = settings.freeFromInternational;
}

async function loadShipping() {
    const settings = await api('/api/admin/shipping');
    fillShippingForm(settings);
    return settings;
}

async function loadDashboard() {
    await Promise.all([loadProducts(), loadOrders(), loadContacts(), loadShipping()]);
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus(loginStatus, 'Bezig…');
    try {
        const data = await api('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: document.getElementById('admin-password').value
            })
        });
        setToken(data.token);
        showDashboard();
        switchView('products');
        await loadDashboard();
        setStatus(loginStatus, '');
    } catch (err) {
        setStatus(loginStatus, err.message, 'error');
    }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
        await api('/api/admin/logout', { method: 'POST' });
    } catch (_) {
        /* ignore */
    }
    clearToken();
    showLogin();
});

tabProducts.addEventListener('click', () => switchView('products'));
tabOrders.addEventListener('click', () => {
    switchView('orders');
    loadOrders().catch(() => {});
});
tabShipping.addEventListener('click', () => {
    switchView('shipping');
    loadShipping().catch((err) => setStatus(shippingStatus, err.message, 'error'));
});
tabContacts.addEventListener('click', () => {
    switchView('contacts');
    loadContacts().catch(() => {});
});

shippingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus(shippingStatus, 'Opslaan…');
    try {
        const settings = await api('/api/admin/shipping', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                feeDomestic: document.getElementById('ship-fee-domestic').value,
                feeInternational: document.getElementById('ship-fee-international').value,
                freeFromDomestic: document.getElementById('ship-free-domestic').value,
                freeFromInternational: document.getElementById('ship-free-international').value
            })
        });
        fillShippingForm(settings);
        setStatus(shippingStatus, 'Verzendkosten opgeslagen.', 'ok');
    } catch (err) {
        setStatus(shippingStatus, err.message, 'error');
    }
});

document.getElementById('btn-new').addEventListener('click', () => openForm(null));

document.getElementById('btn-cancel').addEventListener('click', () => {
    productForm.hidden = true;
    resetForm();
});

imageInput.addEventListener('change', () => {
    const files = Array.from(imageInput.files || []);
    if (!files.length) return;

    const room = MAX_IMAGES - keptImages.length - pendingImages.length;
    if (room <= 0) {
        setStatus(formStatus, `Maximaal ${MAX_IMAGES} foto’s per product.`, 'error');
        imageInput.value = '';
        return;
    }

    const accepted = files.slice(0, room);
    for (const file of accepted) {
        pendingImages.push({ file, url: URL.createObjectURL(file) });
    }
    if (files.length > room) {
        setStatus(formStatus, `Alleen de eerste ${room} foto’s toegevoegd (max ${MAX_IMAGES}).`, 'error');
    } else {
        setStatus(formStatus, '');
    }
    imageInput.value = '';
    renderImageGallery();
});

function applyScanFields(fields) {
    if (!fields || typeof fields !== 'object') return;

    if (fields.title) document.getElementById('field-title').value = fields.title;
    if (fields.brand) document.getElementById('field-brand').value = fields.brand;
    if (fields.category) document.getElementById('field-category').value = fields.category;
    document.getElementById('field-psa').value = fields.psa || '';
    document.getElementById('field-badge').value = fields.badge || '';
    document.getElementById('field-set').value = fields.set || '';
    document.getElementById('field-type').value = fields.type || '';
    document.getElementById('field-condition').value = fields.condition || '';
    if (fields.description) document.getElementById('field-description').value = fields.description;
}

imageGallery.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-image');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (btn.dataset.kind === 'kept') {
        keptImages.splice(index, 1);
    } else if (btn.dataset.kind === 'pending') {
        const [removed] = pendingImages.splice(index, 1);
        if (removed) URL.revokeObjectURL(removed.url);
    }
    renderImageGallery();
});

btnAiScan.addEventListener('click', async () => {
    if (!pendingImages.length) {
        setStatus(aiScanStatus, 'Upload eerst een foto, daarna kun je AI invullen gebruiken.', 'error');
        return;
    }

    btnAiScan.disabled = true;
    setStatus(aiScanStatus, 'Kaart wordt herkend…');

    try {
        const prepared = await prepareImageUpload(pendingImages[0].file);
        const formData = new FormData();
        formData.append('image', prepared);

        const data = await api('/api/admin/scan-card', {
            method: 'POST',
            body: formData
        });

        applyScanFields(data.fields);
        setStatus(aiScanStatus, 'Velden ingevuld — controleer en vul de prijs in.', 'ok');
    } catch (err) {
        setStatus(aiScanStatus, err.message, 'error');
    } finally {
        btnAiScan.disabled = false;
    }
});

productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus(formStatus, 'Opslaan…');

    const editId = document.getElementById('edit-id').value;
    const formData = new FormData();
    formData.append('title', document.getElementById('field-title').value.trim());
    formData.append('brand', document.getElementById('field-brand').value.trim());
    formData.append('category', document.getElementById('field-category').value);
    formData.append('psa', document.getElementById('field-psa').value);
    formData.append('price', document.getElementById('field-price').value);
    formData.append('oldPrice', document.getElementById('field-old-price').value);
    formData.append('badge', document.getElementById('field-badge').value);
    formData.append('set', document.getElementById('field-set').value.trim());
    formData.append('type', document.getElementById('field-type').value.trim());
    formData.append('condition', document.getElementById('field-condition').value.trim());
    formData.append('maxQty', document.getElementById('field-max-qty').value);
    formData.append('purchaseMode', document.getElementById('field-purchase-mode').value);
    formData.append('inStock', document.getElementById('field-in-stock').checked ? 'true' : 'false');
    formData.append('description', document.getElementById('field-description').value.trim());
    formData.append('keepImages', JSON.stringify(keptImages));

    const imageUrl = document.getElementById('field-image-url').value.trim();
    if (imageUrl) {
        formData.append('imageUrl', imageUrl);
    }

    try {
        if (pendingImages.length) {
            setStatus(formStatus, 'Foto’s verwerken…');
            for (const item of pendingImages) {
                const prepared = await prepareImageUpload(item.file);
                formData.append('images', prepared);
            }
        }

        setStatus(formStatus, 'Opslaan…');
        if (editId) {
            await api(`/api/products/${encodeURIComponent(editId)}`, {
                method: 'PUT',
                body: formData
            });
            setStatus(formStatus, 'Product bijgewerkt.', 'ok');
        } else {
            await api('/api/products', {
                method: 'POST',
                body: formData
            });
            setStatus(formStatus, 'Product toegevoegd.', 'ok');
        }
        await loadProducts();
        productForm.hidden = true;
        resetForm();
    } catch (err) {
        setStatus(formStatus, err.message, 'error');
    }
});

tbody.addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const id = row.dataset.id;

    if (e.target.classList.contains('btn-edit')) {
        try {
            const product = await api(`/api/products/${encodeURIComponent(id)}`);
            openForm(product);
        } catch (err) {
            alert(err.message);
        }
        return;
    }

    if (e.target.classList.contains('btn-delete')) {
        if (!confirm('Dit product verwijderen?')) return;
        try {
            await api(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
            await loadProducts();
        } catch (err) {
            alert(err.message);
        }
    }
});

ordersTbody.addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-order-id]');
    if (!row) return;
    const id = row.dataset.orderId;

    let status = null;
    if (e.target.classList.contains('btn-order-paid')) {
        status = 'paid';
    } else if (e.target.classList.contains('btn-order-cancel')) {
        if (!confirm('Deze bestelling annuleren?')) return;
        status = 'cancelled';
    } else if (e.target.classList.contains('btn-order-reopen')) {
        status = 'pending';
    }
    if (!status) return;

    try {
        await api(`/api/admin/orders/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        await loadOrders();
    } catch (err) {
        alert(err.message);
    }
});

contactsTbody.addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-contact-id]');
    if (!row) return;
    const id = row.dataset.contactId;

    if (e.target.classList.contains('btn-contact-toggle')) {
        const currentlyDone = e.target.textContent.includes('Als nieuw');
        try {
            await api(`/api/admin/contacts/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: currentlyDone ? 'new' : 'done' })
            });
            await loadContacts();
        } catch (err) {
            alert(err.message);
        }
        return;
    }

    if (e.target.classList.contains('btn-contact-delete')) {
        if (!confirm('Dit bericht verwijderen?')) return;
        try {
            await api(`/api/admin/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
            await loadContacts();
        } catch (err) {
            alert(err.message);
        }
    }
});

(async function init() {
    const token = getToken();
    if (!token) return;

    try {
        await api('/api/admin/me');
        showDashboard();
        switchView('products');
        await loadDashboard();
    } catch (_) {
        clearToken();
        showLogin();
    }
})();
