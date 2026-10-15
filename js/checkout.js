(function () {
    const FREE_SHIPPING_FROM = 100;
    const SHIPPING_FEE = 6.95;

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

    function shippingFor(subtotal) {
        return subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;
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
        const shipping = shippingFor(subtotal);
        const total = subtotal + shipping;

        document.getElementById('checkout-subtotal').textContent = formatEuro(subtotal);
        document.getElementById('checkout-shipping').textContent =
            shipping === 0 ? 'Gratis' : formatEuro(shipping);
        document.getElementById('checkout-total').textContent = formatEuro(total);
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

        const payload = {
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
        submitBtn.textContent = 'Betaling voorbereiden…';

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
    });
})();
