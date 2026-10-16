(function () {
    const FREE_SHIPPING_FROM_DOMESTIC = 100;
    const FREE_SHIPPING_FROM_INTERNATIONAL = 150;
    const SHIPPING_FEE_DOMESTIC = 6.95;
    const SHIPPING_FEE_INTERNATIONAL = 14.95;
    const DOMESTIC_COUNTRIES = new Set(['NL', 'BE']);

    function formatEuro(amount) {
        return '€' + Number(amount).toFixed(2).replace('.', ',');
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function selectedCountry() {
        const el = document.getElementById('country');
        return el ? el.value : 'NL';
    }

    function shippingFor(subtotal, country) {
        if (DOMESTIC_COUNTRIES.has(country)) {
            return subtotal >= FREE_SHIPPING_FROM_DOMESTIC ? 0 : SHIPPING_FEE_DOMESTIC;
        }
        return subtotal >= FREE_SHIPPING_FROM_INTERNATIONAL ? 0 : SHIPPING_FEE_INTERNATIONAL;
    }

    function updateNote(subtotal, country, shipping) {
        const note = document.getElementById('checkout-note');
        if (!note) return;
        const domestic = DOMESTIC_COUNTRIES.has(country);
        if (shipping === 0) {
            note.textContent = domestic
                ? 'Gratis verzending binnen NL/BE. Na bevestigen rond je de betaling af.'
                : 'Gratis internationale verzending vanaf €150. Na bevestigen rond je de betaling af.';
        } else if (domestic) {
            const remaining = FREE_SHIPPING_FROM_DOMESTIC - subtotal;
            note.textContent = remaining > 0
                ? `Verzendkosten €${SHIPPING_FEE_DOMESTIC.toFixed(2).replace('.', ',')}. Nog ${formatEuro(remaining)} tot gratis verzending (NL/BE).`
                : 'Gratis verzending binnen NL/BE. Na bevestigen rond je de betaling af.';
        } else {
            const remaining = FREE_SHIPPING_FROM_INTERNATIONAL - subtotal;
            note.textContent = remaining > 0
                ? `Internationale verzending €${SHIPPING_FEE_INTERNATIONAL.toFixed(2).replace('.', ',')}. Nog ${formatEuro(remaining)} tot gratis verzending wereldwijd.`
                : 'Gratis internationale verzending. Na bevestigen rond je de betaling af.';
        }
    }

    function renderSummary() {
        const itemsEl = document.getElementById('checkout-items');
        const emptyEl = document.getElementById('checkout-empty');
        const gridEl = document.getElementById('checkout-grid');
        if (!itemsEl || !emptyEl || !gridEl) return;

        Cart.load();
        const items = Cart.items || [];

        if (!items.length) {
            emptyEl.hidden = false;
            gridEl.hidden = true;
            return;
        }

        emptyEl.hidden = true;
        gridEl.hidden = false;

        itemsEl.innerHTML = items.map((item) => `
            <div class="checkout-line">
                <div class="checkout-line-image">
                    <img src="${escapeHtml(item.image || '')}" alt="">
                </div>
                <div class="checkout-line-info">
                    <p class="checkout-line-title">${escapeHtml(item.title || '')}</p>
                    <p class="checkout-line-meta">${formatEuro(item.price)} × ${item.quantity}</p>
                </div>
                <strong class="checkout-line-total">${formatEuro(item.price * item.quantity)}</strong>
            </div>
        `).join('');

        const subtotal = Cart.getTotalPrice();
        const country = selectedCountry();
        const shipping = shippingFor(subtotal, country);
        const total = subtotal + shipping;

        document.getElementById('checkout-subtotal').textContent = formatEuro(subtotal);
        document.getElementById('checkout-shipping').textContent =
            shipping === 0 ? 'Gratis' : formatEuro(shipping);
        document.getElementById('checkout-total').textContent = formatEuro(total);
        updateNote(subtotal, country, shipping);
    }

    async function submitCheckout(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const submitBtn = document.getElementById('checkout-submit');
        const errorEl = document.getElementById('checkout-error');
        errorEl.textContent = '';
        errorEl.classList.remove('visible');

        Cart.load();
        if (!Cart.items.length) {
            errorEl.textContent = 'Je winkelwagen is leeg.';
            errorEl.classList.add('visible');
            return;
        }

        const paymentMethod = (form.paymentMethod?.value || 'bunq') === 'crypto'
            ? 'crypto'
            : 'bunq';

        const payload = {
            paymentMethod,
            items: Cart.items.map((item) => ({
                productId: item.id,
                qty: item.quantity
            })),
            customer: {
                name: form.name.value.trim(),
                email: form.email.value.trim(),
                phone: form.phone.value.trim(),
                address: {
                    line1: form.street.value.trim(),
                    postalCode: form.postalCode.value.trim(),
                    city: form.city.value.trim(),
                    country: form.country.value.trim() || 'NL'
                }
            }
        };

        submitBtn.disabled = true;
        submitBtn.textContent = paymentMethod === 'crypto'
            ? 'Bestelling plaatsen…'
            : 'Betaling voorbereiden…';

        try {
            const response = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Kon betaling niet starten.');
            }

            if (data.paymentMethod === 'crypto' || data.orderUrl) {
                if (typeof Cart !== 'undefined') {
                    Cart.items = [];
                    Cart.save();
                    Cart.updateHeader();
                }
                window.location.href = data.orderUrl
                    || `/bestelling.html?order=${encodeURIComponent(data.orderId)}`;
                return;
            }

            if (!data.paymentUrl) {
                throw new Error('Geen betaallink ontvangen.');
            }
            window.location.href = data.paymentUrl;
        } catch (err) {
            errorEl.textContent = err.message || 'Er ging iets mis.';
            errorEl.classList.add('visible');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Doorgaan naar betalen';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderSummary();
        const form = document.getElementById('checkout-form');
        if (form) form.addEventListener('submit', submitCheckout);
        const country = document.getElementById('country');
        if (country) country.addEventListener('change', renderSummary);
    });
})();
