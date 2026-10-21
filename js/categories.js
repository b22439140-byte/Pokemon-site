const PRODUCT_CATEGORIES = [
    { value: 'pokemon', label: 'Pokémon', labelKey: 'cat.pokemon' },
    { value: 'boxen', label: 'Boxen', labelKey: 'cat.boxen' },
    { value: 'boosters', label: 'Boosters', labelKey: 'cat.boosters' },
    { value: 'tins', label: 'Tins', labelKey: 'cat.tins' },
    { value: 'blisters', label: 'Blisters', labelKey: 'cat.blisters' },
    { value: 'losse-kaarten', label: 'Losse Kaarten', labelKey: 'cat.singles' },
    { value: 'accessoires', label: 'Accessoires', labelKey: 'cat.accessories' },
    { value: 'andere-tcg', label: 'Andere TCG', labelKey: 'cat.otherTcg' },
    { value: 'lego', label: 'LEGO', labelKey: 'cat.lego' },
    { value: 'sale', label: 'Sale', labelKey: 'cat.sale' }
];

const PSA_GRADES = [
    { value: '', label: 'Geen PSA', labelKey: 'psa.none' },
    { value: '1', label: 'PSA 1' },
    { value: '2', label: 'PSA 2' },
    { value: '3', label: 'PSA 3' },
    { value: '4', label: 'PSA 4' },
    { value: '5', label: 'PSA 5' },
    { value: '6', label: 'PSA 6' },
    { value: '7', label: 'PSA 7' },
    { value: '8', label: 'PSA 8' },
    { value: '9', label: 'PSA 9' },
    { value: '10', label: 'PSA 10' }
];

const CATEGORY_VALUES = PRODUCT_CATEGORIES.map((c) => c.value);

const LEGACY_CATEGORY_MAP = {
    single: 'losse-kaarten',
    sealed: 'boxen',
    accessory: 'accessoires'
};

function categoryLabel(value) {
    if (value === 'preorder') {
        return typeof t === 'function' ? t('cat.preorder') : 'Pre-order';
    }
    const found = PRODUCT_CATEGORIES.find((c) => c.value === value);
    if (!found) return value || '—';
    if (found.labelKey && typeof t === 'function') return t(found.labelKey);
    return found.label;
}

function psaLabel(value) {
    if (!value) return '';
    const found = PSA_GRADES.find((g) => g.value === String(value));
    if (!found) return `PSA ${value}`;
    if (found.labelKey && typeof t === 'function') return t(found.labelKey);
    return found.label;
}

function normalizeProductMeta(product) {
    if (!product || typeof product !== 'object') return product;

    let category = product.category;
    let psa = product.psa == null || product.psa === '' ? null : String(product.psa);

    const psaMatch = typeof category === 'string' && category.match(/^psa-(\d{1,2})$/);
    if (psaMatch) {
        psa = psaMatch[1];
        category = 'losse-kaarten';
    } else if (LEGACY_CATEGORY_MAP[category]) {
        category = LEGACY_CATEGORY_MAP[category];
    }

    if (!CATEGORY_VALUES.includes(category)) {
        category = 'pokemon';
    }

    if (psa && !/^(10|[1-9])$/.test(psa)) {
        psa = null;
    }

    return { ...product, category, psa };
}
