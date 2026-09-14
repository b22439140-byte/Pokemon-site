document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');
    const container = document.getElementById('product-detail');
    if (!container) return;

    try {
        await loadProducts();
    } catch (err) {
        container.innerHTML = `
            <div class="empty-state">
                <h2>Kon producten niet laden</h2>
                <p>Start de server met <code>npm start</code> en probeer opnieuw.</p>
            </div>
        `;
        return;
    }

    const product = getProductById(productId);

    if (!product) {
        container.innerHTML = `
            <div class="empty-state">
                <h2>Product niet gevonden</h2>
                <p>Dit product bestaat niet of is niet meer beschikbaar.</p>
                <a class="btn-hero" href="aanbod.html">Terug naar aanbod</a>
            </div>
        `;
        document.title = 'Product niet gevonden — PokeVault';
        return;
    }

    document.title = `${product.title} — PokeVault`;

    const badgeHtml = product.badge
        ? `<span class="badge ${product.badge}">${product.badge === 'sale' ? 'Sale −15%' : 'Pre-order'}</span>`
        : '';

    const oldPriceHtml = product.oldPrice
        ? `<span class="price-old">${formatEuro(product.oldPrice)}</span>`
        : '';

    const metaItems = [
        product.set && `<li><strong>Set:</strong> ${product.set}</li>`,
        product.type && `<li><strong>Type:</strong> ${product.type}</li>`,
        product.condition && `<li><strong>Conditie:</strong> ${product.condition}</li>`,
        `<li><strong>Verzending:</strong> 3-5 dagen levertijd</li>`
    ].filter(Boolean).join('');

    const imgStyle = product.imageOpacity ? ` style="opacity: ${product.imageOpacity};"` : '';

    const stockLabel = product.badge === 'preorder'
        ? 'Pre-order — reserveer nu'
        : 'Op voorraad — vandaag verwerkt';

    const conditionNote = product.condition
        ? `<div class="product-authenticity">
               <strong>✓ Eerlijk gegradeerd</strong>
               <span>Visueel gecontroleerd door ons team. Extra foto's op aanvraag via <a href="contact.html">contact</a>.</span>
           </div>`
        : `<div class="product-authenticity">
               <strong>✓ 100% sealed &amp; authentiek</strong>
               <span>Rechtstreeks via officiële distributeurs. Nooit gerepackaged.</span>
           </div>`;

    container.innerHTML = `
        <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="index.html">Home</a>
            <span aria-hidden="true">/</span>
            <a href="aanbod.html">Aanbod</a>
            <span aria-hidden="true">/</span>
            <span>${product.title}</span>
        </nav>

        <div class="product-detail-layout">
            <div class="product-detail-gallery">
                ${badgeHtml}
                <div class="card-image product-detail-image">
                    <img src="${product.image}" alt="${product.title}"${imgStyle}>
                </div>
            </div>

            <div class="product-detail-info">
                <p class="product-brand">${product.brand}</p>
                <h1 class="product-detail-title">${product.title}</h1>

                <div class="product-rating">
                    <span class="product-stars" aria-label="9,4 van 10">★★★★★</span>
                    <span class="product-rating-text"><strong>9,4/10</strong> · 847 reviews op Trustpilot</span>
                </div>

                <div class="product-stock ${product.badge === 'preorder' ? 'preorder' : 'in-stock'}">${stockLabel}</div>

                <div class="product-price-row">
                    <span class="price-current">${formatEuro(product.price)}</span>
                    ${oldPriceHtml}
                    <span class="price-incl">Incl. BTW</span>
                </div>

                <p class="product-detail-desc">${product.description}</p>
                <ul class="product-meta">${metaItems}</ul>

                ${conditionNote}

                <div class="purchase-group product-detail-purchase"
                     data-product-id="${product.id}"
                     data-product-title="${product.title.replace(/"/g, '&quot;')}"
                     data-product-image="${product.image}">
                    <input type="number" class="qty-input" value="1" min="1" max="${product.maxQty}" data-price="${product.price}" aria-label="Aantal">
                    <button class="btn-add btn-add-large">${product.buttonLabel || 'In winkelwagen'}</button>
                </div>

                <div class="product-trust-grid">
                    <div class="product-trust-card">
                        <span class="trust-card-icon">🔒</span>
                        <strong>Veilig betalen</strong>
                        <span>iDEAL, PayPal &amp; creditcard</span>
                    </div>
                    <div class="product-trust-card">
                        <span class="trust-card-icon">📦</span>
                        <strong>Stevig verpakt</strong>
                        <span>Toploader + bubbeltjesfolie</span>
                    </div>
                    <div class="product-trust-card">
                        <span class="trust-card-icon">↩</span>
                        <strong>14 dagen retour</strong>
                        <span>Eenvoudig retourneren</span>
                    </div>
                    <div class="product-trust-card">
                        <span class="trust-card-icon">🇳🇱</span>
                        <strong>Nederlandse webshop</strong>
                        <span>Verzending vanuit NL</span>
                    </div>
                </div>

                <div class="payment-badges">
                    <span>iDEAL</span>
                    <span>PayPal</span>
                    <span>Visa</span>
                    <span>Mastercard</span>
                    <span>Bancontact</span>
                    <span>Apple Pay</span>
                </div>
            </div>
        </div>

        <section class="product-reviews" aria-label="Klantbeoordelingen">
            <h2>Wat klanten zeggen</h2>
            <div class="review-cards">
                <blockquote class="review-card">
                    <div class="review-stars">★★★★★</div>
                    <p>"Kaart kwam perfect verpakt aan, exact zoals beschreven. Zeker voor herhaling vatbaar!"</p>
                    <footer>— Mark V., <time datetime="2026-01">januari 2026</time></footer>
                </blockquote>
                <blockquote class="review-card">
                    <div class="review-stars">★★★★★</div>
                    <p>"Snelle levering en eerlijke prijs. Fijn dat je foto's kunt opvragen bij singles."</p>
                    <footer>— Sophie K., <time datetime="2026-02">februari 2026</time></footer>
                </blockquote>
            </div>
        </section>
    `;
});
