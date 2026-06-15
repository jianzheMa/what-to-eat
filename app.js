(function() {
'use strict';

// ============================================
// DOM refs
// ============================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  locationDot: $('#locationDot'),
  locationText: $('#locationText'),
  apiConfigToggle: $('#apiConfigToggle'),
  apiKeySection: $('#apiKeySection'),
  apiKeyInput: $('#apiKeyInput'),
  securityCodeInput: $('#securityCodeInput'),
  saveApiKeyBtn: $('#saveApiKeyBtn'),
  apiKeyStatus: $('#apiKeyStatus'),
  pickBtn: $('#pickBtn'),
  resultCard: $('#resultCard'),
  resultActions: $('#resultActions'),
  rerollBtn: $('#rerollBtn'),
  blacklistBtn: $('#blacklistBtn'),
  ratingSlider: $('#ratingSlider'),
  ratingValue: $('#ratingValue'),
  distanceSlider: $('#distanceSlider'),
  distanceValue: $('#distanceValue'),
  priceOptions: $('#priceOptions'),
  cuisineTags: $('#cuisineTags'),
  cuisineHint: $('#cuisineHint'),
  dislikeOptions: $('#dislikeOptions'),
  dislikeHint: $('#dislikeHint'),
  historyList: $('#historyList'),
  clearHistoryBtn: $('#clearHistoryBtn'),
  blacklistList: $('#blacklistList'),
  spinner: $('#spinner'),
  spinnerText: $('#spinnerText'),
  filterBody: $('#filterBody'),
  filterArrow: $('#filterArrow'),
  historyBody: $('#historyBody'),
  historyArrow: $('#historyArrow'),
  blacklistBody: $('#blacklistBody'),
  blacklistArrow: $('#blacklistArrow'),
  favBody: $('#favBody'),
  favArrow: $('#favArrow'),
  favList: $('#favList'),
  favResultBtn: $('#favResultBtn'),
  shareBtn: $('#shareBtn'),
  debugPanel: $('#debugPanel'),
  debugContent: $('#debugContent'),
  debugBody: $('#debugBody'),
  debugArrow: $('#debugArrow'),
  ritualFlash: $('#ritualFlash'),
  shakeHint: $('#shakeHint'),
};

// ============================================
// Debug
// ============================================
const debugLines = [];
function debugLog(label, data) {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${label}: ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`;
  debugLines.push(line);
  if (debugLines.length > 50) debugLines.shift();
  if (dom.debugContent) {
    dom.debugContent.textContent = debugLines.join('\n');
    dom.debugBody.scrollTop = dom.debugBody.scrollHeight;
  }
  console.log(label, data);
}

// ============================================
// Settings & Storage
// ============================================
const SETTINGS_KEY = 'eat_settings';
const HISTORY_KEY = 'eat_history';
const BLACKLIST_KEY = 'eat_blacklist';
const FAVORITES_KEY = 'eat_favorites';
const API_KEY_STORAGE = 'amap_api_key';
const SECURITY_CODE_STORAGE = 'amap_security_code';

const DEFAULT_SETTINGS = {
  minRating: 3.5, maxDistance: 3000, maxPrice: 0,
  cuisines: [], dislikes: [], pickCount: 1,
};

const DISLIKE_RULES = {
  spicy: { label: '不要太辣', keywords: ['川菜', '湘菜', '火锅', '麻辣', '香锅', '串串', '冒菜', '酸菜鱼'] },
  far: { label: '不想太远', maxDistance: 1200 },
  expensive: { label: '不想太贵', maxCost: 80 },
  fastfood: { label: '不吃快餐', keywords: ['快餐', '汉堡', '炸鸡', '披萨', '简餐', '便当'] },
  greasy: { label: '不想油腻', keywords: ['烧烤', '烤肉', '炸', '串', '火锅', '干锅', '烤鱼'] },
  cafe: { label: '不喝咖啡', keywords: ['咖啡', '咖啡厅', '星巴克', '瑞幸'] },
};

function loadJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function saveJSON(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ============================================
// State
// ============================================
let state = {
  position: null,
  candidates: [],
  shownThisRound: new Set(),
  currentResult: null,
  isSearching: false,
  sdkReady: false,
  miniMap: null,
};

let settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON(SETTINGS_KEY, DEFAULT_SETTINGS));
if (!Array.isArray(settings.cuisines)) settings.cuisines = [];
if (!Array.isArray(settings.dislikes)) settings.dislikes = [];
let history = loadJSON(HISTORY_KEY, []);
let blacklist = loadJSON(BLACKLIST_KEY, []);
let favorites = loadJSON(FAVORITES_KEY, []);
let apiKey = localStorage.getItem(API_KEY_STORAGE) || '';
let securityCode = localStorage.getItem(SECURITY_CODE_STORAGE) || '';

const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
history = history.filter(h => Date.now() - h.timestamp < SEVEN_DAYS);
saveJSON(HISTORY_KEY, history);

// ============================================
// Helpers
// ============================================
function showSpinner(text) {
  dom.spinnerText.textContent = text;
  dom.spinner.classList.remove('hidden');
}
function hideSpinner() { dom.spinner.classList.add('hidden'); }

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function formatDistance(m) {
  if (m < 1000) return m + 'm';
  return (m / 1000).toFixed(1) + 'km';
}

function renderStars(rating) {
  const num = parseFloat(rating) || 0;
  const full = Math.floor(num);
  const half = num - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '☆' : '') + '☆'.repeat(empty);
}

function getTypeLabel(types) {
  if (!types) return '';
  const parts = types.split(/[;|]/);
  const filtered = parts.filter(t =>
    t && t !== '餐饮服务' && t !== '餐饮' && t !== '中餐厅' && t !== '快餐厅'
    && t !== '餐饮相关场所' && t !== '餐饮相关' && t !== '休闲餐饮场所'
    && t !== '冷饮店' && t !== '咖啡厅'
  );
  return filtered.length > 0 ? filtered.slice(-1)[0] : (parts.length > 1 ? parts[parts.length - 1] : '');
}

function setLocationStatus(active, text) {
  dom.locationDot.classList.toggle('active', active);
  dom.locationText.textContent = text;
}

function debounce(fn, ms) {
  let timer;
  return function() { clearTimeout(timer); timer = setTimeout(fn, ms); };
}
const debouncedSaveSettings = debounce(function() { saveJSON(SETTINGS_KEY, settings); }, 150);

// ============================================
// Oracle Verdict System
// ============================================
function generateVerdict(restaurant) {
  const rating = getRating(restaurant);
  const dist = restaurant.distance || 0;
  const cost = getCost(restaurant);
  const typeLabel = getTypeLabel(restaurant.type);
  const name = restaurant.name || '';
  const hour = new Date().getHours();

  const timePrefixes = [];
  if (hour >= 6 && hour < 10) timePrefixes.push('晨光初现', '朝食为天', '一日之计');
  else if (hour >= 10 && hour < 14) timePrefixes.push('午时已到', '正午当食', '日中而食');
  else if (hour >= 14 && hour < 17) timePrefixes.push('午后小憩', '申时茶点', '日斜时分');
  else if (hour >= 17 && hour < 21) timePrefixes.push('华灯初上', '暮色将至', '晚来天欲');
  else timePrefixes.push('夜深人静', '宵夜正当时', '星月为伴');

  const ratingPhrases = rating >= 4.5
    ? ['此店有贵人相助之相', '紫气东来，此为上选', '五星聚顶，大吉之兆']
    : rating >= 4.0
    ? ['此签中上，可安心前往', '天时地利，值得一试', '吉星高照，口味不凡']
    : rating >= 3.5
    ? ['中平之签，果腹足矣', '不求有功但求无过', '寻常滋味，亦有其道']
    : ['随缘而食，自有惊喜', '粗茶淡饭，亦是修行', '莫计较小节，且去便是'];

  const distPhrases = dist < 500
    ? ['近在咫尺，乃命中注定', '举步即至，此乃天意', '眼前即是，何必远求']
    : dist < 1500
    ? ['不远不近，恰到好处', '几步之遥，缘分使然', '行不多远，美味即达']
    : ['虽远必达，诚意动天', '路途虽遥，佳肴相候', '远方有食，值得奔赴'];

  const costPhrases = cost > 0
    ? (cost < 40 ? ['价廉物美，百姓之福', '平民之价，不俗之味'] :
       cost < 100 ? ['中庸之道，丰俭由人', '物有所值，不失体面'] :
       ['贵人聚所，宴客之选', '金樽清酒，玉盘珍羞'])
    : [];

  const typeMap = {
    '火锅': ['红汤沸腾，如人生热烈', '围炉而坐，人间烟火', '一锅煮沸江湖'],
    '川菜': ['麻辣鲜香，蜀地真味', '天府之国，味在四川'],
    '日料': ['和风细雨，匠人之心', '简约至美，东瀛之味'],
    '烧烤': ['烟火缭绕，快意江湖', '炙烤之间，香气四溢'],
    '面馆': ['一碗江湖，面里有乾坤', '汤浓面筋，世事皆可抛'],
    '小吃': ['街头巷尾，人间至味', '市井烟火，最抚凡人心'],
    '粤菜': ['清淡鲜美，岭南风情', '食在广州，味在天下'],
    '湘菜': ['辣中见真，潇湘本色', '无辣不欢，湘味无穷'],
    '西餐': ['刀叉之间，异域风情', '横贯东西，味蕾远行'],
  };

  const typePhrases = typeLabel && typeMap[typeLabel]
    ? typeMap[typeLabel]
    : (typeLabel ? [typeLabel + '，今日之选', '随遇而食，' + typeLabel + '正当时'] : []);

  const allPhrases = [
    ...ratingPhrases, ...distPhrases, ...costPhrases, ...typePhrases,
    '食神引你至此，莫要犹豫',
    '机缘已至，此刻出发',
    '天降美食，欣然受之',
    '冥冥之中，自有食意',
    '饕客之道，在于行动',
    '闻香下马，知味停车',
    '色香味全，吉签所指',
    '饮食男女，人之大欲',
    '一箸入口，三春不忘',
    '佳肴在前，岂可辜负',
  ];

  const idx = Math.floor(Math.random() * allPhrases.length);
  return allPhrases[idx];
}

// ============================================
// Oracle Ritual Animation
// ============================================
function showOracleRitual(restaurantName) {
  return new Promise((resolve) => {
    const old = document.querySelector('.oracle-ritual');
    if (old) old.remove();

    const ritual = document.createElement('div');
    ritual.className = 'oracle-ritual';
    ritual.setAttribute('aria-label', '正在为你挑选...');
    ritual.setAttribute('role', 'alertdialog');

    const glyph = restaurantName ? restaurantName.charAt(0) : '?';

    ritual.innerHTML = `
      <div class="ritual-smoke" aria-hidden="true">
        <div class="smoke-particle"></div>
        <div class="smoke-particle"></div>
        <div class="smoke-particle"></div>
        <div class="smoke-particle"></div>
        <div class="smoke-particle"></div>
      </div>
      <div class="divination-slip">
        <div class="slip-card">
          <div class="slip-face">
            <div class="slip-seal" aria-hidden="true">✓</div>
            <div class="slip-glyph">${escapeHtml(glyph)}</div>
            <div class="slip-text">为你挑选</div>
          </div>
        </div>
      </div>
      <div class="ritual-hint">正在附近搜索...</div>
    `;

    document.body.appendChild(ritual);

    setTimeout(() => {
      dom.ritualFlash.classList.remove('hidden');
      dom.ritualFlash.style.animation = 'none';
      dom.ritualFlash.offsetHeight;
      dom.ritualFlash.style.animation = 'warmFlash 0.7s ease-out forwards';
    }, 2800);

    setTimeout(() => {
      ritual.remove();
      dom.ritualFlash.classList.add('hidden');
      resolve();
    }, 3500);
  });
}

// ============================================
// Shake Detection
// ============================================
let shakeEnabled = false;
let lastShakeTime = 0;
const SHAKE_COOLDOWN = 4000;
const SHAKE_THRESHOLD = 18;

function initShakeDetection() {
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  if (!isMobile) return;

  if (typeof DeviceMotionEvent === 'undefined') return;

  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    dom.shakeHint.classList.add('visible');
    dom.shakeHint.textContent = '📳 点击页面任意处启用"摇一摇"';

    const enableShake = () => {
      DeviceMotionEvent.requestPermission()
        .then(state => {
          if (state === 'granted') {
            shakeEnabled = true;
            dom.shakeHint.textContent = '📳 摇一摇手机，随机选一家';
          }
        })
        .catch(() => {});
      document.removeEventListener('click', enableShake);
    };
    document.addEventListener('click', enableShake, { once: true });
  } else {
    shakeEnabled = true;
    dom.shakeHint.classList.add('visible');
  }

  let lastX = 0, lastY = 0, lastZ = 0;

  window.addEventListener('devicemotion', (e) => {
    if (!shakeEnabled) return;
    if (state.isSearching) return;

    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x == null) return;

    const now = Date.now();
    if (now - lastShakeTime < SHAKE_COOLDOWN) return;

    const deltaX = Math.abs(acc.x - lastX);
    const deltaY = Math.abs(acc.y - lastY);
    const deltaZ = Math.abs(acc.z - lastZ);

    lastX = acc.x; lastY = acc.y; lastZ = acc.z;

    const magnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);

    if (magnitude > SHAKE_THRESHOLD) {
      setTimeout(() => {
        const deltaX2 = Math.abs((e.accelerationIncludingGravity?.x || acc.x) - lastX);
        const deltaY2 = Math.abs((e.accelerationIncludingGravity?.y || acc.y) - lastY);
        const deltaZ2 = Math.abs((e.accelerationIncludingGravity?.z || acc.z) - lastZ);
        const mag2 = Math.sqrt(deltaX2 * deltaX2 + deltaY2 * deltaY2 + deltaZ2 * deltaZ2);

        if (mag2 > SHAKE_THRESHOLD && !state.isSearching) {
          lastShakeTime = Date.now();
          showToast('正在为你搜索...');
          doPick();
        }
      }, 150);
    }
  }, { passive: true });
}

// ============================================
// Escape HTML
// ============================================
const _escapeDiv = document.createElement('div');
function escapeHtml(str) {
  if (!str) return '';
  _escapeDiv.textContent = str;
  return _escapeDiv.innerHTML;
}

// ============================================
// API Key
// ============================================
function initApiKey() {
  dom.apiKeyInput.value = apiKey;
  dom.securityCodeInput.value = securityCode;

  if (apiKey) {
    dom.apiKeySection.classList.add('hidden');
    dom.apiKeyStatus.textContent = securityCode ? 'Key 和安全密钥已配置' : 'Key 已配置，但缺少安全密钥';
    loadAMapSDK(apiKey, securityCode);
  } else {
    dom.apiKeySection.classList.remove('hidden');
    dom.apiKeyStatus.textContent = '请填入高德 API Key 和安全密钥';
    dom.pickBtn.disabled = true;
    setLocationStatus(false, '请先设置 API Key 和安全密钥');
  }
}

dom.apiConfigToggle.addEventListener('click', () => {
  const isHidden = dom.apiKeySection.classList.contains('hidden');
  if (isHidden) {
    dom.apiKeySection.classList.remove('hidden');
    dom.apiConfigToggle.textContent = '收起配置';
  } else {
    dom.apiKeySection.classList.add('hidden');
    dom.apiConfigToggle.textContent = 'API 配置';
  }
});

dom.saveApiKeyBtn.addEventListener('click', () => {
  const key = dom.apiKeyInput.value.trim();
  const code = dom.securityCodeInput.value.trim();
  if (!key) { showToast('请输入 API Key'); return; }
  if (!code) { showToast('请输入安全密钥（securityJsCode）'); return; }
  apiKey = key;
  securityCode = code;
  localStorage.setItem(API_KEY_STORAGE, key);
  localStorage.setItem(SECURITY_CODE_STORAGE, code);
  dom.apiKeySection.classList.add('hidden');
  dom.apiConfigToggle.textContent = 'API 配置';
  dom.apiKeyStatus.textContent = 'Key 和安全密钥已配置';
  showToast('配置已保存，正在重新加载...');
  state.sdkReady = false;
  state.position = null;
  loadAMapSDK(key, code);
});

// ============================================
// AMap SDK
// ============================================
function loadAMapSDK(key, secCode) {
  if (window.AMap && state.sdkReady) { initLocation(); return; }
  showSpinner('加载地图...');
  dom.pickBtn.disabled = true;
  setLocationStatus(false, '加载中...');

  const old = document.querySelector('script[src*="webapi.amap.com"]');
  if (old) old.remove();
  try { delete window.AMap; } catch {}

  if (secCode) {
    window._AMapSecurityConfig = { securityJsCode: secCode };
    debugLog('安全密钥已配置', 'securityJsCode: ' + secCode.slice(0, 4) + '****');
  } else {
    window._AMapSecurityConfig = {};
    debugLog('警告', '未配置安全密钥');
  }

  const script = document.createElement('script');
  script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
  script.onload = () => {
    hideSpinner();
    state.sdkReady = true;
    debugLog('SDK加载成功', `AMap.version: ${window.AMap?.version || 'unknown'}`);
    initLocation();
  };
  script.onerror = () => {
    hideSpinner();
    debugLog('SDK加载失败', '请检查API Key');
    setLocationStatus(false, 'SDK 加载失败，请检查 Key');
    showToast('SDK 加载失败，请检查 API Key 是否正确');
    dom.pickBtn.disabled = true;
  };
  document.head.appendChild(script);
}

// ============================================
// Geolocation
// ============================================
function initLocation() {
  setLocationStatus(false, '定位中...');
  dom.pickBtn.disabled = true;

  AMap.plugin(['AMap.Geolocation'], () => {
    const geo = new AMap.Geolocation({
      enableHighAccuracy: true, timeout: 10000, noIpLocate: false,
    });
    geo.getCurrentPosition((status, result) => {
      debugLog('定位 status', status);
      debugLog('定位 result', result ? { position: result.position, location_type: result.location_type, message: result.message, formattedAddress: result.formattedAddress } : 'null');

      if (status === 'complete' && result && result.position) {
        state.position = { lng: result.position.lng, lat: result.position.lat };
        debugLog('定位成功', state.position);
        const type = (result.location_type === 'html5' || result.location_type === 'sdk') ? 'GPS' : 'IP';
        setLocationStatus(true, `已定位 (${type}) · ${result.formattedAddress || '您当前的位置'}`);
        dom.pickBtn.disabled = false;
      } else {
        const msg = result && result.message ? result.message : '定位失败，请检查浏览器定位权限';
        debugLog('定位失败', msg);
        setLocationStatus(false, msg.length > 25 ? msg.slice(0, 25) + '...' : msg);
        showToast('定位失败，请在浏览器设置中允许定位权限');
        dom.pickBtn.disabled = true;
      }
    });
  });
}

// ============================================
// Search
// ============================================
function searchRestaurants() {
  return new Promise((resolve) => {
    AMap.plugin(['AMap.PlaceSearch'], () => {
      const center = new AMap.LngLat(state.position.lng, state.position.lat);
      const radius = Math.max(settings.maxDistance || 5000, 500);
      const keyword = settings.cuisines.length === 1 ? settings.cuisines[0] : '';

      debugLog('搜索参数', { keyword: keyword || '(无)', center: [state.position.lng, state.position.lat], radius: radius });

      function doSearch(pageIndex) {
        return new Promise((res) => {
          const ps = new AMap.PlaceSearch({ pageSize: 25, pageIndex: pageIndex, extensions: 'all' });
          ps.searchNearBy(keyword, center, radius, (status, result) => {
            debugLog(`搜索第${pageIndex}页 status`, status);
            if (status === 'complete' && result) {
              let list = [];
              if (result.poiList && Array.isArray(result.poiList.pois)) list = result.poiList.pois;
              else if (Array.isArray(result.poiList)) list = result.poiList;
              else if (Array.isArray(result.pois)) list = result.pois;
              debugLog(`搜索第${pageIndex}页 解析到`, `${list.length} 条POI`);
              res(list);
            } else {
              debugLog(`搜索第${pageIndex}页 失败`, `status=${status}, info=${result?.info}`);
              res([]);
            }
          });
        });
      }

      Promise.all([doSearch(1), doSearch(2)]).then(([page1, page2]) => {
        const all = [...page1, ...page2];
        debugLog('搜索总计', `${all.length} 条`);
        if (all.length > 0) debugLog('样例POI', JSON.parse(JSON.stringify(all[0])));
        resolve(all);
      });
    });
  });
}

function filterRestaurants(pois) {
  const blackIds = new Set(blacklist.map(b => b.id));

  return pois.filter(poi => {
    if (!poi.name) return false;
    if (!(poi.type || '').includes('餐饮')) return false;
    if (getRating(poi) < settings.minRating) return false;
    if (settings.maxDistance > 0 && (poi.distance || 0) > settings.maxDistance) return false;
    if (settings.maxPrice > 0 && getCost(poi) > settings.maxPrice) return false;
    if (blackIds.has(poi.id)) return false;

    const combined = getPoiSearchText(poi);
    if (settings.cuisines.length > 0) {
      if (!settings.cuisines.some(kw => combined.includes(kw))) return false;
    }
    if (matchesDislikes(poi, combined)) return false;
    return true;
  });
}

function getPoiSearchText(poi) {
  return [
    poi.name || '',
    poi.type || '',
    poi.address || '',
    poi.biz_ext?.type || '',
    poi.deep_info?.tag || '',
  ].join(' ');
}

function matchesDislikes(poi, combinedText) {
  const selected = Array.isArray(settings.dislikes) ? settings.dislikes : [];
  if (selected.length === 0) return false;
  const dist = poi.distance || 0;
  const cost = getCost(poi);
  return selected.some(function(key) {
    const rule = DISLIKE_RULES[key];
    if (!rule) return false;
    if (rule.maxDistance && dist > rule.maxDistance) return true;
    if (rule.maxCost && cost > 0 && cost > rule.maxCost) return true;
    if (rule.keywords && rule.keywords.some(function(kw) { return combinedText.includes(kw); })) return true;
    return false;
  });
}

function pickRandom(candidates, count) {
  if (candidates.length === 0) return null;
  const actualCount = count || 1;
  let pool = candidates.filter(function(c) { return !state.shownThisRound.has(c.id); });
  if (pool.length === 0) { state.shownThisRound.clear(); pool = candidates; }
  const n = Math.min(pool.length, actualCount);
  const picks = pickWeighted(pool, n);
  picks.forEach(function(p) { state.shownThisRound.add(p.id); });
  return actualCount === 1 ? picks[0] : picks;
}

function pickWeighted(pool, count) {
  const remaining = pool.slice();
  const picks = [];
  while (remaining.length > 0 && picks.length < count) {
    const total = remaining.reduce(function(sum, poi) {
      return sum + getRecommendationWeight(poi);
    }, 0);
    let cursor = Math.random() * Math.max(total, 0.01);
    let chosenIndex = 0;
    for (let i = 0; i < remaining.length; i++) {
      cursor -= getRecommendationWeight(remaining[i]);
      if (cursor <= 0) { chosenIndex = i; break; }
    }
    picks.push(remaining.splice(chosenIndex, 1)[0]);
  }
  return picks;
}

function getRecommendationWeight(poi) {
  const rating = getRating(poi);
  const dist = poi.distance || 0;
  const cost = getCost(poi);
  const typeLabel = getTypeLabel(poi.type);
  const combined = getPoiSearchText(poi);
  const historyEntry = history.find(function(h) { return h.id === poi.id; });
  let score = 1;

  if (rating > 0) score += Math.max(0, rating - 3) * 0.9;
  if (dist > 0) score += dist < 600 ? 1.4 : dist < 1200 ? 0.9 : dist < 2500 ? 0.35 : 0;
  if (settings.maxPrice > 0 && cost > 0 && cost <= settings.maxPrice) score += 0.5;
  if (settings.cuisines.some(function(kw) { return combined.includes(kw); })) score += 1.2;
  if (favorites.some(function(f) { return f.typeLabel && typeLabel && f.typeLabel === typeLabel; })) score += 0.7;

  if (historyEntry) {
    const ageHours = (Date.now() - historyEntry.timestamp) / 3600000;
    score *= ageHours < 24 ? 0.18 : ageHours < 72 ? 0.35 : 0.55;
  }

  return Math.max(score, 0.05);
}

function getRecommendationReasons(poi) {
  const reasons = [];
  const rating = getRating(poi);
  const dist = poi.distance || 0;
  const cost = getCost(poi);
  const typeLabel = getTypeLabel(poi.type);
  const combined = getPoiSearchText(poi);
  const historyEntry = history.find(function(h) { return h.id === poi.id; });

  if (dist > 0) {
    reasons.push(dist < 600 ? '离你很近' : '距离可接受');
  }
  if (rating >= 4.5) reasons.push('评分很稳');
  else if (rating >= 4.0) reasons.push('评分不错');
  if (settings.cuisines.some(function(kw) { return combined.includes(kw); })) reasons.push('符合菜系偏好');
  if (settings.maxPrice > 0 && cost > 0 && cost <= settings.maxPrice) reasons.push('价格在预算内');
  if (!historyEntry) reasons.push('最近没推荐过');
  if (favorites.some(function(f) { return f.typeLabel && typeLabel && f.typeLabel === typeLabel; })) reasons.push('接近你的收藏口味');

  return reasons.slice(0, 4);
}

// ============================================
// Data getters
// ============================================
function getRating(poi) {
  if (poi._rating !== undefined) return poi._rating;
  const r = poi.rating || poi.biz_ext?.rating || poi.deep_info?.rating || '';
  const num = parseFloat(r);
  return (poi._rating = isNaN(num) ? 0 : num);
}
function getCost(poi) {
  if (poi._cost !== undefined) return poi._cost;
  const c = poi.cost || poi.biz_ext?.cost || poi.deep_info?.cost || '';
  const num = parseFloat(c);
  return (poi._cost = isNaN(num) ? 0 : num);
}
function getPhotoUrl(poi) {
  if (poi.photos && Array.isArray(poi.photos) && poi.photos.length > 0) {
    const p = poi.photos[0]; return p.url || p;
  }
  if (poi.deep_info?.photos && Array.isArray(poi.deep_info.photos) && poi.deep_info.photos.length > 0) {
    const dp = poi.deep_info.photos[0]; return dp.url || dp;
  }
  if (poi.biz_ext?.photos && Array.isArray(poi.biz_ext.photos) && poi.biz_ext.photos.length > 0) {
    const bp = poi.biz_ext.photos[0]; return bp.url || bp;
  }
  return null;
}

// ============================================
// Display
// ============================================
function displayResult(restaurant) {
  state.currentResult = restaurant;
  destroyMiniMap();

  if (!restaurant) {
    dom.resultCard.classList.remove('has-result');
    dom.resultCard.innerHTML = `
      <div class="result-empty">
        <div class="empty-symbol">🔍</div>
        <p>附近没找到合适的餐厅</p>
        <p class="result-hint">试试放宽筛选条件或扩大搜索范围</p>
      </div>`;
    dom.resultActions.classList.add('hidden');
    return;
  }

  if (Array.isArray(restaurant)) {
    displayMultiResult(restaurant);
    return;
  }

  dom.resultCard.classList.add('has-result');
  const rating = getRating(restaurant);
  const cost = getCost(restaurant);
  const dist = restaurant.distance || 0;
  const typeLabel = getTypeLabel(restaurant.type);
  const navUrl = getNavUrl(restaurant);
  const hasLocation = !!getPoiLocation(restaurant);
  const photoUrl = getPhotoUrl(restaurant);
  const verdict = generateVerdict(restaurant);
  const reasons = getRecommendationReasons(restaurant);

  dom.resultCard.innerHTML = `
    ${photoUrl ? '<img class="result-photo" src="' + photoUrl + '" alt="' + escapeHtml(restaurant.name) + '" loading="lazy" onerror="this.classList.add(\'hidden\')">' : ''}
    <div class="result-name">${escapeHtml(restaurant.name)}</div>
    <div class="result-stars">
      ${renderStars(rating)}
      <span class="score">${rating > 0 ? rating.toFixed(1) : '暂无评分'}</span>
    </div>
    <div class="result-meta">
      <span>${formatDistance(dist)}</span>
      ${cost > 0 ? '<span>人均 ¥' + cost + '</span>' : ''}
    </div>
    <div class="result-address">${escapeHtml(restaurant.address || '')}</div>
    ${typeLabel ? '<span class="result-type">' + escapeHtml(typeLabel) + '</span>' : ''}
    ${reasons.length > 0 ? '<div class="reason-list">' + reasons.map(function(reason) {
      return '<span class="reason-chip">' + escapeHtml(reason) + '</span>';
    }).join('') + '</div>' : ''}
    <div class="oracle-verdict">
      <div class="oracle-verdict-deco" aria-hidden="true">今日箴言</div>
      <div class="verdict-text">${escapeHtml(verdict)}</div>
    </div>
    ${hasLocation ? '<div class="result-map" id="miniMapContainer"></div>' : ''}
    ${navUrl ? '<div class="result-nav-row"><a class="result-nav-btn" href="' + navUrl + '" target="_blank" rel="noopener noreferrer">导航去这里</a></div>' : ''}
  `;

  dom.resultActions.classList.remove('hidden');
  updateFavResultBtn();

  if (hasLocation) {
    const mapContainer = document.getElementById('miniMapContainer');
    if (mapContainer) {
      setTimeout(function() { renderMiniMap(mapContainer, restaurant); }, 200);
    }
  }
}

function displayMultiResult(restaurants) {
  dom.resultCard.classList.add('has-result');
  let html = '<div class="mr-count-header">为你找到 ' + restaurants.length + ' 家</div>';
  html += restaurants.map(function(r, i) {
    const rating = getRating(r);
    const cost = getCost(r);
    const dist = r.distance || 0;
    const typeLabel = getTypeLabel(r.type);
    const navUrl = getNavUrl(r);
    const starsHtml = rating > 0 ? '<span class="star-badge">★ ' + rating.toFixed(1) + '</span>' : '';
    const reasons = getRecommendationReasons(r);
    return '<div class="multi-result-item">' +
      '<div class="mr-header">' +
        '<span class="mr-name">' + (i + 1) + '. ' + escapeHtml(r.name) + '</span>' +
        (starsHtml ? '<span class="mr-stars">' + starsHtml + '</span>' : '') +
      '</div>' +
      '<div class="mr-meta">' +
        (dist > 0 ? '<span>' + formatDistance(dist) + '</span>' : '') +
        (cost > 0 ? '<span>人均 ¥' + cost + '</span>' : '') +
        (typeLabel ? '<span class="mr-type-label">' + escapeHtml(typeLabel) + '</span>' : '') +
      '</div>' +
      (r.address ? '<div class="mr-address">' + escapeHtml(r.address) + '</div>' : '') +
      (reasons.length > 0 ? '<div class="reason-list reason-list--compact">' + reasons.map(function(reason) {
        return '<span class="reason-chip">' + escapeHtml(reason) + '</span>';
      }).join('') + '</div>' : '') +
      '<div class="mr-actions">' +
        (navUrl ? '<a class="mr-nav" href="' + navUrl + '" target="_blank" rel="noopener noreferrer">导航</a>' : '') +
        '<button class="mr-blacklist" data-mr-idx="' + i + '">拉黑</button>' +
      '</div>' +
    '</div>';
  }).join('');
  dom.resultCard.innerHTML = html;
  dom.resultActions.classList.remove('hidden');

  setTimeout(function() {
    dom.resultCard.querySelectorAll('.mr-blacklist').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const idx = parseInt(btn.dataset.mrIdx);
        if (state.currentResult && Array.isArray(state.currentResult) && state.currentResult[idx]) {
          addToBlacklist(state.currentResult[idx]);
          state.currentResult.splice(idx, 1);
          if (state.currentResult.length === 0) {
            displayResult(null);
          } else {
            displayMultiResult(state.currentResult);
          }
        }
      });
    });
  }, 50);
}

function renderMetaChips(item, opts) {
  const chips = [];
  if (item.rating > 0) chips.push('<span class="star-badge">★ ' + item.rating.toFixed(1) + '</span>');
  if (item.distance > 0) chips.push('<span>' + formatDistance(item.distance) + '</span>');
  if (item.cost > 0) chips.push('<span>¥' + item.cost + '</span>');
  if (item.typeLabel) chips.push('<span class="chip-type-label">' + escapeHtml(item.typeLabel) + '</span>');
  if (opts && opts.showPickCount && item.pickCount > 1) chips.push('<span>' + item.pickCount + '次</span>');
  return chips.join('');
}

// ============================================
// Mini Map & Navigation
// ============================================
function getPoiLocation(poi) {
  if (!poi || !poi.location) return null;
  const loc = poi.location;
  const lng = typeof loc.lng === 'number' ? loc.lng : (typeof loc.getLng === 'function' ? loc.getLng() : null);
  const lat = typeof loc.lat === 'number' ? loc.lat : (typeof loc.getLat === 'function' ? loc.getLat() : null);
  if (lng == null || lat == null) return null;
  return { lng: lng, lat: lat };
}

function getNavUrl(poi) {
  const loc = getPoiLocation(poi);
  if (!loc) return null;
  return 'https://uri.amap.com/navigation?to=' + loc.lng + ',' + loc.lat + ',' + encodeURIComponent(poi.name) + '&mode=car&callnative=1';
}

function destroyMiniMap() {
  if (state.miniMap) { try { state.miniMap.destroy(); } catch (e) {} state.miniMap = null; }
}

function renderMiniMap(container, poi) {
  destroyMiniMap();
  const loc = getPoiLocation(poi);
  if (!loc || !window.AMap) return;
  const map = new AMap.Map(container, {
    zoom: 16, center: [loc.lng, loc.lat],
    resizeEnable: true, scrollWheel: false, dragEnable: false,
    zoomEnable: false, doubleClickZoom: false, keyboardEnable: false,
    showBuildingBlock: true,
  });
  const marker = new AMap.Marker({ position: [loc.lng, loc.lat], title: poi.name, anchor: 'center' });
  map.add(marker);
  state.miniMap = map;
}

// ============================================
// Main Action
// ============================================
async function doPick() {
  if (state.isSearching) return;
  if (!state.position) { showToast('请等待定位完成'); return; }

  state.isSearching = true;
  dom.pickBtn.disabled = true;
  destroyMiniMap();
  dom.resultCard.classList.remove('has-result');
  dom.resultActions.classList.add('hidden');

  try {
    const pois = await searchRestaurants();
    hideSpinner();

    if (pois.length === 0) {
      debugLog('搜索结果为空', 'API返回0条POI');
      displayResult(null);
      showToast('附近没搜到餐厅，试试扩大距离');
    } else {
      debugLog('搜索原始结果', `${pois.length} 条`);
      state.shownThisRound.clear();
      state.candidates = filterRestaurants(pois);
      debugLog('筛选后结果', `${state.candidates.length} 条`);

      if (state.candidates.length === 0) {
        const totalWithFilters = pois.filter(p => getRating(p) >= settings.minRating).length;
        debugLog('筛选后为空', `评分达标:${totalWithFilters}/${pois.length}`);
        displayResult(null);
        if (totalWithFilters === 0 && pois.length > 0) {
          showToast(`找到 ${pois.length} 家餐厅但评分都不够，请降低评分要求`);
        } else {
          showToast('筛选后无结果，请放宽条件');
        }
      } else {
        const pick = pickRandom(state.candidates, settings.pickCount);
        const displayName = Array.isArray(pick) ? pick[0]?.name || '餐厅' : pick?.name || '餐厅';

        await showOracleRitual(displayName);

        displayResult(pick);
        if (Array.isArray(pick)) {
          pick.forEach(function(p) { addToHistory(p); });
        } else {
          addToHistory(pick);
        }
        renderHistory();
      }
    }
  } catch (err) {
    hideSpinner();
    const ritualEl = document.querySelector('.oracle-ritual');
    if (ritualEl) ritualEl.remove();
    displayResult(null);
    showToast('搜索失败，请稍后重试');
    console.error(err);
  }

  state.isSearching = false;
  dom.pickBtn.disabled = false;
}

function reroll() {
  if (state.candidates.length === 0) { showToast('没有更多候选了，请重新搜索'); return; }
  const pick = pickRandom(state.candidates, settings.pickCount);
  if (pick) {
    displayResult(pick);
    if (Array.isArray(pick)) {
      pick.forEach(function(p) { addToHistory(p); });
    } else {
      addToHistory(pick);
    }
    renderHistory();
  }
}

function addToBlacklist(restaurant) {
  if (!restaurant) return;
  if (blacklist.some(b => b.id === restaurant.id)) return;
  blacklist.push({ id: restaurant.id, name: restaurant.name, timestamp: Date.now() });
  saveJSON(BLACKLIST_KEY, blacklist);
  state.candidates = state.candidates.filter(c => c.id !== restaurant.id);
  renderBlacklist();
  showToast('已拉黑「' + restaurant.name + '」');
  reroll();
}

// ============================================
// History
// ============================================
function addToHistory(restaurant) {
  if (!restaurant) return;
  const data = Object.assign(getFavData(restaurant), { timestamp: Date.now() });
  const existing = history.find(function(h) { return h.id === restaurant.id; });
  data.pickCount = existing ? (existing.pickCount || 1) + 1 : 1;
  history = history.filter(function(h) { return h.id !== restaurant.id; });
  history.unshift(data);
  history = history.filter(function(h) { return Date.now() - h.timestamp < SEVEN_DAYS; });
  if (history.length > 50) history = history.slice(0, 50);
  saveJSON(HISTORY_KEY, history);
}

function renderHistory() {
  const recent = history.filter(function(h) { return Date.now() - h.timestamp < SEVEN_DAYS; });
  if (recent.length === 0) {
    dom.historyList.innerHTML = '<div class="list-empty">暂无记录</div>';
    dom.clearHistoryBtn.classList.add('hidden');
    return;
  }
  dom.clearHistoryBtn.classList.remove('hidden');
  const favIds = new Set(favorites.map(function(f) { return f.id; }));
  dom.historyList.innerHTML = recent.map(function(h, idx) {
    const faved = favIds.has(h.id);
    return '<div class="list-item" data-idx="' + idx + '">' +
      '<div class="info">' +
        '<div class="name">' + escapeHtml(h.name) + '</div>' +
        '<div class="meta">' + renderMetaChips(h, { showPickCount: true }) + '</div>' +
        '<div class="date">' + new Date(h.timestamp).toLocaleDateString('zh-CN') + '</div>' +
      '</div>' +
      '<div class="item-actions">' +
        '<button class="fav-btn' + (faved ? ' faved' : '') + '" data-hist-idx="' + idx + '">' + (faved ? '★' : '☆') + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function historyToRestaurant(h) {
  return {
    name: h.name, rating: h.rating, cost: h.cost,
    distance: h.distance, type: h.typeLabel,
    address: h.address, location: h.location,
  };
}

function clearHistory() {
  history = [];
  saveJSON(HISTORY_KEY, []);
  renderHistory();
  showToast('历史记录已清空');
}

dom.historyList.addEventListener('click', function(e) {
  const item = e.target.closest('.list-item');
  if (!item) return;
  const idx = parseInt(item.dataset.idx);
  const entry = history[idx];
  if (!entry) return;
  if (e.target.closest('.fav-btn')) { e.stopPropagation(); toggleFavorite(entry); return; }
  displayResult(historyToRestaurant(entry));
  window.scrollTo({ top: dom.resultCard.offsetTop - 20, behavior: 'smooth' });
});

// ============================================
// Share
// ============================================
function shareResult() {
  const r = state.currentResult;
  if (!r) return;
  const items = Array.isArray(r) ? r : [r];
  const lines = ['今天吃什么 · 今日之选', ''];
  items.forEach(function(item, i) {
    if (items.length > 1) lines.push('【第' + (i + 1) + '个】');
    lines.push(item.name);
    const rating = getRating(item);
    if (rating > 0) lines.push('评分：★' + rating.toFixed(1));
    const dist = item.distance || 0;
    if (dist > 0) lines.push('距离：' + formatDistance(dist));
    const cost = getCost(item);
    if (cost > 0) lines.push('人均：¥' + cost);
    if (item.address) lines.push('地址：' + item.address);
    const navUrl = getNavUrl(item);
    if (navUrl) lines.push('导航：' + navUrl);
    lines.push('');
  });
  lines.push('—— 今天吃什么 · 随机选一家');
  const text = lines.join('\n');
  if (navigator.share) {
    navigator.share({ title: '今天吃什么 · 今日之选', text: text }).catch(function() { copyToClipboard(text); });
  } else {
    copyToClipboard(text);
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() { showToast('已复制到剪贴板'); })
      .catch(function() { showToast('分享失败，请截图分享'); });
  } else {
    const ta = document.createElement('textarea'); ta.value = text;
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('已复制到剪贴板'); }
    catch (e) { showToast('分享失败，请截图分享'); }
    document.body.removeChild(ta);
  }
}

// ============================================
// Favorites
// ============================================
function isFavorite(id) { return favorites.some(function(f) { return f.id === id; }); }

function toggleFavorite(data) {
  if (!data || !data.name) return;
  if (isFavorite(data.id)) {
    favorites = favorites.filter(function(f) { return f.id !== data.id; });
    showToast('已取消收藏「' + data.name + '」');
  } else {
    favorites.unshift({
      id: data.id, name: data.name, timestamp: Date.now(),
      rating: data.rating, distance: data.distance, cost: data.cost,
      typeLabel: data.typeLabel, address: data.address, location: data.location,
    });
    showToast('已收藏「' + data.name + '」');
  }
  saveJSON(FAVORITES_KEY, favorites);
  renderFavorites(); renderHistory(); updateFavResultBtn();
}

function getFavData(restaurant) {
  return {
    id: restaurant.id, name: restaurant.name,
    rating: getRating(restaurant), distance: restaurant.distance || 0,
    cost: getCost(restaurant), typeLabel: getTypeLabel(restaurant.type),
    address: restaurant.address || '', location: getPoiLocation(restaurant),
  };
}

function updateFavResultBtn() {
  if (!state.currentResult) return;
  var faved = isFavorite(state.currentResult.id);
  dom.favResultBtn.textContent = faved ? '已收藏' : '想去';
  dom.favResultBtn.classList.toggle('faved', faved);
}

function renderFavorites() {
  if (favorites.length === 0) { dom.favList.innerHTML = '<div class="list-empty">暂无收藏</div>'; return; }
  dom.favList.innerHTML = favorites.map(function(f, idx) {
    return '<div class="list-item" data-idx="' + idx + '">' +
      '<div class="info">' +
        '<div class="name">' + escapeHtml(f.name) + '</div>' +
        '<div class="meta">' + renderMetaChips(f, {}) + '</div>' +
      '</div>' +
      '<div class="item-actions">' +
        '<button class="fav-btn faved" data-fav-idx="' + idx + '">★</button>' +
        '<button class="remove-btn" data-fav-idx="' + idx + '">×</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

dom.favList.addEventListener('click', function(e) {
  const item = e.target.closest('.list-item');
  if (!item) return;
  const idx = parseInt(item.dataset.idx);
  const entry = favorites[idx];
  if (!entry) return;
  if (e.target.closest('.fav-btn')) { e.stopPropagation(); toggleFavorite(entry); return; }
  if (e.target.closest('.remove-btn')) {
    e.stopPropagation();
    favorites = favorites.filter(function(f) { return f.id !== entry.id; });
    saveJSON(FAVORITES_KEY, favorites);
    renderFavorites(); renderHistory(); updateFavResultBtn();
    showToast('已移除「' + entry.name + '」');
    return;
  }
  displayResult(historyToRestaurant(entry));
  window.scrollTo({ top: dom.resultCard.offsetTop - 20, behavior: 'smooth' });
});

// ============================================
// Blacklist
// ============================================
function renderBlacklist() {
  if (blacklist.length === 0) { dom.blacklistList.innerHTML = '<div class="list-empty">暂无拉黑</div>'; return; }
  dom.blacklistList.innerHTML = blacklist.map(b => `
    <div class="list-item">
      <div class="info">
        <div class="name">${escapeHtml(b.name)}</div>
        <div class="date">${new Date(b.timestamp).toLocaleDateString('zh-CN')}</div>
      </div>
      <button class="remove-btn" data-id="${b.id}">×</button>
    </div>
  `).join('');
  dom.blacklistList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      blacklist = blacklist.filter(b => b.id !== id);
      saveJSON(BLACKLIST_KEY, blacklist);
      renderBlacklist();
      showToast('已从黑名单移除');
    });
  });
}

// ============================================
// Settings UI
// ============================================
function initSettingsUI() {
  dom.ratingSlider.value = settings.minRating;
  dom.ratingValue.textContent = settings.minRating.toFixed(1);
  dom.distanceSlider.value = settings.maxDistance;
  dom.distanceValue.textContent = formatDistance(settings.maxDistance);
  dom.priceOptions.querySelectorAll('.price-chip').forEach(chip => {
    chip.classList.toggle('active', parseInt(chip.dataset.price) === settings.maxPrice);
  });
  dom.cuisineTags.querySelectorAll('.cuisine-tag').forEach(tag => {
    tag.classList.toggle('active', settings.cuisines.includes(tag.dataset.keyword));
  });
  if (dom.dislikeOptions) {
    dom.dislikeOptions.querySelectorAll('.dislike-tag').forEach(tag => {
      tag.classList.toggle('active', settings.dislikes.includes(tag.dataset.dislike));
    });
  }
  if (dom.dislikeHint) {
    dom.dislikeHint.textContent = settings.dislikes.length > 0 ? `已选 ${settings.dislikes.length} 项` : '不选则不限';
  }
  $$('.pick-count-btn').forEach(function(btn) {
    btn.classList.toggle('active', parseInt(btn.dataset.count) === settings.pickCount);
  });
}

// ============================================
// Event Bindings
// ============================================
$$('.pick-count-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    $$('.pick-count-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    settings.pickCount = parseInt(btn.dataset.count);
    debouncedSaveSettings();
  });
});

dom.pickBtn.addEventListener('click', doPick);
dom.rerollBtn.addEventListener('click', reroll);
dom.blacklistBtn.addEventListener('click', () => addToBlacklist(state.currentResult));
dom.favResultBtn.addEventListener('click', () => {
  if (state.currentResult) toggleFavorite(getFavData(state.currentResult));
});
dom.shareBtn.addEventListener('click', shareResult);
dom.clearHistoryBtn.addEventListener('click', clearHistory);

dom.ratingSlider.addEventListener('input', () => {
  settings.minRating = parseFloat(dom.ratingSlider.value);
  dom.ratingValue.textContent = settings.minRating.toFixed(1);
  debouncedSaveSettings();
});

dom.distanceSlider.addEventListener('input', () => {
  settings.maxDistance = parseInt(dom.distanceSlider.value);
  dom.distanceValue.textContent = formatDistance(settings.maxDistance);
  debouncedSaveSettings();
});

dom.priceOptions.addEventListener('click', (e) => {
  const chip = e.target.closest('.price-chip');
  if (!chip) return;
  const val = parseInt(chip.dataset.price);
  settings.maxPrice = val === settings.maxPrice ? 0 : val;
  dom.priceOptions.querySelectorAll('.price-chip').forEach(c => c.classList.remove('active'));
  const activePrice = dom.priceOptions.querySelector(`[data-price="${settings.maxPrice}"]`);
  if (activePrice) activePrice.classList.add('active');
  debouncedSaveSettings();
});

dom.cuisineTags.addEventListener('click', (e) => {
  const tag = e.target.closest('.cuisine-tag');
  if (!tag) return;
  const kw = tag.dataset.keyword;
  const idx = settings.cuisines.indexOf(kw);
  if (idx >= 0) { settings.cuisines.splice(idx, 1); tag.classList.remove('active'); }
  else { settings.cuisines.push(kw); tag.classList.add('active'); }
  dom.cuisineHint.textContent = settings.cuisines.length > 0 ? `已选 ${settings.cuisines.length} 项` : '不选则不限';
  debouncedSaveSettings();
});

if (dom.dislikeOptions) {
  dom.dislikeOptions.addEventListener('click', (e) => {
    const tag = e.target.closest('.dislike-tag');
    if (!tag) return;
    const key = tag.dataset.dislike;
    const idx = settings.dislikes.indexOf(key);
    if (idx >= 0) { settings.dislikes.splice(idx, 1); tag.classList.remove('active'); }
    else { settings.dislikes.push(key); tag.classList.add('active'); }
    dom.dislikeHint.textContent = settings.dislikes.length > 0 ? `已选 ${settings.dislikes.length} 项` : '不选则不限';
    debouncedSaveSettings();
  });
}

// Collapsible sections
function bindCollapse(header, arrow, body) {
  header.addEventListener('click', () => {
    const isOpen = body.classList.contains('open');
    if (isOpen) {
      body.classList.remove('open'); arrow.classList.remove('open');
      header.setAttribute('aria-expanded', 'false');
    } else {
      body.classList.add('open'); arrow.classList.add('open');
      header.setAttribute('aria-expanded', 'true');
    }
  });
  header.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); }
  });
}
bindCollapse($('#filterHeader'), dom.filterArrow, dom.filterBody);
bindCollapse($('#historyHeader'), dom.historyArrow, dom.historyBody);
bindCollapse($('#blacklistHeader'), dom.blacklistArrow, dom.blacklistBody);
bindCollapse($('#favHeader'), dom.favArrow, dom.favBody);
bindCollapse($('#debugHeader'), dom.debugArrow, dom.debugBody);

// ============================================
// Init
// ============================================
function init() {
  initSettingsUI();
  renderHistory();
  renderBlacklist();
  renderFavorites();
  initApiKey();
  initShakeDetection();
}

init();

})();
