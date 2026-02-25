'use strict';

/* ── UTILS ── */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function postedLabel(d) { return d === 0 ? 'Today' : d === 1 ? '1 day ago' : `${d} days ago`; }

/* ── SAVED ── */
const SAVED_KEY = 'jnt_saved_v1';
function getSaved() { try { return new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]')); } catch (_) { return new Set(); } }
function setSaved(s) { localStorage.setItem(SAVED_KEY, JSON.stringify([...s])); }
function toggleSave(id) { const s = getSaved(); s.has(id) ? s.delete(id) : s.add(id); setSaved(s); }
function isSaved(id) { return getSaved().has(id); }

/* ── PREFS ── */
const PREFS_KEY = 'jobTrackerPreferences';
function getPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || null; } catch (_) { return null; } }
function savePrefs(p) { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); }

/* ── MATCH SCORE ENGINE ──
   +25 keyword in title
   +15 keyword in description
   +15 location matches
   +10 mode matches
   +10 experience matches
   +15 skill overlap (any)
   +5  posted <= 2 days
   +5  source == LinkedIn
   Cap: 100
*/
function computeMatchScore(job, prefs) {
    if (!prefs) return null;
    let score = 0;
    const kws = (prefs.roleKeywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const skills = (prefs.skills || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const locs = Array.isArray(prefs.preferredLocations) ? prefs.preferredLocations : [];
    const modes = Array.isArray(prefs.preferredMode) ? prefs.preferredMode : [];
    if (kws.length) {
        if (kws.some(k => job.title.toLowerCase().includes(k))) score += 25;
        if (kws.some(k => job.description.toLowerCase().includes(k))) score += 15;
    }
    if (locs.length && locs.includes(job.location)) score += 15;
    if (modes.length && modes.includes(job.mode)) score += 10;
    if (prefs.experienceLevel && job.experience === prefs.experienceLevel) score += 10;
    if (skills.length) {
        const jsl = job.skills.map(s => s.toLowerCase());
        if (skills.some(sk => jsl.some(js => js.includes(sk) || sk.includes(js)))) score += 15;
    }
    if (job.postedDaysAgo <= 2) score += 5;
    if (job.source === 'LinkedIn') score += 5;
    return Math.min(score, 100);
}

function scoreBadgeHTML(score) {
    if (score === null) return '';
    let cls = 'score--none';
    if (score >= 80) cls = 'score--high';
    else if (score >= 60) cls = 'score--mid';
    else if (score >= 40) cls = 'score--low';
    return `<span class="score-badge ${cls}" title="Match score">${score}%</span>`;
}

function salaryNum(s) { const m = s.replace(/[₹,]/g, '').match(/\d+/); return m ? parseInt(m[0]) : 0; }

/* ── FILTER STATE ── */
const F = { keyword: '', location: '', mode: '', experience: '', source: '', sort: 'latest', onlyMatches: false };

/* ── JOB CARD ── */
function jobCardHTML(j, prefs) {
    const score = computeMatchScore(j, prefs);
    const saved = isSaved(j.id);
    return `<article class="job-card" data-id="${j.id}">
    <div class="job-card__top">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <h3 class="job-card__title">${esc(j.title)}</h3>
          ${scoreBadgeHTML(score)}
        </div>
        <p class="job-card__company">${esc(j.company)}</p>
      </div>
      <span class="source-badge source-badge--${esc(j.source)}">${esc(j.source)}</span>
    </div>
    <p class="job-card__meta">${esc(j.location)} · ${esc(j.mode)} · ${esc(j.experience)}</p>
    <p class="job-card__salary">${esc(j.salaryRange)}</p>
    <div class="job-card__tags">${j.skills.slice(0, 3).map(sk => `<span class="job-card__tag">${esc(sk)}</span>`).join('')}</div>
    <div class="job-card__footer">
      <span class="job-card__posted">${postedLabel(j.postedDaysAgo)}</span>
      <div class="job-card__actions">
        <button class="ds-btn ds-btn--ghost ds-btn--sm" onclick="openModal(${j.id})">View</button>
        <button class="ds-btn ds-btn--secondary ds-btn--sm save-btn" data-id="${j.id}" onclick="handleSave(${j.id},this)">${saved ? 'Saved ✓' : 'Save'}</button>
        <a class="ds-btn ds-btn--primary ds-btn--sm" href="${esc(j.applyUrl)}" target="_blank" rel="noopener">Apply</a>
      </div>
    </div>
  </article>`;
}

/* ── FILTER + SORT ── */
function filterJobs(jobs, prefs) {
    let result = [...jobs];
    const kw = F.keyword.toLowerCase().trim();
    if (kw) result = result.filter(j => j.title.toLowerCase().includes(kw) || j.company.toLowerCase().includes(kw) || j.skills.some(s => s.toLowerCase().includes(kw)));
    if (F.location) result = result.filter(j => j.location === F.location || (F.location === 'Remote' && j.mode === 'Remote'));
    if (F.mode) result = result.filter(j => j.mode === F.mode);
    if (F.experience) result = result.filter(j => j.experience === F.experience);
    if (F.source) result = result.filter(j => j.source === F.source);
    if (F.onlyMatches && prefs) {
        const thresh = Number(prefs.minMatchScore) || 40;
        result = result.filter(j => (computeMatchScore(j, prefs) || 0) >= thresh);
    }
    if (F.sort === 'latest') result.sort((a, b) => a.postedDaysAgo - b.postedDaysAgo);
    else if (F.sort === 'oldest') result.sort((a, b) => b.postedDaysAgo - a.postedDaysAgo);
    else if (F.sort === 'score' && prefs) result.sort((a, b) => (computeMatchScore(b, prefs) || 0) - (computeMatchScore(a, prefs) || 0));
    else if (F.sort === 'salary') result.sort((a, b) => salaryNum(b.salaryRange) - salaryNum(a.salaryRange));
    return result;
}

/* ── RENDER DASHBOARD ── */
function renderDashboard() {
    const jobs = window.JOBS || [];
    const prefs = getPrefs();
    const locs = [...new Set(jobs.map(j => j.location))].sort();
    const outlet = document.getElementById('app-outlet');
    const noPrefs = prefs ? '' : '<div class="no-prefs-banner"><span class="no-prefs-banner__icon">✦</span><span>Set your preferences to activate intelligent matching.</span><a href="#/settings" class="ds-btn ds-btn--secondary ds-btn--sm">Go to Settings</a></div>';
    outlet.innerHTML = `<div class="page-wrap">
    <header class="page-header">
      <p class="page-header__eyebrow">Live Listings</p>
      <h1 class="page-header__heading">Dashboard</h1>
      <p class="page-header__sub">Browse ${jobs.length} curated roles for Indian tech professionals.</p>
    </header>
    ${noPrefs}
    <div class="filter-bar">
      <div class="filter-group filter-group--wide">
        <label class="filter-label" for="f-keyword">Search</label>
        <input class="filter-input" id="f-keyword" type="search" placeholder="Title, company or skill…" value="${esc(F.keyword)}" />
      </div>
      <div class="filter-group">
        <label class="filter-label" for="f-location">Location</label>
        <div class="filter-select-wrap"><select class="filter-input" id="f-location">
          <option value="">All</option>
          ${locs.map(l => `<option value="${esc(l)}"${F.location === l ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select></div>
      </div>
      <div class="filter-group">
        <label class="filter-label" for="f-mode">Mode</label>
        <div class="filter-select-wrap"><select class="filter-input" id="f-mode">
          <option value="">All</option>
          ${['Remote', 'Hybrid', 'Onsite'].map(m => `<option${F.mode === m ? ' selected' : ''}>${m}</option>`).join('')}
        </select></div>
      </div>
      <div class="filter-group">
        <label class="filter-label" for="f-exp">Experience</label>
        <div class="filter-select-wrap"><select class="filter-input" id="f-exp">
          <option value="">All</option>
          ${['Fresher', '0-1', '1-3', '3-5'].map(e => `<option value="${e}"${F.experience === e ? ' selected' : ''}>${e === 'Fresher' ? 'Fresher' : e + ' yrs'}</option>`).join('')}
        </select></div>
      </div>
      <div class="filter-group">
        <label class="filter-label" for="f-source">Source</label>
        <div class="filter-select-wrap"><select class="filter-input" id="f-source">
          <option value="">All</option>
          ${['LinkedIn', 'Naukri', 'Indeed'].map(s => `<option${F.source === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select></div>
      </div>
      <div class="filter-group">
        <label class="filter-label" for="f-sort">Sort</label>
        <div class="filter-select-wrap"><select class="filter-input" id="f-sort">
          <option value="latest"${F.sort === 'latest' ? ' selected' : ''}>Latest first</option>
          <option value="oldest"${F.sort === 'oldest' ? ' selected' : ''}>Oldest first</option>
          <option value="score"${F.sort === 'score' ? ' selected' : ''}>Match Score ↓</option>
          <option value="salary"${F.sort === 'salary' ? ' selected' : ''}>Salary (high–low)</option>
        </select></div>
      </div>
    </div>
    <div class="match-toggle-bar">
      <label class="match-toggle-label">
        <input type="checkbox" id="only-matches" ${F.onlyMatches ? 'checked' : ''} />
        <span class="match-toggle-track"><span class="match-toggle-thumb"></span></span>
        Show only jobs above my threshold${prefs ? ` (${prefs.minMatchScore || 40}% min)` : ''}
      </label>
      ${!prefs ? '<span style="font-size:var(--text-xs);color:var(--color-text-secondary);">Requires saved preferences</span>' : ''}
    </div>
    <div id="job-results"></div>
  </div>`;
    document.getElementById('only-matches').addEventListener('change', e => { F.onlyMatches = e.target.checked; renderJobResults(); });
    bindFilters();
    renderJobResults();
}

function renderJobResults() {
    const prefs = getPrefs();
    const filtered = filterJobs(window.JOBS || [], prefs);
    const container = document.getElementById('job-results');
    if (!container) return;
    if (!filtered.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state__ring" aria-hidden="true"><div class="empty-state__ring-inner"></div></div><h2 class="empty-state__heading">No roles match your criteria.</h2><p class="empty-state__sub">Adjust filters, clear search, or lower your threshold.</p><button class="ds-btn ds-btn--secondary" style="margin-top:var(--space-2);" onclick="clearFilters()">Clear Filters</button></div>`;
        return;
    }
    container.innerHTML = `<p class="job-count">${filtered.length} role${filtered.length !== 1 ? 's' : ''} found</p><div class="job-grid">${filtered.map(j => jobCardHTML(j, prefs)).join('')}</div>`;
}

function bindFilters() {
    const b = (id, key) => { const el = document.getElementById(id); if (!el) return; el.addEventListener('input', () => { F[key] = el.value; renderJobResults(); }); };
    b('f-keyword', 'keyword'); b('f-location', 'location'); b('f-mode', 'mode'); b('f-exp', 'experience'); b('f-source', 'source'); b('f-sort', 'sort');
}

function clearFilters() { Object.assign(F, { keyword: '', location: '', mode: '', experience: '', source: '', sort: 'latest', onlyMatches: false }); renderDashboard(); }

/* ── RENDER SAVED ── */
function renderSaved() {
    const saved = getSaved(); const prefs = getPrefs();
    const jobs = (window.JOBS || []).filter(j => saved.has(j.id));
    const outlet = document.getElementById('app-outlet');
    if (!jobs.length) {
        outlet.innerHTML = `<div class="empty-state"><div class="empty-state__ring" aria-hidden="true"><div class="empty-state__ring-inner"></div></div><p class="ds-eyebrow">Saved Roles</p><h1 class="empty-state__heading">Your shortlist lives here.</h1><p class="empty-state__sub">Roles you bookmark from the dashboard will appear here.</p><a href="#/dashboard" class="ds-btn ds-btn--secondary" style="margin-top:var(--space-2);">Browse Dashboard</a></div>`;
        return;
    }
    outlet.innerHTML = `<div class="page-wrap"><header class="page-header"><p class="page-header__eyebrow">Saved Roles</p><h1 class="page-header__heading">Your Shortlist</h1><p class="page-header__sub">${jobs.length} role${jobs.length !== 1 ? 's' : ''} saved.</p></header><div class="job-grid">${jobs.map(j => jobCardHTML(j, prefs)).join('')}</div></div>`;
}

/* ── MODAL ── */
function openModal(id) {
    const j = (window.JOBS || []).find(x => x.id === id); if (!j) return;
    const prefs = getPrefs(); const score = computeMatchScore(j, prefs);
    document.getElementById('modal-title').textContent = j.title;
    document.getElementById('modal-company').textContent = j.company;
    document.getElementById('modal-meta').innerHTML = [
        `<span class="modal__meta-item"><strong>${j.location}</strong></span>`,
        `<span class="modal__meta-item">· ${j.mode}</span>`,
        `<span class="modal__meta-item">· ${j.experience === 'Fresher' ? 'Fresher' : j.experience + ' yrs'}</span>`,
        `<span class="modal__meta-item">· <strong>${j.salaryRange}</strong></span>`,
        `<span class="modal__meta-item">· ${postedLabel(j.postedDaysAgo)}</span>`,
        score !== null ? `<span class="modal__meta-item" style="margin-left:auto;">${scoreBadgeHTML(score)}</span>` : '',
        `<span class="modal__meta-item" style="margin-left:${score !== null ? '4px' : 'auto'};"><span class="source-badge source-badge--${esc(j.source)}">${esc(j.source)}</span></span>`
    ].join('');
    document.getElementById('modal-desc').textContent = j.description;
    document.getElementById('modal-skills').innerHTML = j.skills.map(s => `<span class="job-card__tag">${esc(s)}</span>`).join('');
    document.getElementById('modal-apply-btn').href = j.applyUrl;
    const sb = document.getElementById('modal-save-btn');
    sb.textContent = isSaved(id) ? 'Saved ✓' : 'Save Role';
    sb.onclick = () => { toggleSave(id); sb.textContent = isSaved(id) ? 'Saved ✓' : 'Save Role'; syncSaveBtns(id); };
    document.getElementById('job-modal').classList.add('is-open');
    document.body.style.overflow = 'hidden';
}

function closeModal() { document.getElementById('job-modal').classList.remove('is-open'); document.body.style.overflow = ''; }
function handleSave(id, btn) { toggleSave(id); btn.textContent = isSaved(id) ? 'Saved ✓' : 'Save'; syncSaveBtns(id); }
function syncSaveBtns(id) { document.querySelectorAll(`.save-btn[data-id="${id}"]`).forEach(b => b.textContent = isSaved(id) ? 'Saved ✓' : 'Save'); }

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('job-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeMobileDrawer(); } });

/* ── SETTINGS ── */
function bindSettingsUI() {
    const form = document.getElementById('settings-form');
    if (!form) return;
    const prefs = getPrefs();
    if (prefs) {
        const kw = form.querySelector('#pref-keywords'); if (kw) kw.value = prefs.roleKeywords || '';
        const sk = form.querySelector('#pref-skills'); if (sk) sk.value = prefs.skills || '';
        const ex = form.querySelector('#pref-exp'); if (ex) ex.value = prefs.experienceLevel || '';
        const sl = form.querySelector('#pref-score');
        const sv = form.querySelector('#score-val');
        if (sl) { sl.value = prefs.minMatchScore || 40; if (sv) sv.textContent = (prefs.minMatchScore || 40) + '%'; }
        const lm = form.querySelector('#pref-locations');
        if (lm && prefs.preferredLocations) { [...lm.options].forEach(o => { o.selected = prefs.preferredLocations.includes(o.value); }); }
        const cbs = form.querySelectorAll('.mode-cb');
        cbs.forEach(cb => { const modes = prefs.preferredMode || []; cb.checked = modes.includes(cb.value); });
    }
    const sl = form.querySelector('#pref-score'); const sv = form.querySelector('#score-val');
    if (sl && sv) { sl.addEventListener('input', () => sv.textContent = sl.value + '%'); }
    form.addEventListener('submit', e => {
        e.preventDefault();
        const data = new FormData(form);
        const lm = form.querySelector('#pref-locations');
        const selectedLocs = lm ? [...lm.selectedOptions].map(o => o.value) : [];
        const selectedModes = [...form.querySelectorAll('.mode-cb:checked')].map(c => c.value);
        const p = {
            roleKeywords: data.get('roleKeywords') || '',
            preferredLocations: selectedLocs,
            preferredMode: selectedModes,
            experienceLevel: data.get('experienceLevel') || '',
            skills: data.get('skills') || '',
            minMatchScore: parseInt(data.get('minMatchScore')) || 40
        };
        savePrefs(p);
        const msg = form.querySelector('#save-msg');
        if (msg) { msg.textContent = 'Preferences saved ✓'; msg.style.color = 'var(--color-success)'; setTimeout(() => msg.textContent = '', 2500); }
    });
}

/* ── ROUTER ── */
const ROUTES = { '': { tpl: 'tpl-home', title: 'Home' }, 'digest': { tpl: 'tpl-digest', title: 'Digest' }, 'settings': { tpl: 'tpl-settings', title: 'Settings' }, 'proof': { tpl: 'tpl-proof', title: 'Proof' } };

function getSegment() { return (window.location.hash || '').replace(/^#\/?/, '').split('/')[0].toLowerCase().trim(); }

function navigate() {
    const seg = getSegment(); const outlet = document.getElementById('app-outlet');
    if (seg === 'dashboard') { renderDashboard(); document.title = 'Dashboard — Job Notification Tracker'; }
    else if (seg === 'saved') { renderSaved(); document.title = 'Saved — Job Notification Tracker'; }
    else {
        const route = ROUTES[seg];
        if (route) {
            const tpl = document.getElementById(route.tpl);
            outlet.innerHTML = ''; if (tpl) outlet.appendChild(tpl.content.cloneNode(true));
            document.title = `${route.title} — Job Notification Tracker`;
            bindSettingsUI();
        } else {
            outlet.innerHTML = `<div class="notfound"><p class="notfound__code" aria-hidden="true">404</p><h1 class="notfound__heading">Page Not Found</h1><p class="notfound__sub">This page does not exist.</p><a href="#/" class="ds-btn ds-btn--primary">Go Home</a></div>`;
            document.title = 'Not Found — Job Notification Tracker';
        }
    }
    syncNav(seg); closeMobileDrawer(); window.scrollTo({ top: 0, behavior: 'instant' });
}

function syncNav(seg) { document.querySelectorAll('[data-route]').forEach(l => { const m = l.dataset.route === seg; l.classList.toggle('is-active', m); l.setAttribute('aria-current', m ? 'page' : 'false'); }); }

/* ── HAMBURGER ── */
const hamburger = document.getElementById('hamburger-btn');
const drawer = document.getElementById('mobile-drawer');
function closeMobileDrawer() { drawer.classList.remove('is-open'); hamburger.setAttribute('aria-expanded', 'false'); }
hamburger.addEventListener('click', () => { const open = drawer.classList.contains('is-open'); open ? closeMobileDrawer() : (drawer.classList.add('is-open'), hamburger.setAttribute('aria-expanded', 'true')); });
document.addEventListener('click', e => { if (!e.target.closest('.app-nav')) closeMobileDrawer(); });

/* ── BOOT ── */
window.addEventListener('hashchange', navigate);
if (!window.location.hash || window.location.hash === '#') { window.location.replace('#/'); } else { navigate(); }
