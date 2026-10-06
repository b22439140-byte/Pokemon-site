const CATEGORY_HERO_COPY = {
    pokemon: 'Alle Pokémon producten — sealed, singles en meer.',
    boxen: 'Elite Trainer Boxes, booster boxes en collectieboxen.',
    boosters: 'Losse boosters en booster packs uit lopende en oudere sets.',
    tins: 'Tins en metalen collectieverpakkingen.',
    blisters: 'Blister packs en mini-collecties.',
    'losse-kaarten': 'Singles en losse kaarten, klaar voor je deck of verzameling.',
    accessoires: 'Sleeves, binders, toploaders en meer.',
    'andere-tcg': 'Yu-Gi-Oh!, Magic, Lorcana, One Piece en andere TCG’s.',
    lego: 'LEGO sets met Pokémon en verzamelthema.',
    sale: 'Aanbiedingen en afgeprijsde producten.'
};

function renderProductCard(product) {
    const badgeLabels = { sale: 'Sale −15%', preorder: 'Pre-order', en: 'EN' };
    const badgeHtml = product.badge && badgeLabels[product.badge]
        ? `<span class="badge ${product.badge}">${badgeLabels[product.badge]}</span>`
        : '';

    const oldPriceHtml = product.oldPrice
        ? `<span class="price-old">${formatEuro(product.oldPrice)}</span>`
        : '';

    const imgStyle = product.imageOpacity ? ` style="opacity: ${product.imageOpacity};"` : '';
    const catLabel = typeof categoryLabel === 'function' ? categoryLabel(product.category) : product.category;
    const metaBits = [
        catLabel,
        product.psa ? psaLabel(product.psa) : ''
    ].filter(Boolean);

    return `
        <article class="product-card">
            ${badgeHtml}
            <a href="product.html?id=${product.id}" class="card-image-link">
                <div class="card-image">
                    <img src="${product.image}" alt="${product.title}"${imgStyle}>
                </div>
            </a>
            <div class="product-brand">${metaBits.join(' · ')}</div>
            <h3 class="product-title">
                <a href="product.html?id=${product.id}">${product.title}</a>
            </h3>
            <div class="product-price-row">
                <span class="price-current">${formatEuro(product.price)}</span>
                ${oldPriceHtml}
            </div>
            <div class="purchase-group"
                 data-product-id="${product.id}"
                 data-product-title="${product.title.replace(/"/g, '&quot;')}"
                 data-product-image="${product.image}">
                <input type="number" class="qty-input" value="1" min="1" max="${product.maxQty}" data-price="${product.price}" aria-label="Aantal">
                <button class="btn-add">${product.buttonLabel || 'In winkelwagen'}</button>
            </div>
        </article>
    `;
}

function renderProductGrid(container, products) {
    if (products.length === 0) {
        container.innerHTML = '<p class="empty-state">Geen producten gevonden. Probeer een andere filter of zoekterm.</p>';
        return;
    }
    container.innerHTML = products.map(renderProductCard).join('');
}

function filterProducts({ category, psa, set, search, sort }) {
    let filtered = [...PRODUCTS];

    if (category && category !== 'all') {
        if (category === 'sale') {
            filtered = filtered.filter((p) => p.category === 'sale' || p.badge === 'sale');
        } else {
            filtered = filtered.filter((p) => p.category === category);
        }
    }

    if (psa && psa !== 'all') {
        filtered = filtered.filter((p) => String(p.psa || '') === String(psa));
    }

    if (set && set !== 'all') {
        filtered = filtered.filter((p) => p.set === set);
    }

    if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter((p) =>
            p.title.toLowerCase().includes(q) ||
            (p.set && p.set.toLowerCase().includes(q)) ||
            (p.type && p.type.toLowerCase().includes(q)) ||
            (p.brand && p.brand.toLowerCase().includes(q))
        );
    }

    if (sort === 'price-asc') {
        filtered.sort((a, b) => a.price - b.price);
    } else if (sort === 'price-desc') {
        filtered.sort((a, b) => b.price - a.price);
    } else if (sort === 'name') {
        filtered.sort((a, b) => a.title.localeCompare(b.title));
    }

    return filtered;
}

function setActiveCategoryNav(category) {
    document.querySelectorAll('.category-nav a[href*="category="]').forEach((link) => {
        const url = new URL(link.href, window.location.origin);
        const linkCat = url.searchParams.get('category');
        link.classList.toggle('is-active', Boolean(category) && linkCat === category);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const grid = document.getElementById('aanbod-grid');
    const countEl = document.getElementById('product-count');
    if (!grid) return;

    try {
        await loadProducts();
    } catch (err) {
        grid.innerHTML = '<p class="empty-state">Producten konden niet worden geladen. Start de server met <code>npm start</code>.</p>';
        if (countEl) countEl.textContent = '0 producten';
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const searchInput = document.getElementById('filter-search');
    const categorySelect = document.getElementById('filter-category');
    const psaSelect = document.getElementById('filter-psa');
    const setSelect = document.getElementById('filter-set');
    const sortSelect = document.getElementById('filter-sort');
    const headingEl = document.querySelector('.aanbod-header h2');
    const heroTitle = document.getElementById('aanbod-hero-title');
    const heroText = document.getElementById('aanbod-hero-text');

    if (params.get('q') && searchInput) {
        searchInput.value = params.get('q');
    }

    const urlCategory = params.get('category');
    if (urlCategory && categorySelect) {
        const option = [...categorySelect.options].find((o) => o.value === urlCategory);
        if (option) categorySelect.value = urlCategory;
    }

    const urlPsa = params.get('psa');
    if (urlPsa && psaSelect) {
        const option = [...psaSelect.options].find((o) => o.value === urlPsa);
        if (option) psaSelect.value = urlPsa;
    }

    setActiveCategoryNav(categorySelect?.value !== 'all' ? categorySelect.value : urlCategory);

    const sets = [...new Set(PRODUCTS.filter((p) => p.set).map((p) => p.set))].sort();
    sets.forEach((set) => {
        const opt = document.createElement('option');
        opt.value = set;
        opt.textContent = set;
        setSelect.appendChild(opt);
    });

    function syncUrl() {
        const next = new URLSearchParams();
        const q = searchInput.value.trim();
        if (q) next.set('q', q);
        if (categorySelect.value !== 'all') next.set('category', categorySelect.value);
        if (psaSelect.value !== 'all') next.set('psa', psaSelect.value);
        if (setSelect.value !== 'all') next.set('set', setSelect.value);
        if (sortSelect.value !== 'default') next.set('sort', sortSelect.value);
        const qs = next.toString();
        const path = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        window.history.replaceState({}, '', path);
    }

    function updateHero(category) {
        const label = category && category !== 'all' ? categoryLabel(category) : 'Aanbod';
        if (heroTitle) heroTitle.textContent = label;
        if (heroText) {
            heroText.textContent = category && category !== 'all' && CATEGORY_HERO_COPY[category]
                ? CATEGORY_HERO_COPY[category]
                : 'Blader door ons volledige assortiment. Filter op categorie, set of prijs — alles direct uit voorraad of pre-order.';
        }
        document.title = category && category !== 'all'
            ? `${label} — PokeVault`
            : 'Aanbod — PokeVault';
    }

    function updateGrid() {
        const category = categorySelect.value;
        const products = filterProducts({
            category,
            psa: psaSelect.value,
            set: setSelect.value,
            search: searchInput.value.trim(),
            sort: sortSelect.value
        });

        countEl.textContent = `${products.length} product${products.length !== 1 ? 'en' : ''}`;
        if (headingEl) {
            headingEl.textContent = category !== 'all'
                ? categoryLabel(category)
                : 'Alle producten';
        }
        updateHero(category);
        setActiveCategoryNav(category !== 'all' ? category : null);
        renderProductGrid(grid, products);
        syncUrl();
    }

    [searchInput, categorySelect, psaSelect, setSelect, sortSelect].forEach((el) => {
        el.addEventListener('input', updateGrid);
        el.addEventListener('change', updateGrid);
    });

    updateGrid();
});
