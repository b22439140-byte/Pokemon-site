const CATEGORY_HERO_KEYS = {
    pokemon: 'aanbod.hero.pokemon',
    boxen: 'aanbod.hero.boxen',
    boosters: 'aanbod.hero.boosters',
    tins: 'aanbod.hero.tins',
    blisters: 'aanbod.hero.blisters',
    'losse-kaarten': 'aanbod.hero.singles',
    accessoires: 'aanbod.hero.accessories',
    'andere-tcg': 'aanbod.hero.otherTcg',
    lego: 'aanbod.hero.lego',
    sale: 'aanbod.hero.sale'
};

function badgeLabel(badge) {
    const keys = { sale: 'badge.sale', preorder: 'badge.preorder', en: 'badge.en' };
    if (!badge || !keys[badge]) return '';
    return typeof t === 'function' ? t(keys[badge]) : badge;
}

function renderProductCard(product) {
    const label = badgeLabel(product.badge);
    const badgeHtml = label
        ? `<span class="badge ${product.badge}">${label}</span>`
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

    const qtyAria = typeof t === 'function' ? t('btn.qty') : 'Aantal';
    const addLabel = typeof resolveButtonLabel === 'function'
        ? resolveButtonLabel(product.buttonLabel)
        : (product.buttonLabel || 'In winkelwagen');
    const contactLabel = typeof t === 'function' ? t('btn.contact') : 'Neem contact op';

    return `
        <article class="product-card">
            ${badgeHtml}
            <a href="/product?id=${product.id}" class="card-image-link">
                <div class="card-image">
                    <img src="${product.image}" alt="${product.title}"${imgStyle}>
                </div>
            </a>
            <div class="product-brand">${metaBits.join(' · ')}</div>
            <h3 class="product-title">
                <a href="/product?id=${product.id}">${product.title}</a>
            </h3>
            <div class="product-price-row">
                <span class="price-current">${formatEuro(product.price)}</span>
                ${oldPriceHtml}
            </div>
            <div class="purchase-group"
                 data-product-id="${product.id}"
                 data-product-title="${product.title.replace(/"/g, '&quot;')}"
                 data-product-image="${product.image}">
                ${product.purchaseMode === 'contact'
                    ? `<a class="btn-contact" href="/contact?product=${encodeURIComponent(product.id)}">${contactLabel}</a>`
                    : `<input type="number" class="qty-input" value="1" min="1" max="${product.maxQty}" data-price="${product.price}" aria-label="${qtyAria}">
                       <button type="button" class="btn-add">${addLabel}</button>`}
            </div>
        </article>
    `;
}

function renderProductGrid(container, products) {
    if (products.length === 0) {
        const empty = typeof t === 'function' ? t('aanbod.empty') : 'Geen producten gevonden. Probeer een andere filter of zoekterm.';
        container.innerHTML = `<p class="empty-state">${empty}</p>`;
        return;
    }
    container.innerHTML = products.map(renderProductCard).join('');
}

/** Parent “Pokémon” nav: alle Pokémon-producten, niet alleen category=pokemon. */
const POKEMON_CATEGORIES = new Set([
    'pokemon',
    'boxen',
    'boosters',
    'tins',
    'blisters',
    'losse-kaarten',
    'accessoires',
    'sale'
]);

function filterProducts({ category, psa, set, search, sort }) {
    let filtered = [...PRODUCTS];

    if (category && category !== 'all') {
        if (category === 'sale') {
            filtered = filtered.filter((p) => p.category === 'sale' || p.badge === 'sale');
        } else if (category === 'pokemon') {
            filtered = filtered.filter((p) => POKEMON_CATEGORIES.has(p.category));
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
        const msg = typeof t === 'function' ? t('aanbod.loadError') : 'Producten konden niet worden geladen.';
        grid.innerHTML = `<p class="empty-state">${msg}</p>`;
        if (countEl) countEl.textContent = typeof t === 'function' ? t('aanbod.count', { n: 0 }) : '0 producten';
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
        const tr = typeof t === 'function' ? t : (k) => k;
        const label = category && category !== 'all' ? categoryLabel(category) : tr('aanbod.heroTitle');
        if (heroTitle) heroTitle.textContent = label;
        if (heroText) {
            const heroKey = category && category !== 'all' ? CATEGORY_HERO_KEYS[category] : null;
            heroText.textContent = heroKey
                ? tr(heroKey)
                : tr('aanbod.heroText');
        }
        document.title = category && category !== 'all'
            ? tr('aanbod.titleCat', { label })
            : tr('aanbod.titleDefault');
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

        const tr = typeof t === 'function' ? t : (k, v) => String(v?.n ?? 0);
        countEl.textContent = products.length === 1
            ? tr('aanbod.countOne', { n: products.length })
            : tr('aanbod.count', { n: products.length });
        if (headingEl) {
            headingEl.textContent = category !== 'all'
                ? categoryLabel(category)
                : tr('aanbod.headingAllProducts');
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

    window.addEventListener('pokevault:langchange', () => {
        if (typeof applyI18n === 'function') applyI18n(document);
        updateGrid();
    });
});
