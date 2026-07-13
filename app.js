import { isSupabaseConfigured, supabase } from "./js/supabase-client.js";
import { criarObra, listarObras } from "./js/obras-service.js";
import { criarContato, listarContatos } from "./js/contatos-service.js";
import {
  atualizarDespesa,
  criarDespesa,
  listarDespesas,
  obterUrlComprovante,
  removerComprovante,
  uploadComprovante
} from "./js/despesas-service.js";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const defaultObjective =
  "Definir soluções técnicas, pendências, responsáveis e prazos combinados em reunião de obra.";

const topics = [
  {
    id: "cozinha-revestimento",
    name: "Cozinha - revestimento sobre revestimento",
    hint: "Validacao tecnica do assentamento sobre o revestimento existente.",
    items: [
      "Revestimento existente possui pecas ocas?",
      "E tecnicamente viavel assentar sobre o revestimento atual?",
      "Espessura final interfere no batente?",
      "Guarnicoes laqueadas poderao ser reaproveitadas?",
      "Sera necessario engrossar alguma parede?",
      "Acabamento junto ao batente foi definido?",
      "Tipo de argamassa definido?",
      "Necessario regularizar alguma area?"
    ]
  },
  {
    id: "protecao-portas-batentes",
    name: "Protecao de portas e batentes",
    hint: "Registro e protecao das portas, batentes e guarnicoes laqueadas.",
    items: [
      "Portas foram fotografadas antes da obra?",
      "Batentes serao protegidos?",
      "Guarnicoes serao protegidas?",
      "Protecao sera feita com filme plastico?",
      "Protecao tera papelao, MDF fino ou material rigido?",
      "Fita usada sera segura para laca?",
      "Esta proibido apoiar ferramentas nas portas?",
      "Responsável pela proteção foi definido?"
    ]
  },
  {
    id: "terraco-piso-caimento",
    name: "Terraco - piso sobre piso e caimento",
    hint: "Verificacao de espessura final, niveis, caimento e risco de empocamento.",
    items: [
      "Piso sobre piso e viavel?",
      "Soleira permite aumento de espessura?",
      "Foi levantado o nivel atual do piso?",
      "Caimento para o guarda-corpo e viavel?",
      "Caimento apenas para um lado exige muita altura no lado oposto?",
      "Existe risco de empocamento?",
      "Altura final do piso foi aprovada?",
      "Regularizacao com argamassa e suficiente?"
    ]
  },
  {
    id: "ralo-linear-terraco",
    name: "Ralo linear no terraco",
    hint: "Viabilidade, ligacao, impermeabilizacao e manutencao do ralo linear.",
    items: [
      "Ralo linear junto ao guarda-corpo e viavel?",
      "Ha ponto de escoamento proximo?",
      "Ligacao ao esgoto/pluvial foi confirmada?",
      "Impermeabilizacao ao redor do ralo foi considerada?",
      "Comprimento do ralo foi definido?",
      "Limpeza/manutencao futura foi considerada?"
    ]
  },
  {
    id: "nicho-adega",
    name: "Nicho para adega",
    hint: "Demolicao, instalacoes existentes, dimensoes e fechamento do nicho.",
    items: [
      "Parede pode ser demolida nesse trecho?",
      "Parede nao e estrutural?",
      "Existe eletrica na parede?",
      "Existe hidraulica na parede?",
      "Profundidade necessaria da adega foi confirmada?",
      "Dimensoes exatas do nicho foram medidas?",
      "Fechamento pelo comodo oposto foi definido?",
      "Drywall e adequado para esse fechamento?",
      "Placa cimenticia seria melhor?",
      "Tratamento contra fissuras foi definido?"
    ]
  },
  {
    id: "banheira-agua-esgoto",
    name: "Banheira - agua e esgoto",
    hint: "Localizacao dos pontos e area de demolicao necessaria para instalacao.",
    items: [
      "Ponto de agua foi localizado?",
      "Ponto de esgoto foi localizado?",
      "Os pontos estao na fileira central proxima a parede?",
      "E possivel remover apenas o piso que ficara sob a banheira?",
      "Sera necessario quebrar alem da area coberta pela banheira?",
      "Altura/posicao do esgoto atende a banheira?",
      "Fotos serao feitas antes da demolicao?"
    ]
  }
];

const noteFields = [
  { key: "decisaoFinal", label: "Decisão final" },
  { key: "pendencia", label: "Pendência" },
  { key: "responsavel", label: "Responsável" },
  { key: "prazo", label: "Prazo" },
  { key: "fotosNecessarias", label: "Fotos necessárias" }
];

let session = null;
let obras = [];
let contatos = [];
let despesas = [];
let currentObra = null;
let activeDespesaFilter = "todas";
let activeMeetingTopic = topics[0].id;
let currentView = "login";
let handledInitialSession = false;
let homeLoadPromise = null;
let editingDespesa = null;
let oauthAuthorizationDetails = null;
let oauthFlowInProgress = false;
let oauthBootstrapStarted = false;
let oauthDetailsRequested = false;
let oauthRedirectStarted = false;
let oauthLoginSubmitted = false;
let oauthDetailsRequestCount = 0;
const oauthLoadPromises = new Map();
let comprovanteState = {
  file: null,
  path: null,
  originalPath: null,
  warning: null,
  previewUrl: null,
  signedUrl: null,
  removed: false,
  uploadPromise: null
};
let comprovanteUploadSeq = 0;

const els = {
  messageArea: document.querySelector("#messageArea"),
  loginView: document.querySelector("#loginView"),
  oauthConsentView: document.querySelector("#oauthConsentView"),
  oauthClientName: document.querySelector("#oauthClientName"),
  oauthUserEmail: document.querySelector("#oauthUserEmail"),
  oauthScopes: document.querySelector("#oauthScopes"),
  approveOAuthButton: document.querySelector("#approveOAuthButton"),
  denyOAuthButton: document.querySelector("#denyOAuthButton"),
  obrasView: document.querySelector("#obrasView"),
  obraDetailView: document.querySelector("#obraDetailView"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  sessionBar: document.querySelector("#sessionBar"),
  userEmail: document.querySelector("#userEmail"),
  logoutButton: document.querySelector("#logoutButton"),
  newObraButton: document.querySelector("#newObraButton"),
  obraForm: document.querySelector("#obraForm"),
  obrasList: document.querySelector("#obrasList"),
  backToObras: document.querySelector("#backToObras"),
  obraTitle: document.querySelector("#obraTitle"),
  obraMeta: document.querySelector("#obraMeta"),
  totalDespesas: document.querySelector("#totalDespesas"),
  despesasAClassificar: document.querySelector("#despesasAClassificar"),
  newDespesaButton: document.querySelector("#newDespesaButton"),
  despesaForm: document.querySelector("#despesaForm"),
  despesaFormTitle: document.querySelector("#despesaFormTitle"),
  saveDespesaButton: document.querySelector("#saveDespesaButton"),
  cancelDespesaButton: document.querySelector("#cancelDespesaButton"),
  despesaObraNome: document.querySelector("#despesaObraNome"),
  comprovanteInput: document.querySelector("#comprovanteInput"),
  comprovanteDropZone: document.querySelector("#comprovanteDropZone"),
  comprovanteEmpty: document.querySelector("#comprovanteEmpty"),
  comprovantePreview: document.querySelector("#comprovantePreview"),
  comprovanteThumb: document.querySelector("#comprovanteThumb"),
  comprovanteName: document.querySelector("#comprovanteName"),
  comprovanteStatus: document.querySelector("#comprovanteStatus"),
  selectComprovanteButton: document.querySelector("#selectComprovanteButton"),
  openComprovanteButton: document.querySelector("#openComprovanteButton"),
  replaceComprovanteButton: document.querySelector("#replaceComprovanteButton"),
  removeComprovanteButton: document.querySelector("#removeComprovanteButton"),
  contatoSearch: document.querySelector("#contatoSearch"),
  contatosOptions: document.querySelector("#contatosOptions"),
  quickContactPanel: document.querySelector("#quickContactPanel"),
  quickContatoNome: document.querySelector("#quickContatoNome"),
  quickContatoTipo: document.querySelector("#quickContatoTipo"),
  quickContatoTelefone: document.querySelector("#quickContatoTelefone"),
  quickContatoEmail: document.querySelector("#quickContatoEmail"),
  saveQuickContact: document.querySelector("#saveQuickContact"),
  despesasList: document.querySelector("#despesasList"),
  despesasSection: document.querySelector("#despesasSection"),
  reunioesSection: document.querySelector("#reunioesSection"),
  topicTabs: document.querySelector("#topicTabs"),
  meetingSectionTitle: document.querySelector("#meetingSectionTitle"),
  checklistHeading: document.querySelector("#checklistHeading"),
  checklistHint: document.querySelector("#checklistHint"),
  checklistBody: document.querySelector("#checklistBody"),
  completionBadge: document.querySelector("#completionBadge"),
  clearSection: document.querySelector("#clearSection"),
  exportPdf: document.querySelector("#exportPdf"),
  printAll: document.querySelector("#printAll")
};

init().catch((error) => {
  console.error(error);
  showMessage(error.message || "Não foi possível iniciar o SOO.", "error");
  if (isOAuthConsentRoute()) {
    renderOAuthConsentShell();
  } else {
    showView("login");
  }
});

async function init() {
  bindEvents();
  registerServiceWorker();

  if (!isSupabaseConfigured) {
    showMessage("Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY em js/supabase-client.js para conectar ao projeto SOO.", "warning");
    showView("login");
    return;
  }

  supabase.auth.onAuthStateChange(handleAuthStateChange);

  const { data } = await supabase.auth.getSession();
  if (!handledInitialSession) {
    handledInitialSession = true;
    session = data.session;
    if (isOAuthConsentRoute()) {
      await loadOAuthConsent();
    } else if (session) {
      await loadHomeOnce();
    } else {
      showView("login");
    }
  }
}

function handleAuthStateChange(event, nextSession) {
  session = nextSession;

  if (event === "INITIAL_SESSION") {
    if (handledInitialSession) return;
    handledInitialSession = true;
    if (isOAuthConsentRoute()) {
      return;
    } else if (session) {
      loadHomeOnce();
    } else {
      showView("login");
    }
    return;
  }

  if (event === "SIGNED_IN") {
    if (!session) {
      showView("login");
      return;
    }
    if (isOAuthConsentRoute()) {
      if (oauthBootstrapStarted && oauthLoginSubmitted && !oauthDetailsRequested && !oauthRedirectStarted) {
        oauthLoginSubmitted = false;
        loadOAuthConsent();
      }
      return;
    }
    if (currentView === "login") {
      loadHomeOnce();
    }
    return;
  }

  if (event === "SIGNED_OUT") {
    currentObra = null;
    contatos = [];
    despesas = [];
    if (isOAuthConsentRoute()) {
      showOAuthLogin();
      return;
    }
    showView("login");
    return;
  }

  if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
    return;
  }
}

async function loadHomeOnce() {
  if (!homeLoadPromise) {
    homeLoadPromise = loadHome().finally(() => {
      homeLoadPromise = null;
    });
  }
  return homeLoadPromise;
}

function bindEvents() {
  els.loginForm.addEventListener("submit", handleLogin);
  els.logoutButton.addEventListener("click", () => supabase.auth.signOut());
  els.approveOAuthButton.addEventListener("click", () => completeOAuthConsent("approve"));
  els.denyOAuthButton.addEventListener("click", () => completeOAuthConsent("deny"));
  els.newObraButton.addEventListener("click", () => toggleForm(els.obraForm, true));
  els.obraForm.addEventListener("submit", handleCreateObra);
  els.backToObras.addEventListener("click", () => loadHome());
  els.newDespesaButton.addEventListener("click", () => openDespesaForm());
  els.despesaForm.addEventListener("submit", handleCreateDespesa);
  els.cancelDespesaButton.addEventListener("click", cancelDespesaForm);
  els.selectComprovanteButton.addEventListener("click", () => els.comprovanteInput.click());
  els.replaceComprovanteButton.addEventListener("click", () => els.comprovanteInput.click());
  els.openComprovanteButton.addEventListener("click", openComprovante);
  els.comprovanteInput.addEventListener("change", () => handleComprovanteFile(els.comprovanteInput.files?.[0]));
  els.removeComprovanteButton.addEventListener("click", removeComprovanteFromForm);
  els.comprovanteDropZone.addEventListener("dragover", handleComprovanteDragOver);
  els.comprovanteDropZone.addEventListener("dragleave", () => els.comprovanteDropZone.classList.remove("dragging"));
  els.comprovanteDropZone.addEventListener("drop", handleComprovanteDrop);
  document.addEventListener("paste", handleComprovantePaste);
  els.contatoSearch.addEventListener("input", handleContactSearch);
  els.saveQuickContact.addEventListener("click", handleQuickContact);
  els.clearSection.addEventListener("click", clearCurrentMeetingTopic);
  els.exportPdf.addEventListener("click", exportMeetingPdf);

  document.querySelectorAll("[data-close-form]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = document.querySelector(`#${button.dataset.closeForm}`);
      toggleForm(form, false);
    });
  });

  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", () => {
      activeDespesaFilter = button.dataset.filter;
      document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item === button));
      renderDespesas();
    });
  });

  document.querySelectorAll(".section-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const isMeetings = button.dataset.section === "reunioes";
      document.querySelectorAll(".section-tab").forEach((item) => item.classList.toggle("active", item === button));
      els.despesasSection.hidden = isMeetings;
      els.reunioesSection.hidden = !isMeetings;
      if (isMeetings) renderMeetings();
    });
  });

  document.querySelectorAll("[data-store]").forEach((field) => {
    field.addEventListener("input", () => {
      const state = getMeetingState();
      setByPath(state, field.dataset.store, field.value);
      saveMeetingState(state);
    });
  });

  document.querySelectorAll("[data-section-field]").forEach((field) => {
    field.addEventListener("input", () => {
      const state = getMeetingState();
      const topicState = getTopicState(state, activeMeetingTopic);
      topicState.notes[field.dataset.sectionField] = field.value;
      saveMeetingState(state);
    });
  });
}

async function handleLogin(event) {
  event.preventDefault();
  clearMessage();
  if (!supabase) {
    showMessage("Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY antes de entrar.", "warning");
    return;
  }
  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;
  try {
    if (isOAuthConsentRoute()) oauthLoginSubmitted = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showMessage("Login realizado com sucesso.", "success");
  } catch (error) {
    oauthLoginSubmitted = false;
    showMessage("Email ou senha incorretos. Verifique os dados e tente novamente.", "error");
  }
}

function isOAuthConsentRoute() {
  return window.location.pathname === "/oauth/consent";
}

function getOAuthAuthorizationId() {
  return new URLSearchParams(window.location.search).get("authorization_id");
}

async function loadOAuthConsent() {
  clearMessage();
  oauthBootstrapStarted = true;
  if (!supabase) {
    showMessage("Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY antes de autorizar o conector.", "warning");
    showView("login");
    return;
  }

  const authorizationId = getOAuthAuthorizationId();
  if (!authorizationId) {
    showMessage("Link de autorização inválido: authorization_id ausente.", "error");
    showView("login");
    return;
  }

  const cachedRedirectUrl = getProcessedOAuthRedirectUrl(authorizationId);
  if (cachedRedirectUrl) {
    oauthRedirectStarted = true;
    window.location.replace(cachedRedirectUrl);
    return;
  }

  if (oauthLoadPromises.has(authorizationId)) {
    return oauthLoadPromises.get(authorizationId);
  }

  if (oauthFlowInProgress) return;

  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (!session?.user) {
    showOAuthLogin();
    return;
  }

  const loadPromise = loadOAuthConsentDetailsOnce(authorizationId);
  oauthLoadPromises.set(authorizationId, loadPromise);
  return loadPromise;
}

async function loadOAuthConsentDetailsOnce(authorizationId) {
  oauthFlowInProgress = true;
  let redirecting = false;
  try {
    const details = await fetchOAuthAuthorizationDetails(authorizationId);
    oauthAuthorizationDetails = details;
    const redirectInfo = getOAuthRedirectInfo(details);
    logOAuthDebug("authorization details received", {
      authorization_id: authorizationId,
      auto_approved: details?.auto_approved === true,
      redirect_field: redirectInfo.field || null
    });
    if (details?.auto_approved === true && redirectInfo.url) {
      rememberProcessedOAuthRedirectUrl(authorizationId, redirectInfo.url);
      oauthRedirectStarted = true;
      redirecting = true;
      window.location.replace(redirectInfo.url);
      return;
    }
    renderOAuthConsent(details);
  } catch (error) {
    const redirectUrl = getProcessedOAuthRedirectUrl(authorizationId);
    if (redirectUrl) {
      redirecting = true;
      oauthRedirectStarted = true;
      window.location.replace(redirectUrl);
      return;
    }
    if (error.status === 400) {
      showMessage("Esta solicitação já foi processada. Feche esta aba e conecte novamente pelo ChatGPT.", "error");
      setOAuthButtonsVisible(false);
      showView("oauthConsent");
      return;
    }
    showMessage(error.message || "Não foi possível carregar os detalhes de autorização.", "error");
    renderOAuthConsentShell("Não foi possível carregar o aplicativo solicitante.", ["openid", "email", "profile"]);
    setOAuthButtonsEnabled(false);
  } finally {
    if (!redirecting) oauthFlowInProgress = false;
  }
}

function showOAuthLogin() {
  showView("login");
  els.sessionBar.hidden = true;
  showMessage("Entre no SOO para autorizar a conexão com o ChatGPT.", "info");
}

function renderOAuthConsentShell(clientMessage = "ChatGPT quer acessar sua conta SOO.", scopes = []) {
  els.userEmail.textContent = session?.user?.email || "";
  els.sessionBar.hidden = !session?.user;
  els.oauthClientName.textContent = clientMessage;
  els.oauthUserEmail.textContent = session?.user?.email ? `Usuário logado: ${session.user.email}` : "Faça login para continuar.";
  renderOAuthScopes(scopes.length ? scopes : ["openid", "email", "profile"]);
  setOAuthButtonsEnabled(Boolean(session?.user));
  showView("oauthConsent");
}

function renderOAuthConsent(details) {
  const client = details?.client || details?.client_metadata || details?.oauth_client || {};
  const clientName = client.client_name || client.name || details?.client_name || "ChatGPT";
  const scopes = details?.scopes || details?.scope || details?.requested_scopes || details?.requestedScopes || [];
  const scopeList = normalizeScopes(scopes);

  els.userEmail.textContent = session?.user?.email || "";
  els.sessionBar.hidden = false;
  els.oauthClientName.textContent = `${clientName} quer acessar sua conta SOO.`;
  els.oauthUserEmail.textContent = `Usuário logado: ${session?.user?.email || "não identificado"}`;
  renderOAuthScopes(scopeList.length ? scopeList : ["openid", "email", "profile"]);
  setOAuthButtonsVisible(true);
  setOAuthButtonsEnabled(true);
  showView("oauthConsent");
}

function renderOAuthScopes(scopes) {
  els.oauthScopes.innerHTML = "";
  scopes.forEach((scope) => {
    const item = document.createElement("li");
    item.textContent = scope;
    els.oauthScopes.append(item);
  });
}

function normalizeScopes(scopes) {
  if (Array.isArray(scopes)) return scopes.filter(Boolean);
  return String(scopes || "").split(/\s+/).filter(Boolean);
}

function setOAuthButtonsEnabled(enabled) {
  els.approveOAuthButton.disabled = !enabled;
  els.denyOAuthButton.disabled = !enabled;
}

function setOAuthButtonsVisible(visible) {
  els.approveOAuthButton.hidden = !visible;
  els.denyOAuthButton.hidden = !visible;
}

async function completeOAuthConsent(action) {
  clearMessage();
  if (oauthFlowInProgress) return;
  oauthFlowInProgress = true;
  setOAuthButtonsEnabled(false);
  const authorizationId = getOAuthAuthorizationId();
  if (!authorizationId) {
    showMessage("Link de autorização inválido.", "error");
    setOAuthButtonsEnabled(true);
    oauthFlowInProgress = false;
    return;
  }

  try {
    const data = await submitOAuthConsent(authorizationId, action);
    const redirectUrl = getOAuthRedirectUrl(data) || getOAuthRedirectUrl(oauthAuthorizationDetails);
    if (!redirectUrl) throw new Error("Supabase não retornou redirect_url.");
    rememberProcessedOAuthRedirectUrl(authorizationId, redirectUrl);
    oauthRedirectStarted = true;
    window.location.replace(redirectUrl);
  } catch (error) {
    showMessage(error.message || "Não foi possível concluir a autorização.", "error");
    setOAuthButtonsEnabled(true);
    oauthFlowInProgress = false;
  }
}

function getOAuthRedirectUrl(data) {
  return getOAuthRedirectInfo(data).url;
}

function getOAuthRedirectInfo(data) {
  const directFields = ["redirect_url", "redirectTo", "redirect_uri", "redirect_to", "url"];
  for (const field of directFields) {
    if (typeof data?.[field] === "string" && data[field]) {
      return { field, url: data[field] };
    }
  }
  for (const [field, value] of Object.entries(data || {})) {
    if (field.toLowerCase().includes("redirect") && typeof value === "string" && value) {
      return { field, url: value };
    }
  }
  return { field: "", url: "" };
}

function getProcessedOAuthRedirectUrl(authorizationId) {
  try {
    return sessionStorage.getItem(oauthRedirectStorageKey(authorizationId)) || "";
  } catch {
    return "";
  }
}

function rememberProcessedOAuthRedirectUrl(authorizationId, redirectUrl) {
  try {
    sessionStorage.setItem(oauthRedirectStorageKey(authorizationId), redirectUrl);
  } catch {
    // Best-effort guard against duplicate OAuth processing after reloads.
  }
}

function oauthRedirectStorageKey(authorizationId) {
  return `soo.oauth.redirect.${authorizationId}`;
}

async function submitOAuthConsent(authorizationId, action) {
  const oauth = supabase.auth.oauth;
  const method = action === "approve" ? "approveAuthorization" : "denyAuthorization";
  if (oauth?.[method]) {
    const { data, error } = await oauth[method](authorizationId, { skipBrowserRedirect: true });
    if (error) throw error;
    return data;
  }
  return fetchOAuthConsent(authorizationId, action);
}

async function fetchOAuthAuthorizationDetails(authorizationId) {
  const token = await getCurrentAccessToken();
  oauthDetailsRequested = true;
  oauthDetailsRequestCount += 1;
  logOAuthDebug("authorization details request started", {
    authorization_id: authorizationId,
    request_count: oauthDetailsRequestCount
  });
  const response = await fetch(`${supabase.supabaseUrl}/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}`, {
    headers: oauthRequestHeaders(token)
  });
  const payload = await response.json().catch(() => null);
  const redirectInfo = getOAuthRedirectInfo(payload);
  logOAuthDebug("authorization details response", {
    authorization_id: authorizationId,
    request_count: oauthDetailsRequestCount,
    status: response.status,
    json_keys: Object.keys(payload || {}),
    auto_approved: payload?.auto_approved === true,
    redirect_field: redirectInfo.field || null
  });
  if (!response.ok) {
    const error = new Error(payload?.msg || payload?.message || payload?.error_description || payload?.error || `Supabase retornou ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function fetchOAuthConsent(authorizationId, action) {
  const token = await getCurrentAccessToken();
  const response = await fetch(`${supabase.supabaseUrl}/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}/consent`, {
    method: "POST",
    headers: { ...oauthRequestHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ action })
  });
  return parseOAuthResponse(response);
}

async function getCurrentAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Entre novamente para continuar.");
  return token;
}

function oauthRequestHeaders(token) {
  return {
    apikey: supabase.supabaseKey,
    authorization: `Bearer ${token}`,
    accept: "application/json"
  };
}

function logOAuthDebug(message, data = {}) {
  console.info("[SOO OAuth]", message, data);
}

async function parseOAuthResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || payload?.error_description || payload?.error || `Supabase retornou ${response.status}`);
  }
  return payload;
}

async function loadHome() {
  if (!session?.user) return showView("login");
  showView("obras");
  els.userEmail.textContent = session.user.email || "";
  els.sessionBar.hidden = false;
  try {
    obras = await listarObras(session.user.id);
    renderObras();
  } catch (error) {
    await cleanupUnsavedComprovante();
    showMessage(error.message, "error");
  }
}

async function handleCreateObra(event) {
  event.preventDefault();
  clearMessage();
  const data = Object.fromEntries(new FormData(els.obraForm).entries());
  try {
    const obra = await criarObra(session.user.id, data);
    obras = [obra, ...obras];
    els.obraForm.reset();
    toggleForm(els.obraForm, false);
    showMessage("Obra criada com sucesso.", "success");
    await openObra(obra.id);
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function openObra(obraId) {
  currentObra = obras.find((obra) => obra.id === obraId);
  if (!currentObra) return;

  showView("obra");
  els.obraTitle.textContent = currentObra.nome;
  els.obraMeta.textContent = [currentObra.cliente, currentObra.cidade, statusLabel(currentObra.status)].filter(Boolean).join(" • ");
  els.despesaObraNome.value = currentObra.nome;
  els.meetingSectionTitle.textContent = `Reuniões - ${currentObra.nome}`;

  try {
    [contatos, despesas] = await Promise.all([
      listarContatos(session.user.id),
      listarDespesas(session.user.id, currentObra.id)
    ]);
    renderContatosOptions();
    renderObraSummary();
    renderDespesas();
    renderMeetings();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

function openDespesaForm() {
  editingDespesa = null;
  els.despesaForm.reset();
  clearComprovante();
  els.despesaFormTitle.textContent = "Nova despesa";
  els.saveDespesaButton.textContent = "Salvar despesa";
  els.despesaObraNome.value = currentObra.nome;
  els.despesaForm.elements.data.valueAsDate = new Date();
  els.despesaForm.elements.categoria.value = "A classificar";
  els.contatoSearch.dataset.contatoId = "";
  els.quickContactPanel.hidden = true;
  toggleForm(els.despesaForm, true);
}

async function openEditDespesa(despesaId) {
  const despesa = despesas.find((item) => item.id === despesaId);
  if (!despesa) return;
  editingDespesa = despesa;
  els.despesaForm.reset();
  clearComprovante();
  els.despesaFormTitle.textContent = "Editar despesa";
  els.saveDespesaButton.textContent = "Salvar alterações";
  els.despesaObraNome.value = currentObra.nome;
  els.despesaForm.elements.descricao.value = despesa.descricao || "";
  els.despesaForm.elements.valor.value = despesa.valor ?? "";
  els.despesaForm.elements.data.value = despesa.data || "";
  els.despesaForm.elements.quem_pagou.value = despesa.quem_pagou || "";
  els.despesaForm.elements.categoria.value = despesa.categoria || "A classificar";
  els.despesaForm.elements.observacao.value = despesa.observacao || "";

  const contato = contatos.find((item) => item.id === despesa.contato_id);
  els.contatoSearch.value = contato?.nome || "";
  els.contatoSearch.dataset.contatoId = contato?.id || "";
  els.quickContactPanel.hidden = true;

  if (despesa.comprovante_path) {
    await loadExistingComprovante(despesa.comprovante_path);
  }

  toggleForm(els.despesaForm, true);
}

async function handleCreateDespesa(event) {
  event.preventDefault();
  clearMessage();
  const formData = new FormData(els.despesaForm);

  try {
    if (comprovanteState.uploadPromise) {
      await comprovanteState.uploadPromise;
    }
    const payload = {
      obra_id: currentObra.id,
      contato_id: els.contatoSearch.dataset.contatoId || null,
      descricao: formData.get("descricao"),
      valor: formData.get("valor"),
      data: formData.get("data"),
      quem_pagou: formData.get("quem_pagou"),
      categoria: formData.get("categoria"),
      observacao: formData.get("observacao"),
      comprovante_path: comprovanteState.path
    };

    const oldPath = comprovanteState.originalPath;
    const newPath = comprovanteState.path;
    const isEditing = Boolean(editingDespesa);
    const despesa = isEditing
      ? await atualizarDespesa(session.user.id, editingDespesa.id, payload)
      : await criarDespesa(session.user.id, payload);

    if (isEditing && oldPath && oldPath !== newPath) {
      try {
        await removerComprovante(oldPath);
      } catch {
        comprovanteState.warning = "Despesa atualizada, mas nao foi possivel remover o comprovante antigo do Storage.";
      }
    }

    if (isEditing) {
      despesas = despesas.map((item) => (item.id === despesa.id ? despesa : item));
    } else {
      despesas = [despesa, ...despesas];
    }
    editingDespesa = null;
    toggleForm(els.despesaForm, false);
    renderObraSummary();
    renderDespesas();
    showMessage(
      comprovanteState.warning || (isEditing ? "Despesa atualizada com sucesso." : "Despesa salva com sucesso."),
      comprovanteState.warning ? "warning" : "success"
    );
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function cancelDespesaForm() {
  await cleanupUnsavedComprovante();
  editingDespesa = null;
  toggleForm(els.despesaForm, false);
}

async function cleanupUnsavedComprovante() {
  if (!comprovanteState.path) return;
  if (editingDespesa && comprovanteState.path === comprovanteState.originalPath) return;
  try {
    await removerComprovante(comprovanteState.path);
  } catch {
    // O cancelamento nao deve bloquear o usuario se o Storage ja tiver removido o arquivo.
  }
}

async function removeComprovanteFromForm() {
  const currentPath = comprovanteState.path;
  const originalPath = comprovanteState.originalPath;
  if (currentPath && currentPath !== originalPath) {
    try {
      await removerComprovante(currentPath);
    } catch {
      showMessage("Nao foi possivel remover o arquivo enviado agora. Ele nao sera salvo na despesa.", "warning");
    }
  }
  clearComprovante(true);
}

function handleComprovanteDragOver(event) {
  event.preventDefault();
  if (els.despesaForm.hidden) return;
  els.comprovanteDropZone.classList.add("dragging");
}

function handleComprovanteDrop(event) {
  event.preventDefault();
  els.comprovanteDropZone.classList.remove("dragging");
  if (els.despesaForm.hidden) return;
  handleComprovanteFile(event.dataTransfer.files?.[0]);
}

function handleComprovantePaste(event) {
  if (els.despesaForm.hidden || currentView !== "obra") return;
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (file) {
    event.preventDefault();
    handleComprovanteFile(file);
  }
}

function handleComprovanteFile(file) {
  if (!file) return;
  if (!currentObra || !session?.user) {
    showMessage("Abra uma obra antes de enviar comprovante.", "warning");
    return;
  }

  clearComprovante(true);
  comprovanteState.file = file;
  comprovanteState.removed = false;
  comprovanteState.previewUrl = URL.createObjectURL(file);
  renderComprovante("Enviando...");

  const uploadSeq = ++comprovanteUploadSeq;
  comprovanteState.uploadPromise = uploadComprovante(session.user.id, currentObra.id, file)
    .then((result) => {
      if (uploadSeq !== comprovanteUploadSeq) return result;
      comprovanteState.path = result.path;
      comprovanteState.removed = false;
      comprovanteState.warning = result.warning;
      renderComprovante(result.warning ? "Nao enviado" : "Enviado");
      if (result.warning) showMessage(result.warning, "warning");
      return result;
    })
    .catch((error) => {
      if (uploadSeq !== comprovanteUploadSeq) return { path: null, warning: null };
      comprovanteState.path = comprovanteState.originalPath;
      comprovanteState.warning = comprovanteState.originalPath
        ? "Nao foi possivel enviar o novo comprovante. O comprovante antigo sera mantido."
        : "Nao foi possivel enviar o comprovante. A despesa podera ser salva sem comprovante.";
      renderComprovante("Nao enviado");
      showMessage(error.message || comprovanteState.warning, "error");
      return { path: null, warning: comprovanteState.warning };
    })
    .finally(() => {
      if (uploadSeq === comprovanteUploadSeq) comprovanteState.uploadPromise = null;
    });
}

function clearComprovante(preserveOriginal = false) {
  comprovanteUploadSeq += 1;
  if (comprovanteState.previewUrl) URL.revokeObjectURL(comprovanteState.previewUrl);
  const originalPath = preserveOriginal && editingDespesa ? comprovanteState.originalPath : null;
  comprovanteState = {
    file: null,
    path: null,
    originalPath,
    warning: null,
    previewUrl: null,
    signedUrl: null,
    removed: Boolean(originalPath && preserveOriginal),
    uploadPromise: null
  };
  els.comprovanteInput.value = "";
  renderComprovante("");
}

function renderComprovante(statusText) {
  const hasFile = Boolean(comprovanteState.file || comprovanteState.path);
  els.comprovanteEmpty.hidden = hasFile;
  els.comprovantePreview.hidden = !hasFile;
  els.comprovanteDropZone.classList.toggle("has-file", hasFile);
  els.comprovanteName.textContent = comprovanteState.file?.name || fileNameFromPath(comprovanteState.path);
  els.comprovanteStatus.textContent = statusText;
  els.comprovanteThumb.innerHTML = "";
  els.openComprovanteButton.hidden = !(comprovanteState.signedUrl || comprovanteState.previewUrl);

  if (!hasFile) return;
  if (comprovanteState.previewUrl && comprovanteState.file?.type.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = comprovanteState.previewUrl;
    image.alt = "Miniatura do comprovante";
    els.comprovanteThumb.appendChild(image);
    return;
  }
  if (comprovanteState.signedUrl && isImagePath(comprovanteState.path)) {
    const image = document.createElement("img");
    image.src = comprovanteState.signedUrl;
    image.alt = "Miniatura do comprovante";
    els.comprovanteThumb.appendChild(image);
    return;
  }

  const badge = document.createElement("span");
  badge.textContent = fileExtension(comprovanteState.path || comprovanteState.file?.name) || "ARQ";
  els.comprovanteThumb.appendChild(badge);
}

async function loadExistingComprovante(path) {
  comprovanteState.originalPath = path;
  comprovanteState.path = path;
  comprovanteState.removed = false;
  try {
    comprovanteState.signedUrl = await obterUrlComprovante(path);
    renderComprovante("Comprovante atual");
  } catch (error) {
    comprovanteState.warning = "Nao foi possivel carregar a miniatura do comprovante.";
    renderComprovante("Comprovante atual");
  }
}

function openComprovante() {
  const url = comprovanteState.signedUrl || comprovanteState.previewUrl;
  if (!url) return;
  window.open(url, "_blank", "noopener");
}

function fileNameFromPath(path) {
  if (!path) return "";
  return path.split("/").at(-1) || path;
}

function fileExtension(path) {
  const extension = fileNameFromPath(path).split(".").pop();
  return extension ? extension.toUpperCase().slice(0, 4) : "";
}

function isImagePath(path) {
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(path || "");
}

function handleContactSearch() {
  const typed = els.contatoSearch.value.trim();
  const found = contatos.find((contato) => contato.nome.toLowerCase() === typed.toLowerCase());
  els.contatoSearch.dataset.contatoId = found ? found.id : "";
  els.quickContatoNome.value = typed;
  els.quickContactPanel.hidden = !typed || Boolean(found);
}

async function handleQuickContact() {
  const nome = els.quickContatoNome.value.trim();
  if (!nome) {
    showMessage("Informe o nome do contato.", "warning");
    return;
  }

  try {
    const contato = await criarContato(session.user.id, {
      nome,
      tipos: els.quickContatoTipo.value,
      telefone: els.quickContatoTelefone.value,
      email: els.quickContatoEmail.value
    });
    contatos = [...contatos, contato].sort((a, b) => a.nome.localeCompare(b.nome));
    els.contatoSearch.value = contato.nome;
    els.contatoSearch.dataset.contatoId = contato.id;
    els.quickContactPanel.hidden = true;
    renderContatosOptions();
    showMessage("Contato salvo. Continue o lancamento da despesa.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  }
}

function renderObras() {
  if (!obras.length) {
    els.obrasList.innerHTML = `<div class="empty-state">Nenhuma obra cadastrada.</div>`;
    return;
  }

  els.obrasList.innerHTML = obras
    .map((obra) => `
      <article class="obra-card">
        <div>
          <span class="status-pill">${escapeHtml(statusLabel(obra.status))}</span>
          <h2>${escapeHtml(obra.nome)}</h2>
          <p>${escapeHtml([obra.cliente, obra.cidade].filter(Boolean).join(" • ") || "Sem cliente/cidade")}</p>
          <small>Início: ${formatDate(obra.data_inicio) || "Não informado"}</small>
        </div>
        <button class="button secondary" type="button" data-open-obra="${obra.id}">Abrir</button>
      </article>
    `)
    .join("");

  els.obrasList.querySelectorAll("[data-open-obra]").forEach((button) => {
    button.addEventListener("click", () => openObra(button.dataset.openObra));
  });
}

function renderObraSummary() {
  const total = despesas.reduce((sum, despesa) => sum + Number(despesa.valor || 0), 0);
  const pending = despesas.filter((despesa) => despesa.status_classificacao === "a_classificar").length;
  els.totalDespesas.textContent = currency.format(total);
  els.despesasAClassificar.textContent = String(pending);
}

function renderContatosOptions() {
  els.contatosOptions.innerHTML = contatos
    .map((contato) => `<option value="${escapeHtml(contato.nome)}"></option>`)
    .join("");
}

function renderDespesas() {
  const contatoById = new Map(contatos.map((contato) => [contato.id, contato]));
  const filtered = despesas.filter((despesa) => {
    if (activeDespesaFilter === "a_classificar") return despesa.status_classificacao === "a_classificar";
    if (activeDespesaFilter === "sem_comprovante") return !despesa.comprovante_path;
    return true;
  });

  if (!filtered.length) {
    els.despesasList.innerHTML = `<div class="empty-state">Nenhuma despesa neste filtro.</div>`;
    return;
  }

  els.despesasList.innerHTML = filtered
    .map((despesa) => {
      const contato = contatoById.get(despesa.contato_id);
      return `
        <article class="expense-row" data-edit-despesa="${despesa.id}" tabindex="0">
          <span>${formatDate(despesa.data)}</span>
          <strong>${escapeHtml(despesa.descricao)}</strong>
          <span>${escapeHtml(contato?.nome || "Sem contato")}</span>
          <strong>${currency.format(Number(despesa.valor || 0))}</strong>
          <span>${escapeHtml(despesa.categoria || "A classificar")}</span>
          <span>${escapeHtml(despesa.quem_pagou || "-")}</span>
          <span class="receipt ${despesa.comprovante_path ? "ok" : ""}">${despesa.comprovante_path ? "Com comprovante" : "Sem comprovante"}</span>
          <button class="button secondary edit-expense-button" type="button" data-edit-despesa-button="${despesa.id}">Editar</button>
        </article>`;
    })
    .join("");

  els.despesasList.querySelectorAll("[data-edit-despesa]").forEach((row) => {
    row.addEventListener("click", () => openEditDespesa(row.dataset.editDespesa));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openEditDespesa(row.dataset.editDespesa);
      }
    });
  });

  els.despesasList.querySelectorAll("[data-edit-despesa-button]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openEditDespesa(button.dataset.editDespesaButton);
    });
  });
}

function renderMeetings() {
  const state = getMeetingState();
  if (!state.meta) state.meta = {};
  state.meta.obra = currentObra.nome;
  if (!state.meta.tipo) state.meta.tipo = "Pedreiro / Azulejista";
  if (!state.meta.objetivo) state.meta.objetivo = defaultObjective;

  document.querySelectorAll("[data-store]").forEach((field) => {
    field.value = getByPath(state, field.dataset.store) || "";
  });

  els.topicTabs.innerHTML = topics
    .map((topic) => `
      <button class="meeting-tab ${topic.id === activeMeetingTopic ? "active" : ""}" type="button" data-topic="${topic.id}">
        ${escapeHtml(topic.name)}
      </button>`)
    .join("");

  els.topicTabs.querySelectorAll("[data-topic]").forEach((button) => {
    button.addEventListener("click", () => {
      activeMeetingTopic = button.dataset.topic;
      renderMeetings();
    });
  });

  renderChecklist(state);
  renderPrintAll(state);
  saveMeetingState(state);
}

function renderChecklist(state) {
  const topic = topics.find((item) => item.id === activeMeetingTopic);
  const topicState = getTopicState(state, activeMeetingTopic);
  els.checklistHeading.textContent = topic.name;
  els.checklistHint.textContent = topic.hint;
  els.checklistBody.innerHTML = "";

  topic.items.forEach((item, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="item-cell">${escapeHtml(item)}</td>
      ${["sim", "nao", "na"].map((choice) => `
        <td class="choice-cell">
          <label class="choice" title="${choice === "na" ? "N.A." : choice === "nao" ? "Não" : "Sim"}">
            <input type="radio" name="${activeMeetingTopic}-${index}" value="${choice}" ${topicState.answers[index] === choice ? "checked" : ""}>
            <span></span>
          </label>
        </td>`).join("")}
      <td class="obs-cell"><textarea rows="2" placeholder="Observações do item">${escapeHtml(topicState.observations[index] || "")}</textarea></td>`;

    row.querySelectorAll("input[type='radio']").forEach((input) => {
      input.addEventListener("change", () => {
        topicState.answers[index] = input.value;
        saveMeetingState(state);
        updateCompletion(state);
      });
    });
    row.querySelector("textarea").addEventListener("input", (event) => {
      topicState.observations[index] = event.target.value;
      saveMeetingState(state);
    });
    els.checklistBody.appendChild(row);
  });

  document.querySelectorAll("[data-section-field]").forEach((field) => {
    field.value = topicState.notes[field.dataset.sectionField] || "";
  });
  updateCompletion(state);
}

function updateCompletion(state) {
  const topic = topics.find((item) => item.id === activeMeetingTopic);
  const topicState = getTopicState(state, activeMeetingTopic);
  const answered = topic.items.filter((_, index) => topicState.answers[index]).length;
  els.completionBadge.textContent = `${answered}/${topic.items.length}`;
}

function clearCurrentMeetingTopic() {
  const topic = topics.find((item) => item.id === activeMeetingTopic);
  if (!window.confirm(`Limpar todos os dados de "${topic.name}"?`)) return;
  const state = getMeetingState();
  state.topics[activeMeetingTopic] = defaultTopicState();
  saveMeetingState(state);
  renderMeetings();
}

function renderPrintAll(state) {
  const topicMarkup = topics
    .map((topic, topicIndex) => {
      const topicState = getTopicState(state, topic.id);
      const rows = topic.items
        .map((item, index) => {
          const answer = topicState.answers[index];
          return `
            <tr>
              <td>${escapeHtml(item)}</td>
              <td class="print-choice">${answer === "sim" ? "X" : ""}</td>
              <td class="print-choice">${answer === "nao" ? "X" : ""}</td>
              <td class="print-choice">${answer === "na" ? "X" : ""}</td>
              <td>${escapeHtml(topicState.observations[index])}</td>
            </tr>`;
        })
        .join("");
      const notes = noteFields
        .map((field) => `
          <div class="print-note">
            <strong>${field.label}</strong>
            <span>${escapeHtml(topicState.notes[field.key])}</span>
          </div>`)
        .join("");

      return `
        <article class="print-topic">
          <h2>${topicIndex + 1}. ${escapeHtml(topic.name)}</h2>
          <p>${escapeHtml(topic.hint)}</p>
          <table class="print-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Sim</th>
                <th>Não</th>
                <th>N.A.</th>
                <th>Observações</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="print-notes">${notes}</div>
        </article>`;
    })
    .join("");

  els.printAll.innerHTML = `
    <div class="print-cover">
      <p class="eyebrow">SOO - Sistema Operacional de Obras</p>
      <h1>${escapeHtml(currentObra.nome)} - Reuniao</h1>
      <div class="print-meta">
        <div><strong>Obra</strong><span>${escapeHtml(currentObra.nome)}</span></div>
        <div><strong>Tipo de reunião</strong><span>${escapeHtml(state.meta.tipo)}</span></div>
        <div><strong>Data</strong><span>${escapeHtml(state.meta.data)}</span></div>
        <div><strong>Participantes</strong><span>${escapeHtml(state.meta.participantes)}</span></div>
        <div class="span-2"><strong>Objetivo da reunião</strong><span>${escapeHtml(state.meta.objetivo)}</span></div>
      </div>
    </div>
    ${topicMarkup}`;
}

function exportMeetingPdf() {
  renderPrintAll(getMeetingState());
  document.title = `SOO - ${currentObra.nome} - Reuniões`;
  window.print();
}

function getMeetingStorageKey() {
  return `soo-reunioes-${session.user.id}-${currentObra.id}`;
}

function getMeetingState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(getMeetingStorageKey()));
    return parsed && typeof parsed === "object" ? parsed : { meta: {}, topics: {} };
  } catch {
    return { meta: {}, topics: {} };
  }
}

function saveMeetingState(state) {
  localStorage.setItem(getMeetingStorageKey(), JSON.stringify(state));
}

function defaultTopicState() {
  return {
    answers: {},
    observations: {},
    notes: {
      decisaoFinal: "",
      pendencia: "",
      responsavel: "",
      prazo: "",
      fotosNecessarias: ""
    }
  };
}

function getTopicState(state, topicId) {
  if (!state.topics) state.topics = {};
  if (!state.topics[topicId]) state.topics[topicId] = defaultTopicState();
  return state.topics[topicId];
}

function showView(view) {
  currentView = view;
  els.loginView.hidden = view !== "login";
  els.oauthConsentView.hidden = view !== "oauthConsent";
  els.obrasView.hidden = view !== "obras";
  els.obraDetailView.hidden = view !== "obra";
  els.sessionBar.hidden = view === "login";
  if (view === "login") els.userEmail.textContent = "";
}

function toggleForm(form, visible) {
  form.hidden = !visible;
  if (visible) form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showMessage(text, type = "info") {
  els.messageArea.innerHTML = text ? `<div class="message ${type}">${escapeHtml(text)}</div>` : "";
}

function clearMessage() {
  showMessage("");
}

function statusLabel(value) {
  const labels = {
    ativa: "Ativa",
    planejamento: "Planejamento",
    pausada: "Pausada",
    finalizada: "Finalizada"
  };
  return labels[value] || value || "Ativa";
}

function formatDate(value) {
  if (!value) return "";
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getByPath(target, path) {
  return path.split(".").reduce((current, part) => current?.[part], target);
}

function setByPath(target, path, value) {
  const parts = path.split(".");
  let current = target;
  parts.slice(0, -1).forEach((part) => {
    if (!current[part]) current[part] = {};
    current = current[part];
  });
  current[parts.at(-1)] = value;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => navigator.serviceWorker.ready.then(() => registration.unregister()))
      .catch(() => {});
  }
}
