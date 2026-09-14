const TOKEN_KEY = 'pokevault-admin-token';

const loginPanel = document.getElementById('login-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const productForm = document.getElementById('product-form');
const formStatus = document.getElementById('form-status');
const tbody = document.getElementById('products-tbody');
const productTotal = document.getElementById('product-total');
const imageInput = document.getElementById('field-image');
const imagePreview = document.getElementById('image-preview');

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

function resetForm() {
    productForm.reset();
    document.getElementById('edit-id').value = '';
    document.getElementById('field-brand').value = 'Pokémon TCG';
    document.getElementById('field-button').value = 'In winkelwagen';
    document.getElementById('field-max-qty').value = '10';
    document.getElementById('field-in-stock').checked = true;
    document.getElementById('btn-save').textContent = 'Product opslaan';
    imagePreview.src = '';
    imagePreview.classList.remove('is-visible');
    setStatus(formStatus, '');
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
    document.getElementById('field-category').value = product.category || 'single';
    document.getElementById('field-price').value = product.price ?? '';
    document.getElementById('field-old-price').value = product.oldPrice ?? '';
    document.getElementById('field-badge').value = product.badge || '';
    document.getElementById('field-set').value = product.set || '';
    document.getElementById('field-type').value = product.type || '';
    document.getElementById('field-condition').value = product.condition || '';
    document.getElementById('field-max-qty').value = product.maxQty ?? 10;
    document.getElementById('field-button').value = product.buttonLabel || 'In winkelwagen';
    document.getElementById('field-in-stock').checked = product.inStock !== false;
    document.getElementById('field-description').value = product.description || '';
    document.getElementById('field-image-url').value = product.image?.startsWith('/uploads/') ? '' : (product.image || '');
    imageInput.value = '';

    if (product.image) {
        imagePreview.src = product.image;
        imagePreview.classList.add('is-visible');
    } else {
        imagePreview.src = '';
        imagePreview.classList.remove('is-visible');
    }

    document.getElementById('btn-save').textContent = 'Wijzigingen opslaan';
    setStatus(formStatus, '');
    productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderProducts(products) {
    productTotal.textContent = `${products.length} product${products.length !== 1 ? 'en' : ''}`;

    if (!products.length) {
        tbody.innerHTML = '<tr><td colspan="5">Nog geen producten. Voeg er een toe.</td></tr>';
        return;
    }

    tbody.innerHTML = products.map((p) => `
        <tr data-id="${p.id}">
            <td><img class="admin-thumb" src="${p.image}" alt=""></td>
            <td>
                <strong>${escapeHtml(p.title)}</strong><br>
                <span style="color:var(--muted)">${escapeHtml(p.brand || '')}</span>
            </td>
            <td>${escapeHtml(p.category)}</td>
            <td>${formatEuro(p.price)}</td>
            <td>
                <div class="admin-row-actions">
                    <button type="button" class="btn-secondary btn-edit">Bewerken</button>
                    <button type="button" class="btn-danger btn-delete">Verwijderen</button>
                </div>
            </td>
        </tr>
    `).join('');
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
        await loadProducts();
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

document.getElementById('btn-new').addEventListener('click', () => openForm(null));

document.getElementById('btn-cancel').addEventListener('click', () => {
    productForm.hidden = true;
    resetForm();
});

imageInput.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    imagePreview.src = url;
    imagePreview.classList.add('is-visible');
});

productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus(formStatus, 'Opslaan…');

    const editId = document.getElementById('edit-id').value;
    const formData = new FormData();
    formData.append('title', document.getElementById('field-title').value.trim());
    formData.append('brand', document.getElementById('field-brand').value.trim());
    formData.append('category', document.getElementById('field-category').value);
    formData.append('price', document.getElementById('field-price').value);
    formData.append('oldPrice', document.getElementById('field-old-price').value);
    formData.append('badge', document.getElementById('field-badge').value);
    formData.append('set', document.getElementById('field-set').value.trim());
    formData.append('type', document.getElementById('field-type').value.trim());
    formData.append('condition', document.getElementById('field-condition').value.trim());
    formData.append('maxQty', document.getElementById('field-max-qty').value);
    formData.append('buttonLabel', document.getElementById('field-button').value.trim());
    formData.append('inStock', document.getElementById('field-in-stock').checked ? 'true' : 'false');
    formData.append('description', document.getElementById('field-description').value.trim());

    const imageUrl = document.getElementById('field-image-url').value.trim();
    if (imageUrl) {
        formData.append('imageUrl', imageUrl);
    }

    const file = imageInput.files?.[0];
    if (file) {
        formData.append('image', file);
    }

    try {
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

(async function init() {
    const token = getToken();
    if (!token) return;

    try {
        await api('/api/admin/me');
        showDashboard();
        await loadProducts();
    } catch (_) {
        clearToken();
        showLogin();
    }
})();
