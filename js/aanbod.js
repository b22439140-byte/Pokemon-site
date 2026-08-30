function renderProductCard(product) {
    const badgeHtml = product.badge
        ? `<span class="badge ${product.badge}">${product.badge === 'sale' ? 'Sale −15%' : 'Pre-order'}</span>`
        : '';

    const oldPriceHtml = product.oldPrice
        ? `<span class="price-old">${formatEuro(product.oldPrice)}</span>`
        : '';

    const imgStyle = product.imageOpacity ? ` style="opacity: ${product.imageOpacity};"` : '';

    return `
        <article class="product-card">
            ${badgeHtml}
            <a href="product.html?id=${product.id}" class="card-image-link">
                <div class="card-image">
                    <img src="${product.image}" alt="${product.title}"${imgStyle}>
                </div>
            </a>
            <div class="product-brand">${product.brand}</div>
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

function filterProducts({ category, set, search, sort }) {
    let filtered = PRODUCTS.filter(p => p.category !== 'accessory');

    if (category && category !== 'all') {
        filtered = filtered.filter(p => p.category === category);
    }

    if (set && set !== 'all') {
        filtered = filtered.filter(p => p.set === set);
    }

    if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(p =>
            p.title.toLowerCase().includes(q) ||
            (p.set && p.set.toLowerCase().includes(q)) ||
            (p.type && p.type.toLowerCase().includes(q))
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

document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('aanbod-grid');
    const countEl = document.getElementById('product-count');
    if (!grid) return;

    const params = new URLSearchParams(window.location.search);
    const searchInput = document.getElementById('filter-search');
    const categorySelect = document.getElementById('filter-category');
    const setSelect = document.getElementById('filter-set');
    const sortSelect = document.getElementById('filter-sort');

    if (params.get('q') && searchInput) {
        searchInput.value = params.get('q');
    }

    const sets = [...new Set(PRODUCTS.filter(p => p.set).map(p => p.set))].sort();
    sets.forEach(set => {
        const opt = document.createElement('option');
        opt.value = set;
        opt.textContent = set;
        setSelect.appendChild(opt);
    });

    function updateGrid() {
        const products = filterProducts({
            category: categorySelect.value,
            set: setSelect.value,
            search: searchInput.value.trim(),
            sort: sortSelect.value
        });

        countEl.textContent = `${products.length} product${products.length !== 1 ? 'en' : ''}`;
        renderProductGrid(grid, products);
    }

    [searchInput, categorySelect, setSelect, sortSelect].forEach(el => {
        el.addEventListener('input', updateGrid);
        el.addEventListener('change', updateGrid);
    });

    updateGrid();
});
