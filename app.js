/* ARAFURA Rapoarte — aplicatia JS (v2: paginare server-side + RPC-uri pentru totaluri)
   Depinde de: window.supabase (CDN) si window.ARAFURA_CONFIG (config.js).
*/

'use strict';

// ============================================================================
// CONSTANTE
// ============================================================================

const GESTIUNI = [
  { cod: '3',  nume: 'Tomis 3',            nume_full: 'Magazin Tomis 3',       tip: 'magazin' },
  { cod: '12', nume: 'Marvimex',           nume_full: 'Magazin Marvimex',      tip: 'magazin' },
  { cod: '16', nume: 'Medgidia',           nume_full: 'Magazin Medgidia',      tip: 'magazin' },
  { cod: '21', nume: 'Poarta 6',           nume_full: 'Magazin Poarta 6',      tip: 'magazin' },
  { cod: '32', nume: 'Babadag',            nume_full: 'Magazin Babadag',       tip: 'magazin' },
  { cod: '64', nume: 'Năvodari',           nume_full: 'Magazin Năvodari',      tip: 'magazin' },
  { cod: '10', nume: 'Depozit IT',         nume_full: 'Depozit Produse IT',    tip: 'depozit' },
  { cod: '40', nume: 'Showroom',           nume_full: 'Showroom',              tip: 'depozit' },
  { cod: '70', nume: 'Depozit Papetărie',  nume_full: 'Depozit Papetărie',     tip: 'depozit' },
];

const GEST_MAP = Object.fromEntries(GESTIUNI.map(g => [g.cod, g]));

const STARE_DISPLAY = {
  'lipsa':                          'Lipsă',
  'pe terminate':                   'Pe terminate',
  'stoc negativ – de verificat':    'Stoc negativ – de verificat',
};

const STARE_CLASA = {
  'lipsa':                          'lipsa',
  'pe terminate':                   'termin',
  'stoc negativ – de verificat':    'negativ',
};

const GRUPE = {
  '10': 'Produse IT',
  '20': 'Papetărie',
  '25': 'Cartele',
  '30': 'Carte',
  '45': 'Curăţenie',
  '50': 'Jucării',
};

const PAGINI = [
  { cod: 'pe-scurt',          titlu: 'Pe scurt' },
  { cod: 'lipsuri',           titlu: 'Lipsuri' },
  { cod: 'stagneaza',         titlu: 'Marfă care stagnează' },
  { cod: 'stocuri-negative',  titlu: 'Stocuri negative' },
  { cod: 'retururi',          titlu: 'Retururi spre depozit' },
  { cod: 'stoc',              titlu: 'Stoc' },
  { cod: 'activitate',        titlu: 'Activitate', doarAdmin: true },
];

const PAG_SIZE = 200;              // cate randuri pe pagina
const DL_BATCH = 1000;             // batch pentru download in bucla

// ============================================================================
// FORMATARE
// ============================================================================

const nfBani = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfInt  = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 });
const nfProc = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmtBani(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  return nfBani.format(Number(n)) + ' lei';
}
function fmtInt(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  return nfInt.format(Number(n));
}
function fmtNr(n, zecimale) {
  // numere intregi fara zecimale (5, nu 5,00)
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  return new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: zecimale ?? 2,
  }).format(Number(n));
}
function fmtProc(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  return nfProc.format(Number(n) * 100) + '%';
}
function fmtData(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const zz = String(date.getDate()).padStart(2, '0');
  const ll = String(date.getMonth() + 1).padStart(2, '0');
  return `${zz}.${ll}.${date.getFullYear()}`;
}
function fmtDataOra(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return fmtData(d) + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
function gestiuneNume(cod) { return GEST_MAP[cod]?.nume || cod; }
function gestiuneNumeFull(cod) { return GEST_MAP[cod]?.nume_full || cod; }
function esteMagazin(cod) { return GEST_MAP[cod]?.tip === 'magazin'; }

// PAS 5 A: eticheta mica „cu TVA" / „fără TVA" (sub capul de coloană sau sub o cifră mare).
function etichetaTva(cuTva) {
  return `<small class="eticheta-tva">${cuTva ? 'cu TVA' : 'fără TVA'}</small>`;
}
// Capul de coloană în două rânduri: titlu + mică linie cu TVA. Folosit cu `thSortHtml`.
function capTva(titlu, cuTva) {
  return escapeHtml(titlu) + '<br>' + etichetaTva(cuTva);
}
function capTvaMix(titlu) {
  // „cu TVA la magazine / fără TVA la depozite"
  return escapeHtml(titlu) + '<br><small class="eticheta-tva">cu/fără TVA</small>';
}
// PAS 5 A: preţ de raft pentru un rând din ar_pozitii — depinde de tipul gestiunii.
function pretVzHtml(r) {
  const val = esteMagazin(r.cod_depozit) ? r.pret_lista : r.pret_lista_fara_tva;
  return val ? fmtBani(val) : '';
}
function pretVzVal(r) {
  // pentru CSV (număr simplu, fără TVA suffix)
  return esteMagazin(r.cod_depozit) ? r.pret_lista : r.pret_lista_fara_tva;
}
function stareBadge(stare) {
  if (!stare) return '';
  const cls = STARE_CLASA[stare] || '';
  const txt = STARE_DISPLAY[stare] || stare;
  return `<span class="badge ${cls}">${escapeHtml(txt)}</span>`;
}

function titluPagina(cod) {
  // Alias istoric: pagina „Căutare produse" s-a redenumit „Stoc" (PAS 4).
  if (cod === 'cautare') return 'Stoc';
  const p = PAGINI.find(x => x.cod === cod);
  return p ? p.titlu : (cod || 'pagină');
}

function descriereActivitate(ev) {
  const act = ev.actiune;
  const pag = ev.pagina ? titluPagina(ev.pagina) : '';
  const det = ev.detalii || {};
  if (act === 'login') return 'a intrat';
  if (act === 'view' && pag) return 'a deschis „' + pag + '"';
  if (act === 'descarca') {
    const fis = det.fisier || 'lista';
    return 'a descărcat „' + fis + '"';
  }
  if (act === 'cautare' || det.q) return 'a căutat: ' + (det.q || '');
  return act + (pag ? ' („' + pag + '")' : '');
}

// ============================================================================
// STARE GLOBALA
// ============================================================================

const stare = {
  client: null,
  utilizator: null,
  stareDatelor: null,
};

// ============================================================================
// SUPABASE
// ============================================================================

function initClient() {
  const cfg = window.ARAFURA_CONFIG;
  if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY
      || cfg.SUPABASE_URL.includes('TODO') || cfg.SUPABASE_ANON_KEY.includes('TODO')) {
    document.body.innerHTML = '<div class="ecran-auth"><div class="card-login"><h1>Config lipsă</h1>' +
      '<p>Copiază <code>config.example.js</code> în <code>config.js</code> şi completează cheile din Supabase Studio.</p></div></div>';
    throw new Error('Config lipsa');
  }
  stare.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
}

async function sessionCheck() {
  const { data: { session } } = await stare.client.auth.getSession();
  return session;
}

async function incarcaUtilizator() {
  const session = await sessionCheck();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  const { data } = await stare.client.from('ar_utilizatori').select('*').eq('email', email).maybeSingle();
  return data;
}

async function logActivitate(pagina, actiune, detalii) {
  if (!stare.utilizator) return;
  try {
    await stare.client.from('ar_activitate').insert({
      email: stare.utilizator.email,
      pagina,
      actiune,
      detalii: detalii || null,
    });
  } catch (e) { /* non-fatal */ }
}

// ============================================================================
// AUTH / INTRARE
// ============================================================================

function afisLogin() {
  document.getElementById('ecran-auth').style.display = '';
  document.getElementById('aplicatie').style.display = 'none';
  document.getElementById('login-email').focus();
}

async function dupaLogin() {
  stare.utilizator = await incarcaUtilizator();
  if (!stare.utilizator) {
    const sess = await sessionCheck();
    const email = sess?.user?.email || '';
    document.getElementById('ecran-auth').style.display = 'none';
    document.getElementById('aplicatie').style.display = '';
    document.getElementById('continut').innerHTML =
      '<div class="mesaj danger">Nu ai acces. Vorbeşte cu Eugen.' +
      (email ? '<br><small>Autentificat ca ' + escapeHtml(email) + '</small>' : '') + '</div>';
    document.getElementById('meniu').innerHTML = '';
    return;
  }

  await incarcaStareDatelor();
  construiesteMeniu();
  document.getElementById('ecran-auth').style.display = 'none';
  document.getElementById('aplicatie').style.display = '';
  document.getElementById('user-nume').textContent = stare.utilizator.nume;
  await logActivitate(null, 'login');
  routeaza();
}

async function incarcaStareDatelor() {
  const { data } = await stare.client.from('ar_stare').select('*').eq('k', 1).maybeSingle();
  stare.stareDatelor = data;
}

function construiesteMeniu() {
  const meniu = document.getElementById('meniu');
  meniu.innerHTML = '';
  for (const p of PAGINI) {
    if (p.doarAdmin && stare.utilizator?.rol !== 'admin') continue;
    const a = document.createElement('a');
    a.href = '#/' + p.cod;
    a.textContent = p.titlu;
    a.dataset.cod = p.cod;
    meniu.appendChild(a);
  }
}

function marcheazaMeniu(cod) {
  document.querySelectorAll('#meniu a').forEach(a => {
    a.classList.toggle('activ', a.dataset.cod === cod);
  });
}

// ============================================================================
// ROUTING
// ============================================================================

async function routeaza() {
  const h = location.hash || '#/pe-scurt';
  const fara = h.replace(/^#\//, '');
  const [rutaBruta, qs] = fara.split('?');
  let [ruta, param] = rutaBruta.split('/');
  // Alias istoric: #/cautare → #/stoc (PAS 4). Pastreaza parametrii.
  if (ruta === 'cautare') {
    location.replace('#/stoc' + (qs ? '?' + qs : ''));
    return;
  }
  const filtre = Object.fromEntries(new URLSearchParams(qs || ''));
  marcheazaMeniu(ruta);
  document.getElementById('filtre-bar').style.display = 'none';
  document.getElementById('continut').innerHTML = '<div class="incarca">Se încarcă…</div>';

  await logActivitate(ruta, 'view', filtre);

  try {
    switch (ruta) {
      case 'pe-scurt':         return await pagPeScurt();
      case 'lipsuri':          return await pagLipsuri(filtre);
      case 'stagneaza':        return await pagStagneaza(filtre);
      case 'stocuri-negative': return await pagStocuriNegative(filtre);
      case 'retururi':         return await pagRetururi(filtre);
      case 'stoc':             return await pagStoc(filtre);
      case 'fisa':             return await pagFisa(param, filtre);
      case 'activitate':       return await pagActivitate(filtre);
      default:                 return await pagPeScurt();
    }
  } catch (e) {
    console.error(e);
    document.getElementById('continut').innerHTML = '<div class="mesaj danger">Eroare la încărcarea paginii:<br>' + escapeHtml(e.message || String(e)) + '</div>';
  }
}

window.addEventListener('hashchange', routeaza);

// ============================================================================
// FILTRE COMUNE
// ============================================================================

function construiesteFiltreHTML(filtre, optiuni, listeExtra) {
  const partsHtml = [];
  if (optiuni.perioada) {
    const val = filtre.p || '8';
    partsHtml.push(`<label>Perioadă<select name="p">
      <option value="8" ${val==='8'?'selected':''}>Ultimele 8 săpt.</option>
      <option value="4" ${val==='4'?'selected':''}>Ultimele 4 săpt.</option>
      <option value="2" ${val==='2'?'selected':''}>Ultimele 2 săpt.</option>
      <option value="1" ${val==='1'?'selected':''}>Ultima săpt.</option>
    </select></label>`);
  }
  if (optiuni.gestiune) {
    const val = filtre.g || '';
    const opt_gest = GESTIUNI.filter(g => optiuni.gestiune === 'all' || g.tip === optiuni.gestiune);
    partsHtml.push(`<label>${optiuni.gestiune==='magazin'?'Magazin':'Gestiune'}<select name="g">
      <option value="">— toate —</option>
      ${opt_gest.map(g => `<option value="${g.cod}" ${val===g.cod?'selected':''}>${escapeHtml(g.nume)}</option>`).join('')}
    </select></label>`);
  }
  if (optiuni.furnizor && (listeExtra?.furnizori?.length)) {
    const val = filtre.f || '';
    const opts = listeExtra.furnizori.map(f => `<option value="${escapeHtml(f)}" ${val===f?'selected':''}>${escapeHtml(f)}</option>`).join('');
    const extra = optiuni.extraFurnizor
      ? `<option value="(fără furnizor)" ${val==='(fără furnizor)'?'selected':''}>(fără furnizor)</option>`
      : '';
    partsHtml.push(`<label>Furnizor<select name="f">
      <option value="">— toţi —</option>
      ${opts}${extra}
    </select></label>`);
  }
  if (optiuni.familie && (listeExtra?.familii?.length)) {
    const val = filtre.fam || '';
    // PAS 4: familii poate fi array de string-uri (cod) sau array de {cod, nume}.
    //        Se afiseaza „cod – nume" cand nume e prezent.
    const opts = listeExtra.familii.map(f => {
      const cod  = (typeof f === 'object') ? f.cod  : f;
      const nume = (typeof f === 'object') ? (f.nume || '') : '';
      const label = cod + (nume ? ' – ' + nume : '');
      return `<option value="${escapeHtml(cod)}" ${val===cod?'selected':''}>${escapeHtml(label)}</option>`;
    }).join('');
    partsHtml.push(`<label>Familie<select name="fam">
      <option value="">— toate —</option>
      ${opts}
    </select></label>`);
  }
  if (optiuni.grupa) {
    const val = filtre.gr || '';
    const extra = optiuni.extraGrupa
      ? `<option value="(none)" ${val==='(none)'?'selected':''}>(fără grupă)</option>`
      : '';
    partsHtml.push(`<label>Grupă<select name="gr">
      <option value="">— toate —</option>
      ${Object.entries(GRUPE).map(([k,v]) => `<option value="${k}" ${val===k?'selected':''}>${escapeHtml(v)}</option>`).join('')}
      ${extra}
    </select></label>`);
  }
  if (optiuni.stoc && optiuni.stoc.length > 0) {
    const val = filtre.st || (optiuni.stocDefault || 'in');
    const opts = optiuni.stoc.map(v => `<option value="${v.val}" ${val===v.val?'selected':''}>${escapeHtml(v.txt)}</option>`).join('');
    partsHtml.push(`<label>Stoc<select name="st">${opts}</select></label>`);
  }
  if (optiuni.mod && optiuni.mod.length > 0) {
    const val = filtre.mod || (optiuni.modDefault || 'pe-gestiuni');
    const opts = optiuni.mod.map(v => `<option value="${v.val}" ${val===v.val?'selected':''}>${escapeHtml(v.txt)}</option>`).join('');
    partsHtml.push(`<label>Afişare<select name="mod">${opts}</select></label>`);
  }
  if (optiuni.cautare) {
    const val = filtre.q || '';
    partsHtml.push(`<label>Cod intern / cod de bare / denumire<input name="q" value="${escapeHtml(val)}" placeholder="caută…"></label>`);
  }
  if (optiuni.vedere && optiuni.vedere.length > 0) {
    const val = filtre.v || (optiuni.vedereDefault || '');
    const opts = optiuni.vedere.map(v => `<option value="${v.val}" ${val===v.val?'selected':''}>${escapeHtml(v.txt)}</option>`).join('');
    partsHtml.push(`<label>Vedere<select name="v">${opts}</select></label>`);
  }
  if (optiuni.sursa && optiuni.sursa.length > 0) {
    const val = filtre.s || '';
    const opts = optiuni.sursa.map(v => `<option value="${escapeHtml(v.val)}" ${val===v.val?'selected':''}>${escapeHtml(v.txt)}</option>`).join('');
    partsHtml.push(`<label>De unde se aduce<select name="s">${opts}</select></label>`);
  }
  partsHtml.push('<div class="separator"></div>');
  if (optiuni.descarca) {
    partsHtml.push('<button type="button" class="btn-descarca" id="btn-descarca">Descarcă lista</button>');
  }
  const bar = document.getElementById('filtre-bar');
  bar.style.display = '';
  bar.innerHTML = partsHtml.join('');

  bar.querySelectorAll('select, input').forEach(el => {
    const ev = el.tagName === 'INPUT' ? 'change' : 'change';
    el.addEventListener(ev, () => {
      const f = {};
      bar.querySelectorAll('select, input').forEach(x => { if (x.value) f[x.name] = x.value; });
      const ruta = location.hash.replace(/^#\//,'').split('?')[0];
      location.hash = '#/' + ruta + '?' + new URLSearchParams(f).toString();
    });
  });
}

// ============================================================================
// PAGINARE / COUNT (PostgREST: range + Prefer: count=exact)
// ============================================================================

function aplicaFiltreQuery(builder) {
  // utility — folosit de constructorul de query in fiecare pagina
  return builder;
}

async function fetchPagina(constrQuery, pag) {
  // constrQuery = functie care intoarce un query builder NOU la fiecare apel
  // pag = numarul paginii (1-based)
  const from = (pag - 1) * PAG_SIZE;
  const to   = from + PAG_SIZE - 1;
  const q = constrQuery().range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return { randuri: data || [], total: count || 0, from: from + 1, to: Math.min(to + 1, count || 0) };
}

async function fetchTot(constrQuery, totalEstimat) {
  // bucla pentru download: aduce toate randurile
  const randuri = [];
  let offset = 0;
  while (true) {
    const q = constrQuery().range(offset, offset + DL_BATCH - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    randuri.push(...data);
    if (data.length < DL_BATCH) break;
    offset += DL_BATCH;
    if (totalEstimat && offset >= totalEstimat) break;
  }
  return randuri;
}

function renderPaginareHTML(from, to, total, pag) {
  const totalPag = Math.max(1, Math.ceil(total / PAG_SIZE));
  return `<div class="paginare">
    <span class="info">${total > 0 ? `${fmtInt(from)}–${fmtInt(to)} din ${fmtInt(total)}` : 'niciun rând'}</span>
    <div class="butoane">
      <button type="button" class="btn-mic" ${pag <= 1 ? 'disabled' : ''} data-pag="${pag-1}">← Înapoi</button>
      <span class="info">Pagina ${pag}/${totalPag}</span>
      <button type="button" class="btn-mic" ${pag >= totalPag ? 'disabled' : ''} data-pag="${pag+1}">Înainte →</button>
    </div>
  </div>`;
}

function activeazaPaginare() {
  document.querySelectorAll('.paginare button[data-pag]').forEach(b => {
    b.addEventListener('click', () => {
      const ruta = location.hash.replace(/^#\//,'').split('?')[0];
      const qs = new URLSearchParams(location.hash.split('?')[1] || '');
      qs.set('pag', b.dataset.pag);
      location.hash = '#/' + ruta + '?' + qs.toString();
    });
  });
}

// Helper pentru header sortabil
function thSort(col, label, cls, filtre, implicit) {
  // filtre.sort + filtre.dir vin din URL
  const curentCol = filtre.sort || implicit?.col || '';
  const curentDir = filtre.dir  || implicit?.dir || 'desc';
  const activ = curentCol === col;
  const sageata = activ ? (curentDir === 'asc' ? '▲' : '▼') : '⇅';
  return `<th class="${cls||''} sortabil ${activ?'activ':''}" data-sort="${col}">${escapeHtml(label)} <span class="sage">${sageata}</span></th>`;
}
// Variantă cu label HTML (pt. cap pe două rânduri: titlu + „cu/fără TVA").
function thSortHtml(col, labelHtml, cls, filtre, implicit) {
  const curentCol = filtre.sort || implicit?.col || '';
  const curentDir = filtre.dir  || implicit?.dir || 'desc';
  const activ = curentCol === col;
  const sageata = activ ? (curentDir === 'asc' ? '▲' : '▼') : '⇅';
  return `<th class="${cls||''} sortabil ${activ?'activ':''}" data-sort="${col}">${labelHtml} <span class="sage">${sageata}</span></th>`;
}

// PAS 5 B.3: sortare client pe tabele sumar, fără hash.
// Convenţie:
//   - <table class="sort-client">
//   - <th class="sort-sk" data-sk-type="nr|text">...</th>
//   - <td data-sv="valoare brută pentru sort">afișat</td> (dacă lipseşte data-sv, se foloseşte textContent)
//   - <tfoot> NU se mută la sort (rândul de total rămâne jos).
function initSortClient(container) {
  const root = container || document;
  root.querySelectorAll('table.sort-client').forEach(tbl => {
    if (tbl.dataset.sortInit === '1') return;
    tbl.dataset.sortInit = '1';
    const headerCells = [...tbl.querySelectorAll('thead th')];
    headerCells.forEach((th, idx) => {
      if (!th.classList.contains('sort-sk')) return;
      th.classList.add('sortabil');
      if (!th.querySelector('.sage')) th.insertAdjacentHTML('beforeend', ' <span class="sage">⇅</span>');
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const prev = th.dataset.skDir || '';
        const newDir = prev === 'asc' ? 'desc' : 'asc';
        headerCells.forEach(h => {
          if (!h.classList.contains('sort-sk')) return;
          h.dataset.skDir = '';
          h.classList.remove('activ');
          const s = h.querySelector('.sage'); if (s) s.textContent = '⇅';
        });
        th.dataset.skDir = newDir;
        th.classList.add('activ');
        const s = th.querySelector('.sage'); if (s) s.textContent = newDir === 'asc' ? '▲' : '▼';
        const type = th.dataset.skType || 'text';
        const tbody = tbl.querySelector('tbody'); if (!tbody) return;
        const rows = [...tbody.querySelectorAll(':scope > tr')];
        rows.sort((a, b) => {
          const ca = a.children[idx], cb = b.children[idx];
          const va = ca?.dataset.sv ?? ca?.textContent ?? '';
          const vb = cb?.dataset.sv ?? cb?.textContent ?? '';
          if (type === 'nr') {
            const na = Number(va) || 0, nb = Number(vb) || 0;
            return newDir === 'asc' ? na - nb : nb - na;
          }
          return newDir === 'asc'
            ? String(va).localeCompare(String(vb), 'ro')
            : String(vb).localeCompare(String(va), 'ro');
        });
        rows.forEach(r => tbody.appendChild(r));
      });
    });
  });
}
function activeazaSortare(filtre, implicit) {
  document.querySelectorAll('th.sortabil[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      const curentCol = filtre.sort || implicit?.col || '';
      const curentDir = filtre.dir  || implicit?.dir || 'desc';
      let newDir;
      if (curentCol === col) {
        newDir = curentDir === 'asc' ? 'desc' : 'asc';
      } else {
        newDir = 'asc';
      }
      const ruta = location.hash.replace(/^#\//,'').split('?')[0];
      const qs = new URLSearchParams(location.hash.split('?')[1] || '');
      qs.set('sort', col);
      qs.set('dir', newDir);
      qs.delete('pag');  // revine la pag 1
      location.hash = '#/' + ruta + '?' + qs.toString();
    });
  });
}
function aplicaSortare(q, filtre, implicit) {
  const col = filtre.sort || implicit?.col;
  const dir = filtre.dir  || implicit?.dir || 'desc';
  if (col) return q.order(col, { ascending: dir === 'asc' });
  return q;
}

// ============================================================================
// EXPORT CSV
// ============================================================================

function descarcaCsv(nume, coloane, randuri) {
  const lines = [];
  lines.push(coloane.map(c => '"' + String(c.titlu).replaceAll('"','""') + '"').join(';'));
  for (const r of randuri) {
    const cells = coloane.map(c => {
      const val = typeof c.val === 'function' ? c.val(r) : r[c.val];
      if (val === null || val === undefined) return '';
      if (typeof val === 'number') return String(val).replace('.', ',');
      return '"' + String(val).replaceAll('"','""') + '"';
    });
    lines.push(cells.join(';'));
  }
  const bom = '﻿';
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nume + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  logActivitate(location.hash, 'descarca', { fisier: nume + '.csv', randuri: randuri.length });
}

async function descarcaCuBucla(nume, coloane, constrQuery, total) {
  // afis temporar: butonul devine „se descarcă…"
  const btn = document.getElementById('btn-descarca');
  const txtInitial = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Se descarcă…'; }
  try {
    const randuri = await fetchTot(constrQuery, total);
    descarcaCsv(nume, coloane, randuri);
  } catch (e) {
    alert('Eroare la descărcare: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = txtInitial; }
  }
}

// ============================================================================
// PAGINA 1 — PE SCURT (RPC-uri, fara calcul in browser)
// ============================================================================

async function pagPeScurt() {
  // Timing fiecare RPC in paralel (pentru masurare in consola)
  const rpcTimed = async (nume, params) => {
    const t0 = performance.now();
    const r = await (params ? stare.client.rpc(nume, params) : stare.client.rpc(nume));
    const dt = Math.round(performance.now() - t0);
    console.log(`[rpc] ${nume}: ${dt}ms`, r.error ? `EROARE: ${r.error.message || JSON.stringify(r.error)}` : `${(r.data?.length ?? (r.data ? 1 : 0))} rânduri`);
    return { ...r, dt, nume };
  };

  const tTotal = performance.now();
  const [sumar, peGest, peFurn, vzMag] = await Promise.all([
    rpcTimed('ar_sumar'),
    rpcTimed('ar_sumar_pe_gestiuni'),
    rpcTimed('ar_sumar_pe_furnizori', { lim: 10 }),
    rpcTimed('ar_vanzari_mag_sapt'),
  ]);
  const dtTotal = Math.round(performance.now() - tTotal);
  console.log(`[rpc] TOTAL „Pe scurt": ${dtTotal}ms`);

  if (sumar.error) throw sumar.error;
  const s = (sumar.data && sumar.data[0]) || {};
  const gest = peGest.data || [];
  const furn = peFurn.data || [];
  const vz   = vzMag.data || [];

  const gestList = GESTIUNI.map(g => {
    const row = gest.find(x => x.cod_depozit === g.cod);
    return { cod: g.cod, nume: g.nume_full, valoare: Number(row?.stoc_fara_vz || 0) };
  });

  // Vanzari pe saptamani per magazin (lei) — pivot
  const magazineOrder = ['3','12','16','21','32','64'];
  const saptSet = new Set();
  const matr = {};  // matr[sapt][mag] = lei
  for (const r of vz) {
    const z  = r.prima_zi ? String(r.prima_zi).slice(0, 10) : null;
    const cm = r.cod_depozit != null ? String(r.cod_depozit) : null;
    const vp = Number(r.valoare_pret ?? 0);
    if (!z || !cm || !Number.isFinite(vp)) continue;
    saptSet.add(z);
    matr[z] = matr[z] || {};
    matr[z][cm] = vp;
  }
  const saptOrdered = [...saptSet].sort();
  if (vz.length === 0 && vzMag.error) {
    console.error('[pagPeScurt] ar_vanzari_mag_sapt a eşuat:', vzMag.error);
  } else if (vz.length === 0) {
    console.warn('[pagPeScurt] ar_vanzari_mag_sapt a întors 0 rânduri.');
  } else if (saptOrdered.length === 0) {
    console.warn('[pagPeScurt] ar_vanzari_mag_sapt a întors rânduri, dar niciunul valid. Primul rând:', vz[0]);
  }
  const totalPerMag = Object.fromEntries(magazineOrder.map(m => [m, 0]));
  for (const z of saptOrdered) {
    for (const m of magazineOrder) {
      totalPerMag[m] += (matr[z]?.[m] || 0);
    }
  }
  const mediaTotal = Object.values(totalPerMag).reduce((a,b)=>a+b, 0) / 8;

  const html = `
    <h2 class="titlu-pagina">Pe scurt</h2>
    <p class="mic" style="color:var(--text-dim);margin:0 0 12px;">
      Date la <strong>${fmtData(s.data_d)}</strong> &nbsp;·&nbsp;
      Recalculat ${fmtDataOra(s.recalculat_la)} &nbsp;·&nbsp;
      ${fmtInt(s.rand_pozitii)} poziţii în total
    </p>
    <div class="cartele">
      <a class="cartela cartela-link" data-ruta="stagneaza"><div class="eticheta">Stoc total (la cost)</div><div class="valoare">${fmtBani(s.stoc_total)} ${etichetaTva(false)}</div></a>
      <div class="cartela"><div class="eticheta">Stoc preţ vânzare – magazine</div><div class="valoare">${fmtBani(s.stoc_pret_mag_cu_tva)} ${etichetaTva(true)}</div></div>
      <div class="cartela"><div class="eticheta">Stoc preţ vânzare – depozite</div><div class="valoare">${fmtBani(s.stoc_pret_dep_fara_tva)} ${etichetaTva(false)}</div></div>
      <div class="cartela"><div class="eticheta">Vânzări 8 săpt. (magazine)</div><div class="valoare">${fmtBani(s.vanzari_8w_lei)} ${etichetaTva(true)}</div></div>
      <a class="cartela danger cartela-link" data-ruta="lipsuri" data-v="lipsa"><div class="eticheta">Lipsă</div><div class="valoare">${fmtInt(s.nr_lipsa)}</div></a>
      <a class="cartela warn cartela-link"   data-ruta="lipsuri" data-v="termin"><div class="eticheta">Pe terminate</div><div class="valoare">${fmtInt(s.nr_termin)}</div></a>
      <a class="cartela cartela-link"        data-ruta="stocuri-negative"><div class="eticheta">Stoc negativ total (magazine)</div><div class="valoare">${fmtInt(s.nr_stoc_negativ_mag_total)}</div></a>
      <a class="cartela cartela-link"        data-ruta="stagneaza"><div class="eticheta">Stoc fără vânzare (la cost)</div><div class="valoare">${fmtBani(s.stoc_fara_vz_total)} ${etichetaTva(false)}</div></a>
      <div class="cartela warn"><div class="eticheta">Pierdere pe săptămână (lipsă)</div><div class="valoare">${fmtBani(s.pierdere_sapt_total)} ${etichetaTva(true)}</div></div>
    </div>

    <h3>Vânzări pe săptămână, pe magazin (lei cu TVA)</h3>
    ${saptOrdered.length === 0 ? `<div class="mesaj danger" style="margin-bottom:12px;">
      Nu s-au încărcat date de vânzări pe săptămână.
      ${vzMag.error ? `Eroare RPC: <code>${escapeHtml(vzMag.error.message || JSON.stringify(vzMag.error))}</code>` : 'Verifică consola (F12).'}
    </div>` : ''}
    <div class="tabel-wrap">
      <table class="sort-client">
        <thead><tr>
          <th class="sort-sk" data-sk-type="text">Săpt.</th>
          ${magazineOrder.map(m => `<th class="nr sort-sk" data-sk-type="nr">${escapeHtml(gestiuneNume(m))}</th>`).join('')}
          <th class="nr sort-sk" data-sk-type="nr">Total</th>
        </tr></thead>
        <tbody>${saptOrdered.map(z => {
          let totalSapt = 0;
          const cells = magazineOrder.map(m => {
            const v = matr[z]?.[m] || 0;
            totalSapt += v;
            return `<td class="nr" data-sv="${v}">${fmtBani(v)}</td>`;
          });
          return `<tr><td class="mic" data-sv="${z}">${fmtData(z)}</td>${cells.join('')}<td class="nr" data-sv="${totalSapt}"><strong>${fmtBani(totalSapt)}</strong></td></tr>`;
        }).join('')}
        </tbody>
        <tfoot>
          <tr class="rand-total">
            <td><strong>Total 8 săpt.</strong></td>
            ${magazineOrder.map(m => `<td class="nr"><strong>${fmtBani(totalPerMag[m])}</strong></td>`).join('')}
            <td class="nr"><strong>${fmtBani(mediaTotal * 8)}</strong></td>
          </tr>
          <tr class="rand-total">
            <td class="mic">Medie / săpt.</td>
            ${magazineOrder.map(m => `<td class="nr mic">${fmtBani(totalPerMag[m]/8)}</td>`).join('')}
            <td class="nr mic">${fmtBani(mediaTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="tabele-paralele" style="margin-top:16px;">
      <div class="tabel-wrap">
        <table class="sort-client">
          <thead><tr>
            <th class="sort-sk" data-sk-type="text">Gestiune</th>
            <th class="nr sort-sk" data-sk-type="nr">Stoc fără vânzare<br>${etichetaTva(false)}</th>
          </tr></thead>
          <tbody>${gestList.sort((a,b) => b.valoare - a.valoare).map(g => `
            <tr class="clickabil" data-ruta="stagneaza" data-g="${escapeHtml(g.cod)}">
              <td data-sv="${escapeHtml(g.nume)}">${escapeHtml(g.nume)}</td>
              <td class="nr" data-sv="${g.valoare}">${fmtBani(g.valoare)}</td></tr>`).join('')}
          </tbody>
          <tfoot>
            <tr class="rand-total">
              <td><strong>Total</strong></td>
              <td class="nr"><strong>${fmtBani(s.stoc_fara_vz_total)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="tabel-wrap">
        <table class="sort-client">
          <thead><tr>
            <th class="sort-sk" data-sk-type="text">Furnizor (primii 10 după valoare)</th>
            <th class="nr sort-sk" data-sk-type="nr">Stoc fără vânzare<br>${etichetaTva(false)}</th>
          </tr></thead>
          <tbody>${furn.map(f => `
            <tr class="clickabil" data-ruta="stagneaza" data-f="${escapeHtml(f.furnizor)}">
              <td data-sv="${escapeHtml(f.furnizor)}">${escapeHtml(f.furnizor)}</td>
              <td class="nr" data-sv="${f.stoc_fara_vz}">${fmtBani(f.stoc_fara_vz)}</td></tr>`).join('')}
          </tbody>
          <tfoot>
            <tr class="rand-total">
              <td><strong>Total (toţi furnizorii)</strong></td>
              <td class="nr"><strong>${fmtBani(s.stoc_fara_vz_total)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
  initSortClient();
  document.getElementById('continut').innerHTML = html;

  // click handlers pentru cartele + randuri cu data-ruta
  document.querySelectorAll('[data-ruta]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const r = el.dataset.ruta;
      const qs = new URLSearchParams();
      if (el.dataset.v) qs.set('v', el.dataset.v);
      if (el.dataset.g) qs.set('g', el.dataset.g);
      if (el.dataset.f) qs.set('f', el.dataset.f);
      const s = qs.toString();
      location.hash = '#/' + r + (s ? '?' + s : '');
    });
  });
}

// ============================================================================
// Builder generic: ar_pozitii cu filtre
// ============================================================================

function queryPozitii(filtre, scop) {
  // scop poate adauga conditii specifice paginii
  let q = stare.client.from('ar_pozitii').select('*', { count: 'exact' }).eq('e_marfa', true);
  if (scop === 'magazine')    q = q.eq('tip_gestiune', 'magazin');
  if (scop === 'lipsuri')     q = q.eq('tip_gestiune', 'magazin').not('stare', 'is', null);
  if (scop === 'stagneaza')   q = q.eq('stagneaza', true);
  if (scop === 'negative')    q = q.lt('stoc', 0);

  if (filtre.g)   q = q.eq('cod_depozit', filtre.g);
  if (filtre.f)   q = q.eq('furnizor', filtre.f);
  if (filtre.fam) q = q.eq('cod_familie', filtre.fam);
  if (filtre.gr)  q = q.like('cod_familie', filtre.gr + '%');

  if (filtre.v === 'lipsa')    q = q.eq('stare', 'lipsa');
  if (filtre.v === 'termin')   q = q.eq('stare', 'pe terminate');
  if (filtre.v === 'negativ')  q = q.eq('stare', 'stoc negativ – de verificat');
  if (filtre.v === 'stagn')    q = q.eq('stagneaza', true);
  if (filtre.v === 'sub-cost') q = q.eq('stoc_sub_cost', true);
  if (filtre.v === 'fara-bar') q = q.or('cod_bare.is.null,cod_bare.eq.');

  if (filtre.q) {
    const t = filtre.q.trim();
    q = q.or(`cod_art.ilike.%${t}%,nume_art.ilike.%${t}%,cod_bare.ilike.%${t}%`);
  }
  return q;
}

// ============================================================================
// PAGINA 2 — LIPSURI
// ============================================================================

async function pagLipsuri(filtre) {
  // Listele pt dropdown-uri
  const { data: furnData } = await stare.client.rpc('ar_sumar_pe_furnizori', { lim: 1000 });
  const furnizori = (furnData || []).map(x => x.furnizor).filter(x => x !== '(fără furnizor)').sort((a,b) => a.localeCompare(b, 'ro'));
  const { data: famData }  = await stare.client.rpc('ar_sumar_pe_familii',   { lim: 500 });
  // PAS 4: enrich cu nume_familie (afisare „cod – nume" in dropdown)
  const { data: famListaData } = await stare.client.rpc('ar_lista_familii');
  const famMap = new Map((famListaData || []).map(x => [x.cod_familie, x.nume_familie]));
  const familii = (famData || []).map(x => x.cod_familie).filter(x => x !== '(fără familie)').sort()
    .map(cod => ({ cod, nume: famMap.get(cod) || '' }));

  construiesteFiltreHTML(filtre, {
    gestiune: 'magazin', furnizor: true, familie: true, grupa: true, cautare: true, descarca: true,
    vedere: [
      { val: 'toate',   txt: 'Toate (lipsă + pe terminate + stoc negativ rulaj)' },
      { val: 'lipsa',   txt: 'Doar lipsă' },
      { val: 'termin',  txt: 'Doar pe terminate' },
      { val: 'negativ', txt: 'Stoc negativ (rulaj)' },
    ],
    vedereDefault: 'toate',
    sursa: [
      { val: '',                txt: '— orice sursă —' },
      { val: 'din depozit',     txt: 'Din depozit' },
      { val: 'din alt magazin', txt: 'Din alt magazin' },
      { val: 'de comandat',     txt: 'De comandat' },
    ],
  }, { furnizori, familii });

  // Sumar sus (RPC cu filtre)
  const { data: sumar } = await stare.client.rpc('ar_lipsuri_sumar', {
    p_mag:       filtre.g       || null,
    p_furnizor:  filtre.f       || null,
    p_familie:   filtre.fam     || null,
    p_grupa:     filtre.gr      || null,
    p_sursa:     filtre.s       || null,
    p_q:         filtre.q       || null,
  });
  const ss = sumar || [];
  const totalPierdere = ss.reduce((a,x) => a + Number(x.pierdere_total || 0), 0);

  const pag = Number(filtre.pag) || 1;
  const implicitSort = { col: 'pierdere_sapt', dir: 'desc' };
  const constr = () => {
    let q = queryPozitii(filtre, 'lipsuri');
    if (filtre.s) q = q.eq('sursa', filtre.s);
    return aplicaSortare(q, filtre, implicitSort);
  };
  const { randuri, total, from, to } = await fetchPagina(constr, pag);

  document.getElementById('continut').innerHTML = `
    <h2 class="titlu-pagina">Lipsuri</h2>

    <h3>Sumar pe magazine</h3>
    <div class="tabel-wrap">
      <table class="sort-client">
        <thead><tr>
          <th class="sort-sk" data-sk-type="text">Magazin</th>
          <th class="nr sort-sk" data-sk-type="nr">Lipsă</th>
          <th class="nr sort-sk" data-sk-type="nr">Pe terminate</th>
          <th class="nr sort-sk" data-sk-type="nr">Stoc negativ</th>
          <th class="nr sort-sk" data-sk-type="nr">Din depozit</th>
          <th class="nr sort-sk" data-sk-type="nr">Din alt magazin</th>
          <th class="nr sort-sk" data-sk-type="nr">De comandat</th>
          <th class="nr sort-sk" data-sk-type="nr">Pierdere/săpt.<br>${etichetaTva(true)}</th>
        </tr></thead>
        <tbody>${ss.sort((a,b) => Number(b.pierdere_total) - Number(a.pierdere_total)).map(r => `
          <tr>
            <td data-sv="${escapeHtml(gestiuneNumeFull(r.cod_depozit))}">${escapeHtml(gestiuneNumeFull(r.cod_depozit))}</td>
            <td class="nr" data-sv="${Number(r.nr_lipsa||0)}">${fmtInt(r.nr_lipsa)}</td>
            <td class="nr" data-sv="${Number(r.nr_termin||0)}">${fmtInt(r.nr_termin)}</td>
            <td class="nr" data-sv="${Number(r.nr_negativ||0)}">${fmtInt(r.nr_negativ)}</td>
            <td class="nr" data-sv="${Number(r.nr_din_dep||0)}">${fmtInt(r.nr_din_dep)}</td>
            <td class="nr" data-sv="${Number(r.nr_alt_mag||0)}">${fmtInt(r.nr_alt_mag)}</td>
            <td class="nr" data-sv="${Number(r.nr_comandat||0)}">${fmtInt(r.nr_comandat)}</td>
            <td class="nr" data-sv="${Number(r.pierdere_total||0)}">${fmtBani(r.pierdere_total)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="rand-total">
            <td><strong>Total</strong></td>
            <td class="nr"><strong>${fmtInt(ss.reduce((a,x)=>a+Number(x.nr_lipsa||0),0))}</strong></td>
            <td class="nr"><strong>${fmtInt(ss.reduce((a,x)=>a+Number(x.nr_termin||0),0))}</strong></td>
            <td class="nr"><strong>${fmtInt(ss.reduce((a,x)=>a+Number(x.nr_negativ||0),0))}</strong></td>
            <td class="nr"><strong>${fmtInt(ss.reduce((a,x)=>a+Number(x.nr_din_dep||0),0))}</strong></td>
            <td class="nr"><strong>${fmtInt(ss.reduce((a,x)=>a+Number(x.nr_alt_mag||0),0))}</strong></td>
            <td class="nr"><strong>${fmtInt(ss.reduce((a,x)=>a+Number(x.nr_comandat||0),0))}</strong></td>
            <td class="nr"><strong>${fmtBani(totalPierdere)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <h3>Lista produselor</h3>
    ${renderPaginareHTML(from, to, total, pag)}
    <div class="tabel-wrap tabel-cu-sticky">
      <table>
        <thead><tr>
          ${thSort('cod_depozit', 'Magazin', '', filtre, implicitSort)}
          ${thSort('cod_art', 'Cod', '', filtre, implicitSort)}
          ${thSort('cod_bare', 'Cod de bare', 'col-cod-bare', filtre, implicitSort)}
          ${thSort('nume_art', 'Denumire', 'col-denumire', filtre, implicitSort)}
          ${thSort('furnizor', 'Furnizor', 'col-furnizor', filtre, implicitSort)}
          ${thSort('stoc', 'Stoc', 'nr', filtre, implicitSort)}
          ${thSort('pe_drum', 'Pe drum', 'nr', filtre, implicitSort)}
          ${thSort('ritm', 'Ritm/săpt.', 'nr', filtre, implicitSort)}
          ${thSort('acoperire', 'Acoperire', 'nr', filtre, implicitSort)}
          ${thSort('stare', 'Stare', '', filtre, implicitSort)}
          ${thSort('sursa', 'Sursă', '', filtre, implicitSort)}
          ${thSortHtml('pierdere_sapt', 'Pierdere/săpt.<br>' + etichetaTva(true), 'nr', filtre, implicitSort)}
          ${thSortHtml('pret_lista', capTvaMix('Preţ vz/buc'), 'nr', filtre, implicitSort)}
        </tr></thead>
        <tbody>
        ${randuri.map(r => `
          <tr class="clickabil" data-cod="${escapeHtml(r.cod_art)}">
            <td>${escapeHtml(gestiuneNume(r.cod_depozit))}</td>
            <td><code>${escapeHtml(r.cod_art)}</code></td>
            <td class="col-cod-bare mic">${escapeHtml(r.cod_bare || '')}</td>
            <td class="col-denumire">${escapeHtml(r.nume_art || '')}</td>
            <td class="col-furnizor mic">${escapeHtml(r.furnizor || '')}</td>
            <td class="nr">${fmtNr(r.stoc)}</td>
            <td class="nr">${fmtNr(r.pe_drum)}</td>
            <td class="nr">${fmtNr(r.ritm, 2)}</td>
            <td class="nr">${r.acoperire != null ? fmtNr(r.acoperire, 1) : '∞'}</td>
            <td>${stareBadge(r.stare)}</td>
            <td class="mic">${escapeHtml(r.sursa || '')}</td>
            <td class="nr">${Number(r.pierdere_sapt) > 0 ? fmtBani(r.pierdere_sapt) : ''}</td>
            <td class="nr">${pretVzHtml(r)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${renderPaginareHTML(from, to, total, pag)}
  `;
  activeazaFisaLink();
  activeazaPaginare();
  activeazaSortare(filtre, implicitSort);
  initSortClient();
  document.getElementById('btn-descarca').addEventListener('click', () => {
    descarcaCuBucla('lipsuri', coloaneCsvLipsuri(), constr, total);
  });
}

function coloaneCsvLipsuri() {
  // PAS 5 C: ordine comună — gestiune, cod, cod bare, denumire, furnizor, cifre, preţ vz.
  return [
    { titlu: 'Magazin',    val: r => gestiuneNumeFull(r.cod_depozit) },
    { titlu: 'Cod',        val: 'cod_art' },
    { titlu: 'Cod de bare',val: 'cod_bare' },
    { titlu: 'Denumire',   val: 'nume_art' },
    { titlu: 'Furnizor',   val: 'furnizor' },
    { titlu: 'Familie',    val: 'cod_familie' },
    { titlu: 'Stoc',       val: 'stoc' },
    { titlu: 'Pe drum',    val: 'pe_drum' },
    { titlu: 'Ritm',       val: 'ritm' },
    { titlu: 'Acoperire',  val: 'acoperire' },
    { titlu: 'Stare',      val: r => STARE_DISPLAY[r.stare] || r.stare },
    { titlu: 'Sursă',      val: 'sursa' },
    { titlu: 'Pierdere/săpt (cu TVA)', val: 'pierdere_sapt' },
    { titlu: 'Preţ achiziţie (fără TVA)', val: 'pret_achizitie' },
    { titlu: 'Preţ vânzare/buc (cu TVA la magazine, fără TVA la depozite)', val: pretVzVal },
  ];
}

// ============================================================================
// PAGINA 3 — MARFĂ CARE STAGNEAZĂ
// ============================================================================

async function pagStagneaza(filtre) {
  // Listele pentru filtre — doar la prima incarcare, cu limita micsorata pentru performanta
  const [furnRes, famRes, famListaRes] = await Promise.all([
    stare.client.rpc('ar_sumar_pe_furnizori', { lim: 500 }),
    stare.client.rpc('ar_sumar_pe_familii',   { lim: 500 }),
    stare.client.rpc('ar_lista_familii'),
  ]);
  const furnizori = (furnRes.data || []).map(x => x.furnizor).filter(x => x !== '(fără furnizor)').sort((a,b) => a.localeCompare(b, 'ro'));
  // PAS 4: enrich cu nume_familie (afisare „cod – nume" in dropdown)
  const famMap = new Map((famListaRes.data || []).map(x => [x.cod_familie, x.nume_familie]));
  const familii   = (famRes.data  || []).map(x => x.cod_familie).filter(x => x !== '(fără familie)').sort()
    .map(cod => ({ cod, nume: famMap.get(cod) || '' }));

  construiesteFiltreHTML(filtre, {
    gestiune: 'all', furnizor: true, familie: true, grupa: true, cautare: true, descarca: true,
    vedere: [
      { val: '8',     txt: 'Fără vânzare 8 săpt.' },
      { val: '4',     txt: 'Fără vânzare 4 săpt.' },
      { val: '2',     txt: 'Fără vânzare 2 săpt.' },
      { val: '1',     txt: 'Fără vânzare 1 săpt.' },
      { val: '6luni', txt: 'Peste 6 luni (sau niciodată)' },
    ],
    vedereDefault: '8',
  }, { furnizori, familii });

  const perioada = filtre.v || '8';
  const campStagn = {
    '1':     'stagneaza_1w',
    '2':     'stagneaza_2w',
    '4':     'stagneaza_4w',
    '8':     'stagneaza',
    '6luni': 'stagneaza_6luni',
  }[perioada];

  // Sumar RPC cu filtre
  const { data: sumar } = await stare.client.rpc('ar_stagn_sumar', {
    p_perioada: perioada,
    p_mag:      filtre.g   || null,
    p_furnizor: filtre.f   || null,
    p_familie:  filtre.fam || null,
    p_grupa:    filtre.gr  || null,
    p_q:        filtre.q   || null,
  });
  const ss = (sumar && sumar[0]) || { nr_pozitii: 0, valoare_total: 0 };

  const pag = Number(filtre.pag) || 1;
  const implicitSort = { col: 'valoare_cost', dir: 'desc' };
  const constr = () => {
    let q = stare.client.from('ar_pozitii').select('*', { count: 'exact' })
      .eq('e_marfa', true).eq(campStagn, true);
    if (filtre.g)   q = q.eq('cod_depozit', filtre.g);
    if (filtre.f)   q = q.eq('furnizor', filtre.f);
    if (filtre.fam) q = q.eq('cod_familie', filtre.fam);
    if (filtre.gr)  q = q.like('cod_familie', filtre.gr + '%');
    if (filtre.q) {
      const t = filtre.q.trim();
      q = q.or(`cod_art.ilike.%${t}%,nume_art.ilike.%${t}%,cod_bare.ilike.%${t}%`);
    }
    return aplicaSortare(q, filtre, implicitSort);
  };
  const { randuri, total, from, to } = await fetchPagina(constr, pag);

  document.getElementById('continut').innerHTML = `
    <h2 class="titlu-pagina">Marfă care stagnează</h2>
    <p class="mic" style="color:var(--text-dim);margin:0 0 10px;">
      Pentru selecţia curentă: <strong>${fmtInt(ss.nr_pozitii)}</strong> poziţii — <strong>${fmtBani(ss.valoare_total)}</strong> la cost ${etichetaTva(false)}
    </p>
    ${renderPaginareHTML(from, to, total, pag)}
    <div class="tabel-wrap tabel-cu-sticky tabel-compact">
      <table>
        <thead><tr>
          ${thSort('cod_depozit', 'Gestiune', '', filtre, implicitSort)}
          ${thSort('cod_art', 'Cod', '', filtre, implicitSort)}
          ${thSort('cod_bare', 'Cod de bare', 'col-cod-bare', filtre, implicitSort)}
          ${thSort('nume_art', 'Denumire', 'col-denumire', filtre, implicitSort)}
          ${thSort('furnizor', 'Furnizor', 'col-furnizor', filtre, implicitSort)}
          ${thSort('cod_familie', 'Familie', '', filtre, implicitSort)}
          ${thSort('stoc', 'Stoc', 'nr', filtre, implicitSort)}
          ${thSortHtml('pret_achizitie', 'Preţ achiziţie<br>' + etichetaTva(false), 'nr', filtre, implicitSort)}
          ${thSortHtml('pret_lista', capTvaMix('Preţ vânzare'), 'nr', filtre, implicitSort)}
          ${thSortHtml('valoare_cost', 'Val. cost<br>' + etichetaTva(false), 'nr', filtre, implicitSort)}
          ${thSort('ultima_vz_gestiune', 'Ultima vz. gest.', '', filtre, implicitSort)}
          ${thSort('ultima_vz_firma', 'Ultima vz. firmă', '', filtre, implicitSort)}
        </tr></thead>
        <tbody>
        ${randuri.map(r => `
          <tr class="clickabil" data-cod="${escapeHtml(r.cod_art)}">
            <td>${escapeHtml(gestiuneNume(r.cod_depozit))}</td>
            <td><code>${escapeHtml(r.cod_art)}</code></td>
            <td class="col-cod-bare mic">${escapeHtml(r.cod_bare || '')}</td>
            <td class="col-denumire">${escapeHtml(r.nume_art || '')}</td>
            <td class="col-furnizor mic">${escapeHtml(r.furnizor || '')}</td>
            <td class="mic">${escapeHtml(r.cod_familie || '')}</td>
            <td class="nr">${fmtNr(r.stoc)}</td>
            <td class="nr">${r.pret_achizitie ? fmtBani(r.pret_achizitie) : ''}</td>
            <td class="nr">${pretVzHtml(r)}</td>
            <td class="nr">${fmtBani(r.valoare_cost)}</td>
            <td class="mic">${fmtData(r.ultima_vz_gestiune)}</td>
            <td class="mic">${fmtData(r.ultima_vz_firma)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${renderPaginareHTML(from, to, total, pag)}
  `;
  activeazaFisaLink();
  activeazaPaginare();
  activeazaSortare(filtre, implicitSort);
  document.getElementById('btn-descarca').addEventListener('click', () => {
    descarcaCuBucla('stagneaza', [
      { titlu: 'Gestiune',   val: r => gestiuneNumeFull(r.cod_depozit) },
      { titlu: 'Cod',        val: 'cod_art' },
      { titlu: 'Cod de bare',val: 'cod_bare' },
      { titlu: 'Denumire',   val: 'nume_art' },
      { titlu: 'Furnizor',   val: 'furnizor' },
      { titlu: 'Familie',    val: 'cod_familie' },
      { titlu: 'Stoc',       val: 'stoc' },
      { titlu: 'Preţ achiziţie/buc (fără TVA)', val: 'pret_achizitie' },
      { titlu: 'Preţ vânzare/buc (cu TVA la magazine, fără TVA la depozite)', val: pretVzVal },
      { titlu: 'Valoare cost (fără TVA)', val: 'valoare_cost' },
      { titlu: 'Ultima vânz. gestiune',   val: r => fmtData(r.ultima_vz_gestiune) },
      { titlu: 'Ultima vânz. firmă',      val: r => fmtData(r.ultima_vz_firma) },
    ], constr, total);
  });
}

// ============================================================================
// PAGINA 4 — STOCURI NEGATIVE
// ============================================================================

async function pagStocuriNegative(filtre) {
  construiesteFiltreHTML(filtre, { gestiune: 'all', descarca: true }, {});

  const pag = Number(filtre.pag) || 1;
  const implicitSort = { col: 'valoare_cost', dir: 'asc' };
  const constr = () => aplicaSortare(queryPozitii(filtre, 'negative'), filtre, implicitSort);
  const { randuri, total, from, to } = await fetchPagina(constr, pag);

  // sumar pe gestiuni: bucla pe toate pozitiile negative (pot fi 1000+)
  const toateNeg = await fetchTot(() => queryPozitii({}, 'negative'), total);
  const sumar = {};
  for (const r of toateNeg) {
    const k = r.cod_depozit;
    sumar[k] = sumar[k] || { cod: k, nume: gestiuneNumeFull(k), poz: 0, buc: 0, valoare: 0 };
    sumar[k].poz += 1;
    sumar[k].buc += Number(r.stoc || 0);
    sumar[k].valoare += Number(r.valoare_cost || 0);
  }
  const sumarList = Object.values(sumar).sort((a,b) => a.valoare - b.valoare);

  const totalPoz = sumarList.reduce((a,s)=>a+s.poz, 0);
  const totalBuc = sumarList.reduce((a,s)=>a+s.buc, 0);
  const totalVal = sumarList.reduce((a,s)=>a+s.valoare, 0);

  document.getElementById('continut').innerHTML = `
    <h2 class="titlu-pagina">Stocuri negative</h2>

    <h3>Pe gestiuni</h3>
    <div class="tabel-wrap">
      <table class="sort-client">
        <thead><tr>
          <th class="sort-sk" data-sk-type="text">Gestiune</th>
          <th class="nr sort-sk" data-sk-type="nr">Nr. produse</th>
          <th class="nr sort-sk" data-sk-type="nr">Bucăţi</th>
          <th class="nr sort-sk" data-sk-type="nr">Valoare la cost<br>${etichetaTva(false)}</th>
        </tr></thead>
        <tbody>${sumarList.map(s => `
          <tr>
            <td data-sv="${escapeHtml(s.nume)}">${escapeHtml(s.nume)}</td>
            <td class="nr" data-sv="${s.poz}">${fmtInt(s.poz)}</td>
            <td class="nr" data-sv="${s.buc}">${fmtNr(s.buc, 2)}</td>
            <td class="nr" data-sv="${s.valoare}">${fmtBani(s.valoare)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="rand-total">
            <td><strong>Total</strong></td>
            <td class="nr"><strong>${fmtInt(totalPoz)}</strong></td>
            <td class="nr"><strong>${fmtNr(totalBuc, 2)}</strong></td>
            <td class="nr"><strong>${fmtBani(totalVal)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <h3>Lista produselor</h3>
    ${renderPaginareHTML(from, to, total, pag)}
    <div class="tabel-wrap tabel-cu-sticky">
      <table>
        <thead><tr>
          ${thSort('cod_depozit', 'Gestiune', '', filtre, implicitSort)}
          ${thSort('cod_art', 'Cod', '', filtre, implicitSort)}
          ${thSort('cod_bare', 'Cod de bare', 'col-cod-bare', filtre, implicitSort)}
          ${thSort('nume_art', 'Denumire', 'col-denumire', filtre, implicitSort)}
          ${thSort('furnizor', 'Furnizor', 'col-furnizor', filtre, implicitSort)}
          ${thSort('stoc', 'Stoc', 'nr', filtre, implicitSort)}
          ${thSortHtml('valoare_cost', 'Valoare cost<br>' + etichetaTva(false), 'nr', filtre, implicitSort)}
          ${thSort('ritm', 'Ritm/săpt.', 'nr', filtre, implicitSort)}
          ${thSortHtml('pret_lista', capTvaMix('Preţ vz/buc'), 'nr', filtre, implicitSort)}
        </tr></thead>
        <tbody>
        ${randuri.map(r => `
          <tr class="clickabil" data-cod="${escapeHtml(r.cod_art)}">
            <td>${escapeHtml(gestiuneNume(r.cod_depozit))}</td>
            <td><code>${escapeHtml(r.cod_art)}</code></td>
            <td class="col-cod-bare mic">${escapeHtml(r.cod_bare || '')}</td>
            <td class="col-denumire">${escapeHtml(r.nume_art || '')}</td>
            <td class="col-furnizor mic">${escapeHtml(r.furnizor || '')}</td>
            <td class="nr">${fmtNr(r.stoc, 2)}</td>
            <td class="nr">${fmtBani(r.valoare_cost)}</td>
            <td class="nr">${fmtNr(r.ritm, 2)}</td>
            <td class="nr">${pretVzHtml(r)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${renderPaginareHTML(from, to, total, pag)}
  `;
  activeazaFisaLink();
  activeazaPaginare();
  activeazaSortare(filtre, implicitSort);
  initSortClient();
  document.getElementById('btn-descarca').addEventListener('click', () => {
    descarcaCuBucla('stocuri-negative', [
      { titlu: 'Gestiune',   val: r => gestiuneNumeFull(r.cod_depozit) },
      { titlu: 'Cod',        val: 'cod_art' },
      { titlu: 'Cod de bare',val: 'cod_bare' },
      { titlu: 'Denumire',   val: 'nume_art' },
      { titlu: 'Furnizor',   val: 'furnizor' },
      { titlu: 'Stoc',       val: 'stoc' },
      { titlu: 'Valoare cost (fără TVA)', val: 'valoare_cost' },
      { titlu: 'Ritm',       val: 'ritm' },
      { titlu: 'Preţ vânzare/buc (cu TVA la magazine, fără TVA la depozite)', val: pretVzVal },
    ], constr, total);
  });
}

// ============================================================================
// PAGINA 5 — RETURURI SPRE DEPOZIT
// ============================================================================

async function pagRetururi(filtre) {
  // Lista magazine + furnizori — din ar_retururi, distincti via bucla
  const toatefurn = await fetchTot(() => stare.client.from('ar_retururi').select('furnizor', { count: 'exact' }));
  const fSet = new Set(toatefurn.map(x => x.furnizor).filter(Boolean));
  const furnizori = [...fSet].sort((a,b) => a.localeCompare(b, 'ro'));

  construiesteFiltreHTML(filtre, {
    perioada: true, gestiune: 'magazin', furnizor: true, descarca: true,
  }, { furnizori });

  // Sumar pe magazine prin RPC
  const { data: sumar } = await stare.client.rpc('ar_retururi_sumar');
  const sumarSorted = (sumar || []).sort((a,b) => Number(b.retur) - Number(a.retur));
  const totalRetur = sumarSorted.reduce((s,r) => s + Number(r.retur||0), 0);

  // detaliat — paginare pe ar_retururi; perioada aplicata ca filtru data
  const pag = Number(filtre.pag) || 1;
  const d = new Date(stare.stareDatelor?.data_d);
  const zile = { '1':7, '2':14, '4':28, '8':56 }[filtre.p || '8'] || 56;
  const prag = new Date(d); prag.setDate(prag.getDate() - zile + 1);
  const pragStr = prag.toISOString().slice(0, 10);

  const implicitSort = { col: 'valoare_cost', dir: 'desc' };
  const constr = () => {
    let q = stare.client.from('ar_retururi').select('*', { count: 'exact' })
      .gte('prima_zi', pragStr);
    if (filtre.g) q = q.eq('cod_depozit', filtre.g);
    if (filtre.f) q = q.eq('furnizor', filtre.f);
    return aplicaSortare(q, filtre, implicitSort);
  };
  const { randuri, total, from, to } = await fetchPagina(constr, pag);

  document.getElementById('continut').innerHTML = `
    <h2 class="titlu-pagina">Retururi spre depozit</h2>

    <h3>Sumar pe magazine — 8 săptămâni</h3>
    <div class="tabel-wrap">
      <table class="sort-client">
        <thead><tr>
          <th class="sort-sk" data-sk-type="text">Magazin</th>
          <th class="nr sort-sk" data-sk-type="nr">Valoare retur<br>${etichetaTva(false)}</th>
          <th class="nr sort-sk" data-sk-type="nr">Marfă primită<br>${etichetaTva(false)}</th>
          <th class="nr sort-sk" data-sk-type="nr">% din primită</th>
        </tr></thead>
        <tbody>${sumarSorted.map(r => `
          <tr>
            <td data-sv="${escapeHtml(gestiuneNumeFull(r.cod_depozit))}">${escapeHtml(gestiuneNumeFull(r.cod_depozit))}</td>
            <td class="nr" data-sv="${Number(r.retur||0)}">${fmtBani(r.retur)}</td>
            <td class="nr" data-sv="${Number(r.primita||0)}">${fmtBani(r.primita)}</td>
            <td class="nr" data-sv="${Number(r.procent||0)}">${r.procent != null ? fmtProc(r.procent) : ''}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="rand-total">
            <td><strong>Total</strong></td>
            <td class="nr"><strong>${fmtBani(totalRetur)}</strong></td>
            <td class="nr"><strong>${fmtBani(sumarSorted.reduce((a,x)=>a+Number(x.primita||0),0))}</strong></td>
            <td class="nr"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <h3>Detaliu ${filtre.p ? 'ultimele ' + filtre.p + ' săpt.' : 'ultimele 8 săpt.'}</h3>
    ${renderPaginareHTML(from, to, total, pag)}
    <div class="tabel-wrap">
      <table>
        <thead><tr>
          ${thSort('prima_zi', 'Săpt.', '', filtre, implicitSort)}
          ${thSort('cod_depozit', 'Magazin', '', filtre, implicitSort)}
          ${thSort('cod_art', 'Cod', '', filtre, implicitSort)}
          ${thSort('cod_bare', 'Cod de bare', 'col-cod-bare', filtre, implicitSort)}
          ${thSort('nume_art', 'Denumire', 'col-denumire', filtre, implicitSort)}
          ${thSort('furnizor', 'Furnizor', 'col-furnizor', filtre, implicitSort)}
          ${thSort('cantitate', 'Cantitate', 'nr', filtre, implicitSort)}
          ${thSortHtml('valoare_cost', 'Valoare cost<br>' + etichetaTva(false), 'nr', filtre, implicitSort)}
        </tr></thead>
        <tbody>
        ${randuri.map(r => `
          <tr class="clickabil" data-cod="${escapeHtml(r.cod_art)}">
            <td class="mic">${fmtData(r.prima_zi)}</td>
            <td>${escapeHtml(gestiuneNume(r.cod_depozit))}</td>
            <td><code>${escapeHtml(r.cod_art)}</code></td>
            <td class="col-cod-bare mic">${escapeHtml(r.cod_bare || '')}</td>
            <td class="col-denumire">${escapeHtml(r.nume_art || '')}</td>
            <td class="col-furnizor mic">${escapeHtml(r.furnizor || '')}</td>
            <td class="nr">${fmtNr(r.cantitate, 2)}</td>
            <td class="nr">${fmtBani(r.valoare_cost)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${renderPaginareHTML(from, to, total, pag)}
  `;
  activeazaFisaLink();
  activeazaPaginare();
  activeazaSortare(filtre, implicitSort);
  initSortClient();
  document.getElementById('btn-descarca').addEventListener('click', () => {
    descarcaCuBucla('retururi', [
      { titlu: 'Săptămâna (prima zi)', val: r => fmtData(r.prima_zi) },
      { titlu: 'Magazin',    val: r => gestiuneNumeFull(r.cod_depozit) },
      { titlu: 'Cod',        val: 'cod_art' },
      { titlu: 'Cod de bare',val: 'cod_bare' },
      { titlu: 'Denumire',   val: 'nume_art' },
      { titlu: 'Furnizor',   val: 'furnizor' },
      { titlu: 'Cantitate',  val: 'cantitate' },
      { titlu: 'Valoare cost (fără TVA)', val: 'valoare_cost' },
    ], constr, total);
  });
}

// ============================================================================
// PAGINA 6 — STOC (fostă „Căutare produse"; PAS 4: 5 schimbări + comutator Pe gestiuni/Pe produs)
// ============================================================================

const VEDERI_STOC = [
  { val: '',               txt: '— tot —' },
  { val: 'stagn',          txt: 'Stagnează (stoc, fără vânzare 8 săpt.)' },
  { val: 'lipsa',          txt: 'Lipsă' },
  { val: 'termin',         txt: 'Pe terminate' },
  { val: 'negativ',        txt: 'Stoc negativ (marfă de rulaj)' },
  { val: 'neg-toate',      txt: 'Stoc negativ (toate)' },
  { val: 'sub-cost',       txt: 'Preţ sub preţul ultimei facturi' },
  { val: 'sub-cost-mediu', txt: 'Preţ sub costul mediu' },
  { val: 'fara-bar',       txt: 'Fără cod de bare' },
  { val: 'fara-fam',       txt: 'Fără familie' },
];

// Aplica filtrele „Stoc" pe un query de ar_pozitii (vedere „Pe gestiuni")
function aplicaFiltreStocPoz(q, filtre) {
  if (filtre.g)   q = q.eq('cod_depozit', filtre.g);
  if (filtre.f) {
    if (filtre.f === '(fără furnizor)') q = q.or('furnizor.is.null,furnizor.eq.');
    else                                q = q.eq('furnizor', filtre.f);
  }
  if (filtre.fam) q = q.eq('cod_familie', filtre.fam);
  if (filtre.gr) {
    if (filtre.gr === '(none)') q = q.or('cod_familie.is.null,cod_familie.eq.');
    else                         q = q.like('cod_familie', filtre.gr + '%');
  }
  if (filtre.q) {
    const t = filtre.q.trim();
    q = q.or(`cod_art.ilike.%${t}%,nume_art.ilike.%${t}%,cod_bare.ilike.%${t}%`);
  }
  // Vedere (probleme)
  switch (filtre.v) {
    case 'stagn':          q = q.eq('stagneaza', true); break;
    case 'lipsa':          q = q.eq('stare', 'lipsa'); break;
    case 'termin':         q = q.eq('stare', 'pe terminate'); break;
    case 'negativ':        q = q.eq('stare', 'stoc negativ – de verificat'); break;
    case 'neg-toate':      q = q.lt('stoc', 0); break;
    case 'sub-cost':       q = q.eq('stoc_sub_cost', true); break;
    case 'sub-cost-mediu': q = q.eq('pret_sub_cost_mediu', true); break;
    case 'fara-bar':       q = q.or('cod_bare.is.null,cod_bare.eq.'); break;
    case 'fara-fam':       q = q.or('cod_familie.is.null,cod_familie.eq.'); break;
  }
  // Selector stoc
  const st = filtre.st || 'in';
  if      (st === 'in')   q = q.gt('stoc', 0);
  else if (st === 'fara') q = q.eq('stoc', 0);
  // 'toate' → fara conditie
  return q;
}

// Aplica filtrele „Stoc" pe un query de ar_produse (vedere „Pe produs")
function aplicaFiltreStocProd(q, filtre) {
  if (filtre.g) {
    // „are stoc in gestiunea X" — exprimat ca stoc_<g> > 0
    const col = 'stoc_' + filtre.g;
    q = q.gt(col, 0);
  }
  if (filtre.f) {
    if (filtre.f === '(fără furnizor)') q = q.or('furnizor.is.null,furnizor.eq.');
    else                                q = q.eq('furnizor', filtre.f);
  }
  if (filtre.fam) q = q.eq('cod_familie', filtre.fam);
  if (filtre.gr) {
    if (filtre.gr === '(none)') q = q.or('cod_familie.is.null,cod_familie.eq.');
    else                         q = q.like('cod_familie', filtre.gr + '%');
  }
  if (filtre.q) {
    const t = filtre.q.trim();
    q = q.or(`cod_art.ilike.%${t}%,nume_art.ilike.%${t}%,cod_bare.ilike.%${t}%`);
  }
  // Vedere (probleme)
  switch (filtre.v) {
    case 'stagn':          q = q.eq('stagneaza_prod', true); break;
    case 'lipsa':          q = q.eq('are_lipsa', true); break;
    case 'termin':         q = q.eq('are_termin', true); break;
    case 'negativ':        q = q.eq('are_neg_rulaj', true); break;
    case 'neg-toate':      q = q.eq('are_neg_toate', true); break;
    case 'sub-cost':       q = q.eq('are_sub_cost', true); break;
    case 'sub-cost-mediu': q = q.eq('are_sub_cost_mediu', true); break;
    case 'fara-bar':       q = q.or('cod_bare.is.null,cod_bare.eq.'); break;
    case 'fara-fam':       q = q.or('cod_familie.is.null,cod_familie.eq.'); break;
  }
  // PAS 5 E: Selector stoc pe produs — „in stoc" = stoc pozitiv in CEL PUTIN o gestiune sau marfa pe drum.
  const st = filtre.st || 'in';
  if      (st === 'in')   q = q.or('are_stoc_poz.eq.true,pe_drum.gt.0');
  else if (st === 'fara') q = q.eq('are_stoc_poz', false).eq('pe_drum', 0);
  // 'toate' → fara conditie
  return q;
}

async function pagStoc(filtre) {
  const mod = filtre.mod || 'pe-gestiuni';

  // Listele complete pentru dropdown-uri (nu doar stagneaza, ca pe alte pagini)
  const [furnRes, famRes] = await Promise.all([
    stare.client.rpc('ar_lista_furnizori'),
    stare.client.rpc('ar_lista_familii'),
  ]);
  const furnizori = (furnRes.data || []).map(x => x.furnizor).filter(x => x !== '(fără furnizor)').sort((a,b) => a.localeCompare(b, 'ro'));
  const familii = (famRes.data || []).map(x => ({ cod: x.cod_familie, nume: x.nume_familie || '' }));

  construiesteFiltreHTML(filtre, {
    gestiune: 'all',
    furnizor: true, extraFurnizor: true,
    familie: true,
    grupa: true, extraGrupa: true,
    cautare: true, descarca: true,
    vedere: VEDERI_STOC, vedereDefault: '',
    stoc: [
      { val: 'in',    txt: 'În stoc' },
      { val: 'fara',  txt: 'Fără stoc' },
      { val: 'toate', txt: 'Toate' },
    ],
    stocDefault: 'in',
    mod: [
      { val: 'pe-gestiuni', txt: 'Pe gestiuni' },
      { val: 'pe-produs',   txt: 'Pe produs' },
    ],
    modDefault: 'pe-gestiuni',
  }, { furnizori, familii });

  // Total selectie (sus) — RPC in paralel cu lista
  const paramsTotal = {
    p_g:   filtre.g   || null,
    p_f:   filtre.f   || null,
    p_fam: filtre.fam || null,
    p_gr:  filtre.gr  || null,
    p_q:   filtre.q   || null,
    p_v:   filtre.v   || null,
    p_st:  filtre.st  || 'in',
  };
  const totalRpc = mod === 'pe-produs' ? 'ar_stoc_total_prod' : 'ar_stoc_total_poz';
  const totalPromise = stare.client.rpc(totalRpc, paramsTotal);

  if (mod === 'pe-produs') {
    await pagStocPeProdus(filtre, totalPromise);
  } else {
    await pagStocPeGestiuni(filtre, totalPromise);
  }
}

function renderTotalSelectieHTML(t, modProd) {
  if (!t) t = {};
  const nrPoz  = Number(t.nr_pozitii || 0);
  const nrProd = Number(t.nr_produse || 0);
  const buc    = Number(t.bucati || 0);
  const vc     = Number(t.valoare_cost || 0);
  // PAS 5 A: două valori la preţ vz — magazine CU TVA + depozite FĂRĂ TVA.
  const vpMag  = Number(t.valoare_pret_mag_cu_tva   || 0);
  const vpDep  = Number(t.valoare_pret_dep_fara_tva || 0);
  const etLinie = modProd
    ? `<strong>${fmtInt(nrProd)}</strong> produse`
    : `<strong>${fmtInt(nrPoz)}</strong> poziţii &nbsp;·&nbsp; <strong>${fmtInt(nrProd)}</strong> produse diferite`;
  return `
    <div class="cartele" style="grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); margin-bottom: 12px;">
      <div class="cartela"><div class="eticheta">Selecţie</div><div class="valoare" style="font-size:16px;">${etLinie}</div></div>
      <div class="cartela"><div class="eticheta">Bucăţi</div><div class="valoare">${fmtNr(buc, 2)}</div></div>
      <div class="cartela"><div class="eticheta">Valoare la cost</div><div class="valoare">${fmtBani(vc)} ${etichetaTva(false)}</div></div>
      <div class="cartela"><div class="eticheta">Preţ vz – magazine</div><div class="valoare">${fmtBani(vpMag)} ${etichetaTva(true)}</div></div>
      <div class="cartela"><div class="eticheta">Preţ vz – depozite</div><div class="valoare">${fmtBani(vpDep)} ${etichetaTva(false)}</div></div>
    </div>
    ${!modProd ? '<p class="mic" style="color:var(--text-dim);margin:4px 0 12px;">O poziţie = un produs într-o gestiune.</p>' : ''}`;
}

// ============================================================================
// Stoc — vederea „Pe gestiuni"
// ============================================================================

async function pagStocPeGestiuni(filtre, totalPromise) {
  const pag = Number(filtre.pag) || 1;
  const implicitSort = { col: 'valoare_cost', dir: 'desc' };
  const constr = () => {
    let q = stare.client.from('ar_pozitii').select('*', { count: 'exact' }).eq('e_marfa', true);
    q = aplicaFiltreStocPoz(q, filtre);
    return aplicaSortare(q, filtre, implicitSort);
  };
  const [listaRes, totalRes] = await Promise.all([ fetchPagina(constr, pag), totalPromise ]);
  const { randuri, total, from, to } = listaRes;
  const t = (totalRes.data && totalRes.data[0]) || {};

  document.getElementById('continut').innerHTML = `
    <h2 class="titlu-pagina">Stoc</h2>
    ${renderTotalSelectieHTML(t, false)}
    ${renderPaginareHTML(from, to, total, pag)}
    <div class="tabel-wrap tabel-cu-sticky">
      <table>
        <thead><tr>
          ${thSort('cod_depozit', 'Gestiune', '', filtre, implicitSort)}
          ${thSort('cod_art', 'Cod', '', filtre, implicitSort)}
          ${thSortHtml('cod_bare', escapeHtml('Cod de bare'), 'col-cod-bare', filtre, implicitSort)}
          ${thSort('nume_art', 'Denumire', 'col-denumire', filtre, implicitSort)}
          ${thSort('furnizor', 'Furnizor', 'col-furnizor', filtre, implicitSort)}
          ${thSort('cod_familie', 'Familie', '', filtre, implicitSort)}
          ${thSort('stoc', 'Stoc', 'nr', filtre, implicitSort)}
          ${thSort('pe_drum', 'Pe drum', 'nr', filtre, implicitSort)}
          ${thSortHtml('valoare_cost', capTva('Val. cost', false), 'nr', filtre, implicitSort)}
          ${thSortHtml('pret_achizitie', capTva('Preţ achiziţie', false), 'nr', filtre, implicitSort)}
          ${thSortHtml('pret_lista', capTvaMix('Preţ vânzare'), 'nr', filtre, implicitSort)}
          ${thSort('adaos', 'Adaos', 'nr', filtre, implicitSort)}
          ${thSort('stare', 'Stare', '', filtre, implicitSort)}
        </tr></thead>
        <tbody>
        ${randuri.map(r => {
          const tooltip = (r.factura_furnizor || r.factura_data)
            ? ` title="${escapeHtml((r.factura_furnizor || '—') + (r.factura_data ? ', ' + fmtData(r.factura_data) : ''))}"` : '';
          return `
          <tr class="clickabil" data-cod="${escapeHtml(r.cod_art)}">
            <td>${escapeHtml(gestiuneNume(r.cod_depozit))}</td>
            <td><code>${escapeHtml(r.cod_art)}</code></td>
            <td class="col-cod-bare mic">${escapeHtml(r.cod_bare || '')}</td>
            <td class="col-denumire">${escapeHtml(r.nume_art || '')}</td>
            <td class="col-furnizor mic">${escapeHtml(r.furnizor || '')}</td>
            <td class="mic">${escapeHtml(r.cod_familie || '')}</td>
            <td class="nr ${Number(r.stoc) < 0 ? 'neg' : ''}">${fmtNr(r.stoc, 2)}</td>
            <td class="nr">${fmtNr(r.pe_drum, 2)}</td>
            <td class="nr">${fmtBani(r.valoare_cost)}</td>
            <td class="nr"${tooltip}>${r.pret_achizitie ? fmtBani(r.pret_achizitie) : ''}</td>
            <td class="nr">${pretVzHtml(r)}</td>
            <td class="nr">${r.adaos != null ? fmtProc(r.adaos) : ''}</td>
            <td>${stareBadge(r.stare)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>
    <p class="mic" style="color:var(--text-dim);margin-top:6px;">Adaosul este calculat pe valori fără TVA.</p>
    ${renderPaginareHTML(from, to, total, pag)}
  `;
  activeazaFisaLink();
  activeazaPaginare();
  activeazaSortare(filtre, implicitSort);
  document.getElementById('btn-descarca').addEventListener('click', () => {
    descarcaCuBucla('stoc-pe-gestiuni', [
      { titlu: 'Gestiune',    val: r => gestiuneNumeFull(r.cod_depozit) },
      { titlu: 'Cod',         val: 'cod_art' },
      { titlu: 'Cod de bare', val: 'cod_bare' },
      { titlu: 'Denumire',    val: 'nume_art' },
      { titlu: 'Furnizor',    val: 'furnizor' },
      { titlu: 'Familie',     val: 'cod_familie' },
      { titlu: 'Stoc',        val: 'stoc' },
      { titlu: 'Pe drum',     val: 'pe_drum' },
      { titlu: 'Valoare cost', val: 'valoare_cost' },
      { titlu: 'Preţ achiziţie', val: 'pret_achizitie' },
      { titlu: 'Furnizor factură', val: 'factura_furnizor' },
      { titlu: 'Data factură', val: r => fmtData(r.factura_data) },
      { titlu: 'Preţ vânzare', val: 'pret_lista' },
      { titlu: 'Adaos',       val: 'adaos' },
      { titlu: 'Stare',       val: r => STARE_DISPLAY[r.stare] || r.stare || '' },
    ], constr, total);
  });
}

// ============================================================================
// Stoc — vederea „Pe produs"
// ============================================================================

const GEST_PE_PRODUS = [
  { cod: '70', col: 'stoc_70', nume: 'Depozit Papetărie' },
  { cod: '10', col: 'stoc_10', nume: 'Depozit IT' },
  { cod: '40', col: 'stoc_40', nume: 'Showroom' },
  { cod: '3',  col: 'stoc_3',  nume: 'Tomis 3' },
  { cod: '16', col: 'stoc_16', nume: 'Medgidia' },
  { cod: '64', col: 'stoc_64', nume: 'Năvodari' },
  { cod: '32', col: 'stoc_32', nume: 'Babadag' },
  { cod: '21', col: 'stoc_21', nume: 'Poarta 6' },
  { cod: '12', col: 'stoc_12', nume: 'Marvimex' },
];

async function pagStocPeProdus(filtre, totalPromise) {
  const pag = Number(filtre.pag) || 1;
  const implicitSort = { col: 'valoare_cost', dir: 'desc' };
  const constr = () => {
    let q = stare.client.from('ar_produse').select('*', { count: 'exact' }).eq('e_marfa', true);
    q = aplicaFiltreStocProd(q, filtre);
    return aplicaSortare(q, filtre, implicitSort);
  };
  const [listaRes, totalRes] = await Promise.all([ fetchPagina(constr, pag), totalPromise ]);
  const { randuri, total, from, to } = listaRes;
  const t = (totalRes.data && totalRes.data[0]) || {};

  const celStoc = (n, extraCls) => {
    const v = Number(n || 0);
    const cls = 'nr' + (extraCls ? ' ' + extraCls : '') + (v < 0 ? ' neg' : '');
    const txt = v === 0 ? '' : fmtNr(v, 2);
    return `<td class="${cls}">${txt}</td>`;
  };

  document.getElementById('continut').innerHTML = `
    <h2 class="titlu-pagina">Stoc</h2>
    ${renderTotalSelectieHTML(t, true)}
    ${renderPaginareHTML(from, to, total, pag)}
    <div class="tabel-wrap tabel-cu-sticky tabel-pe-produs">
      <table>
        <thead><tr>
          ${thSort('cod_art',       'Cod',             '', filtre, implicitSort)}
          ${thSort('cod_bare',      'Cod de bare',     'col-cod-bare', filtre, implicitSort)}
          ${thSort('nume_art',      'Denumire',        'col-denumire', filtre, implicitSort)}
          ${thSort('cod_familie',   'Familie',         'col-opt', filtre, implicitSort)}
          ${thSort('furnizor',      'Furnizor',        'col-opt', filtre, implicitSort)}
          ${thSortHtml('pret_achizitie',       capTva('Preţ achiziţie', false),      'nr col-opt', filtre, implicitSort)}
          ${thSortHtml('pret_lista',           capTva('Preţ vz magazin', true),      'nr', filtre, implicitSort)}
          ${thSortHtml('pret_lista_fara_tva',  capTva('Preţ vz depozit', false),     'nr', filtre, implicitSort)}
          ${thSort('adaos',         'Adaos',           'nr col-opt', filtre, implicitSort)}
          ${GEST_PE_PRODUS.map(g => thSort(g.col, g.nume, 'nr col-opt', filtre, implicitSort)).join('')}
          ${thSort('pe_drum',       'Pe drum',         'nr col-opt', filtre, implicitSort)}
          ${thSort('stoc_total',    'Total stoc',      'nr', filtre, implicitSort)}
          ${thSortHtml('valoare_cost',  capTva('Valoare cost', false),  'nr col-opt', filtre, implicitSort)}
        </tr></thead>
        <tbody>
        ${randuri.map(r => {
          const tooltip = (r.factura_furnizor || r.factura_data)
            ? ` title="${escapeHtml((r.factura_furnizor || '—') + (r.factura_data ? ', ' + fmtData(r.factura_data) : ''))}"` : '';
          return `
          <tr class="clickabil" data-cod="${escapeHtml(r.cod_art)}">
            <td><code>${escapeHtml(r.cod_art)}</code></td>
            <td class="col-cod-bare mic">${escapeHtml(r.cod_bare || '')}</td>
            <td class="col-denumire">${escapeHtml(r.nume_art || '')}</td>
            <td class="col-opt mic">${escapeHtml(r.cod_familie || '')}</td>
            <td class="col-opt mic">${escapeHtml(r.furnizor || '')}</td>
            <td class="nr col-opt"${tooltip}>${r.pret_achizitie ? fmtBani(r.pret_achizitie) : ''}</td>
            <td class="nr">${r.pret_lista ? fmtBani(r.pret_lista) : ''}</td>
            <td class="nr">${r.pret_lista_fara_tva ? fmtBani(r.pret_lista_fara_tva) : ''}</td>
            <td class="nr col-opt">${r.adaos != null ? fmtProc(r.adaos) : ''}</td>
            ${GEST_PE_PRODUS.map(g => celStoc(r[g.col], 'col-opt')).join('')}
            <td class="nr col-opt">${Number(r.pe_drum || 0) === 0 ? '' : fmtNr(r.pe_drum, 2)}</td>
            <td class="nr ${Number(r.stoc_total) < 0 ? 'neg' : ''}">${fmtNr(r.stoc_total, 2)}</td>
            <td class="nr col-opt">${fmtBani(r.valoare_cost)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>
    <p class="mic" style="color:var(--text-dim);margin-top:6px;">Adaosul este calculat pe valori fără TVA. Preţul de raft la depozite este fără TVA (nu avem listă de preţuri en gros).</p>
    ${renderPaginareHTML(from, to, total, pag)}
  `;
  activeazaFisaLink();
  activeazaPaginare();
  activeazaSortare(filtre, implicitSort);
  document.getElementById('btn-descarca').addEventListener('click', () => {
    descarcaCuBucla('stoc-pe-produs', [
      { titlu: 'Cod',          val: 'cod_art' },
      { titlu: 'Cod de bare',  val: 'cod_bare' },
      { titlu: 'Denumire',     val: 'nume_art' },
      { titlu: 'Familie',      val: 'cod_familie' },
      { titlu: 'Furnizor',     val: 'furnizor' },
      { titlu: 'Preţ achiziţie (fără TVA)', val: 'pret_achizitie' },
      { titlu: 'Furnizor factură', val: 'factura_furnizor' },
      { titlu: 'Data factură', val: r => fmtData(r.factura_data) },
      { titlu: 'Preţ vz magazin (cu TVA)',  val: 'pret_lista' },
      { titlu: 'Preţ vz depozit (fără TVA)', val: 'pret_lista_fara_tva' },
      { titlu: 'Adaos',        val: 'adaos' },
      ...GEST_PE_PRODUS.map(g => ({ titlu: g.nume, val: g.col })),
      { titlu: 'Pe drum',      val: 'pe_drum' },
      { titlu: 'Total stoc',   val: 'stoc_total' },
      { titlu: 'Valoare cost (fără TVA)', val: 'valoare_cost' },
      { titlu: 'Valoare preţ – magazine (cu TVA)',  val: 'valoare_pret_mag_cu_tva' },
      { titlu: 'Valoare preţ – depozite (fără TVA)', val: 'valoare_pret_dep_fara_tva' },
    ], constr, total);
  });
}

// ============================================================================
// PAGINA 7 — FIŞA PRODUSULUI
// ============================================================================

async function pagFisa(cod) {
  if (!cod) {
    document.getElementById('continut').innerHTML = '<div class="mesaj">Alege un produs din listă.</div>';
    return;
  }
  const { data: pozitii } = await stare.client.from('ar_pozitii').select('*').eq('cod_art', cod);
  if (!pozitii || pozitii.length === 0) {
    document.getElementById('continut').innerHTML = '<div class="mesaj">Produsul nu există.</div>';
    return;
  }
  const p0 = pozitii[0];
  const { data: istoric } = await stare.client.from('ar_vanzari_sapt').select('*')
    .eq('cod_art', cod).order('prima_zi', { ascending: false }).limit(20);

  const stocTotal   = pozitii.reduce((s,p) => s + Number(p.stoc || 0), 0);
  const peDrumTotal = pozitii.reduce((s,p) => s + Number(p.pe_drum || 0), 0);

  document.getElementById('continut').innerHTML = `
    <div class="fisa-antet">
      <h2>${escapeHtml(p0.nume_art || cod)}</h2>
      <div class="meta">
        Cod: <code>${escapeHtml(cod)}</code> &nbsp;·&nbsp;
        Cod de bare: <code>${escapeHtml(p0.cod_bare || '—')}</code> &nbsp;·&nbsp;
        Familie: <code>${escapeHtml(p0.cod_familie || '—')}</code> &nbsp;·&nbsp;
        Grupă: ${escapeHtml(p0.grupa_nume || '—')} &nbsp;·&nbsp;
        Furnizor: <strong>${escapeHtml(p0.furnizor || '—')}</strong>
      </div>
      <div class="meta" style="margin-top:8px;">
        Stoc total: <strong>${fmtNr(stocTotal, 2)}</strong> &nbsp;·&nbsp;
        Pe drum: <strong>${fmtNr(peDrumTotal, 2)}</strong> &nbsp;·&nbsp;
        Cost mediu: ${p0.cost_mediu ? fmtBani(p0.cost_mediu) : '—'} ${etichetaTva(false)} &nbsp;·&nbsp;
        Preţ vz magazin: ${p0.pret_lista ? fmtBani(p0.pret_lista) : '—'} ${etichetaTva(true)} &nbsp;·&nbsp;
        Preţ vz depozit: ${p0.pret_lista_fara_tva ? fmtBani(p0.pret_lista_fara_tva) : '—'} ${etichetaTva(false)} &nbsp;·&nbsp;
        Preţ achiziţie: ${p0.pret_achizitie ? fmtBani(p0.pret_achizitie) : '—'} ${etichetaTva(false)}
        ${p0.factura_furnizor ? ' (de la ' + escapeHtml(p0.factura_furnizor) + ', ' + fmtData(p0.factura_data) + ')' : ''}
        &nbsp;·&nbsp; Adaos: ${p0.adaos != null ? fmtProc(p0.adaos) : '—'} <small class="eticheta-tva">pe valori fără TVA</small>
      </div>
    </div>

    <h3>Stoc pe gestiune</h3>
    <div class="tabel-wrap">
      <table class="sort-client">
        <thead><tr>
          <th class="sort-sk" data-sk-type="text">Gestiune</th>
          <th class="nr sort-sk" data-sk-type="nr">Stoc</th>
          <th class="nr sort-sk" data-sk-type="nr">Pe drum</th>
          <th class="nr sort-sk" data-sk-type="nr">Val. cost<br>${etichetaTva(false)}</th>
          <th class="nr sort-sk" data-sk-type="nr">Vânzări 8 săpt. (bon)</th>
          <th class="nr sort-sk" data-sk-type="nr">Săpt. active</th>
          <th class="nr sort-sk" data-sk-type="nr">Acoperire</th>
          <th class="sort-sk" data-sk-type="text">Stare</th>
          <th class="sort-sk" data-sk-type="text">Sursă</th>
          <th class="mic sort-sk" data-sk-type="text">Ultima vânzare</th>
        </tr></thead>
        <tbody>${pozitii
          .sort((a,b) => GESTIUNI.findIndex(g => g.cod === a.cod_depozit) - GESTIUNI.findIndex(g => g.cod === b.cod_depozit))
          .map(p => {
            const bon = Number(p.v_s1||0)+Number(p.v_s2||0)+Number(p.v_s3||0)+Number(p.v_s4||0)
                      +Number(p.v_s5||0)+Number(p.v_s6||0)+Number(p.v_s7||0)+Number(p.v_s8||0);
            return `
            <tr>
              <td data-sv="${escapeHtml(gestiuneNumeFull(p.cod_depozit))}">${escapeHtml(gestiuneNumeFull(p.cod_depozit))}</td>
              <td class="nr" data-sv="${Number(p.stoc||0)}">${fmtNr(p.stoc, 2)}</td>
              <td class="nr" data-sv="${Number(p.pe_drum||0)}">${fmtNr(p.pe_drum, 2)}</td>
              <td class="nr" data-sv="${Number(p.valoare_cost||0)}">${fmtBani(p.valoare_cost)}</td>
              <td class="nr" data-sv="${bon}">${fmtNr(bon, 2)}</td>
              <td class="nr" data-sv="${Number(p.nr_sapt_vz||0)}">${fmtInt(p.nr_sapt_vz)}</td>
              <td class="nr" data-sv="${p.acoperire != null ? Number(p.acoperire) : 999999}">${p.acoperire != null ? fmtNr(p.acoperire, 1) : ''}</td>
              <td data-sv="${escapeHtml(p.stare || '')}">${stareBadge(p.stare)}</td>
              <td class="mic" data-sv="${escapeHtml(p.sursa || '')}">${escapeHtml(p.sursa || '')}</td>
              <td class="mic" data-sv="${p.ultima_vz_gestiune || ''}">${fmtData(p.ultima_vz_gestiune)}</td>
            </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>

    <h3>Vânzări pe săptămână (toate gestiunile, ultimele 20)</h3>
    <div class="tabel-wrap">
      <table class="sort-client">
        <thead><tr>
          <th class="sort-sk" data-sk-type="text">Săpt.</th>
          <th class="sort-sk" data-sk-type="text">Gestiune</th>
          <th class="nr sort-sk" data-sk-type="nr">Bon</th>
          <th class="nr sort-sk" data-sk-type="nr">Factură</th>
          <th class="nr sort-sk" data-sk-type="nr">Aviz</th>
          <th class="nr sort-sk" data-sk-type="nr">Val. cost<br>${etichetaTva(false)}</th>
        </tr></thead>
        <tbody>${(istoric || []).map(v => `
          <tr>
            <td class="mic" data-sv="${v.prima_zi || ''}">${fmtData(v.prima_zi)}</td>
            <td data-sv="${escapeHtml(gestiuneNume(v.cod_depozit))}">${escapeHtml(gestiuneNume(v.cod_depozit))}</td>
            <td class="nr" data-sv="${Number(v.cant_bon||0)}">${fmtNr(v.cant_bon, 2)}</td>
            <td class="nr" data-sv="${Number(v.cant_factura||0)}">${fmtNr(v.cant_factura, 2)}</td>
            <td class="nr" data-sv="${Number(v.cant_aviz||0)}">${fmtNr(v.cant_aviz, 2)}</td>
            <td class="nr" data-sv="${Number(v.valoare_cost||0)}">${fmtBani(v.valoare_cost)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  initSortClient();
}

function activeazaFisaLink() {
  document.querySelectorAll('tr.clickabil[data-cod]').forEach(tr => {
    tr.addEventListener('click', () => { location.hash = '#/fisa/' + encodeURIComponent(tr.dataset.cod); });
  });
}

// ============================================================================
// PAGINA 8 — ACTIVITATE (doar admin, paginata)
// ============================================================================

async function pagActivitate(filtre) {
  if (stare.utilizator.rol !== 'admin') {
    document.getElementById('continut').innerHTML = '<div class="mesaj danger">Doar administratorul.</div>';
    return;
  }

  const { data: statsUser } = await stare.client.rpc('ar_activitate_utilizatori');

  const pag = Number(filtre.pag) || 1;
  const implicitSort = { col: 'moment', dir: 'desc' };
  const constr = () => aplicaSortare(
      stare.client.from('ar_activitate').select('*', { count: 'exact' }),
      filtre, implicitSort);
  const { randuri, total, from, to } = await fetchPagina(constr, pag);

  document.getElementById('continut').innerHTML = `
    <h2 class="titlu-pagina">Activitate</h2>

    <h3>Utilizatori</h3>
    <div class="tabel-wrap">
      <table class="sort-client">
        <thead><tr>
          <th class="sort-sk" data-sk-type="text">Nume</th>
          <th class="sort-sk" data-sk-type="text">Email</th>
          <th class="sort-sk" data-sk-type="text">Rol</th>
          <th class="sort-sk" data-sk-type="text">Activ</th>
          <th class="sort-sk" data-sk-type="text">Ultima intrare</th>
          <th class="nr sort-sk" data-sk-type="nr">Zile active (30 zile)</th>
          <th class="nr sort-sk" data-sk-type="nr">Pagini deschise (7 zile)</th>
        </tr></thead>
        <tbody>${(statsUser || []).map(u => `
          <tr>
            <td data-sv="${escapeHtml(u.nume)}">${escapeHtml(u.nume)}</td>
            <td class="mic" data-sv="${escapeHtml(u.email)}">${escapeHtml(u.email)}</td>
            <td data-sv="${u.rol}"><span class="badge ${u.rol==='admin'?'ok':''}">${u.rol}</span></td>
            <td data-sv="${u.activ ? '1' : '0'}">${u.activ ? 'da' : 'nu'}</td>
            <td class="mic" data-sv="${u.ultima_intrare || ''}">${fmtDataOra(u.ultima_intrare)}</td>
            <td class="nr" data-sv="${Number(u.zile_active_30||0)}">${fmtInt(u.zile_active_30)}</td>
            <td class="nr" data-sv="${Number(u.pagini_7||0)}">${fmtInt(u.pagini_7)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <h3>Evenimente</h3>
    ${renderPaginareHTML(from, to, total, pag)}
    <div class="tabel-wrap">
      <table>
        <thead><tr>
          ${thSort('moment', 'Moment', '', filtre, implicitSort)}
          ${thSort('email', 'Utilizator', '', filtre, implicitSort)}
          ${thSort('actiune', 'Ce a făcut', '', filtre, implicitSort)}
        </tr></thead>
        <tbody>${randuri.map(e => `
          <tr>
            <td class="mic">${fmtDataOra(e.moment)}</td>
            <td class="mic">${escapeHtml(e.email)}</td>
            <td>${escapeHtml(descriereActivitate(e))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${renderPaginareHTML(from, to, total, pag)}
  `;
  activeazaPaginare();
  activeazaSortare(filtre, implicitSort);
  initSortClient();
}

// ============================================================================
// INIT
// ============================================================================

async function init() {
  initClient();

  document.getElementById('form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const parola = document.getElementById('login-parola').value;
    const eroare = document.getElementById('login-eroare');
    eroare.textContent = '';
    const { error } = await stare.client.auth.signInWithPassword({ email, password: parola });
    if (error) { eroare.textContent = 'Autentificare eşuată: ' + error.message; return; }
    await dupaLogin();
  });

  document.getElementById('btn-iesire').addEventListener('click', async () => {
    await stare.client.auth.signOut();
    stare.utilizator = null;
    document.getElementById('aplicatie').style.display = 'none';
    afisLogin();
  });

  const session = await sessionCheck();
  if (session) {
    await dupaLogin();
  } else {
    afisLogin();
  }
}

window.addEventListener('DOMContentLoaded', init);
