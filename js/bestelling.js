(function () {
    const MAX_POLLS = 40;
    const POLL_MS = 3000;

    function formatEuro(amount) {
        return '€' + Number(amount).toFixed(2).replace('.', ',');
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function orderIdFromUrl() {
        return new URLSearchParams(window.location.search).get('order') || '';
    }

    function setStatus({ label, detail, hero, metaHtml = '', actionsHtml = '', paid = false }) {
        const labelEl = document.getElementById('order-status-label');
        const detailEl = document.getElementById('order-status-detail');
        const heroEl = document.getElementById('order-hero-text');
        const metaEl = document.getElementById('order-meta');
        const actionsEl = document.getElementById('order-actions');
        const card = document.getElementById('order-status-card');

        if (labelEl) labelEl.textContent = label;
        if (detailEl) detailEl.textContent = detail;
        if (heroEl) heroEl.textContent = hero;
        if (metaEl) {
            metaEl.innerHTML = metaHtml;
            metaEl.hidden = !metaHtml;
        }
        if (actionsEl) actionsEl.innerHTML = actionsHtml;
        if (card) card.classList.toggle('is-paid', paid);
    }

    async function fetchOrder(orderId) {
        const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Bestelling niet gevonden.');
        }
        return data;
    }

    function renderPaid(order) {
        if (typeof Cart !== 'undefined') {
            Cart.items = [];
            Cart.save();
            Cart.updateHeader();
            Cart.render();
        }

        setStatus({
            paid: true,
            label: 'Betaling ontvangen',
            detail: 'Bedankt! We gaan je bestelling zo snel mogelijk verzenden.',
            hero: 'Je bestelling is betaald.',
            metaHtml: `
                <p><strong>Bestelnummer:</strong> ${escapeHtml(order.id)}</p>
                <p><strong>Totaal:</strong> ${formatEuro(order.total)}</p>
            `,
            actionsHtml: `
                <a class="btn-submit checkout-empty-link" href="aanbod.html">Verder winkelen</a>
                <a class="order-secondary-link" href="contact.html">Vragen? Neem contact op</a>
            `
        });
    }

    function renderCryptoPending(order) {
        const address = order.crypto?.address;
        const network = order.crypto?.network || 'BTC / ETH / USDT';
        const walletBlock = address
            ? `<p><strong>Netwerk:</strong> ${escapeHtml(network)}</p>
               <p><strong>Wallet:</strong> <code class="crypto-wallet">${escapeHtml(address)}</code></p>
               <p>Stuur het exacte bedrag van <strong>${formatEuro(order.total)}</strong> en vermeld je bestelnummer in de memo/notitie indien mogelijk.</p>`
            : `<p>We sturen de crypto-betaalinstructies (BTC, ETH of USDT) naar <strong>${escapeHtml(order.customer?.email || 'je e-mailadres')}</strong>. Vermeld bij vragen altijd je bestelnummer.</p>`;

        setStatus({
            label: 'Wachten op crypto-betaling',
            detail: 'Je bestelling is geplaatst. Rond de betaling af met crypto — daarna verzenden we zo snel mogelijk.',
            hero: 'Betaal met crypto om af te ronden.',
            metaHtml: `
                <p><strong>Bestelnummer:</strong> ${escapeHtml(order.id)}</p>
                <p><strong>Totaal:</strong> ${formatEuro(order.total)}</p>
                <p><strong>Betaalmethode:</strong> Crypto (${escapeHtml(network)})</p>
                ${walletBlock}
            `,
            actionsHtml: `
                <a class="btn-submit checkout-empty-link" href="contact.html?order=${encodeURIComponent(order.id)}">Contact over betaling</a>
                <a class="order-secondary-link" href="aanbod.html">Verder winkelen</a>
            `
        });
    }

    function renderPending(order, attempts) {
        if (order.paymentMethod === 'crypto') {
            renderCryptoPending(order);
            return;
        }

        const payLink = order.paymentUrl
            ? `<a class="btn-submit checkout-empty-link" href="${escapeHtml(order.paymentUrl)}">Opnieuw openen in bunq.me</a>`
            : '';

        setStatus({
            label: attempts >= MAX_POLLS ? 'Nog niet bevestigd' : 'Wachten op betaling',
            detail: attempts >= MAX_POLLS
                ? 'Als je al hebt betaald, kan de bevestiging even duren. Vernieuw deze pagina over een minuut, of open de betaallink opnieuw.'
                : 'Rond je betaling af op bunq.me. Deze pagina werkt automatisch bij.',
            hero: 'Nog even je betaling afronden…',
            metaHtml: `
                <p><strong>Bestelnummer:</strong> ${escapeHtml(order.id)}</p>
                <p><strong>Totaal:</strong> ${formatEuro(order.total)}</p>
            `,
            actionsHtml: `
                ${payLink}
                <a class="order-secondary-link" href="contact.html">Hulp nodig?</a>
            `
        });
    }

    async function poll(orderId) {
        let attempts = 0;
        let lastOrder = null;

        while (attempts < MAX_POLLS) {
            try {
                lastOrder = await fetchOrder(orderId);
                if (lastOrder.status === 'paid') {
                    renderPaid(lastOrder);
                    return;
                }
                renderPending(lastOrder, attempts);
                // Crypto payments are confirmed manually — no need to keep polling.
                if (lastOrder.paymentMethod === 'crypto') {
                    return;
                }
            } catch (err) {
                setStatus({
                    label: 'Bestelling niet gevonden',
                    detail: err.message || 'Kon de bestelling niet laden.',
                    hero: 'Er ging iets mis.',
                    actionsHtml: `<a class="btn-submit checkout-empty-link" href="aanbod.html">Terug naar aanbod</a>`
                });
                return;
            }

            attempts += 1;
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }

        if (lastOrder) renderPending(lastOrder, attempts);
    }

    document.addEventListener('DOMContentLoaded', () => {
        const orderId = orderIdFromUrl();
        if (!orderId) {
            setStatus({
                label: 'Geen bestelling',
                detail: 'Open deze pagina via de link na het afrekenen.',
                hero: 'Geen bestelnummer gevonden.',
                actionsHtml: `<a class="btn-submit checkout-empty-link" href="aanbod.html">Naar aanbod</a>`
            });
            return;
        }
        poll(orderId);
    });
})();
