const PRODUCT_CATEGORIES = [
    { value: 'pokemon', label: 'Pokémon' },
    { value: 'boxen', label: 'Boxen' },
    { value: 'boosters', label: 'Boosters' },
    { value: 'tins', label: 'Tins' },
    { value: 'blisters', label: 'Blisters' },
    { value: 'losse-kaarten', label: 'Losse Kaarten' },
    { value: 'accessoires', label: 'Accessoires' },
    { value: 'andere-tcg', label: 'Andere TCG' },
    { value: 'lego', label: 'LEGO' },
    { value: 'sale', label: 'Sale' }
];

const PSA_GRADES = [
    { value: '', label: 'Geen PSA' },
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
    const found = PRODUCT_CATEGORIES.find((c) => c.value === value);
    return found ? found.label : value || '—';
}

function psaLabel(value) {
    if (!value) return '';
    const found = PSA_GRADES.find((g) => g.value === String(value));
    return found ? found.label : `PSA ${value}`;
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
