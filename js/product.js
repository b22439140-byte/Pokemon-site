(function () {
    let currentProductId = null;
    let productsLoaded = false;
    let loadFailed = false;
    /** @type {{ count: number, average: number|null, reviews: object[] }|null} */
    let productReviews = null;

    function tr(key, vars) {
        return typeof t === 'function' ? t(key, vars) : key;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function starsFromRating(rating) {
        const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
        return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
    }

    function formatReviewDate(iso) {
        try {
            const lang = document.documentElement.lang === 'en' ? 'en-GB' : 'nl-NL';
            return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(new Date(iso));
        } catch {
            return '';
        }
    }

    function badgeLabel(badge) {
        const keys = { sale: 'badge.sale', preorder: 'badge.preorder', en: 'badge.en' };
        if (!badge || !keys[badge]) return '';
        return tr(keys[badge]);
    }

    async function loadProductReviews(productId) {
        productReviews = null;
        if (!productId) return;
        try {
            const res = await fetch(`/api/products/${encodeURIComponent(productId)}/reviews`);
            const data = await res.json().catch(() => null);
            if (res.ok && data) {
                productReviews = {
                    count: Number(data.count) || 0,
                    average: data.average == null ? null : Number(data.average),
                    reviews: Array.isArray(data.reviews) ? data.reviews : []
                };
            }
        } catch {
            productReviews = null;
        }
    }

    function ratingSummaryHtml() {
        const count = productReviews?.count || 0;
        const average = productReviews?.average;
        if (!count || average == null) {
            return `
                <div class="product-rating product-rating-empty">
                    <span class="product-rating-text">${tr('product.ratingEmpty')}</span>
                </div>
            `;
        }
        const avgLabel = Number(average).toFixed(1).replace('.', ',');
        return `
            <div class="product-rating">
                <span class="product-stars" aria-label="${tr('product.ratingAria', { avg: avgLabel, n: count })}">${starsFromRating(average)}</span>
                <span class="product-rating-text">${tr('product.ratingText', { avg: avgLabel, n: count })}</span>
            </div>
        `;
    }

    function reviewsSectionHtml() {
        const reviews = productReviews?.reviews || [];
        if (!reviews.length) {
            return `
                <section class="product-reviews" aria-label="${tr('product.reviewsAria')}">
                    <h2>${tr('product.reviewsTitle')}</h2>
                    <p class="product-reviews-empty">${tr('product.reviewsEmpty')}</p>
                </section>
            `;
        }

        const cards = reviews
            .slice(0, 6)
            .map((review) => {
                const dateLabel = formatReviewDate(review.createdAt);
                return `
                    <blockquote class="review-card">
                        <div class="review-stars">${starsFromRating(review.rating)}</div>
                        <p>${escapeHtml(review.text)}</p>
                        <footer>— ${escapeHtml(review.displayName || tr('product.reviewAnonymous'))}${
                            dateLabel ? `<time datetime="${escapeHtml(String(review.createdAt || '').slice(0, 7))}">${escapeHtml(dateLabel)}</time>` : ''
                        }</footer>
                    </blockquote>
                `;
            })
            .join('');

        return `
            <section class="product-reviews" aria-label="${tr('product.reviewsAria')}">
                <h2>${tr('product.reviewsTitle')}</h2>
                <div class="review-cards">${cards}</div>
            </section>
        `;
    }

    function renderProduct(product) {
        const container = document.getElementById('product-detail');
        if (!container || !product) return;

        document.title = `${product.title} — PokeVault`;

        const label = badgeLabel(product.badge);
        const badgeHtml = label
            ? `<span class="badge ${product.badge}">${label}</span>`
            : '';

        const oldPriceHtml = product.oldPrice
            ? `<span class="price-old">${formatEuro(product.oldPrice)}</span>`
            : '';

        const metaItems = [
            product.category && `<li><strong>${tr('product.category')}</strong> <a href="/aanbod?category=${product.category}">${typeof categoryLabel === 'function' ? categoryLabel(product.category) : product.category}</a></li>`,
            product.psa && `<li><strong>${tr('product.psa')}</strong> ${typeof psaLabel === 'function' ? psaLabel(product.psa) : `PSA ${product.psa}`}</li>`,
            product.set && `<li><strong>${tr('product.set')}</strong> ${product.set}</li>`,
            product.type && `<li><strong>${tr('product.type')}</strong> ${product.type}</li>`,
            product.condition && `<li><strong>${tr('product.condition')}</strong> ${product.condition}</li>`,
            `<li><strong>${tr('product.shipping')}</strong> ${tr('product.shippingValue')}</li>`
        ].filter(Boolean).join('');

        const imgStyle = product.imageOpacity ? ` style="opacity: ${product.imageOpacity};"` : '';
        const images = getProductImages(product);
        const mainImage = images[0] || product.image || '';

        const stockLeft = Number.isFinite(Number(product.maxQty)) && Number(product.maxQty) > 0
            ? Math.floor(Number(product.maxQty))
            : 0;
        const isOutOfStock = product.inStock === false || stockLeft === 0;
        let stockClass = 'in-stock';
        let stockLabel = tr('product.inStock');
        if (product.badge === 'preorder') {
            stockClass = 'preorder';
            stockLabel = stockLeft > 0
                ? tr('product.preorderLeft', { n: stockLeft })
                : tr('product.preorderReserve');
        } else if (isOutOfStock) {
            stockClass = 'out-of-stock';
            stockLabel = tr('product.outOfStock');
        } else if (stockLeft <= 3) {
            stockClass = 'low-stock';
            stockLabel = stockLeft === 1
                ? tr('product.lowStockOne')
                : tr('product.lowStock', { n: stockLeft });
        } else {
            stockLabel = tr('product.inStockCount', { n: stockLeft });
        }

        const conditionNote = product.condition
            ? `<div class="product-authenticity">
                   <strong>${tr('product.gradedTitle')}</strong>
                   <span>${tr('product.gradedText')}</span>
               </div>`
            : `<div class="product-authenticity">
                   <strong>${tr('product.sealedTitle')}</strong>
                   <span>${tr('product.sealedText')}</span>
               </div>`;

        const thumbsHtml = images.length > 1
            ? `<div class="product-detail-thumbs" role="list">
                   ${images.map((src, i) => `
                       <button type="button"
                               class="product-detail-thumb${i === 0 ? ' is-active' : ''}"
                               role="listitem"
                               data-image="${src.replace(/"/g, '&quot;')}"
                               aria-label="${tr('product.photo', { n: i + 1 })}">
                           <img src="${src}" alt="">
                       </button>
                   `).join('')}
               </div>`
            : '';

        const qtyAria = tr('btn.qty');
        const addLabel = typeof resolveButtonLabel === 'function'
            ? resolveButtonLabel(product.buttonLabel)
            : (product.buttonLabel || tr('btn.addToCart'));
        const contactLabel = tr('btn.contact');
        const crumbCat = typeof categoryLabel === 'function' && product.category
            ? categoryLabel(product.category)
            : tr('product.shop');

        container.innerHTML = `
            <nav class="breadcrumb" aria-label="${tr('product.breadcrumb')}">
                <a href="/">${tr('product.home')}</a>
                <span aria-hidden="true">/</span>
                <a href="/aanbod${product.category ? `?category=${product.category}` : ''}">${crumbCat}</a>
                <span aria-hidden="true">/</span>
                <span>${product.title}</span>
            </nav>

            <div class="product-detail-layout">
                <div class="product-detail-gallery">
                    ${badgeHtml}
                    <div class="card-image product-detail-image">
                        <img id="product-main-image" src="${mainImage}" alt="${product.title}"${imgStyle}>
                    </div>
                    ${thumbsHtml}
                </div>

                <div class="product-detail-info">
                    <p class="product-brand">${product.brand}</p>
                    <h1 class="product-detail-title">${product.title}</h1>

                    ${ratingSummaryHtml()}

                    <div class="product-stock ${stockClass}">${stockLabel}</div>

                    <div class="product-price-row">
                        <span class="price-current">${formatEuro(product.price)}</span>
                        ${oldPriceHtml}
                        <span class="price-incl">${tr('product.inclVat')}</span>
                    </div>

                    <p class="product-detail-desc">${product.description}</p>
                    <ul class="product-meta">${metaItems}</ul>

                    ${conditionNote}

                    <div class="purchase-group product-detail-purchase"
                         data-product-id="${product.id}"
                         data-product-title="${product.title.replace(/"/g, '&quot;')}"
                         data-product-image="${mainImage.replace(/"/g, '&quot;')}">
                        ${product.purchaseMode === 'contact'
                            ? `<a class="btn-contact btn-contact-large" href="/contact?product=${encodeURIComponent(product.id)}">${contactLabel}</a>`
                            : `<input type="number" class="qty-input" value="1" min="1" max="${product.maxQty}" data-price="${product.price}" aria-label="${qtyAria}">
                               <button type="button" class="btn-add btn-add-large">${addLabel}</button>`}
                    </div>

                    <div class="product-trust-grid">
                        <div class="product-trust-card">
                            <span class="trust-card-icon">🔒</span>
                            <strong>${tr('product.paySafe')}</strong>
                            <span>${tr('product.paySafeSub')}</span>
                        </div>
                        <div class="product-trust-card">
                            <span class="trust-card-icon">📦</span>
                            <strong>${tr('product.packed')}</strong>
                            <span>${tr('product.packedSub')}</span>
                        </div>
                        <div class="product-trust-card">
                            <span class="trust-card-icon">↩</span>
                            <strong>${tr('product.returns')}</strong>
                            <span>${tr('product.returnsSub')}</span>
                        </div>
                        <div class="product-trust-card">
                            <span class="trust-card-icon">🇳🇱</span>
                            <strong>${tr('product.nlShop')}</strong>
                            <span>${tr('product.nlShopSub')}</span>
                        </div>
                    </div>

                    <div class="payment-badges">
                        <span>iDEAL</span>
                        <span>Bancontact</span>
                        <span>Visa</span>
                        <span>Mastercard</span>
                        <span>Apple Pay</span>
                        <span>Crypto</span>
                        <span>bunq.me</span>
                    </div>
                </div>
            </div>

            ${reviewsSectionHtml()}
        `;

        const mainImg = document.getElementById('product-main-image');
        container.querySelectorAll('.product-detail-thumb').forEach((btn) => {
            btn.addEventListener('click', () => {
                const src = btn.dataset.image;
                if (!src || !mainImg) return;
                mainImg.src = src;
                container.querySelectorAll('.product-detail-thumb').forEach((el) => {
                    el.classList.toggle('is-active', el === btn);
                });
            });
        });
    }

    function renderNotFound() {
        const container = document.getElementById('product-detail');
        if (!container) return;
        container.innerHTML = `
            <div class="empty-state">
                <h2>${tr('product.notFound')}</h2>
                <p>${tr('product.notFoundText')}</p>
                <a class="btn-hero" href="/aanbod">${tr('product.backToShop')}</a>
            </div>
        `;
        document.title = tr('product.notFoundTitle');
    }

    function renderLoadError() {
        const container = document.getElementById('product-detail');
        if (!container) return;
        container.innerHTML = `
            <div class="empty-state">
                <h2>${tr('product.loadErrorTitle')}</h2>
                <p>${tr('product.loadErrorText')}</p>
            </div>
        `;
    }

    function refresh() {
        if (loadFailed) {
            renderLoadError();
            return;
        }
        if (!productsLoaded) return;
        if (!currentProductId) {
            renderNotFound();
            return;
        }
        const product = getProductById(currentProductId);
        if (!product) {
            renderNotFound();
            return;
        }
        renderProduct(product);
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const params = new URLSearchParams(window.location.search);
        currentProductId = params.get('id');
        const container = document.getElementById('product-detail');
        if (!container) return;

        try {
            await loadProducts();
            productsLoaded = true;
            if (currentProductId) {
                await loadProductReviews(currentProductId);
            }
        } catch (err) {
            loadFailed = true;
            renderLoadError();
            return;
        }

        refresh();

        window.addEventListener('pokevault:langchange', refresh);
    });
})();
