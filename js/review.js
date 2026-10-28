(function () {
    let orderId = '';
    let customerName = '';
    /** @type {object[]} */
    let items = [];
    let selectedProductId = '';
    let selectedRating = 0;

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

    function starsHtml(rating, interactive) {
        const n = Math.max(0, Math.min(5, Number(rating) || 0));
        if (!interactive) {
            return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
        }
        return [1, 2, 3, 4, 5]
            .map(
                (value) =>
                    `<button type="button" class="review-star-btn${value <= n ? ' is-active' : ''}" data-rating="${value}" aria-label="${tr('review.starAria', { n: value })}">★</button>`
            )
            .join('');
    }

    function setRoot(html) {
        const root = document.getElementById('review-root');
        if (root) root.innerHTML = html;
    }

    function renderMissingOrder() {
        const hero = document.getElementById('review-hero-text');
        if (hero) hero.textContent = tr('review.missingHero');
        setRoot(`
            <div class="empty-state">
                <h2>${tr('review.missingTitle')}</h2>
                <p>${tr('review.missingText')}</p>
                <a class="btn-hero" href="/aanbod">${tr('review.backToShop')}</a>
            </div>
        `);
    }

    function renderError(message) {
        const hero = document.getElementById('review-hero-text');
        if (hero) hero.textContent = tr('review.errorHero');
        setRoot(`
            <div class="empty-state">
                <h2>${tr('review.errorTitle')}</h2>
                <p>${escapeHtml(message || tr('review.errorText'))}</p>
                <a class="btn-hero" href="/aanbod">${tr('review.backToShop')}</a>
            </div>
        `);
    }

    function openItems() {
        return items.filter((item) => !item.alreadyReviewed);
    }

    function renderForm() {
        const open = openItems();
        const hero = document.getElementById('review-hero-text');
        if (hero) {
            hero.textContent = open.length
                ? tr('review.heroText')
                : tr('review.allDoneHero');
        }

        if (!open.length) {
            setRoot(`
                <div class="empty-state">
                    <h2>${tr('review.allDoneTitle')}</h2>
                    <p>${tr('review.allDoneText')}</p>
                    <a class="btn-hero" href="/aanbod">${tr('review.backToShop')}</a>
                </div>
            `);
            return;
        }

        if (!selectedProductId || !open.some((item) => item.productId === selectedProductId)) {
            selectedProductId = open[0].productId;
        }

        const productOptions = open
            .map(
                (item) => `
                <label class="review-product-option${item.productId === selectedProductId ? ' is-selected' : ''}">
                    <input type="radio" name="productId" value="${escapeHtml(item.productId)}" ${
                        item.productId === selectedProductId ? 'checked' : ''
                    }>
                    ${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : '<span class="review-product-placeholder"></span>'}
                    <span>${escapeHtml(item.title)}</span>
                </label>`
            )
            .join('');

        const doneCount = items.length - open.length;
        const doneNote = doneCount
            ? `<p class="review-done-note">${tr('review.alreadyCount', { n: doneCount })}</p>`
            : '';

        setRoot(`
            <form class="contact-form review-form" id="review-form">
                <h2>${tr('review.formTitle')}</h2>
                <p class="review-order-meta">${tr('review.orderLabel')} <strong>${escapeHtml(orderId)}</strong></p>
                ${doneNote}

                <fieldset class="review-products">
                    <legend>${tr('review.chooseProduct')}</legend>
                    <div class="review-product-list">${productOptions}</div>
                </fieldset>

                <div class="form-group">
                    <span class="review-rating-label" id="review-rating-label">${tr('review.rating')}</span>
                    <div class="review-star-picker" role="group" aria-labelledby="review-rating-label">
                        ${starsHtml(selectedRating, true)}
                    </div>
                </div>

                <div class="form-group">
                    <label for="review-name">${tr('review.displayName')}</label>
                    <input type="text" id="review-name" name="displayName" maxlength="60"
                           value="${escapeHtml(customerName)}"
                           placeholder="${tr('review.displayNamePlaceholder')}" autocomplete="nickname">
                </div>

                <div class="form-group">
                    <label for="review-text">${tr('review.message')}</label>
                    <textarea id="review-text" name="text" required minlength="10" maxlength="1000"
                              placeholder="${tr('review.messagePlaceholder')}"></textarea>
                </div>

                <button type="submit" class="btn-submit" id="review-submit">${tr('review.submit')}</button>
                <p class="form-success" id="review-success" hidden>${tr('review.success')}</p>
                <p class="form-error" id="review-error" role="alert"></p>
            </form>
        `);

        bindForm();
    }

    function bindForm() {
        const form = document.getElementById('review-form');
        if (!form) return;

        form.querySelectorAll('input[name="productId"]').forEach((input) => {
            input.addEventListener('change', () => {
                selectedProductId = input.value;
                selectedRating = 0;
                renderForm();
            });
        });

        form.querySelectorAll('.review-star-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                selectedRating = Number(btn.dataset.rating) || 0;
                const picker = form.querySelector('.review-star-picker');
                if (picker) picker.innerHTML = starsHtml(selectedRating, true);
                bindStarButtons(form);
            });
        });

        form.addEventListener('submit', onSubmit);
    }

    function bindStarButtons(form) {
        form.querySelectorAll('.review-star-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                selectedRating = Number(btn.dataset.rating) || 0;
                const picker = form.querySelector('.review-star-picker');
                if (picker) picker.innerHTML = starsHtml(selectedRating, true);
                bindStarButtons(form);
            });
        });
    }

    async function onSubmit(e) {
        e.preventDefault();
        const form = e.currentTarget;
        const submitBtn = document.getElementById('review-submit');
        const successEl = document.getElementById('review-success');
        const errorEl = document.getElementById('review-error');

        if (errorEl) errorEl.textContent = '';
        if (successEl) successEl.hidden = true;

        if (!selectedRating) {
            if (errorEl) errorEl.textContent = tr('review.ratingRequired');
            return;
        }

        const text = String(form.querySelector('#review-text')?.value || '').trim();
        const displayName = String(form.querySelector('#review-name')?.value || '').trim();

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = tr('review.sending');
        }

        try {
            const res = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId,
                    productId: selectedProductId,
                    rating: selectedRating,
                    text,
                    displayName
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || tr('review.sendFailed'));
            }

            const reviewed = items.find((item) => item.productId === selectedProductId);
            if (reviewed) reviewed.alreadyReviewed = true;
            selectedRating = 0;
            selectedProductId = '';

            if (successEl) {
                successEl.hidden = false;
                successEl.textContent = tr('review.success');
            }

            window.setTimeout(() => renderForm(), 900);
        } catch (err) {
            if (errorEl) errorEl.textContent = err.message || tr('review.genericError');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = tr('review.submit');
            }
        }
    }

    async function load() {
        orderId = new URLSearchParams(window.location.search).get('order') || '';
        if (!orderId) {
            renderMissingOrder();
            return;
        }

        try {
            const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/reviewables`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || tr('review.errorText'));
            }
            customerName = data.customerName || '';
            items = Array.isArray(data.items) ? data.items : [];
            renderForm();
        } catch (err) {
            renderError(err.message);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        load();
        window.addEventListener('pokevault:langchange', () => {
            if (!orderId) renderMissingOrder();
            else if (items.length) renderForm();
            else load();
        });
    });
})();
