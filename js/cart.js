function formatEuro(amount) {
    return '€' + amount.toFixed(2).replace('.', ',');
}

const Cart = {
    items: [],
    _shippingFreeFrom: 100,

    load() {
        try {
            const saved = localStorage.getItem('pokevault-cart');
            if (saved) this.items = JSON.parse(saved);
        } catch {
            this.items = [];
        }
    },

    save() {
        localStorage.setItem('pokevault-cart', JSON.stringify(this.items));
    },

    add(item) {
        const existing = this.items.find(i => i.id === item.id);
        if (existing) {
            existing.quantity += item.quantity;
        } else {
            this.items.push({ ...item });
        }
        this.save();
        this.updateHeader();
        this.render();
    },

    remove(id) {
        this.items = this.items.filter(i => i.id !== id);
        this.save();
        this.updateHeader();
        this.render();
    },

    getTotalItems() {
        return this.items.reduce((sum, i) => sum + i.quantity, 0);
    },

    getTotalPrice() {
        return this.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    },

    updateHeader() {
        const cartCountEl = document.getElementById('cart-count');
        const cartTotalEl = document.getElementById('cart-total');
        const totalItems = this.getTotalItems();
        const totalPrice = this.getTotalPrice();
        if (cartCountEl) cartCountEl.textContent = totalItems;
        if (cartTotalEl) cartTotalEl.textContent = formatEuro(totalPrice);
    },

    updateShippingNote() {
        const note = document.getElementById('cart-shipping-note');
        if (!note || typeof t !== 'function') return;
        const freeFrom = this._shippingFreeFrom;
        if (freeFrom === 0) {
            note.textContent = t('cart.shippingFree');
        } else {
            note.textContent = t('cart.shippingFrom', {
                amount: freeFrom.toFixed(2).replace('.', ',')
            });
        }
    },

    render() {
        const container = document.getElementById('cart-items');
        if (!container) return;

        const tr = typeof t === 'function' ? t : (k) => k;

        if (this.items.length === 0) {
            container.innerHTML = `
                <div class="cart-empty">
                    <span class="cart-empty-icon" aria-hidden="true">🛒</span>
                    <p>${tr('cart.empty')}</p>
                    <a href="/aanbod" class="cart-empty-link">${tr('cart.emptyLink')}</a>
                </div>
            `;
        } else {
            container.innerHTML = this.items.map(item => `
                <div class="cart-item" data-id="${item.id}">
                    <div class="cart-item-image">
                        <img src="${item.image}" alt="">
                    </div>
                    <div class="cart-item-info">
                        <p class="cart-item-title">${item.title}</p>
                        <p class="cart-item-price">${formatEuro(item.price)} × ${item.quantity}</p>
                    </div>
                    <button class="cart-item-remove" aria-label="${tr('cart.remove')}" data-remove="${item.id}">×</button>
                </div>
            `).join('');
        }

        const subtotalEl = document.getElementById('cart-subtotal');
        if (subtotalEl) subtotalEl.textContent = formatEuro(this.getTotalPrice());

        const checkoutBtn = document.getElementById('cart-checkout');
        if (checkoutBtn) {
            checkoutBtn.disabled = this.items.length === 0;
            checkoutBtn.textContent = tr('cart.checkout');
        }

        const continueBtn = document.getElementById('cart-continue');
        if (continueBtn) continueBtn.textContent = tr('cart.continue');

        const titleEl = document.querySelector('.cart-drawer-header h2');
        if (titleEl) titleEl.textContent = tr('cart.title');

        const totalLabel = document.querySelector('.cart-subtotal-row span');
        if (totalLabel) totalLabel.textContent = tr('cart.total');

        const closeBtn = document.getElementById('cart-close');
        if (closeBtn) closeBtn.setAttribute('aria-label', tr('cart.close'));

        const drawer = document.getElementById('cart-drawer');
        if (drawer) drawer.setAttribute('aria-label', tr('cart.aria'));

        this.updateShippingNote();
    },

    open() {
        const drawer = document.getElementById('cart-drawer');
        const overlay = document.getElementById('cart-overlay');
        if (drawer) drawer.classList.add('open');
        if (overlay) overlay.classList.add('open');
        document.body.classList.add('cart-open');
        this.render();
    },

    close() {
        const drawer = document.getElementById('cart-drawer');
        const overlay = document.getElementById('cart-overlay');
        if (drawer) drawer.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
        document.body.classList.remove('cart-open');
    }
};

function getProductDataFromButton(button) {
    const container = button.closest('.product-card, .product-detail-purchase');
    const qtyInput = container.querySelector('.qty-input');
    const quantity = parseInt(qtyInput.value, 10);
    const price = parseFloat(qtyInput.getAttribute('data-price'));

    if (container.dataset.productId) {
        return {
            id: container.dataset.productId,
            title: container.dataset.productTitle,
            image: container.dataset.productImage,
            price,
            quantity
        };
    }

    const card = button.closest('.product-card');
    if (card) {
        const link = card.querySelector('.product-title a, .card-image-link');
        const id = new URL(link.href, window.location.origin).searchParams.get('id') || link.href;
        const title = card.querySelector('.product-title a')?.textContent.trim() || '';
        const image = card.querySelector('.card-image img')?.src || '';
        return { id, title, image, price, quantity };
    }

    return null;
}

function injectCartDrawer() {
    if (document.getElementById('cart-drawer')) return;

    const tr = typeof t === 'function' ? t : (k, fallback) => fallback || k;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="cart-overlay" id="cart-overlay" aria-hidden="true"></div>
        <aside class="cart-drawer" id="cart-drawer" aria-label="${tr('cart.aria', 'Winkelwagen')}">
            <div class="cart-drawer-header">
                <h2>${tr('cart.title', 'Winkelwagen')}</h2>
                <button type="button" class="cart-close" id="cart-close" aria-label="${tr('cart.close', 'Sluiten')}">×</button>
            </div>
            <div class="cart-drawer-body" id="cart-items"></div>
            <div class="cart-drawer-footer">
                <div class="cart-subtotal-row">
                    <span>${tr('cart.total', 'Totaal')}</span>
                    <strong id="cart-subtotal">€0,00</strong>
                </div>
                <p class="cart-shipping-note" id="cart-shipping-note">${tr('cart.shippingNote', 'Wereldwijde verzending · gratis vanaf €100 (NL/BE)')}</p>
                <button type="button" class="btn-checkout" id="cart-checkout">${tr('cart.checkout', 'Afrekenen')}</button>
                <button type="button" class="btn-continue" id="cart-continue">${tr('cart.continue', 'Verder winkelen')}</button>
            </div>
        </aside>
    `);
}

function initCart() {
    if (initCart.initialized) return;
    initCart.initialized = true;

    Cart.load();
    injectCartDrawer();
    Cart.updateHeader();
    Cart.render();

    fetch('/api/shipping')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
            if (!data) return;
            const freeFrom = Number(data.freeFromDomestic);
            if (!Number.isFinite(freeFrom) || freeFrom < 0) return;
            Cart._shippingFreeFrom = freeFrom;
            Cart.updateShippingNote();
        })
        .catch(() => { /* keep default note */ });

    document.getElementById('cart-overlay').addEventListener('click', () => Cart.close());
    document.getElementById('cart-close').addEventListener('click', () => Cart.close());
    document.getElementById('cart-continue').addEventListener('click', () => Cart.close());

    const checkoutBtn = document.getElementById('cart-checkout');
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => {
            Cart.load();
            if (!Cart.items.length) return;
            window.location.href = '/checkout';
        });
    }

    document.querySelectorAll('.cart-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            Cart.open();
        });
    });

    document.body.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove]')) {
            Cart.remove(e.target.closest('[data-remove]').dataset.remove);
            return;
        }

        const button = e.target.closest('.btn-add');
        if (!button) return;

        const product = getProductDataFromButton(button);
        if (!product) return;

        Cart.add(product);
        Cart.open();

        const originalContent = button.innerHTML;
        button.innerHTML = typeof t === 'function' ? t('btn.added') : '✓ Toegevoegd';
        button.style.backgroundColor = '#10b981';

        setTimeout(() => {
            button.innerHTML = originalContent;
            button.style.backgroundColor = '';
            const qtyInput = button.closest('.product-card, .product-detail-purchase')?.querySelector('.qty-input');
            if (qtyInput) qtyInput.value = 1;
        }, 1500);
    });

    window.addEventListener('pokevault:langchange', () => {
        Cart.render();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.querySelector('.search-container');
    if (searchForm) {
        searchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const query = searchForm.querySelector('input').value.trim();
            if (query) {
                window.location.href = `/aanbod?q=${encodeURIComponent(query)}`;
            } else {
                window.location.href = '/aanbod';
            }
        });
    }

    initCart();
});
