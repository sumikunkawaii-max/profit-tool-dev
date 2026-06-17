// === 状態管理 ===
let products = [];
let sortKey = 'lastUpdated';
let sortDir = 'desc';
let colFilters = {};
let selectedAsins = new Set();
let appSettings = {};

// === 列定義 ===
const ALL_COLUMNS = [
  { id:'check',    label:'', fixed:true, w:'30px' },
  { id:'image',    label:'画像', fixed:true, w:'50px' },
  { id:'title',    label:'商品名', fixed:true, sortKey:'title' },
  { id:'asin',     label:'ASIN', fixed:true, sortKey:'asin', w:'95px' },
  { id:'supplier', label:'仕入先', sortKey:'supplierPlatform', filterable:true, filterKey:'supplierUrl', w:'140px' },
  { id:'listingPrice', label:'出品価格', sortKey:'listingPrice', filterable:true, w:'100px' },
  { id:'lowerPrice', label:'下限価格', sortKey:'lowerPrice', filterable:true, w:'75px' },
  { id:'commissionRate', label:'手数料%', w:'55px' },
  { id:'purchasePrice', label:'仕入れ値', sortKey:'purchasePrice', filterable:true, w:'75px' },
  { id:'points',   label:'ポイント', sortKey:'points', filterable:true, w:'65px' },
  { id:'ptPrice',  label:'PT込み', w:'70px' },
  { id:'shipping', label:'配送/送料', filterable:true, filterKey:'shippingMethod', w:'110px' },
  { id:'quantity', label:'個数', sortKey:'quantity', filterable:true, w:'50px' },
  { id:'profit',   label:'粗利', w:'80px' },
  { id:'size',     label:'サイズ', w:'90px' },
  { id:'brand',    label:'ブランド', sortKey:'brand', filterable:true, w:'90px' },
  { id:'category', label:'カテゴリ', sortKey:'category', filterable:true, w:'100px' },
  { id:'amazon',   label:'Amazon出品率', sortKey:'amazonPresence90', w:'65px' },
  { id:'avgPrice', label:'平均価格', sortKey:'avg90BuyBoxPrice', w:'70px' },
  { id:'sellers',  label:'出品者', sortKey:'avg90NewSellerCount', filterable:true, w:'50px' },
  { id:'fba',      label:'FBA', sortKey:'avg90FbaSellerCount', w:'40px' },
  { id:'fbm',      label:'自己発送', sortKey:'avg90FbmSellerCount', w:'50px' },
  { id:'sales',    label:'販売数', sortKey:'salesRankDrops90', w:'55px' },
  { id:'rank',     label:'平均ランク', sortKey:'avg90SalesRank', w:'70px' },
  { id:'rating',   label:'評価', sortKey:'rating', w:'40px' },
  { id:'reviews',  label:'レビュー', sortKey:'reviewCount', w:'55px' },
  { id:'notes',    label:'メモ', filterable:true, w:'120px' },
  { id:'updated',  label:'更新日', sortKey:'lastUpdated', w:'55px' },
  { id:'actions',  label:'操作', fixed:true, w:'80px' },
];

function getColumnConfig() {
  const saved = appSettings.columnConfig;
  if (saved && Array.isArray(saved)) {
    const ids = saved.map(c => c.id);
    const merged = saved
      .map(s => { const base = ALL_COLUMNS.find(a => a.id === s.id); return base ? { ...base, ...s } : null; })
      .filter(Boolean);
    ALL_COLUMNS.forEach(a => { if (!ids.includes(a.id)) merged.push({ ...a, visible: true }); });
    return merged;
  }
  return ALL_COLUMNS.map(c => ({ ...c, visible: true }));
}

function getVisibleColumns() {
  return getColumnConfig().filter(c => c.visible !== false);
}

// === localStorage データ管理 ===
const STORAGE_KEYS = { products: 'pm_products', settings: 'pm_settings' };

const DEFAULT_SETTINGS = {
  keepaApiKey: '',
  shippingMethods: [
    {name:'ネコポス',cost:185},{name:'宅急便コンパクト',cost:404},{name:'宅急便60',cost:470},
    {name:'宅急便80',cost:574},{name:'宅急便100',cost:708},{name:'宅急便120',cost:797},
    {name:'宅急便140',cost:988},{name:'宅急便160',cost:1158},{name:'宅急便180',cost:1599},
    {name:'クール60',cost:745},{name:'クール80',cost:904},{name:'クール100',cost:1148},
    {name:'クール120',cost:1512},{name:'定形郵便',cost:110},{name:'定形外(規格内)',cost:140},
    {name:'レターパックプラス',cost:600},
  ],
  categoryCommissions: [
    {name:'家電・カメラ',rate:8},{name:'おもちゃ・ホビー',rate:10},{name:'ドラッグストア',rate:10},
    {name:'食品・飲料',rate:10},{name:'本・CD・DVD',rate:15},{name:'ペット用品',rate:10},
    {name:'ビューティー',rate:10},{name:'スポーツ＆アウトドア',rate:10},{name:'DIY・工具',rate:15},{name:'その他',rate:10},
  ],
  csvDefaults: { condition:'新品',shippingRoute:'自己発送',leadTime:1,paymentLimit:0,priceReductionPercent:10,priceReductionEnabled:false,priceRevisionMode:'なし',description:'',deliverySettings:'' },
  columnConfig: null,
};

function saveProductsToStorage() { localStorage.setItem(STORAGE_KEYS.products, JSON.stringify(products)); }
function loadProductsFromStorage() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.products)) || []; } catch { return []; } }
function saveSettingsToStorage() { localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(appSettings)); }
function loadSettingsFromStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings));
    return saved ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

// === Keepa API（ブラウザ直接呼び出し） ===
const CSV_TYPE = { AMAZON:0, NEW:1, SALES_RANK:3, COUNT_NEW:11, RATING:16, COUNT_REVIEWS:17, BUY_BOX:18, COUNT_NEW_FBA:34, COUNT_NEW_FBM:35 };

async function fetchFromKeepa(asin) {
  const apiKey = appSettings.keepaApiKey;
  if (!apiKey) return { error: 'Keepa APIキーが設定されていません。設定から入力してください。' };
  const url = `https://api.keepa.com/product?key=${encodeURIComponent(apiKey)}&domain=5&asin=${asin}&stats=90&offers=20`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) return { error: `Keepa APIエラー: ${JSON.stringify(data.error)}` };
    if (!data.products?.length) return { error: '商品が見つかりませんでした。' };
    return parseKeepaProduct(data.products[0]);
  } catch (err) { return { error: `Keepa API通信エラー: ${err.message}` }; }
}

function parseKeepaProduct(product) {
  const stats = product.stats || {};
  const g = (obj, i) => (!obj || !Array.isArray(obj) || obj[i] === undefined || obj[i] === -1) ? null : obj[i];
  let imageUrl = null;
  if (product.images?.length) { const f = product.images[0].l || product.images[0].m; if (f) imageUrl = `https://m.media-amazon.com/images/I/${f}`; }
  let category = '';
  if (product.categoryTree?.length) category = product.categoryTree.map(c => c.name).join(' > ');
  const ratingRaw = g(stats.current, CSV_TYPE.RATING);
  const amazonOOS = stats.outOfStockPercentage90?.[CSV_TYPE.AMAZON];
  // サイズ
  let sizeCm = null;
  let h = product.packageHeight, l = product.packageLength, w = product.packageWidth;
  if (h <= 0 && l <= 0 && w <= 0) { h = product.itemHeight; l = product.itemLength; w = product.itemWidth; }
  if (h > 0 || l > 0 || w > 0) { const toCm = v => v > 0 ? (v/10).toFixed(1) : '?'; sizeCm = `${toCm(l)}x${toCm(w)}x${toCm(h)}`; }
  const weightG = (product.packageWeight > 0) ? product.packageWeight : (product.itemWeight > 0 ? product.itemWeight : null);
  return {
    asin: product.asin, title: product.title || '不明', imageUrl, brand: product.brand || '', category,
    avg90BuyBoxPrice: g(stats.avg90, CSV_TYPE.BUY_BOX) ?? g(stats.avg90, CSV_TYPE.NEW),
    avg90NewSellerCount: g(stats.avg90, CSV_TYPE.COUNT_NEW),
    avg90FbaSellerCount: g(stats.avg90, CSV_TYPE.COUNT_NEW_FBA),
    avg90FbmSellerCount: g(stats.avg90, CSV_TYPE.COUNT_NEW_FBM),
    avg90SalesRank: g(stats.avg90, CSV_TYPE.SALES_RANK),
    amazonPresence90: (amazonOOS !== undefined && amazonOOS !== -1) ? 100 - amazonOOS : null,
    rating: ratingRaw !== null ? ratingRaw / 10 : null,
    reviewCount: g(stats.current, CSV_TYPE.COUNT_REVIEWS),
    currentBuyBoxPrice: stats.buyBoxPrice > 0 ? stats.buyBoxPrice : g(stats.current, CSV_TYPE.BUY_BOX),
    currentNewPrice: g(stats.current, CSV_TYPE.NEW),
    buyBoxType: stats.buyBoxIsAmazon === true ? 'amazon' : stats.buyBoxIsFBA === true ? 'fba' : (stats.buyBoxSellerId && stats.buyBoxIsFBA === false) ? 'fbm' : null,
    sizeCm, weightG,
    salesRankDrops90: stats.salesRankDrops90 ?? null, salesRankDrops30: stats.salesRankDrops30 ?? null,
    monthlySold: product.monthlySold > 0 ? product.monthlySold : null,
  };
}

const USER_FIELDS = ['supplier','supplierPlatform','supplierShop','supplierUrl','listingPrice','lowerPrice',
  'purchasePrice','points','purchasePriceWithPoints','quantity','shippingMethod','shippingCost',
  'shippingSuggested','commissionRate','lowerPricePercent','priceReductionEnabled','notes'];

// === 初期化 ===
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('asinInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleFetch(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeSettings(); closeCsvModal(); } });
  appSettings = loadSettingsFromStorage();
  products = loadProductsFromStorage();
  checkApiStatus();
  renderAll();
  // Service Worker登録
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
});

// === データ操作 ===
function checkApiStatus() {
  const b = document.getElementById('apiStatus');
  const hasKey = !!appSettings.keepaApiKey;
  b.className = 'status-badge ' + (hasKey ? 'connected' : 'disconnected');
  b.querySelector('.status-text').textContent = hasKey ? 'Keepa接続済み' : 'Keepa未設定';
}

function loadSettings() { appSettings = loadSettingsFromStorage(); }
function loadProducts() { products = loadProductsFromStorage(); renderAll(); }

async function handleFetch() {
  const input = document.getElementById('asinInput');
  const asin = input.value.trim().toUpperCase();
  const hint = document.getElementById('inputHint');
  if (!asin) { hint.textContent = 'ASINを入力'; return; }
  if (!/^[A-Z0-9]{10}$/.test(asin)) { hint.textContent = '英数字10桁'; return; }
  hint.textContent = '';
  showLoading(true);
  const keepaData = await fetchFromKeepa(asin);
  showLoading(false);
  if (keepaData.error) { showToast(keepaData.error, 'error'); return; }
  const idx = products.findIndex(p => p.asin === asin);
  const now = new Date().toISOString();
  if (idx >= 0) {
    const ex = products[idx];
    products[idx] = { ...keepaData };
    USER_FIELDS.forEach(f => { products[idx][f] = ex[f] ?? null; });
    if (!products[idx].supplier) products[idx].supplier = '';
    if (!products[idx].notes) products[idx].notes = '';
    products[idx].lastUpdated = now; products[idx].createdAt = ex.createdAt;
    showToast('商品データを更新しました');
  } else {
    const np = { ...keepaData };
    USER_FIELDS.forEach(f => { np[f] = null; });
    np.supplier = ''; np.notes = ''; np.commissionRate = 10; np.priceReductionEnabled = false;
    np.lastUpdated = now; np.createdAt = now;
    products.push(np);
    showToast('商品を追加しました');
  }
  saveProductsToStorage();
  input.value = '';
  renderAll();
}

async function refreshProduct(asin) {
  showLoading(true);
  const keepaData = await fetchFromKeepa(asin);
  showLoading(false);
  if (keepaData.error) { showToast(keepaData.error, 'error'); return; }
  const idx = products.findIndex(p => p.asin === asin);
  if (idx >= 0) {
    const ex = products[idx];
    products[idx] = { ...keepaData };
    USER_FIELDS.forEach(f => { products[idx][f] = ex[f] ?? null; });
    if (!products[idx].supplier) products[idx].supplier = '';
    if (!products[idx].notes) products[idx].notes = '';
    products[idx].lastUpdated = new Date().toISOString(); products[idx].createdAt = ex.createdAt;
  }
  saveProductsToStorage();
  showToast('更新しました');
  renderAll();
}

function deleteProduct(asin) {
  if (!confirm('この商品を削除しますか？')) return;
  products = products.filter(p => p.asin !== asin);
  saveProductsToStorage(); renderAll(); showToast('削除しました');
}

function patchProduct(asin, data) {
  const p = products.find(x => x.asin === asin);
  if (p) { Object.assign(p, data); saveProductsToStorage(); }
}

// === インライン保存 ===
async function saveInline(el) {
  const asin = el.dataset.asin, field = el.dataset.field;
  let value = el.type === 'number' ? (el.value === '' ? null : Number(el.value))
    : el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : el.value;

  // 出品価格変更 → 下限価格自動更新
  if (field === 'listingPrice') {
    const p = products.find(x => x.asin === asin);
    if (p) {
      p.listingPrice = value;
      const updates = { listingPrice: value };
      const pct = p.lowerPricePercent || (appSettings.csvDefaults?.priceReductionEnabled ? appSettings.csvDefaults.priceReductionPercent : null);
      const enabled = p.priceReductionEnabled || appSettings.csvDefaults?.priceReductionEnabled;
      if (enabled && pct && value) {
        const lp = Math.round(value * (1 - pct / 100));
        updates.lowerPrice = lp; p.lowerPrice = lp;
        const lpEl = document.querySelector(`[data-asin="${asin}"][data-field="lowerPrice"]`);
        if (lpEl) lpEl.value = lp;
      }
      patchProduct(asin, updates); flashSaved(el); renderProfitCell(asin); return;
    }
  }
  // PT込み仕入れ値の自動計算
  if (field === 'purchasePrice' || field === 'points') {
    const p = products.find(x => x.asin === asin);
    if (p) {
      const pp = field === 'purchasePrice' ? value : (p.purchasePrice ?? null);
      const pt = field === 'points' ? value : (p.points ?? null);
      if (pp !== null) {
        const ptWp = pp - (pt || 0);
        patchProduct(asin, { [field]: value, purchasePriceWithPoints: ptWp });
        p[field] = value; p.purchasePriceWithPoints = ptWp;
        const ptEl = document.querySelector(`[data-asin="${asin}"][data-field="purchasePriceWithPoints"]`);
        if (ptEl) ptEl.value = ptWp;
        flashSaved(el); renderProfitCell(asin); return;
      }
    }
  }
  // 配送方法選択 → 送料自動入力 + 候補フラグ解除
  if (field === 'shippingMethod') {
    const sm = appSettings.shippingMethods?.find(m => m.name === value);
    const cost = sm ? sm.cost : null;
    patchProduct(asin, { shippingMethod: value, shippingCost: cost, shippingSuggested: false });
    const p = products.find(x => x.asin === asin);
    if (p) { p.shippingMethod = value; p.shippingCost = cost; p.shippingSuggested = false; }
    const costEl = document.querySelector(`[data-asin="${asin}"][data-field="shippingCost"]`);
    if (costEl) costEl.value = cost ?? '';
    flashSaved(el); renderProfitCell(asin);
    // 候補バッジ除去
    const badge = el.closest('td')?.querySelector('.badge-suggested');
    if (badge) badge.remove();
    return;
  }
  const p = products.find(x => x.asin === asin);
  if (p) {
    p[field] = value;
    saveProductsToStorage();
    flashSaved(el);
    if (['listingPrice','purchasePrice','points','shippingCost','commissionRate'].includes(field)) renderProfitCell(asin);
  }
}
function flashSaved(el) { el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 800); }

// === 粗利計算 ===
function calcProfit(p) {
  const listing = p.listingPrice, cost = p.purchasePriceWithPoints ?? p.purchasePrice;
  const ship = p.shippingCost || 0, rate = p.commissionRate ?? 10;
  if (!listing || !cost) return null;
  const commission = Math.round(listing * rate / 100);
  const profit = listing - cost - ship - commission;
  return { profit, profitRate: ((profit / listing) * 100).toFixed(1) };
}
function renderProfitCell(asin) {
  const p = products.find(x => x.asin === asin); if (!p) return;
  const el = document.getElementById(`profit-${asin}`); if (!el) return;
  const r = calcProfit(p);
  if (!r) { el.innerHTML = '<span class="cell-null">-</span>'; el.className = 'cell-profit'; return; }
  el.className = 'cell-profit ' + (r.profit >= 0 ? 'positive' : 'negative');
  el.innerHTML = `¥${r.profit.toLocaleString()}<br><span class="cell-profit-sub">${r.profitRate}%</span>`;
}

// === テーブル描画 ===
function renderAll() { renderTable(); }

function renderCellContent(colId, p, shippingOpts) {
  const pr = calcProfit(p);
  switch(colId) {
    case 'check': return `<input type="checkbox" class="row-checkbox" data-asin="${p.asin}" ${selectedAsins.has(p.asin)?'checked':''} onchange="toggleSelect(this)">`;
    case 'image': return p.imageUrl ? `<img class="product-thumb" src="${esc(p.imageUrl)}" loading="lazy" onclick="openDetail('${p.asin}')" onerror="this.style.display='none'">` : `<div class="product-thumb-placeholder" onclick="openDetail('${p.asin}')"></div>`;
    case 'title': return `<a class="product-name" href="https://www.amazon.co.jp/dp/${p.asin}" target="_blank" rel="noopener">${esc(p.title)}</a>`;
    case 'asin': return `<span class="asin-copy" onclick="copyAsin('${p.asin}',this)" title="コピー">${p.asin}</span>`;
    case 'supplier': {
      const pf = p.supplierPlatform || '';
      const shop = p.supplierShop || '';
      const url = p.supplierUrl || '';
      // URLが未判定でsupplierShopにURL入ってる場合も対応
      const currentUrl = url || (shop && shop.startsWith('http') ? shop : '') || '';
      const displayPf = detectPlatform(currentUrl);
      const displayShop = displayPf ? extractShopName(currentUrl) : '';
      return `<div class="supplier-cell-v">
        <div class="supplier-top">${displayPf ? `<span class="supplier-platform ${getPlatformClass(displayPf)}">${esc(displayPf)}</span>` : ''}${displayShop ? `<span class="supplier-shop">${esc(displayShop)}</span>` : ''}</div>
        <div class="supplier-url-row">
          <input class="supplier-url-input" type="text" value="${escA(currentUrl)}" placeholder="URLを貼り付け" data-asin="${p.asin}" onchange="handleSupplierInput(this)">
          ${currentUrl ? `<a class="supplier-open" href="${escA(currentUrl)}" target="_blank" rel="noopener" title="開く">↗</a>` : ''}
        </div>
      </div>`;
    }
    case 'listingPrice': {
      const cartPrice = p.currentBuyBoxPrice ?? p.currentNewPrice;
      const bbt = p.buyBoxType;
      const badgeCls = bbt === 'amazon' ? 'cart-amazon' : bbt === 'fba' ? 'cart-fba' : bbt === 'fbm' ? 'cart-fbm' : '';
      const badgeLabel = bbt === 'amazon' ? 'Amazon' : bbt === 'fba' ? 'FBA' : bbt === 'fbm' ? '自己発送' : '';
      return `<div class="listing-price-cell">
        <input class="inline-input inline-input-num" type="number" value="${p.listingPrice??''}" placeholder="¥" data-asin="${p.asin}" data-field="listingPrice" onchange="saveInline(this)">
        ${cartPrice ? `<div class="cart-price-hint ${badgeCls}"><span class="cart-badge">${badgeLabel}</span> ¥${cartPrice.toLocaleString()}</div>` : ''}
      </div>`;
    }
    case 'lowerPrice': return `<input class="inline-input inline-input-num" type="number" value="${p.lowerPrice??''}" placeholder="¥" data-asin="${p.asin}" data-field="lowerPrice" onchange="saveInline(this)">`;
    case 'commissionRate': return `<input class="inline-input inline-input-num" type="number" value="${p.commissionRate??10}" data-asin="${p.asin}" data-field="commissionRate" onchange="saveInline(this)" style="width:50px">`;
    case 'purchasePrice': return `<input class="inline-input inline-input-num" type="number" value="${p.purchasePrice??''}" placeholder="¥" data-asin="${p.asin}" data-field="purchasePrice" onchange="saveInline(this)">`;
    case 'points': return `<input class="inline-input inline-input-num" type="number" value="${p.points??''}" placeholder="0" data-asin="${p.asin}" data-field="points" onchange="saveInline(this)">`;
    case 'ptPrice': return `<input class="inline-input inline-input-num stacked-readonly" type="number" value="${p.purchasePriceWithPoints??''}" data-asin="${p.asin}" data-field="purchasePriceWithPoints" readonly tabindex="-1">`;
    case 'shipping': {
      const cls = getShipClass(p.shippingMethod);
      const sugBadge = p.shippingSuggested ? '<span class="badge-suggested">候補</span>' : '';
      return `<div class="stacked-cell ${cls}">${sugBadge}<select class="inline-select" data-asin="${p.asin}" data-field="shippingMethod" onchange="saveInline(this)"><option value="">--</option>${shippingOpts}</select><input class="inline-input inline-input-num" type="number" value="${p.shippingCost??''}" data-asin="${p.asin}" data-field="shippingCost" onchange="saveInline(this)" placeholder="¥0"></div>`;
    }
    case 'quantity': return `<input class="inline-input inline-input-num" type="number" value="${p.quantity??''}" placeholder="個" data-asin="${p.asin}" data-field="quantity" onchange="saveInline(this)">`;
    case 'profit': { const cls = pr ? (pr.profit >= 0 ? 'positive' : 'negative') : ''; const html = pr ? `¥${pr.profit.toLocaleString()}<br><span class="cell-profit-sub">${pr.profitRate}%</span>` : '<span class="cell-null">-</span>'; return `<div class="cell-profit ${cls}" id="profit-${p.asin}">${html}</div>`; }
    case 'size': return formatSizeDisplay(p);
    case 'brand': return `<span class="cell-brand">${formatBrand(p.brand)}</span>`;
    case 'category': return `<span class="cell-category">${formatCategory(p.category)}</span>`;
    case 'amazon': return `<span style="text-align:center;display:block">${formatAmazonPresence(p.amazonPresence90)}</span>`;
    case 'avgPrice': return `<span class="cell-price">${fmtPrice(p.avg90BuyBoxPrice)}</span>`;
    case 'sellers': return `<span class="cell-number">${fmtNum(p.avg90NewSellerCount)}</span>`;
    case 'fba': return `<span class="cell-number">${fmtNum(p.avg90FbaSellerCount)}</span>`;
    case 'fbm': return `<span class="cell-number">${fmtNum(p.avg90FbmSellerCount)}</span>`;
    case 'sales': return `<span class="cell-number">${formatSales(p)}</span>`;
    case 'rank': return `<span class="cell-rank">${fmtRank(p.avg90SalesRank)}</span>`;
    case 'rating': return `<span class="cell-number">${p.rating!=null?p.rating.toFixed(1):'<span class="cell-null">-</span>'}</span>`;
    case 'reviews': return `<span class="cell-number">${fmtNum(p.reviewCount)}</span>`;
    case 'notes': return `<textarea class="inline-memo" data-asin="${p.asin}" data-field="notes" onchange="saveInline(this)">${esc(p.notes||'')}</textarea>`;
    case 'updated': return `<span class="cell-date">${fmtDate(p.lastUpdated)}</span>`;
    case 'actions': return `<div class="action-btns"><button class="btn-icon btn-detail" onclick="openDetail('${p.asin}')" title="詳細"><span class="material-symbols-outlined">info</span></button><button class="btn-icon btn-refresh" onclick="refreshProduct('${p.asin}')" title="再取得"><span class="material-symbols-outlined">sync</span></button><button class="btn-icon btn-delete" onclick="deleteProduct('${p.asin}')" title="削除"><span class="material-symbols-outlined">delete</span></button></div>`;
    default: return '';
  }
}

function renderTable() {
  const empty = document.getElementById('emptyState');
  const container = document.getElementById('tableContainer');
  const cols = getVisibleColumns();

  let filtered = products;
  for (const [col, text] of Object.entries(colFilters)) {
    if (!text) continue;
    const lower = text.toLowerCase();
    filtered = filtered.filter(p => { const v = p[col]; return v != null && String(v).toLowerCase().includes(lower); });
  }
  filtered = [...filtered].sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (va == null) return 1; if (vb == null) return -1;
    if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb||'').toLowerCase(); }
    return va < vb ? (sortDir==='asc'?-1:1) : va > vb ? (sortDir==='asc'?1:-1) : 0;
  });

  if (!products.length) { empty.style.display = 'block'; container.style.display = 'none'; return; }
  empty.style.display = 'none'; container.style.display = 'block';

  const shippingOpts = (appSettings.shippingMethods||[]).map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');

  // ヘッダー描画
  let headHtml = '<tr class="thead-labels">';
  cols.forEach(c => {
    const sortClick = c.sortKey ? ` onclick="handleSort('${c.sortKey}')"` : '';
    const sortIcon = c.sortKey ? ' <span class="material-symbols-outlined sort-icon">unfold_more</span>' : '';
    const draggable = !c.fixed ? ' draggable="true" ondragstart="colDragStart(event,\''+c.id+'\')" ondragover="colDragOver(event)" ondrop="colDrop(event,\''+c.id+'\')"' : '';
    const dragClass = !c.fixed ? ' draggable-th' : '';
    if (c.id === 'check') headHtml += `<th style="width:${c.w}"><input type="checkbox" class="row-checkbox" id="selectAll" onchange="toggleSelectAll(this)"></th>`;
    else if (c.id === 'image') headHtml += `<th style="width:${c.w}"><button class="btn-icon btn-toggle-filter" onclick="toggleFilterRow()" title="列フィルター"><span class="material-symbols-outlined">filter_alt</span></button></th>`;
    else headHtml += `<th style="width:${c.w}" class="sortable${dragClass}"${sortClick}${draggable}>${c.label}${sortIcon}</th>`;
  });
  headHtml += '</tr>';

  const thead = document.querySelector('.product-table thead');

  // フィルター行の表示状態とフィルター値を保持
  const oldFilterRow = document.getElementById('filterRow');
  const filterVisible = oldFilterRow ? oldFilterRow.style.display !== 'none' : false;
  const savedFilterValues = {};
  if (oldFilterRow) {
    oldFilterRow.querySelectorAll('.col-filter').forEach(input => {
      if (input.dataset.col && input.value) savedFilterValues[input.dataset.col] = input.value;
    });
  }

  // フィルター行HTML生成
  let filterHtml = `<tr class="thead-filters" id="filterRow" style="display:${filterVisible ? '' : 'none'}">`;
  cols.forEach(c => {
    const fk = c.filterKey || c.sortKey || '';
    if (c.filterable && fk) {
      const val = savedFilterValues[fk] || '';
      filterHtml += `<th><input class="col-filter" data-col="${fk}" value="${escA(val)}" placeholder="検索..." oninput="handleColFilter()"></th>`;
    } else filterHtml += '<th></th>';
  });
  filterHtml += '</tr>';

  // thead全体を書き換え
  thead.innerHTML = headHtml + filterHtml;

  // ボディ描画
  const tbody = document.getElementById('productTableBody');
  tbody.innerHTML = filtered.map(p => {
    let row = `<tr class="${selectedAsins.has(p.asin)?'selected':''}">`;
    cols.forEach(c => { row += `<td>${renderCellContent(c.id, p, shippingOpts)}</td>`; });
    row += '</tr>';
    return row;
  }).join('');

  // 配送方法のselected設定
  filtered.forEach(p => {
    if (p.shippingMethod) {
      const sel = document.querySelector(`select[data-asin="${p.asin}"]`);
      if (sel) sel.value = p.shippingMethod;
    }
  });
}

// === 行選択 ===
function toggleSelect(cb) { cb.checked ? selectedAsins.add(cb.dataset.asin) : selectedAsins.delete(cb.dataset.asin); cb.closest('tr').classList.toggle('selected',cb.checked); updateBulkBar(); }
function toggleSelectAll(cb) { document.querySelectorAll('#productTableBody .row-checkbox').forEach(c => { c.checked=cb.checked; cb.checked?selectedAsins.add(c.dataset.asin):selectedAsins.delete(c.dataset.asin); c.closest('tr').classList.toggle('selected',cb.checked); }); updateBulkBar(); }
function updateBulkBar() { const bar=document.getElementById('bulkBar'); document.getElementById('selectedCount').textContent=selectedAsins.size; bar.style.display=selectedAsins.size>0?'flex':'none'; }

function deleteSelected() {
  if (!confirm(`${selectedAsins.size}件削除しますか？`)) return;
  products = products.filter(p => !selectedAsins.has(p.asin));
  saveProductsToStorage();
  selectedAsins.clear(); updateBulkBar(); showToast('削除しました'); renderAll();
}

// === 一括操作 ===
async function bulkRefresh() {
  const asins = [...selectedAsins]; if (!asins.length) return;
  showLoading(true);
  let ok = 0;
  for (const asin of asins) {
    const keepaData = await fetchFromKeepa(asin);
    if (keepaData.error) continue;
    const idx = products.findIndex(p => p.asin === asin);
    if (idx >= 0) {
      const ex = products[idx];
      products[idx] = { ...keepaData };
      USER_FIELDS.forEach(f => { products[idx][f] = ex[f] ?? null; });
      if (!products[idx].supplier) products[idx].supplier = '';
      if (!products[idx].notes) products[idx].notes = '';
      products[idx].lastUpdated = new Date().toISOString();
      products[idx].createdAt = ex.createdAt;
      ok++;
    }
  }
  saveProductsToStorage();
  showLoading(false); showToast(`${ok}件更新しました`);
  renderAll();
  suggestShipping(asins);
}

// === 配送提案（重量+サイズ考慮） ===
function suggestShipping(asins) {
  const methods = appSettings.shippingMethods || [];
  if (!methods.length) return;
  let suggested = 0;
  for (const asin of asins) {
    const p = products.find(x => x.asin === asin);
    if (!p || (p.shippingMethod && !p.shippingSuggested)) continue; // 手動設定済みはスキップ
    const weight = p.weightG || 0;
    const dims = p.sizeCm ? p.sizeCm.split('×').map(s => parseFloat(s)).filter(n => !isNaN(n)) : [];
    const total = dims.reduce((a,b) => a+b, 0);
    const minDim = dims.length === 3 ? Math.min(...dims) : 999;

    let method = null;
    // 重量+サイズで最適な配送を判定
    if (weight > 0 && weight <= 50 && minDim <= 1 && total <= 50) {
      method = '定形郵便';
    } else if (weight <= 1000 && minDim <= 3 && total <= 60) {
      method = 'ネコポス';
    } else if (dims.length && total <= 60) {
      method = '宅急便60';
    } else if (dims.length && total <= 80) {
      method = '宅急便80';
    } else if (dims.length && total <= 100) {
      method = '宅急便100';
    } else if (dims.length && total <= 120) {
      method = '宅急便120';
    } else if (dims.length && total <= 140) {
      method = '宅急便140';
    } else if (dims.length && total <= 160) {
      method = '宅急便160';
    } else if (dims.length && total <= 180) {
      method = '宅急便180';
    } else if (weight > 0 && weight <= 1000) {
      method = 'ネコポス'; // サイズ不明だが軽い
    }

    if (method) {
      const sm = methods.find(m => m.name === method);
      if (sm) {
        p.shippingMethod = sm.name; p.shippingCost = sm.cost; p.shippingSuggested = true;
        patchProduct(asin, { shippingMethod: sm.name, shippingCost: sm.cost, shippingSuggested: true });
        suggested++;
      }
    }
  }
  if (suggested > 0) { showToast(`${suggested}件に配送方法を提案しました（候補）`); renderTable(); }
}

function bulkOpenAmazon() { const a=[...selectedAsins]; if(!a.length) return; if(a.length>10&&!confirm(`${a.length}件開きますか？`)) return; a.forEach(x => window.open(`https://www.amazon.co.jp/dp/${x}`,'_blank')); }
function bulkOpenSupplier() {
  let opened=0;
  [...selectedAsins].forEach(a => {
    const p = products.find(x => x.asin === a);
    if (!p) return;
    if (p.supplierUrl) { window.open(p.supplierUrl, '_blank'); opened++; }
    else if (p.supplierShop) { window.open(`https://www.google.com/search?q=${encodeURIComponent((p.supplierPlatform||'')+' '+p.supplierShop+' '+p.title)}`, '_blank'); opened++; }
  });
  if(!opened) showToast('仕入先が未入力です','error');
}

// === ASINコピー ===
function copyAsin(asin,el) { navigator.clipboard.writeText(asin).then(()=>{ el.classList.add('copied'); el.textContent='Copied!'; setTimeout(()=>{el.classList.remove('copied');el.textContent=asin;},1000); }); }

// === フィルター・ソート ===
function toggleFilterRow() { const r=document.getElementById('filterRow'); const btn=document.querySelector('.btn-toggle-filter'); if(r.style.display==='none'){r.style.display='';btn.classList.add('active')}else{r.style.display='none';btn.classList.remove('active');document.querySelectorAll('.col-filter').forEach(i=>i.value='');colFilters={};renderTable();} }
function handleSort(key) { if(sortKey===key) sortDir=sortDir==='asc'?'desc':'asc'; else{sortKey=key;sortDir='asc';} renderTable(); }

// === 列ドラッグ&ドロップ ===
let dragColId = null;
function colDragStart(e, colId) { dragColId = colId; e.dataTransfer.effectAllowed = 'move'; e.target.classList.add('dragging'); }
function colDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function colDrop(e, targetId) {
  e.preventDefault();
  if (!dragColId || dragColId === targetId) return;
  const config = getColumnConfig();
  const fixedCols = config.filter(c => c.fixed);
  const movable = config.filter(c => !c.fixed);
  const fromIdx = movable.findIndex(c => c.id === dragColId);
  const toIdx = movable.findIndex(c => c.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = movable.splice(fromIdx, 1);
  movable.splice(toIdx, 0, moved);
  const result = [];
  let mi = 0;
  config.forEach(c => { if (c.fixed) result.push(c); else result.push(movable[mi++]); });
  appSettings.columnConfig = result;
  // サーバーに保存
  const saveConfig = result.map(c => ({ id: c.id, visible: c.visible !== false }));
  appSettings.columnConfig = saveConfig; saveSettingsToStorage();
  dragColId = null;
  renderTable();
  showToast('列を移動しました');
}

function truncateUrl(url) {
  try { const u = new URL(url); return u.hostname + u.pathname.substring(0, 30) + (u.pathname.length > 30 ? '...' : ''); } catch { return url.substring(0, 50); }
}

function getPlatformClass(pf) {
  const map = { '楽天':'pf-rakuten', 'Yahoo':'pf-yahoo', 'ヤフオク':'pf-yahoo', 'メルカリ':'pf-mercari', 'Amazon':'pf-amazon', 'Qoo10':'pf-qoo10' };
  return map[pf] || 'pf-other';
}

async function clearSupplierUrl(asin) {
  await patchProduct(asin, { supplierPlatform: '', supplierShop: '', supplierUrl: '' });
  const p = products.find(x => x.asin === asin);
  if (p) { p.supplierPlatform = ''; p.supplierShop = ''; p.supplierUrl = ''; }
  showToast('URLを削除しました');
  renderTable();
}

function editSupplierUrl(asin) {
  const p = products.find(x => x.asin === asin);
  const current = p?.supplierUrl || '';
  const url = prompt('仕入先URLを入力:', current);
  if (url === null) return; // キャンセル
  if (url === '') { clearSupplierUrl(asin); return; }
  // URL判定して保存
  const match = SUPPLIER_PATTERNS.find(pt => pt.pattern.test(url));
  const updates = {
    supplierUrl: url,
    supplierPlatform: match ? match.platform : '',
    supplierShop: match ? (match.shopExtract(url) || '') : '',
  };
  patchProduct(asin, updates);
  if (p) Object.assign(p, updates);
  showToast(match ? `${match.platform} を設定しました` : 'URLを保存しました');
  renderTable();
}

function detectPlatform(url) {
  const m = SUPPLIER_PATTERNS.find(p => p.pattern.test(url));
  return m ? m.platform : '';
}
function extractShopName(url) {
  const m = SUPPLIER_PATTERNS.find(p => p.pattern.test(url));
  return m ? (m.shopExtract(url) || '') : '';
}

// === 仕入先URL自動判定 ===
const SUPPLIER_PATTERNS = [
  { pattern: /rakuten\.co\.jp/, platform: '楽天', shopExtract: url => { const m = url.match(/rakuten\.co\.jp\/([^/?]+)/); return m ? m[1] : null; } },
  { pattern: /auctions\.yahoo\.co\.jp/, platform: 'ヤフオク', shopExtract: url => { const m = url.match(/auction\/([a-z0-9]+)/i); return m ? 'オークション ' + m[1] : null; } },
  { pattern: /shopping\.yahoo\.co\.jp/, platform: 'Yahoo', shopExtract: url => { const m = url.match(/yahoo\.co\.jp\/([^/?]+)/); return m ? m[1] : null; } },
  { pattern: /paypaymall\.yahoo\.co\.jp/, platform: 'Yahoo', shopExtract: url => { const m = url.match(/yahoo\.co\.jp\/store\/([^/?]+)/); return m ? m[1] : null; } },
  { pattern: /mercari\.com/, platform: 'メルカリ', shopExtract: url => { const m = url.match(/\/item\/(m[0-9]+)/); return m ? m[1] : null; } },
  { pattern: /amazon\.co\.jp/, platform: 'Amazon', shopExtract: url => { const m = url.match(/\/dp\/([A-Z0-9]{10})/); return m ? m[1] : null; } },
  { pattern: /qoo10\.jp/, platform: 'Qoo10', shopExtract: url => { const m = url.match(/qoo10\.jp\/([^/?]+)/); return m ? m[1] : null; } },
];

async function handleSupplierInput(el) {
  const asin = el.dataset.asin;
  const value = el.value.trim();

  // URL判定
  if (value.startsWith('http')) {
    const match = SUPPLIER_PATTERNS.find(p => p.pattern.test(value));
    if (match) {
      const shopName = match.shopExtract(value) || '';
      const updates = {
        supplierPlatform: match.platform,
        supplierShop: shopName,
        supplierUrl: value,
      };
      await patchProduct(asin, updates);
      const p = products.find(x => x.asin === asin);
      if (p) { Object.assign(p, updates); }
      flashSaved(el);
      showToast(`${match.platform} - ${shopName} を自動設定`);
      renderTable();
      return;
    }
  }

  // 通常のテキスト入力
  await patchProduct(asin, { supplierShop: value });
  const p = products.find(x => x.asin === asin);
  if (p) p.supplierShop = value;
  flashSaved(el);
}

function filterBySupplier(supplier) {
  colFilters.supplierUrl = supplier;
  // フィルター行を表示
  const filterRow = document.getElementById('filterRow');
  if (filterRow) filterRow.style.display = '';
  const btn = document.querySelector('.btn-toggle-filter');
  if (btn) btn.classList.add('active');
  renderTable();
  // フィルター入力欄にも値をセット
  setTimeout(() => {
    const input = document.querySelector('.col-filter[data-col="supplierUrl"]');
    if (input) input.value = supplier;
  }, 50);
  showToast(`「${supplier}」で絞り込み中`);
}
function handleColFilter() { colFilters={}; document.querySelectorAll('.col-filter').forEach(i=>{if(i.dataset.col&&i.value.trim()) colFilters[i.dataset.col]=i.value.trim();}); renderTable(); }

// === フォーマッター ===
function esc(t){if(!t)return '';const d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function escA(t){return(t||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fmtPrice(v){return v!=null?'¥'+Number(v).toLocaleString():'<span class="cell-null">--</span>';}
function fmtNum(v){return v!=null?(Number.isInteger(v)?v.toLocaleString():v.toFixed(1)):'<span class="cell-null">--</span>';}
function fmtRank(v){return v!=null?'#'+Number(v).toLocaleString():'<span class="cell-null">--</span>';}
function fmtDate(s){if(!s)return '-';const d=new Date(s);return `${d.getMonth()+1}/${d.getDate()}`;}
function formatSales(p){if(p.monthlySold)return `${p.monthlySold}+/月`;if(p.salesRankDrops90!=null)return `${Math.round(p.salesRankDrops90/3)}/月`;return '<span class="cell-null">-</span>';}
function formatBrand(b){if(!b)return '-';const m=b.match(/^(.+?)\s*(\(.+\))$/);return m?`<span class="brand-ja">${esc(m[1])}</span><br><span class="brand-en">${esc(m[2])}</span>`:esc(b);}
function formatCategory(c){if(!c)return '-';return c.split(' > ').map((p,i)=>`<span class="cat-level${i===0?' cat-level-0':''}">${'\u2003'.repeat(i)}${esc(p)}</span>`).join('');}
function formatAmazonPresence(pct){if(pct==null)return '<span class="cell-null">-</span>';if(pct===0)return '<span class="badge-amazon no">0%</span>';return `<span class="badge-amazon ${pct>=50?'yes':'low'}">${pct}%</span>`;}
function getShipClass(m){if(!m)return '';if(['定形','レターパック'].some(k=>m.includes(k)))return 'ship-post';return 'ship-yamato';}

function formatSizeDisplay(p) {
  if (p.sizeCm) {
    const w = p.weightG ? `${p.weightG>=1000?(p.weightG/1000).toFixed(1)+'kg':p.weightG+'g'}` : '';
    return `<span class="size-dims">${p.sizeCm}cm</span>${w?`<br><span class="size-weight">${w}</span>`:''}`;
  }
  if (p.weightG) return `<span class="size-weight">${p.weightG>=1000?(p.weightG/1000).toFixed(1)+'kg':p.weightG+'g'}</span>`;
  return '<span class="size-unknown">サイズ不明</span>';
}

// === 詳細モーダル ===
function openDetail(asin) {
  const p=products.find(x=>x.asin===asin);if(!p)return;
  document.getElementById('modalTitle').textContent='商品詳細';
  const pr=calcProfit(p);
  document.getElementById('modalBody').innerHTML=`
    <div class="detail-top">${p.imageUrl?`<img class="detail-image" src="${esc(p.imageUrl)}">`:'<div class="detail-image" style="display:flex;align-items:center;justify-content:center"><span class="material-symbols-outlined" style="font-size:48px;color:var(--outline)">image</span></div>'}
    <div class="detail-info"><h3>${esc(p.title)}</h3><div class="detail-meta"><span class="detail-tag">${p.asin}</span>${p.brand?`<span class="detail-tag">${esc(p.brand)}</span>`:''}</div></div></div>
    <div class="detail-grid">
      <div class="detail-item"><div class="detail-item-label">平均価格(90日)</div><div class="detail-item-value price">${fmtPrice(p.avg90BuyBoxPrice)}</div></div>
      <div class="detail-item"><div class="detail-item-label">出品者数</div><div class="detail-item-value">${fmtNum(p.avg90NewSellerCount)}</div></div>
      <div class="detail-item"><div class="detail-item-label">FBA/自己発送</div><div class="detail-item-value">${fmtNum(p.avg90FbaSellerCount)}/${fmtNum(p.avg90FbmSellerCount)}</div></div>
      <div class="detail-item"><div class="detail-item-label">Amazon出品率</div><div class="detail-item-value">${p.amazonPresence90!=null?p.amazonPresence90+'%':'-'}</div></div>
      <div class="detail-item"><div class="detail-item-label">販売数(90日)</div><div class="detail-item-value">${formatSales(p)}</div></div>
      <div class="detail-item"><div class="detail-item-label">サイズ/重量</div><div class="detail-item-value">${formatSizeDisplay(p)}</div></div>
      ${pr?`<div class="detail-item" style="grid-column:1/-1;background:${pr.profit>=0?'var(--success-light)':'var(--error-light)'}"><div class="detail-item-label">粗利</div><div class="detail-item-value" style="color:${pr.profit>=0?'var(--success)':'var(--error)'}">¥${pr.profit.toLocaleString()}(${pr.profitRate}%)</div></div>`:''}
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}
function closeModal(e){if(e&&e.target!==e.currentTarget)return;document.getElementById('modalOverlay').classList.remove('active');}

// === 設定モーダル ===
let currentSettingsTab='api';
function openSettings(){document.getElementById('settingsOverlay').classList.add('active');renderSettingsTab();}
function closeSettings(e){if(e&&e.target!==e.currentTarget)return;document.getElementById('settingsOverlay').classList.remove('active');}
function switchSettingsTab(tab,btn){currentSettingsTab=tab;document.querySelectorAll('.settings-tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');renderSettingsTab();}

function renderSettingsTab() {
  const body=document.getElementById('settingsBody');
  if(currentSettingsTab==='api') {
    const k = appSettings.keepaApiKey || '';
    const hasKey = !!k;
    const masked = hasKey ? k.slice(0,4) + '****' + k.slice(-4) : '';
    body.innerHTML=`<div class="settings-section"><h4 class="settings-label">Keepa APIキー</h4><p class="settings-desc"><a href="https://keepa.com/#!api" target="_blank">取得はこちら</a></p>
      <div class="settings-current"><span class="settings-current-label">現在:</span><span class="settings-current-value" style="color:${hasKey?'var(--success)':'var(--error)'}">${hasKey?masked:'未設定'}</span></div>
      <div class="field-group" style="margin-top:12px"><label>新しいAPIキー</label><input type="text" id="settingsApiKey" placeholder="APIキーを貼り付け..."></div>
      <div class="settings-actions"><button class="btn-primary" onclick="saveApiKey()"><span class="material-symbols-outlined">save</span>保存</button>${d.hasKey?'<button class="btn-danger" onclick="deleteApiKey()"><span class="material-symbols-outlined">delete</span>削除</button>':''}</div></div>`;
  } else if(currentSettingsTab==='shipping') {
    loadSettings();
    const items=(appSettings.shippingMethods||[]).map((m,i)=>`<div class="settings-list-item"><input class="name-input" value="${escA(m.name)}"><input class="num-input" type="number" value="${m.cost}">円<button class="btn-icon btn-delete" onclick="this.closest('.settings-list-item').remove()"><span class="material-symbols-outlined">close</span></button></div>`).join('');
    body.innerHTML=`<div class="settings-section"><h4 class="settings-label">配送方法と送料</h4><div class="settings-list" id="shippingList">${items}</div>
      <button class="settings-add-btn" onclick="addShippingRow()"><span class="material-symbols-outlined" style="font-size:18px">add</span>追加</button>
      <div style="margin-top:12px"><button class="btn-primary" onclick="saveShippingSettings()"><span class="material-symbols-outlined">save</span>保存</button></div></div>`;
  } else if(currentSettingsTab==='commission') {
    loadSettings();
    const items=(appSettings.categoryCommissions||[]).map((c,i)=>`<div class="settings-list-item"><input class="name-input" value="${escA(c.name)}"><input class="num-input" type="number" value="${c.rate}">%<button class="btn-icon btn-delete" onclick="this.closest('.settings-list-item').remove()"><span class="material-symbols-outlined">close</span></button></div>`).join('');
    body.innerHTML=`<div class="settings-section"><h4 class="settings-label">カテゴリ別販売手数料</h4><div class="settings-list" id="commissionList">${items}</div>
      <button class="settings-add-btn" onclick="addCommissionRow()"><span class="material-symbols-outlined" style="font-size:18px">add</span>追加</button>
      <div style="margin-top:12px"><button class="btn-primary" onclick="saveCommissionSettings()"><span class="material-symbols-outlined">save</span>保存</button></div></div>`;
  } else if(currentSettingsTab==='csv') {
    loadSettings(); const d=appSettings.csvDefaults||{};
    body.innerHTML=`<div class="settings-section"><h4 class="settings-label">マカド高速出品CSV設定</h4>
      <div class="csv-field-row"><div class="csv-field"><label>コンディション</label><select id="csvCondition"><option value="新品" ${d.condition==='新品'?'selected':''}>0:新品</option><option value="中古-ほぼ新品" ${d.condition==='中古-ほぼ新品'?'selected':''}>1:中古-ほぼ新品</option><option value="中古-非常に良い" ${d.condition==='中古-非常に良い'?'selected':''}>2:中古-非常に良い</option><option value="中古-良い" ${d.condition==='中古-良い'?'selected':''}>3:中古-良い</option><option value="中古-可" ${d.condition==='中古-可'?'selected':''}>4:中古-可</option></select></div>
      <div class="csv-field"><label>配送ルート</label><select id="csvRoute"><option value="自己発送" ${d.shippingRoute==='自己発送'?'selected':''}>0:自己発送</option><option value="FBA" ${d.shippingRoute==='FBA'?'selected':''}>1:FBA</option></select></div></div>
      <div class="csv-field-row"><div class="csv-field"><label>価格改定モード</label><select id="csvRevMode"><option value="なし" ${d.priceRevisionMode==='なし'?'selected':''}>0:なし</option><option value="FBA最安値(新品)" ${d.priceRevisionMode==='FBA最安値(新品)'?'selected':''}>3:FBA最安値</option><option value="最安値(新品)" ${d.priceRevisionMode==='最安値(新品)'?'selected':''}>4:最安値</option><option value="カート価格" ${d.priceRevisionMode==='カート価格'?'selected':''}>5:カート価格</option><option value="全最安値" ${d.priceRevisionMode==='全最安値'?'selected':''}>8:全最安値</option></select></div>
      <div class="csv-field"><label>支払い制限</label><select id="csvPayLimit"><option value="0" ${(d.paymentLimit??0)==0?'selected':''}>0:全許可</option><option value="1" ${d.paymentLimit==1?'selected':''}>1:代引制限</option><option value="2" ${d.paymentLimit==2?'selected':''}>2:コンビニ制限</option><option value="3" ${d.paymentLimit==3?'selected':''}>3:両方制限</option></select></div></div>
      <div class="csv-field-row"><div class="csv-field"><label>リードタイム(日)</label><input type="number" id="csvLeadTime" value="${d.leadTime??1}"></div><div class="csv-field"><label>配送設定名</label><input type="text" id="csvDeliverySettings" value="${escA(d.deliverySettings||'')}"></div></div>
      <div class="csv-field-row"><div class="csv-field"><label class="csv-toggle"><input type="checkbox" id="csvPriceRedEnabled" ${d.priceReductionEnabled?'checked':''}>下限価格%有効</label><input type="number" id="csvPriceRedPct" value="${d.priceReductionPercent??10}" placeholder="%" style="margin-top:4px"></div><div class="csv-field"></div></div>
      <div class="csv-field" style="margin-bottom:16px"><label>説明文</label><textarea id="csvDesc">${esc(d.description||'')}</textarea></div>
      <button class="btn-primary" onclick="saveCsvSettings()"><span class="material-symbols-outlined">save</span>保存</button></div>`;
  } else if(currentSettingsTab==='data') {
    body.innerHTML=`<div class="settings-section">
      <h4 class="settings-label">データのエクスポート/インポート</h4>
      <p class="settings-desc">商品データと設定をバックアップ・復元できます。PC変更時やデータ移行に使用してください。</p>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn-primary" onclick="exportAllData()"><span class="material-symbols-outlined">download</span>エクスポート</button>
        <button class="btn-primary" onclick="document.getElementById('importFile').click()"><span class="material-symbols-outlined">upload</span>インポート</button>
        <input type="file" id="importFile" accept=".json" style="display:none" onchange="importAllData(this)">
      </div>
      <div style="border-top:1px solid var(--outline);padding-top:16px;margin-top:16px">
        <h4 class="settings-label">全データ削除</h4>
        <p class="settings-desc">全ての商品データと設定を削除します。この操作は取り消せません。</p>
        <button class="btn-danger" onclick="clearAllData()"><span class="material-symbols-outlined">delete_forever</span>全データ削除</button>
      </div>
    </div>`;
  } else if(currentSettingsTab==='columns') {
    const config = getColumnConfig();
    const chips = config.filter(c => !c.fixed).map(c => {
      const active = c.visible !== false ? 'active' : '';
      return `<div class="col-config-chip ${active}">
        <input type="checkbox" ${c.visible!==false?'checked':''} onchange="toggleColumnVisibility('${c.id}',this.checked)">
        <span>${c.label}</span>
        <span class="chip-arrows"><button class="chip-arrow" onclick="moveColumn('${c.id}',-1)">◀</button><button class="chip-arrow" onclick="moveColumn('${c.id}',1)">▶</button></span>
      </div>`;
    }).join('');
    body.innerHTML=`<div class="settings-section"><h4 class="settings-label">列の表示/非表示・並び順</h4><p class="settings-desc">チェックで表示切替、◀▶で並び替え</p>
      <div class="col-config-grid">${chips}</div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center"><button class="btn-primary" onclick="saveColumnConfig()"><span class="material-symbols-outlined">save</span>保存</button><button class="btn-secondary" onclick="resetColumnConfig()">リセット</button></div></div>`;
  }
}

// === 列設定 ===
function toggleColumnVisibility(colId, visible) {
  const config = getColumnConfig();
  const col = config.find(c => c.id === colId);
  if (col) col.visible = visible;
  appSettings.columnConfig = config;
  renderTable();
}

function moveColumn(colId, direction) {
  const config = getColumnConfig();
  const fixedCols = config.filter(c => c.fixed);
  const movable = config.filter(c => !c.fixed);
  const idx = movable.findIndex(c => c.id === colId);
  if (idx < 0) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= movable.length) return;
  [movable[idx], movable[newIdx]] = [movable[newIdx], movable[idx]];
  // 固定列を元の位置に戻す
  const result = [];
  let mi = 0;
  config.forEach(c => { if (c.fixed) result.push(c); else result.push(movable[mi++]); });
  appSettings.columnConfig = result;
  renderSettingsTab();
  renderTable();
}

function saveColumnConfig() {
  appSettings.columnConfig = getColumnConfig().map(c => ({ id: c.id, visible: c.visible !== false }));
  saveSettingsToStorage(); showToast('列設定を保存しました');
}

function resetColumnConfig() {
  appSettings.columnConfig = null;
  saveSettingsToStorage(); showToast('デフォルトに戻しました'); renderSettingsTab(); renderTable();
}

function addShippingRow() {
  const list = document.getElementById('shippingList');
  const div = document.createElement('div');
  div.className = 'settings-list-item';
  div.innerHTML = '<input class="name-input" placeholder="配送方法名"><input class="num-input" type="number" value="0">円<button class="btn-icon btn-delete" onclick="this.closest(\'.settings-list-item\').remove()"><span class="material-symbols-outlined">close</span></button>';
  list.appendChild(div);
}
function addCommissionRow() {
  const list = document.getElementById('commissionList');
  const div = document.createElement('div');
  div.className = 'settings-list-item';
  div.innerHTML = '<input class="name-input" placeholder="カテゴリ名"><input class="num-input" type="number" value="10">%<button class="btn-icon btn-delete" onclick="this.closest(\'.settings-list-item\').remove()"><span class="material-symbols-outlined">close</span></button>';
  list.appendChild(div);
}

// === 設定保存 ===
function saveApiKey(){const k=document.getElementById('settingsApiKey')?.value?.trim();if(!k){showToast('APIキーを入力','error');return;}appSettings.keepaApiKey=k;saveSettingsToStorage();checkApiStatus();renderSettingsTab();showToast('APIキーを保存しました');}
function deleteApiKey(){if(!confirm('APIキーを削除しますか？'))return;appSettings.keepaApiKey='';saveSettingsToStorage();checkApiStatus();renderSettingsTab();showToast('削除しました');}
function saveShippingSettings(){const items=[];document.querySelectorAll('#shippingList .settings-list-item').forEach(r=>{const n=r.querySelector('.name-input').value.trim();const c=Number(r.querySelector('.num-input').value);if(n)items.push({name:n,cost:c});});appSettings.shippingMethods=items;saveSettingsToStorage();showToast('配送方法を保存しました');renderTable();}
function saveCommissionSettings(){const items=[];document.querySelectorAll('#commissionList .settings-list-item').forEach(r=>{const n=r.querySelector('.name-input').value.trim();const rt=Number(r.querySelector('.num-input').value);if(n)items.push({name:n,rate:rt});});appSettings.categoryCommissions=items;saveSettingsToStorage();showToast('カテゴリ手数料を保存しました');}
function saveCsvSettings(){const csvDefaults={condition:document.getElementById('csvCondition').value,shippingRoute:document.getElementById('csvRoute').value,leadTime:Number(document.getElementById('csvLeadTime').value),paymentLimit:Number(document.getElementById('csvPayLimit').value),priceRevisionMode:document.getElementById('csvRevMode').value,priceReductionEnabled:document.getElementById('csvPriceRedEnabled').checked,priceReductionPercent:Number(document.getElementById('csvPriceRedPct').value),description:document.getElementById('csvDesc').value,deliverySettings:document.getElementById('csvDeliverySettings').value};appSettings.csvDefaults=csvDefaults;saveSettingsToStorage();if(csvDefaults.priceReductionEnabled&&csvDefaults.priceReductionPercent){let updated=0;products.forEach(p=>{if(p.listingPrice&&!p.priceReductionEnabled){p.lowerPrice=Math.round(p.listingPrice*(1-csvDefaults.priceReductionPercent/100));p.priceReductionEnabled=true;p.lowerPricePercent=csvDefaults.priceReductionPercent;updated++;}});if(updated>0){saveProductsToStorage();renderAll();showToast(`CSV設定保存、${updated}件に下限価格適用`);return;}}showToast('CSV設定を保存しました');}

// === CSV出力 ===
function exportCsvDialog() {
  if (!selectedAsins.size) { showToast('商品を選択してください', 'error'); return; }
  const d = appSettings.csvDefaults || {};
  const sel = products.filter(p => selectedAsins.has(p.asin));
  const itemsHtml = sel.map(p => `<div class="csv-item">
    <div class="csv-item-img">${p.imageUrl ? `<img src="${esc(p.imageUrl)}">` : ''}</div>
    <div class="csv-item-name">${esc((p.title||'').substring(0,35))}${(p.title||'').length>35?'...':''}<br><span style="font-size:10px;color:#888">${p.asin}</span></div>
    <div class="csv-item-field"><label>出品価格</label><input type="number" value="${p.listingPrice??''}" data-asin="${p.asin}" data-csv="price"></div>
    <div class="csv-item-field"><label>下限価格</label><input type="number" value="${p.lowerPrice??''}" data-asin="${p.asin}" data-csv="lowerPrice"></div>
    <div class="csv-item-field"><label>個数</label><input type="number" value="${p.quantity??1}" data-asin="${p.asin}" data-csv="quantity"></div>
    <div class="csv-item-field"><label>仕入れ値</label><input type="number" value="${p.purchasePriceWithPoints??p.purchasePrice??''}" data-asin="${p.asin}" data-csv="purchasePrice"></div>
  </div>`).join('');

  document.getElementById('csvBody').innerHTML = `
    <div class="csv-items-scroll">${itemsHtml}</div>
    <details style="margin-top:12px;border-top:1px solid var(--outline);padding-top:12px">
      <summary style="cursor:pointer;font-size:13px;font-weight:500;color:var(--primary)">共通設定を変更</summary>
      <div style="margin-top:12px">
        <div class="csv-field-row"><div class="csv-field"><label>コンディション</label><select id="expCondition"><option value="新品" ${d.condition==='新品'?'selected':''}>0:新品</option><option value="中古-ほぼ新品" ${d.condition==='中古-ほぼ新品'?'selected':''}>1:ほぼ新品</option><option value="中古-非常に良い" ${d.condition==='中古-非常に良い'?'selected':''}>2:非常に良い</option><option value="中古-良い" ${d.condition==='中古-良い'?'selected':''}>3:良い</option><option value="中古-可" ${d.condition==='中古-可'?'selected':''}>4:可</option></select></div>
        <div class="csv-field"><label>配送ルート</label><select id="expRoute"><option value="自己発送" ${d.shippingRoute==='自己発送'?'selected':''}>0:自己発送</option><option value="FBA" ${d.shippingRoute==='FBA'?'selected':''}>1:FBA</option></select></div></div>
        <div class="csv-field-row"><div class="csv-field"><label>価格改定</label><select id="expRevMode"><option value="なし" ${d.priceRevisionMode==='なし'?'selected':''}>0:なし</option><option value="カート価格" ${d.priceRevisionMode==='カート価格'?'selected':''}>5:カート価格</option><option value="全最安値" ${d.priceRevisionMode==='全最安値'?'selected':''}>8:全最安値</option></select></div>
        <div class="csv-field"><label>支払い制限</label><select id="expPayLimit"><option value="0" ${(d.paymentLimit??0)==0?'selected':''}>0:全許可</option><option value="1" ${d.paymentLimit==1?'selected':''}>1:代引制限</option><option value="2" ${d.paymentLimit==2?'selected':''}>2:コンビニ制限</option><option value="3" ${d.paymentLimit==3?'selected':''}>3:両方制限</option></select></div></div>
        <div class="csv-field-row"><div class="csv-field"><label>リードタイム(日)</label><input type="number" id="expLeadTime" value="${d.leadTime??1}"></div><div class="csv-field"><label>配送設定名</label><input type="text" id="expDeliverySettings" value="${escA(d.deliverySettings||'')}"></div></div>
        <div class="csv-field-row"><div class="csv-field"><label class="csv-toggle"><input type="checkbox" id="expPriceRedEnabled" ${d.priceReductionEnabled?'checked':''}>下限% -<input type="number" id="expPriceRedPct" value="${d.priceReductionPercent??10}" style="width:50px;margin:0 4px">%</label></div><div class="csv-field"></div></div>
        <div class="csv-field" style="margin-bottom:8px"><label>説明文</label><textarea id="expDesc">${esc(d.description||'')}</textarea></div>
      </div>
    </details>
    <button class="btn-primary" onclick="doExportCsv()" style="width:100%;justify-content:center;margin-top:12px"><span class="material-symbols-outlined">download</span>マカドCSV出力（${sel.length}件）</button>`;
  document.getElementById('csvOverlay').classList.add('active');
}
function closeCsvModal(e){if(e&&e.target!==e.currentTarget)return;document.getElementById('csvOverlay').classList.remove('active');}
function doExportCsv() {
  // ダイアログ内の値を反映
  document.querySelectorAll('[data-csv]').forEach(input => {
    const p = products.find(x => x.asin === input.dataset.asin); if (!p) return;
    const val = input.value === '' ? null : Number(input.value);
    if (input.dataset.csv === 'price') p.listingPrice = val;
    else if (input.dataset.csv === 'lowerPrice') p.lowerPrice = val;
    else if (input.dataset.csv === 'quantity') p.quantity = val;
    else if (input.dataset.csv === 'purchasePrice') { p.purchasePrice = val; p.purchasePriceWithPoints = val; }
  });
  saveProductsToStorage();

  const opt = {
    condition: document.getElementById('expCondition').value,
    shippingRoute: document.getElementById('expRoute').value,
    priceRevisionMode: document.getElementById('expRevMode').value,
    paymentLimit: Number(document.getElementById('expPayLimit').value),
    leadTime: Number(document.getElementById('expLeadTime').value),
    deliverySettings: document.getElementById('expDeliverySettings').value,
    priceReductionEnabled: document.getElementById('expPriceRedEnabled').checked,
    priceReductionPercent: Number(document.getElementById('expPriceRedPct').value),
    description: document.getElementById('expDesc').value,
  };

  const COND_MAP = {'新品':0,'中古-ほぼ新品':1,'中古-非常に良い':2,'中古-良い':3,'中古-可':4};
  const ROUTE_MAP = {'自己発送':0,'FBA':1};
  const REV_MAP = {'なし':0,'FBA状態合わせ(中古)':1,'状態合わせ(中古)':2,'FBA最安値(新品)':3,'最安値(新品)':4,'カート価格':5,'自己最安値(新品)':6,'上位最安値':7,'全最安値':8};

  const header = 'ASIN,Condition,Price,LowerPrice,PurchasePrice,Stock,Route,AutoUpdateMode,Description,DeliverySettings,LeadTime,MethodOfPayment';
  const selected = products.filter(p => selectedAsins.has(p.asin));
  const rows = selected.map(p => {
    const price = p.listingPrice || '';
    let lp = p.lowerPrice || '';
    if (!lp && opt.priceReductionEnabled && opt.priceReductionPercent && price) lp = Math.round(price * (1 - opt.priceReductionPercent / 100));
    const desc = (opt.description||'').replace(/[,!"#$%&'=+|\\`:;/\s\u3000]/g, '');
    const route = ROUTE_MAP[opt.shippingRoute] ?? 0;
    return [p.asin, COND_MAP[opt.condition]??0, price, lp, p.purchasePriceWithPoints??p.purchasePrice??'', p.quantity||1, route, REV_MAP[opt.priceRevisionMode]??0, desc, opt.deliverySettings||'', route===0?(opt.leadTime||1):'', opt.paymentLimit??0].join(',');
  });

  const csv = '\uFEFF' + [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `makad_listing_${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url); closeCsvModal(); showToast('CSVを出力しました');
}

// === 全商品更新（ブラウザ内で実行） ===
let updateRunning = false;
async function triggerUpdateAll() {
  if (updateRunning) return;
  if (!products.length) { showToast('商品がありません','error'); return; }
  updateRunning = true;
  const btn = document.querySelector('.btn-update-all');
  btn.classList.add('running');
  document.getElementById('updateLabel').textContent = '更新中...';
  const statusEl = document.getElementById('updateStatus');
  let ok = 0, err = 0;
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    statusEl.textContent = `${i+1}/${products.length}件...`;
    try {
      const keepaData = await fetchFromKeepa(p.asin);
      if (keepaData.error) { err++; continue; }
      const ex = products[i];
      products[i] = { ...keepaData };
      USER_FIELDS.forEach(f => { products[i][f] = ex[f] ?? null; });
      if (!products[i].supplier) products[i].supplier = '';
      if (!products[i].notes) products[i].notes = '';
      products[i].lastUpdated = new Date().toISOString();
      products[i].createdAt = ex.createdAt;
      ok++;
    } catch { err++; }
    // 10件ごとに保存＋少し待機
    if ((i+1) % 10 === 0) { saveProductsToStorage(); await new Promise(r => setTimeout(r, 2000)); }
  }
  saveProductsToStorage();
  updateRunning = false;
  btn.classList.remove('running');
  document.getElementById('updateLabel').textContent = '全商品更新';
  statusEl.textContent = `完了: ${ok}成功${err?'/'+err+'失敗':''}`;
  statusEl.className = 'update-status' + (err ? ' has-error' : '');
  showToast(`更新完了: 成功${ok}件${err?', 失敗'+err+'件':''}`, err ? 'error' : 'success');
  renderAll();
}

// === データ管理 ===
function exportAllData() {
  const data = { products, settings: appSettings, exportDate: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `profit-tool-backup-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('エクスポートしました');
}

function importAllData(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.products && Array.isArray(data.products)) {
        products = data.products;
        saveProductsToStorage();
      }
      if (data.settings) {
        appSettings = { ...DEFAULT_SETTINGS, ...data.settings };
        saveSettingsToStorage();
      }
      checkApiStatus();
      renderAll();
      showToast(`インポート完了（${products.length}件）`);
    } catch { showToast('ファイルの読み込みに失敗しました', 'error'); }
  };
  reader.readAsText(file);
  input.value = '';
}

function clearAllData() {
  if (!confirm('全てのデータを削除しますか？この操作は取り消せません。')) return;
  if (!confirm('本当に削除しますか？')) return;
  localStorage.removeItem(STORAGE_KEYS.products);
  localStorage.removeItem(STORAGE_KEYS.settings);
  products = [];
  appSettings = { ...DEFAULT_SETTINGS };
  checkApiStatus();
  renderAll();
  showToast('全データを削除しました');
}

// === UIヘルパー ===
function showLoading(s){document.getElementById('loadingOverlay').classList.toggle('active',s);document.getElementById('fetchBtn').disabled=s;}
function showToast(msg,type='success'){const c=document.getElementById('toastContainer');const t=document.createElement('div');t.className=`toast toast-${type}`;t.innerHTML=`<span class="material-symbols-outlined" style="font-size:20px">${type==='error'?'error':'check_circle'}</span><span>${esc(msg)}</span>`;c.appendChild(t);setTimeout(()=>{t.style.animation='toastOut 300ms ease-in forwards';setTimeout(()=>t.remove(),300);},3000);}
