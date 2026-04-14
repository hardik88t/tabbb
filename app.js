'use strict';

/* ----------------------------------------------------------------
   EXTENSION STORAGE HELPER (replacing Server API)
   ---------------------------------------------------------------- */

const STORAGE_KEY_DEFERRED = 'tab_out_deferred';

async function getDeferred() {
  const data = await chrome.storage.local.get(STORAGE_KEY_DEFERRED);
  return data[STORAGE_KEY_DEFERRED] || { active: [], archived: [] };
}

async function saveDeferred(deferred) {
  await chrome.storage.local.set({ [STORAGE_KEY_DEFERRED]: deferred });
  // Notify background script to update badge if needed
  chrome.runtime.sendMessage({ action: 'updateBadge' });
}

/* ----------------------------------------------------------------
   TAB MANAGEMENT (replacing postMessage bridge)
   ---------------------------------------------------------------- */

let openTabs = [];

async function fetchOpenTabs() {
  const tabs = await chrome.tabs.query({});
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  openTabs = tabs.map(tab => ({
    id:       tab.id,
    url:      tab.url,
    title:    tab.title,
    windowId: tab.windowId,
    active:   tab.active,
    isTabOut: tab.url === newtabUrl || tab.url === 'chrome://newtab/',
  }));
}

async function closeTabsByUrls(urls, exact = false) {
  const targetHostnames = [];
  const targetExactUrls = new Set(urls);

  if (!exact) {
    for (const u of urls) {
      if (!u.startsWith('file://')) {
        try { targetHostnames.push(new URL(u).hostname); } catch {}
      }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(tab => {
    if (targetExactUrls.has(tab.url)) return true;
    if (!exact) {
      try {
        const h = new URL(tab.url).hostname;
        return targetHostnames.includes(h);
      } catch {}
    }
    return false;
  }).map(t => t.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function focusTabsByUrls(urls) {
  const targetHosts = urls.map(u => {
    try { return new URL(u).hostname; } catch { return null; }
  }).filter(Boolean);

  const allTabs = await chrome.tabs.query({});
  const match = allTabs.find(t => {
    try { return targetHosts.includes(new URL(t.url).hostname); } catch { return false; }
  });

  if (match) {
    await chrome.tabs.update(match.id, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
  }
}

async function focusSingleTab(url) {
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  
  let matches = allTabs.filter(t => t.url === url);
  if (matches.length === 0) {
    try {
      const host = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === host; } catch { return false; }
      });
    } catch {}
  }

  if (matches.length > 0) {
    const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
    await chrome.tabs.update(match.id, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
  }
}

/* ----------------------------------------------------------------
   UI HELPERS (Confetti, Sound, etc.) — UNCHANGED
   ---------------------------------------------------------------- */

function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

function shootConfetti(x, y) {
  const colors = ['#c8713a', '#e8a070', '#5a7a62', '#8aaa92', '#5a6b7a', '#8a9baa', '#d4b896', '#b35a5a'];
  for (let i = 0; i < 17; i++) {
    const el = document.createElement('div');
    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6;
    const color = colors[Math.floor(Math.random() * colors.length)];
    el.style.cssText = `position:fixed; left:${x}px; top:${y}px; width:${size}px; height:${size}px; background:${color}; border-radius:${isCircle ? '50%' : '2px'}; pointer-events:none; z-index:9999; transform:translate(-50%, -50%); opacity:1;`;
    document.body.appendChild(el);
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 80;
    const gravity = 200;
    const startTime = performance.now();
    const duration = 700 + Math.random() * 200;
    function frame(now) {
      const elapsed = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);
      if (progress >= 1) { el.remove(); return; }
      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate = elapsed * 200 * (isCircle ? 0 : 1);
      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
}

function animateCardOut(card) {
  if (!card) return;
  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;
  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;
  missionsEl.innerHTML = `<div class="missions-empty-state"><div class="empty-checkmark"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg></div><div class="empty-title">Inbox zero, but for tabs.</div><div class="empty-subtitle">You're free.</div></div>`;
  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 missions';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = new Date() - new Date(dateStr);
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  if (hrs < 24) return hrs + ' hr' + (hrs !== 1 ? 's' : '') + ' ago';
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/* ----------------------------------------------------------------
   DOMAIN HELPERS (SAME AS ORIGINAL)
   ---------------------------------------------------------------- */

const FRIENDLY_DOMAINS = { 'github.com': 'GitHub', 'www.github.com': 'GitHub', 'youtube.com': 'YouTube', 'www.youtube.com': 'YouTube', 'x.com': 'X', 'twitter.com': 'X', 'reddit.com': 'Reddit', 'linkedin.com': 'LinkedIn', 'stackoverflow.com': 'Stack Overflow', 'news.ycombinator.com': 'Hacker News', 'google.com': 'Google', 'mail.google.com': 'Gmail', 'docs.google.com': 'Google Docs', 'notion.so': 'Notion', 'figma.com': 'Figma', 'slack.com': 'Slack', 'discord.com': 'Discord', 'wikipedia.org': 'Wikipedia', 'amazon.com': 'Amazon', 'netflix.com': 'Netflix', 'spotify.com': 'Spotify', 'vercel.com': 'Vercel', 'npmjs.com': 'npm', 'developer.mozilla.org': 'MDN', 'local-files': 'Local Files' };

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];
  if (hostname.endsWith('.substack.com')) return hostname.replace('.substack.com', '') + "'s Substack";
  let clean = hostname.replace(/^www\./, '').replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk)$/, '');
  return clean.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function stripTitleNoise(title) {
  if (!title) return '';
  return title.replace(/^\(\d+\+?\)\s*/, '').replace(/\s*\([\d,]+\+?\)\s*/g, ' ').replace(/\s+on X:\s*/, ': ').replace(/\s*\/\s*X\s*$/, '').trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';
  const friendly = friendlyDomain(hostname).toLowerCase();
  const separators = [' - ', ' | ', ' — ', ' · ', ' – '];
  for (const sep of separators) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix = title.slice(idx + sep.length).trim().toLowerCase();
    if (friendly.includes(suffix) || hostname.includes(suffix)) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  try {
    const u = new URL(url);
    const p = u.pathname;
    const h = u.hostname;
    const titleIsUrl = !title || title === url || title.startsWith(h) || title.startsWith('http');
    if ((h.includes('x.com') || h.includes('twitter.com')) && p.includes('/status/')) {
      const user = p.split('/')[1];
      return user ? `Post by @${user}` : title;
    }
    if (h === 'github.com') {
      const parts = p.split('/').filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}` + (parts[2] ? ` — ${parts.slice(2).join('/')}` : '');
    }
  } catch {}
  return title || url;
}

const ICONS = {
  tabs: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`
};

/* ----------------------------------------------------------------
   DASHBOARD RENDERER
   ---------------------------------------------------------------- */

let domainGroups = [];

function getRealTabs() {
  return openTabs.filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:') && !t.url.startsWith('edge') && !t.url.startsWith('brave'));
}

async function renderDomainCard(group) {
  const tabs = group.tabs || [];
  const tabCount = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');
  
  const urlCounts = {};
  for (const t of tabs) urlCounts[t.url] = (urlCounts[t.url] || 0) + 1;
  const dupeUrls = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">${ICONS.tabs} ${tabCount} tab${tabCount !== 1 ? 's' : ''} open</span>`;
  const dupeBadge = totalExtras > 0 ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}</span>` : '';

  const seen = new Set();
  const uniqueTabs = [];
  for (const t of tabs) if (!seen.has(t.url)) { seen.add(t.url); uniqueTabs.push(t); }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    const count = urlCounts[tab.url];
    const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const safeUrl = tab.url.replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    const domain = new URL(tab.url).hostname;
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    return `<div class="page-chip clickable" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}"><img class="chip-favicon" src="${favicon}" onerror="this.style.display='none'"><span class="chip-text">${label}</span>${dupeTag}<div class="chip-actions"><button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg></button><button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">${ICONS.close}</button></div></div>`;
  }).join('');

  const actions = `<button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">${ICONS.close} Close all ${tabCount} tabs</button>` + 
    (totalExtras > 0 ? `<button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrls.map(([u]) => encodeURIComponent(u)).join(',')}">Close ${totalExtras} duplicates</button>` : '');

  return `<div class="mission-card domain-card ${totalExtras > 0 ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}"><div class="status-bar"></div><div class="mission-content"><div class="mission-top"><span class="mission-name">${isLanding ? 'Homepages' : friendlyDomain(group.domain)}</span>${tabBadge}${dupeBadge}</div><div class="mission-pages">${pageChips}</div><div class="actions">${actions}</div></div></div>`;
}

async function renderDeferredColumn() {
  const { active, archived } = await getDeferred();
  const col = document.getElementById('deferredColumn');
  if (active.length === 0 && archived.length === 0) { col.style.display = 'none'; return; }
  col.style.display = 'block';
  
  const list = document.getElementById('deferredList');
  document.getElementById('deferredCount').textContent = active.length > 0 ? `${active.length} item${active.length !== 1 ? 's' : ''}` : '';
  list.innerHTML = active.map(item => {
    const domain = new URL(item.url).hostname.replace(/^www\./, '');
    return `<div class="deferred-item" data-deferred-id="${item.id}"><input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}"><div class="deferred-info"><a href="${item.url}" target="_blank" class="deferred-title" title="${item.title.replace(/"/g, '&quot;')}"><img src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px">${item.title}</a><div class="deferred-meta"><span>${domain}</span><span>${timeAgo(item.deferred_at)}</span></div></div><button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">${ICONS.close}</button></div>`;
  }).join('');
  document.getElementById('deferredEmpty').style.display = active.length === 0 ? 'block' : 'none';

  if (archived.length > 0) {
    document.getElementById('deferredArchive').style.display = 'block';
    document.getElementById('archiveCount').textContent = `(${archived.length})`;
    document.getElementById('archiveList').innerHTML = archived.map(item => `<div class="archive-item"><a href="${item.url}" target="_blank" class="archive-item-title">${item.title}</a><span class="archive-item-date">${timeAgo(item.archived_at)}</span></div>`).join('');
  } else {
    document.getElementById('deferredArchive').style.display = 'none';
  }
}

async function renderStaticDashboard() {
  document.getElementById('greeting').textContent = getGreeting();
  document.getElementById('dateDisplay').textContent = getDateDisplay();

  await fetchOpenTabs();
  const realTabs = getRealTabs();

  const LANDING = ['mail.google.com', 'x.com', 'twitter.com', 'www.linkedin.com', 'github.com', 'www.youtube.com'];
  const groupMap = {};
  const landingTabs = [];

  for (const t of realTabs) {
    try {
      const u = new URL(t.url);
      if (LANDING.includes(u.hostname) && (u.pathname === '/' || u.pathname === '/home' || u.hostname === 'mail.google.com' && !u.hash.includes('/'))) {
        landingTabs.push(t);
      } else {
        const h = t.url.startsWith('file://') ? 'local-files' : u.hostname;
        if (!groupMap[h]) groupMap[h] = { domain: h, tabs: [] };
        groupMap[h].tabs.push(t);
      }
    } catch {}
  }

  domainGroups = Object.values(groupMap).sort((a, b) => b.tabs.length - a.tabs.length);
  if (landingTabs.length > 0) domainGroups.unshift({ domain: '__landing-pages__', tabs: landingTabs });

  const missionsEl = document.getElementById('openTabsMissions');
  const section = document.getElementById('openTabsSection');
  if (domainGroups.length > 0) {
    document.getElementById('openTabsSectionCount').innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &middot; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    const cards = await Promise.all(domainGroups.map(g => renderDomainCard(g)));
    missionsEl.innerHTML = cards.join('');
    section.style.display = 'block';
  } else {
    section.style.display = 'none';
  }

  document.getElementById('statTabs').textContent = openTabs.length;
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const dupeBanner = document.getElementById('tabOutDupeBanner');
  if (tabOutTabs.length > 1) {
    document.getElementById('tabOutDupeCount').textContent = tabOutTabs.length;
    dupeBanner.style.display = 'flex';
  } else {
    dupeBanner.style.display = 'none';
  }

  await renderDeferredColumn();
}

/* ----------------------------------------------------------------
   EVENT HANDLERS
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'close-tabout-dupes') {
    const extensionId = chrome.runtime.id;
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;
    const tabs = await chrome.tabs.query({});
    const toClose = tabs.filter(t => (t.url === newtabUrl || t.url === 'chrome://newtab/') && !t.active).map(t => t.id);
    if (toClose.length > 0) await chrome.tabs.remove(toClose);
    playCloseSound();
    await renderStaticDashboard();
    showToast('Closed extra Tab Out tabs');
  }

  if (action === 'focus-tab') focusSingleTab(el.dataset.tabUrl);

  if (action === 'close-single-tab') {
    e.stopPropagation();
    await closeTabsByUrls([el.dataset.tabUrl], true);
    playCloseSound();
    const chip = el.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.opacity = '0';
      setTimeout(() => {
        chip.remove();
        if (el.closest('.mission-pages').children.length === 0) animateCardOut(el.closest('.mission-card'));
      }, 200);
    }
  }

  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const { active, archived } = await getDeferred();
    active.unshift({ id: Date.now().toString(), url: el.dataset.tabUrl, title: el.dataset.tabTitle, deferred_at: new Date().toISOString() });
    await saveDeferred({ active, archived });
    await closeTabsByUrls([el.dataset.tabUrl], true);
    playCloseSound();
    await renderStaticDashboard();
    showToast('Saved for later');
  }

  if (action === 'check-deferred') {
    const { active, archived } = await getDeferred();
    const idx = active.findIndex(i => i.id === el.dataset.deferredId);
    if (idx !== -1) {
      const item = active.splice(idx, 1)[0];
      item.archived_at = new Date().toISOString();
      archived.unshift(item);
      await saveDeferred({ active, archived });
      const row = el.closest('.deferred-item');
      row.classList.add('checked');
      setTimeout(() => { row.classList.add('removing'); setTimeout(() => renderDeferredColumn(), 300); }, 800);
    }
  }

  if (action === 'dismiss-deferred') {
    const { active, archived } = await getDeferred();
    const idx = active.findIndex(i => i.id === el.dataset.deferredId);
    if (idx !== -1) {
      active.splice(idx, 1);
      await saveDeferred({ active, archived });
      el.closest('.deferred-item').classList.add('removing');
      setTimeout(() => renderDeferredColumn(), 300);
    }
  }

  if (action === 'close-domain-tabs') {
    const group = domainGroups.find(g => 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === el.dataset.domainId);
    if (group) {
      await closeTabsByUrls(group.tabs.map(t => t.url), group.domain === '__landing-pages__');
      playCloseSound();
      animateCardOut(el.closest('.mission-card'));
    }
  }

  if (action === 'dedup-keep-one') {
    const urls = (el.dataset.dupeUrls || '').split(',').map(decodeURIComponent).filter(Boolean);
    const allTabs = await chrome.tabs.query({});
    const toClose = [];
    for (const url of urls) {
      const matching = allTabs.filter(t => t.url === url);
      const keep = matching.find(t => t.active) || matching[0];
      matching.forEach(t => { if (t.id !== keep.id) toClose.push(t.id); });
    }
    if (toClose.length > 0) await chrome.tabs.remove(toClose);
    playCloseSound();
    await renderStaticDashboard();
    showToast('Closed duplicates');
  }

  if (action === 'close-all-open-tabs') {
    const urls = openTabs.filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:')).map(t => t.url);
    await closeTabsByUrls(urls);
    playCloseSound();
    document.querySelectorAll('.mission-card').forEach(c => animateCardOut(c));
    showToast('All tabs closed');
  }
});

document.addEventListener('click', e => {
  const toggle = e.target.closest('#archiveToggle');
  if (toggle) {
    toggle.classList.toggle('open');
    const body = document.getElementById('archiveBody');
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

renderStaticDashboard();
checkForUpdates();

async function checkForUpdates() {
  // Serverless version skips local update API.
  // Could check GitHub but keeping it local as per mandates.
}
