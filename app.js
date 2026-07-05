const STORAGE_KEY = "soo-obra-rose-pedreiro-azulejista-v1";

const defaultObjective =
  "Definir soluções técnicas para revestimento da cozinha, proteção das portas laqueadas, piso e drenagem do terraço, nicho da adega e localização dos pontos da banheira.";

const topics = [
  {
    id: "cozinha-revestimento",
    name: "Cozinha - revestimento sobre revestimento",
    hint: "Validação técnica do assentamento sobre o revestimento existente.",
    items: [
      "Revestimento existente possui peças ocas?",
      "É tecnicamente viável assentar sobre o revestimento atual?",
      "Espessura final interfere no batente?",
      "Guarnições laqueadas poderão ser reaproveitadas?",
      "Será necessário engrossar alguma parede?",
      "Acabamento junto ao batente foi definido?",
      "Tipo de argamassa definido?",
      "Necessário regularizar alguma área?"
    ]
  },
  {
    id: "protecao-portas-batentes",
    name: "Proteção de portas e batentes",
    hint: "Registro e proteção das portas, batentes e guarnições laqueadas.",
    items: [
      "Portas foram fotografadas antes da obra?",
      "Batentes serão protegidos?",
      "Guarnições serão protegidas?",
      "Proteção será feita com filme plástico?",
      "Proteção terá papelão, MDF fino ou material rígido?",
      "Fita usada será segura para laca?",
      "Está proibido apoiar ferramentas nas portas?",
      "Responsável pela proteção foi definido?"
    ]
  },
  {
    id: "terraco-piso-caimento",
    name: "Terraço - piso sobre piso e caimento",
    hint: "Verificação de espessura final, níveis, caimento e risco de empoçamento.",
    items: [
      "Piso sobre piso é viável?",
      "Soleira permite aumento de espessura?",
      "Foi levantado o nível atual do piso?",
      "Caimento para o guarda-corpo é viável?",
      "Caimento apenas para um lado exige muita altura no lado oposto?",
      "Existe risco de empoçamento?",
      "Altura final do piso foi aprovada?",
      "Regularização com argamassa é suficiente?"
    ]
  },
  {
    id: "ralo-linear-terraco",
    name: "Ralo linear no terraço",
    hint: "Viabilidade, ligação, impermeabilização e manutenção do ralo linear.",
    items: [
      "Ralo linear junto ao guarda-corpo é viável?",
      "Há ponto de escoamento próximo?",
      "Ligação ao esgoto/pluvial foi confirmada?",
      "Impermeabilização ao redor do ralo foi considerada?",
      "Comprimento do ralo foi definido?",
      "Limpeza/manutenção futura foi considerada?"
    ]
  },
  {
    id: "nicho-adega",
    name: "Nicho para adega",
    hint: "Demolição, instalações existentes, dimensões e fechamento do nicho.",
    items: [
      "Parede pode ser demolida nesse trecho?",
      "Parede não é estrutural?",
      "Existe elétrica na parede?",
      "Existe hidráulica na parede?",
      "Profundidade necessária da adega foi confirmada?",
      "Dimensões exatas do nicho foram medidas?",
      "Fechamento pelo cômodo oposto foi definido?",
      "Drywall é adequado para esse fechamento?",
      "Placa cimentícia seria melhor?",
      "Tratamento contra fissuras foi definido?"
    ]
  },
  {
    id: "banheira-agua-esgoto",
    name: "Banheira - água e esgoto",
    hint: "Localização dos pontos e área de demolição necessária para instalação.",
    items: [
      "Ponto de água foi localizado?",
      "Ponto de esgoto foi localizado?",
      "Os pontos estão na fileira central próxima à parede?",
      "É possível remover apenas o piso que ficará sob a banheira?",
      "Será necessário quebrar além da área coberta pela banheira?",
      "Altura/posição do esgoto atende à banheira?",
      "Fotos serão feitas antes da demolição?"
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

const defaultTopicState = () => ({
  answers: {},
  observations: {},
  notes: {
    decisaoFinal: "",
    pendencia: "",
    responsavel: "",
    prazo: "",
    fotosNecessarias: ""
  }
});

let activeId = topics[0].id;
let state = loadState();

const tabsEl = document.querySelector("#topicTabs");
const titleEl = document.querySelector("#sectionTitle");
const checklistHeadingEl = document.querySelector("#checklistHeading");
const checklistHintEl = document.querySelector("#checklistHint");
const checklistBodyEl = document.querySelector("#checklistBody");
const completionBadgeEl = document.querySelector("#completionBadge");
const clearSectionButton = document.querySelector("#clearSection");
const exportPdfButton = document.querySelector("#exportPdf");
const printAllEl = document.querySelector("#printAll");

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureDefaults() {
  if (!state.meta) state.meta = {};
  if (!state.meta.obra) state.meta.obra = "Apartamento Rose";
  if (!state.meta.tipo) state.meta.tipo = "Pedreiro / Azulejista";
  if (!state.meta.objetivo) state.meta.objetivo = defaultObjective;
  if (!state.topics) state.topics = {};
}

function getTopicState(topicId) {
  ensureDefaults();
  if (!state.topics[topicId]) state.topics[topicId] = defaultTopicState();
  return state.topics[topicId];
}

function renderTabs() {
  tabsEl.innerHTML = "";
  topics.forEach((topic) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `tab${topic.id === activeId ? " active" : ""}`;
    tab.textContent = topic.name;
    tab.setAttribute("aria-pressed", topic.id === activeId ? "true" : "false");
    tab.addEventListener("click", () => {
      activeId = topic.id;
      render();
    });
    tabsEl.appendChild(tab);
  });
}

function renderChecklist() {
  const topic = topics.find((item) => item.id === activeId);
  const topicState = getTopicState(activeId);
  titleEl.textContent = "Obra Rose - Reunião Pedreiro/Azulejista";
  checklistHeadingEl.textContent = topic.name;
  checklistHintEl.textContent = topic.hint;
  checklistBodyEl.innerHTML = "";

  topic.items.forEach((item, index) => {
    const row = document.createElement("tr");
    const itemCell = document.createElement("td");
    itemCell.className = "item-cell";
    itemCell.textContent = item;
    row.appendChild(itemCell);

    ["sim", "nao", "na"].forEach((choice) => {
      const choiceCell = document.createElement("td");
      choiceCell.className = "choice-cell";
      const label = document.createElement("label");
      label.className = "choice";
      label.title = choice === "na" ? "N.A." : choice === "nao" ? "Não" : "Sim";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `${activeId}-${index}`;
      input.value = choice;
      input.checked = topicState.answers[index] === choice;
      input.addEventListener("change", () => {
        topicState.answers[index] = choice;
        saveState();
        updateCompletion();
      });
      const dot = document.createElement("span");
      label.append(input, dot);
      choiceCell.appendChild(label);
      row.appendChild(choiceCell);
    });

    const obsCell = document.createElement("td");
    obsCell.className = "obs-cell";
    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.placeholder = "Observações do item";
    textarea.value = topicState.observations[index] || "";
    textarea.addEventListener("input", () => {
      topicState.observations[index] = textarea.value;
      saveState();
    });
    obsCell.appendChild(textarea);
    row.appendChild(obsCell);
    checklistBodyEl.appendChild(row);
  });

  document.querySelectorAll("[data-section-field]").forEach((field) => {
    field.value = topicState.notes[field.dataset.sectionField] || "";
  });

  updateCompletion();
}

function updateCompletion() {
  const topic = topics.find((item) => item.id === activeId);
  const topicState = getTopicState(activeId);
  const answered = topic.items.filter((_, index) => topicState.answers[index]).length;
  completionBadgeEl.textContent = `${answered}/${topic.items.length}`;
}

function bindStoredFields() {
  ensureDefaults();
  document.querySelectorAll("[data-store]").forEach((field) => {
    const key = field.dataset.store;
    field.value = getByPath(state, key) || field.value || "";
    field.addEventListener("input", () => {
      setByPath(state, key, field.value);
      saveState();
    });
  });

  document.querySelectorAll("[data-section-field]").forEach((field) => {
    field.addEventListener("input", () => {
      const topicState = getTopicState(activeId);
      topicState.notes[field.dataset.sectionField] = field.value;
      saveState();
    });
  });

  saveState();
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

function clearCurrentSection() {
  const topic = topics.find((item) => item.id === activeId);
  const ok = window.confirm(`Limpar todos os dados de "${topic.name}"?`);
  if (!ok) return;
  state.topics[activeId] = defaultTopicState();
  saveState();
  renderChecklist();
}

function answerLabel(value) {
  if (value === "sim") return "Sim";
  if (value === "nao") return "Não";
  if (value === "na") return "N.A.";
  return "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPrintAll() {
  ensureDefaults();
  const meta = state.meta;
  const topicMarkup = topics
    .map((topic, topicIndex) => {
      const topicState = getTopicState(topic.id);
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

  printAllEl.innerHTML = `
    <div class="print-cover">
      <p class="eyebrow">SOO - Sistema Operacional de Obras</p>
      <h1>Obra Rose - Reunião Pedreiro/Azulejista</h1>
      <div class="print-meta">
        <div><strong>Obra</strong><span>${escapeHtml(meta.obra)}</span></div>
        <div><strong>Tipo de reunião</strong><span>${escapeHtml(meta.tipo)}</span></div>
        <div><strong>Data</strong><span>${escapeHtml(meta.data)}</span></div>
        <div><strong>Participantes</strong><span>${escapeHtml(meta.participantes)}</span></div>
        <div class="span-2"><strong>Objetivo da reunião</strong><span>${escapeHtml(meta.objetivo)}</span></div>
      </div>
    </div>
    ${topicMarkup}`;
}

function exportPdf() {
  saveState();
  renderPrintAll();
  document.title = "SOO - Obra Rose - Reuniao Pedreiro Azulejista";
  window.print();
}

function render() {
  renderTabs();
  renderChecklist();
}

ensureDefaults();
clearSectionButton.addEventListener("click", clearCurrentSection);
exportPdfButton.addEventListener("click", exportPdf);
bindStoredFields();
render();
renderPrintAll();
