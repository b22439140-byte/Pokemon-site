(function () {
    const DEFAULT_SHIPPING = {
        feeDomestic: 6.95,
        feeInternational: 14.95,
        freeFromDomestic: 100,
        freeFromInternational: 150,
        domesticCountries: ['NL', 'BE']
    };

    let shippingConfig = { ...DEFAULT_SHIPPING };

    function tr(key, vars) {
        return typeof t === 'function' ? t(key, vars) : key;
    }

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

    function domesticSet() {
        return new Set(shippingConfig.domesticCountries || DEFAULT_SHIPPING.domesticCountries);
    }

    function shippingFor(subtotal, country) {
        if (domesticSet().has(country)) {
            return subtotal >= shippingConfig.freeFromDomestic ? 0 : shippingConfig.feeDomestic;
        }
        return subtotal >= shippingConfig.freeFromInternational ? 0 : shippingConfig.feeInternational;
    }

    function updateNote(subtotal, country, shipping) {
        const note = document.getElementById('checkout-note');
        if (!note) return;
        const domestic = domesticSet().has(country);
        if (shipping === 0) {
            note.textContent = domestic
                ? tr('checkout.noteFreeDomestic')
                : tr('checkout.noteFreeIntlFrom', { amount: formatEuro(shippingConfig.freeFromInternational) });
        } else if (domestic) {
            const remaining = shippingConfig.freeFromDomestic - subtotal;
            note.textContent = remaining > 0
                ? tr('checkout.noteDomesticRemaining', {
                    fee: formatEuro(shippingConfig.feeDomestic),
                    remaining: formatEuro(remaining)
                })
                : tr('checkout.noteFreeDomestic');
        } else {
            const remaining = shippingConfig.freeFromInternational - subtotal;
            note.textContent = remaining > 0
                ? tr('checkout.noteIntlRemaining', {
                    fee: formatEuro(shippingConfig.feeInternational),
                    remaining: formatEuro(remaining)
                })
                : tr('checkout.noteFreeIntl');
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
            shipping === 0 ? tr('checkout.free') : formatEuro(shipping);
        document.getElementById('checkout-total').textContent = formatEuro(total);
        updateNote(subtotal, country, shipping);
    }

    async function loadShippingConfig() {
        try {
            const response = await fetch('/api/shipping');
            if (!response.ok) return;
            const data = await response.json();
            const num = (value, fallback) => {
                const n = Number(value);
                return Number.isFinite(n) && n >= 0 ? n : fallback;
            };
            shippingConfig = {
                feeDomestic: num(data.feeDomestic, DEFAULT_SHIPPING.feeDomestic),
                feeInternational: num(data.feeInternational, DEFAULT_SHIPPING.feeInternational),
                freeFromDomestic: num(data.freeFromDomestic, DEFAULT_SHIPPING.freeFromDomestic),
                freeFromInternational: num(data.freeFromInternational, DEFAULT_SHIPPING.freeFromInternational),
                domesticCountries: Array.isArray(data.domesticCountries) && data.domesticCountries.length
                    ? data.domesticCountries
                    : DEFAULT_SHIPPING.domesticCountries
            };
        } catch (_) {
            /* keep defaults */
        }
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
            errorEl.textContent = tr('checkout.emptyError');
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
            ? tr('checkout.placing')
            : tr('checkout.preparing');

        try {
            const response = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || tr('checkout.startError'));
            }

            const clearCart = () => {
                if (typeof Cart === 'undefined') return;
                Cart.items = [];
                Cart.save();
                Cart.updateHeader();
            };

            const localOrderPath = `/bestelling?order=${encodeURIComponent(data.orderId)}`;

            if (data.paymentMethod === 'bunq') {
                if (!data.paymentUrl) {
                    throw new Error(tr('checkout.noPayLink'));
                }
                try {
                    sessionStorage.setItem('pokevault-pending-order', data.orderId);
                } catch (_) { /* ignore */ }
                clearCart();
                window.location.href = data.paymentUrl;
                return;
            }

            clearCart();
            window.location.href = localOrderPath;
        } catch (err) {
            errorEl.textContent = err.message || tr('checkout.genericError');
            errorEl.classList.add('visible');
            submitBtn.disabled = false;
            submitBtn.textContent = tr('checkout.submit');
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        await loadShippingConfig();
        renderSummary();
        const form = document.getElementById('checkout-form');
        if (form) form.addEventListener('submit', submitCheckout);
        const country = document.getElementById('country');
        if (country) country.addEventListener('change', renderSummary);

        window.addEventListener('pokevault:langchange', () => {
            renderSummary();
            const submitBtn = document.getElementById('checkout-submit');
            if (submitBtn && !submitBtn.disabled) {
                submitBtn.textContent = tr('checkout.submit');
            }
        });
    });
})();
