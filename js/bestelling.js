(function () {
    const MAX_POLLS = 40;
    const POLL_MS = 3000;

    let lastView = null;
    let lastOrder = null;
    let lastAttempts = 0;

    function tr(key, vars) {
        return typeof t === 'function' ? t(key, vars) : key;
    }

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
            throw new Error(data.error || tr('order.notFoundError'));
        }
        return data;
    }

    function renderPaid(order) {
        lastView = 'paid';
        lastOrder = order;
        if (typeof Cart !== 'undefined') {
            Cart.items = [];
            Cart.save();
            Cart.updateHeader();
            Cart.render();
        }

        setStatus({
            paid: true,
            label: tr('order.paidLabel'),
            detail: tr('order.paidDetail'),
            hero: tr('order.paidHero'),
            metaHtml: `
                <p><strong>${tr('order.orderNumber')}</strong> ${escapeHtml(order.id)}</p>
                <p><strong>${tr('order.total')}</strong> ${formatEuro(order.total)}</p>
            `,
            actionsHtml: `
                <a class="btn-submit checkout-empty-link" href="/aanbod">${tr('order.continue')}</a>
                <a class="order-secondary-link" href="/contact">${tr('order.questions')}</a>
            `
        });
    }

    function renderCryptoPending(order) {
        lastView = 'crypto';
        lastOrder = order;
        const address = order.crypto?.address;
        const network = order.crypto?.network || 'BTC / ETH / USDT';
        const walletBlock = address
            ? `<p><strong>${tr('order.network')}</strong> ${escapeHtml(network)}</p>
               <p><strong>${tr('order.wallet')}</strong> <code class="crypto-wallet">${escapeHtml(address)}</code></p>
               <p>${tr('order.cryptoSend', { amount: formatEuro(order.total) })}</p>`
            : `<p>${tr('order.cryptoEmail', { email: escapeHtml(order.customer?.email || tr('order.yourEmail')) })}</p>`;

        setStatus({
            label: tr('order.cryptoLabel'),
            detail: tr('order.cryptoDetail'),
            hero: tr('order.cryptoHero'),
            metaHtml: `
                <p><strong>${tr('order.orderNumber')}</strong> ${escapeHtml(order.id)}</p>
                <p><strong>${tr('order.total')}</strong> ${formatEuro(order.total)}</p>
                <p><strong>${tr('order.paymentMethod')}</strong> Crypto (${escapeHtml(network)})</p>
                ${walletBlock}
            `,
            actionsHtml: `
                <a class="btn-submit checkout-empty-link" href="/contact?order=${encodeURIComponent(order.id)}">${tr('order.cryptoContact')}</a>
                <a class="order-secondary-link" href="/aanbod">${tr('order.continue')}</a>
            `
        });
    }

    function renderPending(order, attempts) {
        lastOrder = order;
        lastAttempts = attempts;
        if (order.paymentMethod === 'crypto') {
            renderCryptoPending(order);
            return;
        }

        lastView = 'pending';
        const payLink = order.paymentUrl
            ? `<a class="btn-submit checkout-empty-link" href="${escapeHtml(order.paymentUrl)}">${tr('order.reopenBunq')}</a>`
            : '';

        setStatus({
            label: attempts >= MAX_POLLS ? tr('order.timeoutLabel') : tr('order.pendingLabel'),
            detail: attempts >= MAX_POLLS
                ? tr('order.timeoutDetail')
                : tr('order.pendingDetail'),
            hero: tr('order.pendingHero'),
            metaHtml: `
                <p><strong>${tr('order.orderNumber')}</strong> ${escapeHtml(order.id)}</p>
                <p><strong>${tr('order.total')}</strong> ${formatEuro(order.total)}</p>
            `,
            actionsHtml: `
                ${payLink}
                <a class="order-secondary-link" href="/contact">${tr('order.needHelp')}</a>
            `
        });
    }

    function renderNotFound(message) {
        lastView = 'notfound';
        setStatus({
            label: tr('order.notFoundLabel'),
            detail: message || tr('order.notFoundDetail'),
            hero: tr('order.notFoundHero'),
            actionsHtml: `<a class="btn-submit checkout-empty-link" href="/aanbod">${tr('order.backToShop')}</a>`
        });
    }

    function renderNoOrder() {
        lastView = 'noorder';
        setStatus({
            label: tr('order.noOrderLabel'),
            detail: tr('order.noOrderDetail'),
            hero: tr('order.noOrderHero'),
            actionsHtml: `<a class="btn-submit checkout-empty-link" href="/aanbod">${tr('order.toShop')}</a>`
        });
    }

    function reapplyLastView() {
        if (lastView === 'paid' && lastOrder) renderPaid(lastOrder);
        else if (lastView === 'crypto' && lastOrder) renderCryptoPending(lastOrder);
        else if (lastView === 'pending' && lastOrder) renderPending(lastOrder, lastAttempts);
        else if (lastView === 'notfound') renderNotFound();
        else if (lastView === 'noorder') renderNoOrder();
        else if (lastView === 'checking') {
            setStatus({
                label: tr('order.checkingLabel'),
                detail: tr('order.checkingDetail'),
                hero: tr('order.checkingHero')
            });
        }
    }

    async function poll(orderId) {
        let attempts = 0;
        lastView = 'checking';

        while (attempts < MAX_POLLS) {
            try {
                lastOrder = await fetchOrder(orderId);
                if (lastOrder.status === 'paid') {
                    renderPaid(lastOrder);
                    return;
                }
                renderPending(lastOrder, attempts);
                if (lastOrder.paymentMethod === 'crypto') {
                    return;
                }
            } catch (err) {
                renderNotFound(err.message);
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
            renderNoOrder();
            window.addEventListener('pokevault:langchange', reapplyLastView);
            return;
        }
        poll(orderId);
        window.addEventListener('pokevault:langchange', reapplyLastView);
    });
})();
