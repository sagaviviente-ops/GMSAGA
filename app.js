/* ============================================================
   Mesa · GM con IA
   App de un solo archivo JS, sin build ni dependencias.
   Todo el estado se guarda en localStorage del navegador.
   ============================================================ */

const STORAGE_KEY = 'mesa_gm_state_v1';
const MAX_DOC_CHARS = 6000; // por documento, para no reventar el contexto

const DEFAULT_GM_INSTRUCTIONS = `Eres el Game Master (GM) de una partida de rol narrativo. Tu trabajo:

1. Narra con ritmo de cine: escenas cortas, sensoriales, sin relleno. 2-4 párrafos por turno como máximo salvo que la escena lo pida.
2. Nunca decidas las acciones del/de la protagonista por ella/él. Describe consecuencias, no elecciones ajenas.
3. Interpreta a los PNJ con voces y motivaciones propias y consistentes. No son simples micrófonos de la trama.
4. Mantén la coherencia con la memoria de la campaña y los documentos de contexto que se te proporcionen. Si algo no está definido, invéntalo de forma consistente con el tono establecido y anótalo mentalmente para no contradecirte luego.
5. Introduce tensión, consecuencias y sorpresas, pero respeta lo que el jugador ya estableció sobre su personaje.
6. Termina casi siempre tu turno dejando espacio de decisión: una pregunta implícita, una amenaza, una elección.
7. Tono: [personalízalo aquí — ej. "oscuro y adulto", "heroico y ligero", "terror lento"].
8. Reglas de sistema (si usas alguna: D&D, PbtA, libre...): [defínelas aquí, o borra esta línea si juegas narrativo puro].

Esto es un ejemplo de plantilla por defecto. Sustitúyelo por tus propias instrucciones — este cuadro es tuyo.`;

/* ---------------- State ---------------- */

function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

function defaultState(){
  return {
    settings: {
      mode: 'google',
      googleApiKey: '',
      googleModel: 'gemma-4-31b-it',
      localUrl: 'http://localhost:11434',
      localModel: 'gemma4:12b',
      maxHistoryMessages: 20,
      warnThreshold: 40
    },
    campaigns: [],
    activeCampaignId: null
  };
}

let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...(parsed.settings||{}) } };
  }catch(e){
    console.error('No se pudo leer el estado guardado, empezando de cero.', e);
    return defaultState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveCampaign(){
  return state.campaigns.find(c => c.id === state.activeCampaignId) || null;
}

function getActiveSession(campaign){
  if(!campaign) return null;
  return campaign.sessions.find(s => s.id === campaign.activeSessionId) || null;
}

/* ---------------- Campaign / session CRUD ---------------- */

function createCampaign(name){
  const campaign = {
    id: uid(),
    name: name || 'Nueva campaña',
    gmInstructions: DEFAULT_GM_INSTRUCTIONS,
    memory: '',
    documents: [],
    sessions: [],
    activeSessionId: null
  };
  const session = createSessionObject(1);
  campaign.sessions.push(session);
  campaign.activeSessionId = session.id;
  state.campaigns.push(campaign);
  state.activeCampaignId = campaign.id;
  saveState();
  return campaign;
}

function createSessionObject(number){
  return { id: uid(), name: `Sesión ${number}`, createdAt: Date.now(), messages: [] };
}

function deleteCampaign(id){
  state.campaigns = state.campaigns.filter(c => c.id !== id);
  if(state.activeCampaignId === id){
    state.activeCampaignId = state.campaigns[0]?.id || null;
  }
  saveState();
  renderAll();
}

function newSession(campaign){
  const n = campaign.sessions.length + 1;
  const session = createSessionObject(n);
  campaign.sessions.push(session);
  campaign.activeSessionId = session.id;
  saveState();
  renderAll();
}

/* ---------------- Prompt building (token-aware) ---------------- */

function buildSystemPrompt(campaign){
  const parts = [];
  parts.push(campaign.gmInstructions?.trim() || DEFAULT_GM_INSTRUCTIONS);

  if(campaign.memory && campaign.memory.trim()){
    parts.push(`--- MEMORIA DE LA CAMPAÑA (resumen de sesiones anteriores, trátalo como hechos ya ocurridos) ---\n${campaign.memory.trim()}`);
  }

  const activeDocs = campaign.documents.filter(d => d.active);
  if(activeDocs.length){
    const docsText = activeDocs.map(d => {
      let content = d.content;
      let truncated = false;
      if(content.length > MAX_DOC_CHARS){
        content = content.slice(0, MAX_DOC_CHARS);
        truncated = true;
      }
      return `## ${d.name}${truncated ? ' (truncado por longitud)' : ''}\n${content}`;
    }).join('\n\n');
    parts.push(`--- DOCUMENTOS DE CONTEXTO ---\n${docsText}`);
  }

  return parts.join('\n\n');
}

function recentMessages(session){
  const n = state.settings.maxHistoryMessages || 20;
  return session.messages.slice(-n);
}

/* ---------------- API calls ---------------- */

async function callGoogle(systemText, messages){
  const { googleApiKey, googleModel } = state.settings;
  if(!googleApiKey) throw new Error('Falta la API key de Google en Ajustes.');

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(googleModel)}:generateContent?key=${encodeURIComponent(googleApiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents
    })
  });

  if(!res.ok){
    const errText = await res.text().catch(() => '');
    throw new Error(`Error de la API de Google (${res.status}): ${errText.slice(0,300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
  if(!text) throw new Error('La API de Google respondió sin texto. Revisa el modelo o la key.');
  return text;
}

async function callLocal(systemText, messages){
  const { localUrl, localModel } = state.settings;
  const base = (localUrl || 'http://localhost:11434').replace(/\/+$/, '');

  const chatMessages = [
    { role: 'system', content: systemText },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: localModel, messages: chatMessages, stream: false })
  });

  if(!res.ok){
    const errText = await res.text().catch(() => '');
    throw new Error(`Error del servidor local (${res.status}): ${errText.slice(0,300)}`);
  }
  const data = await res.json();
  const text = data?.message?.content ?? '';
  if(!text) throw new Error('Ollama respondió sin texto. ¿Está el modelo cargado?');
  return text;
}

async function callModel(systemText, messages){
  return state.settings.mode === 'local'
    ? callLocal(systemText, messages)
    : callGoogle(systemText, messages);
}

/* ---------------- Memory summarization ---------------- */

const SUMMARY_INSTRUCTION = `Vas a comprimir el historial de una sesión de rol en una memoria compacta para que un GM de IA la recuerde en el futuro sin gastar tokens innecesarios.

Devuelve SOLO una lista de viñetas breves (máximo 12) con: hechos ocurridos, decisiones importantes del jugador, personajes nuevos y su relación con el protagonista, objetos u objetivos pendientes, y el estado emocional/situación final de la escena. Nada de relleno narrativo, nada de "en esta sesión...". Solo hechos, en presente o pasado simple, uno por línea.`;

async function summarizeSession(campaign, session){
  if(!session.messages.length) return '';
  const transcript = session.messages
    .map(m => `${m.role === 'user' ? 'Jugador' : 'GM'}: ${m.content}`)
    .join('\n');

  const text = await callModel(SUMMARY_INSTRUCTION, [
    { role: 'user', content: transcript.slice(0, 20000) }
  ]);
  return text.trim();
}

async function summarizeAndMerge(campaign, session, { silent=false } = {}){
  setStatus('Resumiendo sesión…');
  try{
    const summary = await summarizeSession(campaign, session);
    if(summary){
      campaign.memory = campaign.memory
        ? `${campaign.memory.trim()}\n\n[${session.name}]\n${summary}`
        : `[${session.name}]\n${summary}`;
      saveState();
    }
    if(!silent) setStatus('Memoria actualizada.');
  }catch(e){
    setStatus('No se pudo resumir: ' + e.message, true);
  }
}

/* ---------------- Chat sending ---------------- */

async function sendMessage(text){
  const campaign = getActiveCampaign();
  const session = getActiveSession(campaign);
  if(!campaign || !session || !text.trim()) return;

  session.messages.push({ role: 'user', content: text.trim(), ts: Date.now() });
  saveState();
  renderChat();

  setSending(true);
  setStatus('El GM está pensando…');
  try{
    const systemText = buildSystemPrompt(campaign);
    const history = recentMessages(session);
    const reply = await callModel(systemText, history);
    session.messages.push({ role: 'assistant', content: reply, ts: Date.now() });
    saveState();
    renderChat();
    setStatus('');
  }catch(e){
    session.messages.push({ role: 'system', content: '⚠ ' + e.message, ts: Date.now() });
    saveState();
    renderChat();
    setStatus('');
  }finally{
    setSending(false);
  }
}

/* ---------------- Rendering ---------------- */

const el = sel => document.querySelector(sel);
const els = sel => Array.from(document.querySelectorAll(sel));

function renderAll(){
  renderCampaignList();
  renderCampaignView();
}

function renderCampaignList(){
  const list = el('#campaign-list');
  list.innerHTML = '';
  state.campaigns.forEach(c => {
    const item = document.createElement('div');
    item.className = 'rail-item' + (c.id === state.activeCampaignId ? ' is-active' : '');
    item.innerHTML = `<span>${escapeHtml(c.name)}</span><button class="rail-item-del" title="Borrar campaña">×</button>`;
    item.addEventListener('click', (e) => {
      if(e.target.closest('.rail-item-del')) return;
      state.activeCampaignId = c.id;
      saveState();
      renderAll();
    });
    item.querySelector('.rail-item-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if(confirm(`¿Borrar la campaña "${c.name}"? Esto elimina también su memoria e historial.`)){
        deleteCampaign(c.id);
      }
    });
    list.appendChild(item);
  });
}

function renderCampaignView(){
  const campaign = getActiveCampaign();
  el('#empty-state').hidden = !!campaign;
  el('#campaign-view').hidden = !campaign;
  el('#session-section').hidden = !campaign;
  if(!campaign) return;

  el('#campaign-name').value = campaign.name;

  const session = getActiveSession(campaign);
  el('#session-name').textContent = session ? session.name : '';

  renderSessionList(campaign);
  renderChat();

  const threshold = state.settings.warnThreshold || 40;
  el('#token-banner').hidden = !(session && session.messages.length >= threshold);
}

function renderSessionList(campaign){
  const list = el('#session-list');
  list.innerHTML = '';
  campaign.sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = 'rail-item' + (s.id === campaign.activeSessionId ? ' is-active' : '');
    item.innerHTML = `<span>${escapeHtml(s.name)}</span><span class="doc-item-meta">${s.messages.length}</span>`;
    item.addEventListener('click', () => {
      campaign.activeSessionId = s.id;
      saveState();
      renderCampaignView();
    });
    list.appendChild(item);
  });
}

function renderChat(){
  const campaign = getActiveCampaign();
  const session = getActiveSession(campaign);
  const log = el('#chat-log');
  log.innerHTML = '';
  if(!session) return;
  session.messages.forEach(m => {
    const div = document.createElement('div');
    if(m.role === 'user') div.className = 'msg msg-user';
    else if(m.role === 'assistant') div.className = 'msg msg-gm';
    else div.className = 'msg msg-system';
    div.textContent = m.content;
    log.appendChild(div);
  });
  const scroller = el('#chat-scroll');
  scroller.scrollTop = scroller.scrollHeight;
}

function setSending(isSending){
  el('#btn-send').disabled = isSending;
}

function setStatus(text, isError){
  const s = el('#composer-status');
  s.textContent = text || '';
  s.style.color = isError ? '#c77' : '';
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ---------------- Modals ---------------- */

function openModal(id){ el(id).hidden = false; }
function closeModal(id){ el(id).hidden = true; }

els('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('.modal-backdrop').hidden = true);
});
els('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', (e) => { if(e.target === backdrop) backdrop.hidden = true; });
});

/* ---------------- Wiring: campaigns / sessions ---------------- */

el('#btn-new-campaign').addEventListener('click', () => {
  const name = prompt('Nombre de la nueva campaña:', 'Nueva campaña');
  if(name === null) return;
  createCampaign(name.trim() || 'Nueva campaña');
  renderAll();
});

el('#btn-new-session').addEventListener('click', async () => {
  const campaign = getActiveCampaign();
  const current = getActiveSession(campaign);
  if(!campaign || !current) return;
  if(current.messages.length && confirm('¿Resumir la sesión actual en la memoria de la campaña antes de abrir una nueva?')){
    await summarizeAndMerge(campaign, current);
  }
  newSession(campaign);
});

el('#campaign-name').addEventListener('change', (e) => {
  const campaign = getActiveCampaign();
  if(!campaign) return;
  campaign.name = e.target.value.trim() || campaign.name;
  saveState();
  renderCampaignList();
});

/* ---------------- Wiring: GM instructions modal ---------------- */

el('#btn-gm').addEventListener('click', () => {
  const campaign = getActiveCampaign();
  if(!campaign) return;
  el('#gm-instructions-text').value = campaign.gmInstructions || '';
  openModal('#modal-gm');
});
el('#btn-gm-save').addEventListener('click', () => {
  const campaign = getActiveCampaign();
  campaign.gmInstructions = el('#gm-instructions-text').value;
  saveState();
  closeModal('#modal-gm');
});
el('#btn-gm-restore-default').addEventListener('click', () => {
  el('#gm-instructions-text').value = DEFAULT_GM_INSTRUCTIONS;
});
el('#btn-gm-clear').addEventListener('click', () => {
  if(confirm('¿Vaciar las instrucciones del GM de esta campaña?')) el('#gm-instructions-text').value = '';
});

/* ---------------- Wiring: documents modal ---------------- */

el('#btn-docs').addEventListener('click', () => {
  renderDocList();
  openModal('#modal-docs');
});
el('#btn-doc-upload').addEventListener('click', () => el('#doc-upload').click());
el('#doc-upload').addEventListener('change', async (e) => {
  const campaign = getActiveCampaign();
  if(!campaign) return;
  const files = Array.from(e.target.files || []);
  for(const file of files){
    const content = await file.text();
    campaign.documents.push({ id: uid(), name: file.name, content, active: true });
  }
  saveState();
  renderDocList();
  e.target.value = '';
});

function renderDocList(){
  const campaign = getActiveCampaign();
  const list = el('#doc-list');
  list.innerHTML = '';
  if(!campaign) return;
  campaign.documents.forEach(d => {
    const item = document.createElement('div');
    item.className = 'doc-item';
    const sizeKb = Math.round(d.content.length / 1024 * 10) / 10;
    item.innerHTML = `
      <input type="checkbox" ${d.active ? 'checked' : ''}>
      <span class="doc-item-name">${escapeHtml(d.name)}</span>
      <span class="doc-item-meta">${sizeKb} KB</span>
      <button class="doc-item-del">×</button>
    `;
    item.querySelector('input').addEventListener('change', (e) => {
      d.active = e.target.checked;
      saveState();
    });
    item.querySelector('.doc-item-del').addEventListener('click', () => {
      campaign.documents = campaign.documents.filter(x => x.id !== d.id);
      saveState();
      renderDocList();
    });
    list.appendChild(item);
  });
}

/* ---------------- Wiring: memory modal ---------------- */

el('#btn-memory').addEventListener('click', () => {
  const campaign = getActiveCampaign();
  if(!campaign) return;
  el('#memory-text').value = campaign.memory || '';
  openModal('#modal-memory');
});
el('#btn-memory-save').addEventListener('click', () => {
  const campaign = getActiveCampaign();
  campaign.memory = el('#memory-text').value;
  saveState();
  closeModal('#modal-memory');
  renderCampaignView();
});
el('#btn-summarize-now').addEventListener('click', async () => {
  const campaign = getActiveCampaign();
  const session = getActiveSession(campaign);
  if(!campaign || !session) return;
  await summarizeAndMerge(campaign, session);
  el('#memory-text').value = campaign.memory || '';
});
el('#btn-suggest-summarize').addEventListener('click', async () => {
  const campaign = getActiveCampaign();
  const session = getActiveSession(campaign);
  if(!campaign || !session) return;
  await summarizeAndMerge(campaign, session);
  newSession(campaign);
});

/* ---------------- Wiring: settings modal ---------------- */

el('#btn-settings').addEventListener('click', () => {
  el('#setting-mode').value = state.settings.mode;
  el('#setting-google-key').value = state.settings.googleApiKey;
  el('#setting-google-model').value = state.settings.googleModel;
  el('#setting-local-url').value = state.settings.localUrl;
  el('#setting-local-model').value = state.settings.localModel;
  el('#setting-max-history').value = state.settings.maxHistoryMessages;
  el('#setting-warn-threshold').value = state.settings.warnThreshold;
  openModal('#modal-settings');
});

els('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    els('.tab-btn').forEach(b => b.classList.remove('is-active'));
    els('.tab-panel').forEach(p => p.classList.remove('is-active'));
    btn.classList.add('is-active');
    el(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add('is-active');
  });
});

el('#btn-settings-save').addEventListener('click', () => {
  state.settings.mode = el('#setting-mode').value;
  state.settings.googleApiKey = el('#setting-google-key').value.trim();
  state.settings.googleModel = el('#setting-google-model').value;
  state.settings.localUrl = el('#setting-local-url').value.trim() || 'http://localhost:11434';
  state.settings.localModel = el('#setting-local-model').value.trim() || 'gemma4:12b';
  state.settings.maxHistoryMessages = parseInt(el('#setting-max-history').value, 10) || 20;
  state.settings.warnThreshold = parseInt(el('#setting-warn-threshold').value, 10) || 40;
  saveState();
  closeModal('#modal-settings');
  renderCampaignView();
});

/* ---------------- Wiring: composer ---------------- */

el('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = el('#composer-input');
  const text = input.value;
  if(!text.trim()) return;
  input.value = '';
  sendMessage(text);
});
el('#composer-input').addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    el('#composer').requestSubmit();
  }
});

/* ---------------- Boot ---------------- */

renderAll();
