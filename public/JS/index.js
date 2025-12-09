// ============ Importações ============
import { emojisByCategory } from "./emojisByCategory.js";
import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";

// ============ Constantes e Variáveis ============
const deleteButton = document.getElementById("deleteBtn");
const addButton = document.getElementById("addBtn");
const exitButton = document.getElementById("exit");
const textInput = document.getElementById("text");
const imageCache = {};

const RECENT_EMOJIS_KEY = "recentEmojis";
const MAX_RECENT_EMOJIS = 30;
const SAVED_STICKERS_KEY = "savedStickers";
const MAX_SAVED_STICKERS = 100;

const socket = io("http://localhost:3000", { transports: ["websocket"] });

let currentTab = 1;
let isLoading = true;
let currentChat = null;
let currentChatJid = null;
let chatHeaderCache = {};
let lastMessageCountMap = {};
let sentThisSession = [];
let messageStatusMap = {};
let moreOpened = false;
let aMBOpen = false;
let sMBOpen = false;
let emojiOpen = false;

// Variáveis para gravação de áudio
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// roles
let sup = false,
  trein = false,
  vend = false,
  at = false,
  admin = false;

// auth token (in-memory)
let authToken = null;

// Funções de token
function getToken() {
  return authToken;
}

function setToken(token) {
  authToken = token;
}

function clearToken() {
  authToken = null;
}

// Carregar token inicial
if (localStorage.getItem("token")) {
  authToken = localStorage.getItem("token");
} else if (sessionStorage.getItem("token")) {
  authToken = sessionStorage.getItem("token");
}

// Utilitários
function escapeHtml(unsafe) {
  //Converte textos para evitar XSS
  if (!unsafe && unsafe !== 0) return "";
  return String(unsafe)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function capitalizeFirstLetter(val) {
  // Capitaliza a primeira letra de uma string
  return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

async function apiFetch(path, options = {}) {
  // Fetch seguro com token
  const token = getToken();
  options.headers = options.headers || {};
  if (token) options.headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, options);
  return res;
}

// Emojis
function getRecentEmojis() {
  // Pega os emojis recentes
  try {
    const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.error("Erro ao carregar emojis recentes:", err);
    return [];
  }
}

function addRecentEmoji(emoji) {
  // Salva emoji como recente
  try {
    let recents = getRecentEmojis();
    recents = recents.filter((e) => e !== emoji);
    recents.unshift(emoji);
    recents = recents.slice(0, MAX_RECENT_EMOJIS);
    localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(recents));
  } catch (err) {
    console.error("Erro ao salvar emoji recente:", err);
  }
}

function clearRecentEmojis() {
  // Limpa os emojis recentes
  try {
    localStorage.removeItem(RECENT_EMOJIS_KEY);
  } catch (e) {
    console.error(e);
  }
}

// Figurinhas favoritas
async function generateStickerHash(url) {
  // Gera hash SHA-256 para uma figurinha
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    console.error("Erro ao gerar hash:", err);
    return null;
  }
}

function getSavedStickersHashes() {
  // Pega as figurinhas salvas com hashes
  try {
    const stored = localStorage.getItem(SAVED_STICKERS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.error("Erro ao carregar stickers salvos:", err);
    return [];
  }
}

async function addStickerToFavorites(stickerUrl, stickerName) {
  // Adiciona figurinha aos favoritos
  try {
    let stickers = getSavedStickersHashes();
    const hash = await generateStickerHash(stickerUrl);
    if (!hash) {
      console.warn("Não foi possível gerar hash do sticker");
      return false;
    }
    const isDuplicate = stickers.some((s) => s.hash === hash);
    if (isDuplicate) {
      console.warn("Sticker já salvo");
      return false;
    }
    const newSticker = {
      url: stickerUrl,
      name: stickerName,
      hash,
      addedAt: Date.now(),
    };
    stickers.unshift(newSticker);
    stickers = stickers.slice(0, MAX_SAVED_STICKERS);
    localStorage.setItem(SAVED_STICKERS_KEY, JSON.stringify(stickers));
    return true;
  } catch (err) {
    console.error("Erro ao salvar nos favoritos:", err);
    return false;
  }
}

function removeStickerFromFavorites(stickerUrl) {
  // Remove figurinha dos favoritos
  try {
    let stickers = getSavedStickersHashes();
    stickers = stickers.filter((s) => s.url !== stickerUrl);
    localStorage.setItem(SAVED_STICKERS_KEY, JSON.stringify(stickers));
    return true;
  } catch (err) {
    console.error("Erro ao remover de favoritos:", err);
    return false;
  }
}

async function isStickerInFavorites(stickerUrl) {
  // Verifica se a figurinha está nos favoritos
  try {
    const stickers = getSavedStickersHashes();
    const hash = await generateStickerHash(stickerUrl);
    if (hash) return stickers.some((s) => s.hash === hash);
    return stickers.some((s) => s.url === stickerUrl);
  } catch (err) {
    console.error("Erro ao verificar favoritos:", err);
    return false;
  }
}

// Loading
function showLoading() {
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) loadingOverlay.style.display = "flex";
}
function hideLoading() {
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    setTimeout(() => {
      loadingOverlay.style.display = "none";
    }, 300);
  }
}
function updateLoadingProgress(current, total) {
  const loadingProgress = document.getElementById("loading-progress");
  if (loadingProgress) {
    loadingProgress.textContent = `Carregando ${current} de ${total} conversas...`;
  }
}

// Mudar status da mensagem (entregue, visto, etc.)
function applyMessageStatus(messageId, status) {
  const msgDiv = document.getElementById(messageId);
  if (!msgDiv) return;
  const statusImg = msgDiv.querySelector(".msg-status");
  if (!statusImg) return;
  statusImg.src = `../images/${status}.png`;
}

// Formatar tempo em 12 horas
function formatTime12h(timestamp) {
  const date = new Date(timestamp || Date.now());
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const timeFormat = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours.toString().padStart(2, "0")}:${minutes} ${timeFormat}`;
}

// Criar elementos de mensagem
function createMessageElement(msg) {
  const div = document.createElement("div");
  div.id = msg.messageId || `msg-${Date.now()}`;
  div.className = msg.fromMe ? "msg-bubble" : "msg-bubble client";
  const time = formatTime12h(msg.timestamp);

  if (msg.type === "sticker") {
    const stickerUrl = msg.url || msg.sticker || msg.contentUrl;
    div.innerHTML = `
      <div class="sticker-wrapper">
        <img class="sticker-img" src="${escapeHtml(
          stickerUrl
        )}" alt="figurinha" />
      </div>
      <p class="msg-hour ${msg.fromMe ? "" : "client"}">${time}</p>
    `;
    const tempImg = div.querySelector(".sticker-img");
    if (tempImg)
      tempImg.onerror = () => {
        tempImg.onerror = null;
        tempImg.style.display = "none";
      };
  } else if (msg.type === "audio") {
    const audioUrl = msg.url || msg.audioUrl;
    if (!audioUrl || audioUrl === "undefined") {
      // Áudio sem URL - mostra mensagem alternativa
      div.innerHTML = `
        <p class="msg-bubble-text${
          msg.fromMe ? "" : " client"
        }">🎤 Áudio (arquivo não disponível)</p>
        <p class="msg-hour ${msg.fromMe ? "" : "client"}">${time}</p>
      `;
    } else {
      const audioId = `audio-${msg.messageId}`;
      div.innerHTML = `
        <div class="audio-message">
          <button class="audio-play-btn" onclick="toggleAudioPlay('${audioId}')">
            <span class="material-icons">play_arrow</span>
          </button>
          <div class="audio-waveform">
            <input type="range" class="audio-progress" id="progress-${audioId}" value="0" min="0" max="100" />
            <span class="audio-duration" id="duration-${audioId}">0:00</span>
          </div>
          <audio id="${audioId}" preload="metadata" style="display: none;">
            <source src="${audioUrl}" type="audio/ogg">
          </audio>
        </div>
        <p class="msg-hour ${msg.fromMe ? "" : "client"}">${time}</p>
      `;

      // Inicializa a duração quando o áudio carrega
      setTimeout(() => {
        const audioEl = document.getElementById(audioId);
        const durationEl = document.getElementById(`duration-${audioId}`);
        if (audioEl && durationEl) {
          audioEl.onloadedmetadata = () => {
            if (
              audioEl.duration &&
              !isNaN(audioEl.duration) &&
              audioEl.duration !== Infinity
            ) {
              const minutes = Math.floor(audioEl.duration / 60);
              const seconds = Math.floor(audioEl.duration % 60);
              durationEl.textContent = `${minutes}:${seconds
                .toString()
                .padStart(2, "0")}`;
            }
          };
        }
      }, 100);
    }
  } else {
    const textHtml = `<p class="msg-bubble-text${
      msg.fromMe ? "" : " client"
    }">${escapeHtml(msg.text || "")}</p>`;
    const timeHtml = `<p class="msg-hour ${
      msg.fromMe ? "" : "client"
    }">${time}</p>`;
    div.innerHTML = textHtml + timeHtml;
  }
  return div;
}

// Formatação de asteriscos em negrito
function formatarAsteriscos(texto) {
  if (!texto || typeof texto !== "string") return "";
  return texto.replace(/\*([^*]+)\*/g, "<strong>$1</strong><br>");
}

// Renderizar mensagens
function renderMessages(chatContainer, messages) {
  if (!chatContainer || !Array.isArray(messages)) return;
  chatContainer.innerHTML = "";

  messages.forEach((msg) => {
    if (msg.fromMe && sentThisSession.includes(msg.messageId)) return;

    // Stickers
    if (msg.type === "sticker") {
      const div = document.createElement("div");
      div.id = msg.messageId;
      div.className = `msg ${msg.fromMe ? "me" : "client"}`;

      const stickerWrapper = document.createElement("div");
      stickerWrapper.className = "sticker-wrapper";
      stickerWrapper.style.cssText =
        "position: relative; cursor: context-menu;";

      const img = document.createElement("img");
      img.className = "sticker-img";
      // Tenta múltiplos campos onde o URL pode estar
      const msgStickerUrl = msg.url || msg.sticker || msg.contentUrl;
      if (msgStickerUrl) {
        img.src = msgStickerUrl;
      }
      img.alt = "figurinha";
      img.onerror = () => {
        console.error("❌ Erro ao carregar sticker:", img.src);
        img.style.display = "none";
      };
      stickerWrapper.appendChild(img);

      // context menu on sticker
      stickerWrapper.addEventListener("contextmenu", (e) => {
        showContextMenu(e, msg.messageId, true, msg.fromMe);
      });

      // info container
      const infoContainer = document.createElement("div");
      infoContainer.className = `msg-info ${msg.fromMe ? "" : "client"}`;

      const statusWrap = document.createElement("div");
      statusWrap.className = "status-wrap";
      statusWrap.appendChild(hourEl);
      if (msg.fromMe && msg.status) {
        const statusEl = document.createElement("img");
        statusEl.className = "msg-status sticker";
        statusEl.src = `../images/${msg.status}.png`;
        statusWrap.appendChild(statusEl);
      }

      const time = formatTime12h(msg.timestamp);
      const hourEl = document.createElement("p");
      hourEl.textContent = time;
      hourEl.className = `msg-hour sticker ${msg.fromMe ? "" : "client"}`;

      stickerWrapper.appendChild(statusWrap);

      div.appendChild(stickerWrapper);
      chatContainer.appendChild(div);
      return;
    }

    // Áudio
    if (msg.type === "audio") {
      const div = document.createElement("div");
      div.id = msg.messageId;
      div.className = msg.fromMe ? "msg-bubble" : "msg-bubble client";

      const audioUrl = msg.url || msg.audioUrl;
      const time = formatTime12h(msg.timestamp);

      if (!audioUrl || audioUrl === "undefined") {
        // Áudio sem URL - mostra mensagem alternativa
        div.innerHTML = `
          <p class="msg-bubble-text${
            msg.fromMe ? "" : " client"
          }">🎤 Áudio (arquivo não disponível)</p>
          <p class="msg-hour ${msg.fromMe ? "" : "client"}">${time}</p>
        `;
      } else {
        const audioId = `audio-${msg.messageId}`;
        div.innerHTML = `
          <div class="audio-message">
            <button class="audio-play-btn" onclick="toggleAudioPlay('${audioId}')">
              <span class="material-icons">play_arrow</span>
            </button>
            <div class="audio-waveform">
              <input type="range" class="audio-progress" id="progress-${audioId}" value="0" min="0" max="100" />
              <span class="audio-duration" id="duration-${audioId}">0:00</span>
            </div>
            <audio id="${audioId}" preload="metadata" style="display: none;">
              <source src="${audioUrl}" type="audio/ogg">
            </audio>
          </div>
          <p class="msg-hour ${msg.fromMe ? "" : "client"}">${time}</p>
        `;

        // Inicializa a duração quando o áudio carrega
        setTimeout(() => {
          const audioEl = document.getElementById(audioId);
          const durationEl = document.getElementById(`duration-${audioId}`);
          if (audioEl && durationEl) {
            audioEl.onloadedmetadata = () => {
              if (
                audioEl.duration &&
                !isNaN(audioEl.duration) &&
                audioEl.duration !== Infinity
              ) {
                const minutes = Math.floor(audioEl.duration / 60);
                const seconds = Math.floor(audioEl.duration % 60);
                durationEl.textContent = `${minutes}:${seconds
                  .toString()
                  .padStart(2, "0")}`;
              }
            };
          }
        }, 100);
      }

      chatContainer.appendChild(div);
      return;
    }

    // Texto
    const div = document.createElement("div");
    div.id = msg.messageId;
    div.className = msg.fromMe ? "msg-bubble" : "msg-bubble client";
    div.style.cursor = "context-menu";
    div.addEventListener("contextmenu", (e) => {
      showContextMenu(e, msg.messageId, false, msg.fromMe);
    });

    const time = formatTime12h(msg.timestamp);

    if (msg.fromMe) {
      div.innerHTML = `
        <p class="msg-bubble-text">${formatarAsteriscos(msg.text)}</p>
        <span class="msg-info">
          <p class="msg-hour">${time}</p>
          <img class="msg-status" src="../images/${
            msg.status || "pending"
          }.png" />
        </span>
      `;
    } else {
      div.innerHTML = `
        <p class="msg-bubble-text client">${escapeHtml(msg.text)}</p>
        <span class="msg-info client">
          <p class="msg-hour client">${time}</p>
        </span>
      `;
    }

    chatContainer.appendChild(div);
  });

  // scroll
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Abrir menu de mensagem rápida
function autoMessageOpen() {
  const autoMessageMenu = document.getElementById("auto-message-menu");

  if (!aMBOpen) {
    autoMessageMenu.style.display = "flex";
    aMBOpen = true;
  } else {
    autoMessageMenu.style.display = "none";
    aMBOpen = false;
  }
}

// Mensagem rápida handler
function autoMessage() {
  const autoMessageOpt = document.querySelectorAll(".auto-message");

  autoMessageOpt.forEach((option) => {
    option.addEventListener("click", async function () {
      const messageText = this.getAttribute("data-message");

      if (!messageText) {
        return;
      }

      // Envia a mensagem
      await sendAutoMessage(messageText);

      // Fecha o menu após enviar
      autoMessageOpen();
    });
  });
}

// Enviar mensagem rápida
async function sendAutoMessage(messageText) {
  const token = getToken();
  if (!token) {
    alert("Você não está logado");
    return;
  }
  if (!currentChatJid) {
    alert("Nenhuma conversa aberta");
    return;
  }

  try {
    const res = await fetch("/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const username = await res.json();
    const user = username.username;
    const userFormatted = capitalizeFirstLetter(user);

    const tempId = `temp-${Date.now()}`;
    sentThisSession.push(tempId);

    // Renderiza mensagem usando msg-bubble
    const chatContainer = document.getElementById("chat-history");
    if (chatContainer) {
      const time = formatTime12h();

      const msgDiv = document.createElement("div");
      msgDiv.id = tempId;
      msgDiv.className = "msg-bubble";
      msgDiv.innerHTML = `
        <p class="msg-bubble-text"><strong>${userFormatted}:</strong><br>${escapeHtml(
        messageText
      )}</p>
        <span class="msg-info">
          <p class="msg-hour">${time}</p>
          <img class="msg-status" src="../images/pending.png" />
        </span>
      `;
      chatContainer.appendChild(msgDiv);
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    const resSend = await fetch("/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jid: currentChatJid,
        textFormatted: `*${userFormatted}:*\n${messageText}`,
      }),
    });

    if (!resSend.ok) {
      const error = await resSend.json();
      const tempDiv = document.getElementById(tempId);
      if (tempDiv) tempDiv.remove();
      alert("Erro ao enviar mensagem: " + (error.error || "Tente novamente"));
      return;
    }

    const data = await resSend.json();
    if (data?.message?.messageId) {
      const newId = data.message.messageId;
      const tempDiv = document.getElementById(tempId);
      if (tempDiv) tempDiv.id = newId;
      sentThisSession.push(newId);
    }
  } catch (err) {
    alert("Erro de conexão ao enviar mensagem");
  }
}

// Criar menu de contexto
function createContextMenu() {
  if (document.getElementById("context-menu")) return;
  const menu = document.createElement("div");
  menu.id = "context-menu";
  menu.className = "context-menu";
  menu.style.cssText =
    "position:fixed;background:white;border:1px solid #ddd;border-radius:0.5em;box-shadow:0 2px 10px rgba(0,0,0,0.2);z-index:10000;display:none;min-width:180px;padding:0.5em 0;";
  document.body.appendChild(menu);
}

// Criar itens para menu de contexto
function addContextMenuItem(menu, label, icon, callback, divider = false) {
  const item = document.createElement("div");
  item.className = "context-menu-item";
  item.style.cssText = `padding:0.6em 1em;cursor:pointer;display:flex;align-items:center;gap:0.5em;font-size:0.9em;border-bottom:${
    divider ? "1px solid #eee" : "none"
  };`;
  item.innerHTML = `<span style="min-width:18px;">${icon}</span><span>${label}</span>`;
  item.addEventListener(
    "mouseenter",
    () => (item.style.background = "#f0f0f0")
  );
  item.addEventListener(
    "mouseleave",
    () => (item.style.background = "transparent")
  );
  item.addEventListener("click", () => {
    callback();
    menu.style.display = "none";
  });
  menu.appendChild(item);
}

// Mostrar menu de contexto
function showContextMenu(e, messageId, isSticker = false, isFromMe = false) {
  e.preventDefault();
  e.stopPropagation();
  createContextMenu();
  const menu = document.getElementById("context-menu");
  menu.innerHTML = "";

  const msgDiv = document.getElementById(messageId);

  // For stickers we need the sticker URL
  let stickerUrl = null;
  if (isSticker && msgDiv) {
    const img = msgDiv.querySelector(".sticker-img");
    if (img) stickerUrl = img.src;
  }

  if (isSticker) {
    // Send
    addContextMenuItem(menu, "Enviar", "📤", async () => {
      if (stickerUrl) {
        // name fallback
        const name = `figurinha-${messageId}`;
        await sendStickerFromFile(stickerUrl, name);
      }
    });

    // Copiar
    addContextMenuItem(
      menu,
      "Copiar",
      "📋",
      async () => {
        try {
          if (!stickerUrl) return;
          const response = await fetch(stickerUrl);
          const blob = await response.blob();
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          showNotification("✅ Sticker copiado!");
        } catch (err) {
          console.error("Erro ao copiar:", err);
          showNotification("❌ Erro ao copiar!");
        }
      },
      true
    );

    // Favoritar ou Desfavoritar (verifica se já está nos favoritos)
    if (stickerUrl) {
      isStickerInFavorites(stickerUrl)
        .then((isFav) => {
          if (isFav) {
            addContextMenuItem(menu, "Desfavoritar", "🗑️", async () => {
              const success = removeStickerFromFavorites(stickerUrl);
              if (success) {
                showNotification("✅ Sticker removido dos favoritos!");
                loadSavedStickers();
              } else showNotification("❌ Erro ao remover sticker!");
            });
          } else {
            addContextMenuItem(menu, "Favoritar", "💾", async () => {
              const saved = await saveReceivedSticker(stickerUrl, messageId);
              if (saved) showNotification("✅ Sticker favoritado!");
            });
          }
        })
        .catch((err) => console.error(err));
    }
  } else {
    // Texto actions
    addContextMenuItem(menu, "Copiar", "📋", () => {
      if (!msgDiv) return;
      const textEl = msgDiv.querySelector(".msg-bubble-text");

      if (textEl)
        navigator.clipboard
          .writeText(textEl.textContent)
          .then(() => showNotification("✅ Copiado!"));
    });

    addContextMenuItem(
      menu,
      "Responder",
      "↩️",
      () => {
        if (!msgDiv) return;
        const textEl = msgDiv.querySelector(".msg-bubble-text");
        if (!textEl) return;
        const input = document.getElementById("text");
        if (input) {
          input.value = `> ${textEl.textContent}\n`;
          input.focus();
        }
      },
      true
    );
  }

  // Actions for messages sent by me
  if (isFromMe) {
    addContextMenuItem(
      menu,
      "Editar",
      "✏️",
      () => {
        if (!msgDiv) return;
        const textEl = msgDiv.querySelector(".msg-bubble-text");
        if (!textEl) return;
        const input = document.getElementById("text");
        if (input) {
          input.value = textEl.textContent;
          input.dataset.editingId = messageId;
          input.focus();
          showNotification("⚠️ Modo de edição ativo");
        }
      },
      true
    );

    addContextMenuItem(menu, "Deletar", "🗑️", async () => {
      if (!confirm("Tem certeza que deseja deletar esta mensagem?")) return;
      if (!msgDiv) return;
      // TODO: chamar API para deletar no backend se existir
      msgDiv.style.opacity = "0.5";
      msgDiv.style.textDecoration = "line-through";
      showNotification("✅ Mensagem deletada!");
    });
  }

  // General favorite toggle for text messages
  if (!isSticker) {
    addContextMenuItem(menu, "Favoritar", "❤️", () => {
      if (!msgDiv) return;
      msgDiv.style.background =
        msgDiv.style.background === "rgb(255, 250, 205)" ? "" : "#fffacd";
      showNotification("❤️ Mensagem favoritada!");
    });
  }

  // position menu
  menu.style.display = "block";
  menu.style.left = `${e.pageX}px`;
  menu.style.top = `${e.pageY}px`;

  setTimeout(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth)
      menu.style.left = `${window.innerWidth - rect.width - 10}px`;
    if (rect.bottom > window.innerHeight)
      menu.style.top = `${window.innerHeight - rect.height - 10}px`;
  }, 0);
}

// Fechar menu de contexto ao clicar fora
document.addEventListener("click", () => {
  const menu = document.getElementById("context-menu");
  if (menu) menu.style.display = "none";
});

// Mostrar notificação temporária
function showNotification(message) {
  const notification = document.createElement("div");
  notification.style.cssText =
    "position:fixed;bottom:20px;right:20px;background:#333;color:white;padding:1em;border-radius:0.5em;z-index:10001;animation:slideIn 0.3s ease;";
  notification.textContent = message;
  if (!document.querySelector("style[data-notification]")) {
    const style = document.createElement("style");
    style.setAttribute("data-notification", "true");
    style.textContent = `@keyframes slideIn { from { transform: translateX(400px); opacity:0 } to { transform: translateX(0); opacity:1 }} @keyframes slideOut { from { transform: translateX(0); opacity:1 } to { transform: translateX(400px); opacity:0 } }`;
    document.head.appendChild(style);
  }
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease";
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

// Carregar figurinhas salvas
function loadSavedStickers() {
  const stickersList = document.getElementById("stickers-list");
  const token = getToken();
  if (!stickersList || !token) return;
  stickersList.innerHTML = "";

  fetch("/stickers-list", { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => res.json())
    .then(async (data) => {
      if (
        !data.success ||
        !Array.isArray(data.stickers) ||
        data.stickers.length === 0
      ) {
        stickersList.innerHTML =
          '<p style="grid-column:1/3;text-align:center;color:#999">Nenhum sticker favoritado</p>';
        return;
      }
      // dedupe
      const seen = new Set();
      const unique = data.stickers.filter((s) => {
        if (seen.has(s.url)) return false;
        seen.add(s.url);
        return true;
      });

      const favoriteStickers = [];
      for (const sticker of unique) {
        const inFavs = await isStickerInFavorites(sticker.url);
        if (inFavs) favoriteStickers.push(sticker);
      }
      if (favoriteStickers.length === 0) {
        stickersList.innerHTML =
          '<p style="grid-column:1/3;text-align:center;color:#999">Nenhum sticker favoritado</p>';
        return;
      }

      const savedStickers = getSavedStickersHashes();
      favoriteStickers.sort((a, b) => {
        const aIndex = savedStickers.findIndex((s) => s.url === a.url);
        const bIndex = savedStickers.findIndex((s) => s.url === b.url);
        return bIndex - aIndex;
      });

      favoriteStickers.forEach((sticker) => {
        const stickerDiv = document.createElement("div");
        stickerDiv.className = "sticker-item";
        stickerDiv.innerHTML = `<div style="position:relative;width:100%;height:100%"><img src="${sticker.url}" alt="sticker" style="width:100%;height:100%;object-fit:contain"/><span style="position:absolute;top:2px;right:2px;font-size:1.2em">⭐</span></div>`;
        stickerDiv.addEventListener("click", async () => {
          await sendStickerFromFile(sticker.url, sticker.name);
        });
        stickerDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showStickerContextMenu(e, sticker.url, stickerDiv);
        });
        stickersList.appendChild(stickerDiv);
      });
    })
    .catch((err) => console.error("Erro ao carregar stickers:", err));
}

// Handler de upload de figurinhas
async function handleStickerUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const allowed = ["image/webp", "image/png", "image/jpeg"];
  const isValid =
    allowed.includes(file.type) || /\.(webp|png|jpg|jpeg)$/i.test(file.name);
  if (!isValid) {
    alert("Selecione .webp, .png ou .jpeg");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert("Arquivo deve ter menos de 10MB");
    return;
  }
  await sendSticker(file);
}

// handler para enviar figurinha
async function sendSticker(file) {
  const token = getToken();
  const jid = currentChatJid;
  if (!token) {
    alert("Você não está logado");
    return;
  }
  if (!jid) {
    alert("Nenhuma conversa aberta");
    return;
  }
  try {
    const formData = new FormData();
    formData.append("sticker", file);
    formData.append("jid", jid);
    const res = await fetch("/send-sticker", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Erro: ${data.error || "Não foi possível enviar o sticker"}`);
      return;
    }
    renderMessage({
      type: "sticker",
      fromMe: true,
      messageId: data.message.messageId,
      status: "sent",
      timestamp: Date.now(),
      url: data.message.url,
      jid,
    });
    closeStickerMenu();
    document.getElementById("sticker-input").value = "";
    scrollToBottom(true);
  } catch (err) {
    console.error("Erro ao enviar sticker:", err);
    alert("Erro ao enviar sticker. Tente novamente.");
  }
}

// Enviar figurinha a partir de um arquivo
async function sendStickerFromFile(stickerUrl, stickerName) {
  const token = getToken();
  const jid = currentChatJid;
  if (!token) {
    alert("Você não está logado");
    return;
  }
  if (!jid) {
    alert("Nenhuma conversa aberta");
    return;
  }
  try {
    const response = await fetch(stickerUrl);
    const blob = await response.blob();
    const formData = new FormData();
    formData.append("sticker", blob, stickerName);
    formData.append("jid", jid);
    const sendRes = await fetch("/send-sticker", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await sendRes.json();
    if (!sendRes.ok) {
      alert(`Erro: ${data.error}`);
      return;
    }

    renderMessage({
      type: "sticker",
      fromMe: true,
      messageId: data.message.messageId,
      status: "sent",
      timestamp: Date.now(),
      url: data.message.url,
      jid,
    });
    scrollToBottom(true);
  } catch (err) {
    console.error("Erro ao enviar sticker:", err);
    alert("Erro ao enviar sticker.");
  }
}

// Salvar figurinha recebida
async function saveReceivedSticker(stickerUrl, messageId) {
  const token = getToken();
  if (!token) {
    console.warn("Você não está logado");
    return false;
  }
  try {
    const inFavorites = await isStickerInFavorites(stickerUrl);
    if (inFavorites) {
      alert("Este sticker já está salvo nos favoritos!");
      return false;
    }

    // Extrai o messageId do URL se necessário
    let extractedMessageId = messageId;
    if (!extractedMessageId && stickerUrl) {
      const match = stickerUrl.match(/\/stickers\/([^.]+)\.webp/);
      if (match) {
        extractedMessageId = match[1];
      }
    }

    const formData = new FormData();
    formData.append("messageId", extractedMessageId);

    const saveRes = await fetch("/save-sticker", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await saveRes.json();
    if (!saveRes.ok) {
      console.warn("Erro ao salvar:", data.error);
      return false;
    }
    const success = await addStickerToFavorites(data.url, data.filename);
    if (success) alert("✅ Sticker salvo! 📌");
    return true;
  } catch (err) {
    console.error("Erro ao salvar sticker:", err);
    return false;
  }
}

// Menu de contexto para figurinhas
function showStickerContextMenu(e, stickerUrl, stickerDiv) {
  e.preventDefault();
  e.stopPropagation();
  createContextMenu();
  const menu = document.getElementById("context-menu");
  menu.innerHTML = "";
  addContextMenuItem(menu, "Enviar", "📤", async () => {
    const name =
      stickerDiv.querySelector(".sticker-item-name")?.textContent ||
      "figurinha";
    await sendStickerFromFile(stickerUrl, name);
  });
  addContextMenuItem(
    menu,
    "Copiar",
    "📋",
    async () => {
      try {
        const response = await fetch(stickerUrl);
        const blob = await response.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        showNotification("✅ Sticker copiado!");
      } catch (err) {
        console.error("Erro ao copiar:", err);
        showNotification("❌ Erro ao copiar!");
      }
    },
    true
  );
  addContextMenuItem(menu, "Desfavoritar", "🗑️", async () => {
    const success = removeStickerFromFavorites(stickerUrl);
    if (success) {
      stickerDiv.style.opacity = "0.5";
      stickerDiv.style.pointerEvents = "none";
      showNotification("✅ Sticker removido dos favoritos!");
      setTimeout(() => loadSavedStickers(), 500);
    } else showNotification("❌ Erro ao remover sticker!");
  });
  menu.style.display = "block";
  menu.style.left = `${e.pageX}px`;
  menu.style.top = `${e.pageY}px`;
  setTimeout(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth)
      menu.style.left = `${window.innerWidth - rect.width - 10}px`;
    if (rect.bottom > window.innerHeight)
      menu.style.top = `${window.innerHeight - rect.height - 10}px`;
  }, 0);
}

// Handler base para a gravação de audios
async function toggleAudioRecording() {
  if (!currentChatJid) {
    alert("Selecione uma conversa primeiro");
    return;
  }

  if (!isRecording) {
    await startRecording();
  } else {
    await stopRecording();
  }
}

// Começar a gravar o audio
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Tenta usar opus se disponível, senão usa o padrão
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus" }
      : {};

    mediaRecorder = new MediaRecorder(stream, options);
    audioChunks = [];

    console.log("🎤 Iniciando gravação com:", mediaRecorder.mimeType);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        console.log("📦 Chunk de áudio:", event.data.size, "bytes");
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, {
        type: mediaRecorder.mimeType || "audio/webm",
      });
      console.log("🎵 Áudio final:", audioBlob.size, "bytes", audioBlob.type);
      await sendAudio(audioBlob);
      stream.getTracks().forEach((track) => track.stop());
    };

    mediaRecorder.start();
    isRecording = true;

    // Muda visual do botão
    const audioBtn = document.getElementById("audio-sym");
    if (audioBtn) {
      audioBtn.textContent = "stop";
      audioBtn.style.color = "#f44336";
    }
  } catch (err) {
    console.error("Erro ao iniciar gravação:", err);
    alert("Erro ao acessar o microfone. Verifique as permissões.");
  }
}

// Parar a gravação do audio
async function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;

    // Restaura visual do botão
    const audioBtn = document.getElementById("audio-sym");
    if (audioBtn) {
      audioBtn.textContent = "mic";
      audioBtn.style.color = "";
    }
  }
}

// Enviar audio gravado
async function sendAudio(audioBlob) {
  const token = getToken();
  const jid = currentChatJid;

  if (!token) {
    alert("Você não está logado");
    return;
  }

  if (!jid) {
    alert("Nenhuma conversa aberta");
    return;
  }

  try {
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    formData.append("jid", jid);

    const response = await fetch("/send-audio", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Erro ao enviar áudio");
    }

    const data = await response.json();

    // Renderiza o áudio enviado
    if (data.messageId && data.timestamp) {
      const audioMsg = {
        type: "audio",
        fromMe: true,
        timestamp: data.timestamp,
        messageId: data.messageId,
        jid: jid,
        url: data.url || data.audioUrl,
        audioUrl: data.url || data.audioUrl,
        status: "sent",
      };
      renderMessage(audioMsg);
    }

    scrollToBottom(true);
  } catch (err) {
    console.error("Erro ao enviar áudio:", err);
    alert("Erro ao enviar áudio. Tente novamente.");
  }
}

// Renderizar mensagens enviadas
function renderMessage(msg) {
  if (!msg || !msg.jid) return;
  const chatContainer = document.getElementById("chat-history");
  if (!chatContainer) return;
  if (document.getElementById(msg.messageId)) return; // não renderiza duplicado

  if (msg.type === "sticker") {
    const msgDiv = document.createElement("div");
    msgDiv.id = msg.messageId;
    msgDiv.className = `msg ${msg.fromMe ? "me" : "client"}`;
    const stickerContainer = document.createElement("div");
    stickerContainer.className = "sticker-wrapper";
    const stickerImg = document.createElement("img");
    stickerImg.src = msg.url;
    stickerImg.alt = "figurinha";
    stickerImg.className = "sticker-img";
    stickerImg.onerror = () => {
      stickerImg.style.display = "none";
    };
    stickerContainer.appendChild(stickerImg);
    stickerContainer.addEventListener("contextmenu", (e) =>
      showContextMenu(e, msg.messageId, true, msg.fromMe)
    );

    // save button for incoming stickers
    if (!msg.fromMe) {
      const saveBtn = document.createElement("button");
      saveBtn.className = "sticker-save-btn";
      saveBtn.textContent = "📌";
      saveBtn.style.display = "none";
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        const success = await saveReceivedSticker(msg.url, msg.messageId);
        if (success) {
          saveBtn.textContent = "✅";
          setTimeout(() => {
            saveBtn.textContent = "📌";
            saveBtn.disabled = false;
          }, 2000);
        }
      };
      stickerContainer.appendChild(saveBtn);
      stickerContainer.onmouseover = () => (saveBtn.style.display = "block");
      stickerContainer.onmouseout = () => (saveBtn.style.display = "none");
    }

    msgDiv.appendChild(stickerContainer);

    const statusInfoWrapper = document.createElement("div");
    statusInfoWrapper.className = "status-wrap";
    statusInfoWrapper.appendChild(hourEl);
    if (msg.fromMe && msg.status) {
      const statusSpan = document.createElement("img");
      statusSpan.className = "msg-status";
      statusSpan.src = `../images/${msg.status}.png`;
      statusInfoWrapper.appendChild(statusSpan);
    }

    const time = formatTime12h(msg.timestamp);
    const hourEl = document.createElement("p");
    hourEl.className = `msg-hour sticker ${msg.fromMe ? "" : "client"}`;
    hourEl.textContent = time;

    stickerContainer.style.position = "relative";
    stickerContainer.appendChild(statusInfoWrapper);

    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return;
  }

  // áudio
  if (msg.type === "audio") {
    const audioUrl = msg.url || msg.audioUrl;

    if (!audioUrl || audioUrl === "undefined") {
      // Áudio sem URL - mostra mensagem alternativa
      const div = document.createElement("div");
      div.id = msg.messageId;
      div.className = msg.fromMe ? "msg-bubble" : "msg-bubble client";
      const time = formatTime12h(msg.timestamp);
      div.innerHTML = `
        <p class="msg-bubble-text${
          msg.fromMe ? "" : " client"
        }">🎤 Áudio (arquivo não disponível)</p>
        <p class="msg-hour ${msg.fromMe ? "" : "client"}">${time}</p>
      `;
      chatContainer.appendChild(div);
      chatContainer.scrollTop = chatContainer.scrollHeight;
      return;
    }

    const msgDiv = document.createElement("div");
    msgDiv.id = msg.messageId;
    msgDiv.className = msg.fromMe ? "msg-bubble" : "msg-bubble client";
    const time = formatTime12h(msg.timestamp);
    const audioId = `audio-${msg.messageId}`;

    msgDiv.innerHTML = `
      <div class="audio-message">
        <button class="audio-play-btn" onclick="toggleAudioPlay('${audioId}')">
          <span class="material-icons">play_arrow</span>
        </button>
        <div class="audio-waveform">
          <input type="range" class="audio-progress" id="progress-${audioId}" value="0" min="0" max="100" />
          <span class="audio-duration" id="duration-${audioId}">0:00</span>
        </div>
        <audio id="${audioId}" preload="metadata" style="display: none;">
          <source src="${audioUrl}" type="audio/ogg">
        </audio>
      </div>
      <p class="msg-hour ${msg.fromMe ? "" : "client"}">${time}</p>
    `;

    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Inicializa a duração quando o áudio carrega
    setTimeout(() => {
      const audioEl = document.getElementById(audioId);
      const durationEl = document.getElementById(`duration-${audioId}`);
      if (audioEl && durationEl) {
        audioEl.onloadedmetadata = () => {
          if (
            audioEl.duration &&
            !isNaN(audioEl.duration) &&
            audioEl.duration !== Infinity
          ) {
            const minutes = Math.floor(audioEl.duration / 60);
            const seconds = Math.floor(audioEl.duration % 60);
            durationEl.textContent = `${minutes}:${seconds
              .toString()
              .padStart(2, "0")}`;
          }
        };
      }
    }, 100);

    return;
  }

  // texto
  const div = document.createElement("div");
  div.id = msg.messageId;
  div.className = msg.fromMe ? "msg-bubble" : "msg-bubble client";
  div.style.cursor = "context-menu";
  div.addEventListener("contextmenu", (e) =>
    showContextMenu(e, msg.messageId, false, msg.fromMe)
  );
  const time = formatTime12h(msg.timestamp);
  if (msg.fromMe) {
    div.innerHTML = `<p class="msg-bubble-text">${formatarAsteriscos(
      msg.text
    )}</p><span class="msg-info"><p class="msg-hour">${time}</p><img class="msg-status" src="../images/${
      msg.status || "pending"
    }.png" /></span>`;
  } else {
    div.innerHTML = `<p class="msg-bubble-text client">${escapeHtml(
      msg.text
    )}</p><span class="msg-info client"><p class="msg-hour">${time}</p></span>`;
  }
  document.getElementById("chat-history")?.appendChild(div);
  setTimeout(() => {
    document.getElementById("chat-history").scrollTop =
      document.getElementById("chat-history").scrollHeight;
  }, 50);
}

// Buscar conversas
async function fetchConversations() {
  const token = getToken();
  if (!token) {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
    return;
  }
  try {
    const res = await fetch("/conversations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401) {
        // Token inválido ou expirado
        localStorage.removeItem("token");
        clearToken();
        window.location.href = "/login.html";
        return;
      }
      throw new Error("Erro ao buscar conversas");
    }
    const data = await res.json();
    const dataWithoutGroups = data.filter(
      (c) =>
        c && c.jid && !c.jid.endsWith("@g.us") && !c.jid.endsWith("@newsletter")
    );
    const container = document.getElementById("menu-chat-block");
    if (!container) return;

    const existingChats = {};
    container
      .querySelectorAll(".menu-chats")
      .forEach((div) => (existingChats[div.getAttribute("data-jid")] = div));

    let filtered = [];
    if (currentTab === 1)
      filtered = dataWithoutGroups.filter((c) => c.status === "active");
    if (currentTab === 2)
      filtered = dataWithoutGroups.filter((c) => c.status === "queue");
    if (currentTab === 3)
      filtered = dataWithoutGroups.filter((c) => c.status === "closed");

    const total = filtered.length;
    let loaded = 0;

    // Carrega fotos de perfil de TODAS as conversas (independente da aba)
    for (const c of dataWithoutGroups) {
      if (c && c.jid) {
        safeUpdateProfilePicture(c.jid);
      }
    }

    for (const c of filtered) {
      // Validação: ignora conversas sem JID válido
      if (!c || !c.jid) {
        console.warn("Conversa sem JID válido:", c);
        continue;
      }

      // Atualiza progresso se ainda estiver em loading inicial
      if (isLoading) {
        loaded++;
        updateLoadingProgress(loaded, total);
      }

      let div = existingChats[c.jid];
      if (!div) {
        div = document.createElement("div");
        div.className = "menu-chats";
        div.setAttribute("data-jid", c.jid);
        div.innerHTML = `
          <img class="user-pfp" data-jid="${c.jid}" src="${
          c.img || `/profile-pics/${encodeURIComponent(c.jid)}.jpg`
        }" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(
          c.name || c.jid
        )}&background=random'" />
          <h2 class="client-name"></h2>
          <p class="latest-msg"></p>
        `;
        container.appendChild(div);
        div.addEventListener("click", () => {
          // Validação: só abre se o JID for válido
          if (!c.jid || c.jid === "undefined" || c.jid === "null") {
            console.error(
              "Tentativa de abrir conversa com JID inválido:",
              c.jid
            );
            return;
          }

          currentChat = c.jid;
          currentChatJid = c.jid;

          // Pequeno delay para garantir que o estado foi atualizado
          setTimeout(() => {
            openChat(c.jid);
          }, 50);

          document
            .querySelectorAll(".menu-chats")
            .forEach((el) => el.classList.remove("selected"));
          div.classList.add("selected");
          checkChat();
        });
      }
      div.querySelector(".client-name").textContent = c.name || c.jid;
      const lastMsgText = c.messages?.slice(-1)[0]?.text || "";
      const formattedText = lastMsgText.replace(
        /\*([^*]+)\*/g,
        "<strong>$1</strong>"
      );
      div.querySelector(".latest-msg").innerHTML = formattedText;
      if (currentChat === c.jid) div.classList.add("selected");
      else div.classList.remove("selected");
    }

    Object.keys(existingChats).forEach((jid) => {
      if (!filtered.find((c) => c.jid === jid)) existingChats[jid].remove();
    });
  } catch (err) {
    console.error("Erro ao buscar conversas:", err);
  }
}

// Configurar bloco de mensagem rápida
const aMB = document.getElementById("msg-sym");
aMB.addEventListener("click", () => {
  autoMessageOpen();
});

// Configuração de anexo
const span = document.getElementById("anexo-sym");
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.style.display = "none";
const fileBlock = document.getElementById("file");
const fileCancel = document.getElementById("close-attach-sym");
const fileInfo = document.getElementById("file-info");
if (span) span.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) {
    if (fileBlock) fileBlock.style.display = "block";
    if (fileInfo)
      fileInfo.innerHTML = `<img src="../images/file-icon.png" alt="file" class="file-icon"/><h2>${escapeHtml(
        file.name
      )}</h2><p>${(file.size / 1024).toFixed(2)} KB</p>`;
  }
});
if (fileCancel)
  fileCancel.addEventListener("click", () => {
    if (fileBlock) fileBlock.style.display = "none";
    fileInput.value = "";
    fileInput.files = null;
  });

// Handler de envio de figurinhas
const stickerInput = document.getElementById("sticker-input");
if (stickerInput) {
  stickerInput.addEventListener("change", handleStickerUpload);
}

// Alternar janela de emojis
function emojiWindow() {
  const emojiDiv = document.getElementById("emojis");
  if (!emojiDiv) return;
  if (!emojiOpen) {
    const emojiContent = document.getElementById("emoji-content");
    if (emojiContent && emojiContent.innerHTML === "") emojis();
    emojiDiv.style.display = "flex";
    emojiOpen = true;
  } else {
    emojiDiv.style.display = "none";
    emojiOpen = false;
  }
}

// Trocar entre emojis e figurinhas
function switchToEmojis() {
  const emojiTab = document.getElementById("emoji-tab");
  const stickerTab = document.getElementById("sticker-tab");
  const emojiContent = document.getElementById("emoji-content");
  const stickerContent = document.getElementById("sticker-content");

  emojiTab.classList.add("active");
  stickerTab.classList.remove("active");
  emojiContent.style.display = "block";
  stickerContent.style.display = "none";

  if (emojiContent.innerHTML === "") emojis();
}

function switchToStickers() {
  const emojiTab = document.getElementById("emoji-tab");
  const stickerTab = document.getElementById("sticker-tab");
  const emojiContent = document.getElementById("emoji-content");
  const stickerContent = document.getElementById("sticker-content");

  emojiTab.classList.remove("active");
  stickerTab.classList.add("active");
  emojiContent.style.display = "none";
  stickerContent.style.display = "block";

  if (stickerContent.innerHTML === "") loadStickers();
}

// Carregar figurinhas
function loadStickers() {
  const stickerContent = document.getElementById("sticker-content");
  const token = getToken();
  if (!stickerContent || !token) return;
  stickerContent.innerHTML = "";

  // Cria grid para os stickers
  const stickerGrid = document.createElement("div");
  stickerGrid.style.cssText =
    "display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5em;";

  fetch("/stickers-list", { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => res.json())
    .then(async (data) => {
      if (
        !data.success ||
        !Array.isArray(data.stickers) ||
        data.stickers.length === 0
      ) {
        stickerContent.innerHTML =
          '<p style="text-align:center;color:#999;padding:2em;">Nenhuma figurinha salva</p>';
        return;
      }

      // Remove duplicados
      const seen = new Set();
      const unique = data.stickers.filter((s) => {
        if (seen.has(s.url)) return false;
        seen.add(s.url);
        return true;
      });

      // Filtra apenas favoritos
      const favoriteStickers = [];
      for (const sticker of unique) {
        const inFavs = await isStickerInFavorites(sticker.url);
        if (inFavs) favoriteStickers.push(sticker);
      }

      if (favoriteStickers.length === 0) {
        stickerContent.innerHTML =
          '<p style="text-align:center;color:#999;padding:2em;">Nenhuma figurinha favoritada</p>';
        return;
      }

      // Ordena por mais recentes
      const savedStickers = getSavedStickersHashes();
      favoriteStickers.sort((a, b) => {
        const aIndex = savedStickers.findIndex((s) => s.url === a.url);
        const bIndex = savedStickers.findIndex((s) => s.url === b.url);
        return bIndex - aIndex;
      });

      favoriteStickers.forEach((sticker) => {
        const stickerDiv = document.createElement("div");
        stickerDiv.className = "sticker-item";
        stickerDiv.innerHTML = `
          <div style="position:relative;width:100%;height:100%">
            <img src="${sticker.url}" alt="sticker" style="width:100%;height:100%;object-fit:contain"/>
            <span style="position:absolute;top:2px;right:2px;font-size:1.2em">⭐</span>
          </div>
        `;
        stickerDiv.addEventListener("click", async () => {
          await sendStickerFromFile(sticker.url, sticker.name);
          emojiWindow(); // Fecha o menu após enviar
        });
        stickerDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showStickerContextMenu(e, sticker.url, stickerDiv);
        });
        stickerGrid.appendChild(stickerDiv);
      });

      stickerContent.appendChild(stickerGrid);
    })
    .catch((err) => {
      stickerContent.innerHTML =
        '<p style="text-align:center;color:#f44336;padding:2em;">Erro ao carregar figurinhas</p>';
    });
}

// Grid de emojis
function emojis() {
  const emojiGrid = document.getElementById("emoji-content");
  if (!emojiGrid) return;
  emojiGrid.innerHTML = "";
  const recents = getRecentEmojis();
  if (recents.length > 0) {
    const recentTitle = document.createElement("h4");
    recentTitle.textContent = "⏱️ Recentes";
    recentTitle.className = "emoji-category-title emoji-recent-title";
    emojiGrid.appendChild(recentTitle);
    const recentContainer = document.createElement("div");
    recentContainer.classList.add("emoji-section", "emoji-recent-section");
    recents.forEach((e) => {
      const span = document.createElement("span");
      span.textContent = e;
      span.classList.add("emoji", "emoji-recent");
      span.title = e;
      span.addEventListener("click", () => {
        const input = document.getElementById("text");
        if (input) {
          input.value += e;
          input.focus();
          addRecentEmoji(e);
          emojis();
        }
      });
      recentContainer.appendChild(span);
    });
    emojiGrid.appendChild(recentContainer);
    emojiGrid.appendChild(
      Object.assign(document.createElement("hr"), {
        className: "emoji-divider",
      })
    );
  }
  Object.entries(emojisByCategory).forEach(([category, list]) => {
    const title = document.createElement("h4");
    title.textContent = category;
    title.className = "emoji-category-title";
    emojiGrid.appendChild(title);
    const container = document.createElement("div");
    container.classList.add("emoji-section");
    list.forEach((e) => {
      const span = document.createElement("span");
      span.textContent = e;
      span.classList.add("emoji");
      span.title = e;
      span.addEventListener("click", () => {
        const input = document.getElementById("text");
        if (input) {
          input.value += e;
          input.focus();
          addRecentEmoji(e);
          emojis();
        }
      });
      container.appendChild(span);
    });
    emojiGrid.appendChild(container);
  });
}

// Handler de sockets
socket.on("message:new", async (msg) => {
  if (!msg) return;
  if (msg.fromMe && sentThisSession.includes(msg.messageId)) return;
  if (msg && msg.jid === currentChatJid) {
    renderMessage(msg);
    scrollToBottom(true);
    return;
  }
  const unreadCount = await fetchUnreadCount();
  if (unreadCount > 0)
    document.title = `Chat - Automaconn Chat (${unreadCount})`;
  else document.title = "Chat - Automaconn Chat";
  updateConversationPreview(msg);
});

socket.on("message:status", ({ messageId, status }) => {
  messageStatusMap[messageId] = status;
  applyMessageStatus(messageId, status);
});

socket.on("unread:update", ({ jid, unreadCount }) => {
  if (unreadCount > 0)
    document.title = `Chat - Automaconn Chat (${unreadCount})`;
  else document.title = "Chat - Automaconn Chat";
});

// Checar chat
function checkChat() {
  // Verifica se há um chat selecionado e atualiza a interface
  if (currentChatJid) {
    const chatDiv = document.querySelector(`[data-jid="${currentChatJid}"]`);
    if (chatDiv) {
      chatDiv.classList.add("selected");
    }
  }
}

// Atualizar imagens de perfil dos contatos
async function updateProfilePicture(jid) {
  // Validação: não busca se JID for inválido
  if (!jid || jid === "undefined" || jid === "null") {
    console.warn("updateProfilePicture: JID inválido:", jid);
    return;
  }

  try {
    const token = getToken();
    if (!token) return;

    const response = await fetch(
      `/update-profile-picture/${encodeURIComponent(jid)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.img) {
        const img = document.querySelector(`img[data-jid="${jid}"]`);
        if (img) {
          img.src = data.img;
          imageCache[jid] = data.img;
        }
      }
    }
  } catch (err) {
    console.error("Erro ao atualizar foto de perfil:", err);
  }
}

// Função auxiliar para atualizar foto de perfil
async function safeUpdateProfilePicture(jid) {
  // Validação: não busca se JID for inválido
  if (!jid || jid === "undefined" || jid === "null") {
    return;
  }

  // Wrapper seguro que não lança exceções
  try {
    await updateProfilePicture(jid);
  } catch (err) {
    // Silenciosamente ignora erros para não quebrar a renderização
    console.warn("Falha ao atualizar foto de perfil para", jid);
  }
}

/*
// Abrir menu de adicionar contato manualmente
function openAdd() {
  const addMenu = document.getElementById("add-menu");
  if (addMenu) {
    const isVisible = addMenu.style.display === "block";
    addMenu.style.display = isVisible ? "none" : "block";

    // Limpa os campos quando abre
    if (!isVisible) {
      const nameInput = document.getElementById("add-name");
      const numberInput = document.getElementById("add-number");
      if (nameInput) {
        nameInput.value = "";
        nameInput.disabled = false;
      }
      if (numberInput) {
        numberInput.value = "";
        numberInput.disabled = false;
      }
    }
  }
}

// Abrir as configurações
function openSettings() {
  // Abre menu de configurações (pode ser expandido conforme necessário)
  alert("Configurações em desenvolvimento");
}
*/

// Abrir menu de status
function openStatus() {
  const statusMenu = document.getElementById("status-buttons");
  if (!statusMenu) return;

  if (!sMBOpen) {
    statusMenu.style.display = "flex";
    sMBOpen = true;
  } else {
    statusMenu.style.display = "none";
    sMBOpen = false;
  }
}

// Sair da sessão
function quitSession() {
  if (confirm("Tem certeza que deseja sair da sessão?")) {
    clearToken();
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    window.location.href = "/login.html";
  }
}

// Fechar o menu de deletar usuário
function cancelDelete() {
  const deleteMenu = document.getElementById("delete-menu");
  if (deleteMenu) deleteMenu.style.display = "none";
}

// Funcionar para adicionar um contato
async function addContact() {
  const token = getToken();
  if (!token) {
    alert("Você não está logado");
    return;
  }

  const nameInput = document.getElementById("add-name");
  const emailInput = document.getElementById("add-email");

  if (!nameInput || !emailInput) {
    alert("Erro: campos não encontrados");
    return;
  }

  const name = nameInput.value.trim();
  const email = numberInput.value.trim();

  if (!name || !email) {
    alert("Por favor, preencha todos os campos");
    return;
  }

  try {
    const res = await fetch("/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, email }),
    });

    const data = await res.json();

    if (res.ok) {
      alert("✅ Contato adicionado com sucesso!");
      nameInput.value = "";
      emailInput.value = "";
      openAdd(); // Fecha o menu
      fetchConversations(); // Atualiza a lista
    } else {
      alert(`❌ Erro: ${data.error || "Não foi possível adicionar o contato"}`);
    }
  } catch (err) {
    console.error("Erro ao adicionar contato:", err);
    alert("❌ Erro ao adicionar contato. Tente novamente.");
  }
}

// Abrir menu de figurinhas
function openStickerMenu() {
  const stickerMenu = document.getElementById("stickers-menu");
  if (stickerMenu) {
    stickerMenu.style.display = "block";
    loadSavedStickers();
  }
}

// Fechar menu de figurinhas
function closeStickerMenu() {
  const stickerMenu = document.getElementById("stickers-menu");
  if (stickerMenu) stickerMenu.style.display = "none";
}

// Rolar sempre que uma mensagem nova chegar
function scrollToBottom(smooth = false) {
  const chatContainer = document.getElementById("chat-history");
  if (chatContainer) {
    if (smooth) {
      chatContainer.scrollTo({
        top: chatContainer.scrollHeight,
        behavior: "smooth",
      });
    } else {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }
}

// Atualizar a preview da conversa
function updateConversationPreview(msg) {
  if (!msg || !msg.jid) return;

  const chatDiv = document.querySelector(`.menu-chats[data-jid="${msg.jid}"]`);
  if (chatDiv) {
    const latestMsg = chatDiv.querySelector(".latest-msg");
    if (latestMsg && msg.text) {
      const formattedText = msg.text.replace(
        /\*([^*]+)\*/g,
        "<strong>$1</strong>"
      );
      latestMsg.innerHTML = formattedText;
    }

    // Move para o topo da lista
    const container = document.getElementById("menu-chat-block");
    if (container && chatDiv.parentNode === container) {
      container.insertBefore(chatDiv, container.firstChild);
    }
  }
}

// Fazer a contagem de mensagens não lidas
async function fetchUnreadCount() {
  const token = getToken();
  if (!token) return 0;

  try {
    const res = await fetch("/unread-count", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      return data.totalUnread || 0;
    }
  } catch (err) {
    console.error("Erro ao buscar mensagens não lidas:", err);
  }

  return 0;
}

// Inicializar a aplicação
async function initializeApp() {
  showLoading();
  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  // Esconde o chat inicialmente (será mostrado quando selecionar uma conversa)
  const chatEl = document.getElementById("chat");
  if (chatEl) chatEl.style.display = "none";

  try {
    await checkUserRoles(token);
    await checkConnection();
    await fetchConversations();
    await preloadVisibleImages();
    isLoading = false;
    hideLoading();
  } catch (error) {
    console.error("Erro na inicialização:", error);
    hideLoading();
    alert("Erro ao carregar aplicação. Tente novamente.");
  }
}

// Checar área do usuário
async function checkUserRoles(token) {
  try {
    const res = await fetch("/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401) {
        // Token inválido ou expirado
        localStorage.removeItem("token");
        clearToken();
        window.location.href = "/login.html";
        return;
      }
      throw new Error("Erro ao verificar usuário");
    }
    const user = await res.json();
    sup = user.role.includes(1);
    trein = user.role.includes(2);
    vend = user.role.includes(3);
    at = user.role.includes(4);
    admin = user.role.includes(5);
    if (admin) {
      if (deleteButton) deleteButton.style.display = "block";
      if (exitButton) exitButton.style.display = "block";
      if (addButton) addButton.style.display = "block";
    }
  } catch (error) {
    console.error("Erro ao verificar roles:", error);
    localStorage.removeItem("token");
    clearToken();
    window.location.href = "/login.html";
  }
}

// Checar conexão
async function checkConnection() {
  try {
    const statusRes = await fetch("/status");
    const statusData = await statusRes.json();
    if (statusData.status === "conectado") return;
    if (statusData.status === "reconectando") {
      setTimeout(checkConnection, 3000);
      return;
    }
    if (statusData.status === "desconectado") {
      window.location.href = "/connect.html";
    }
  } catch (error) {
    console.error("Erro ao verificar conexão:", error);
    window.location.href = "/connect.html";
  }
}

// Precarregar imagens visíveis
async function preloadVisibleImages() {
  const visibleChats = document.querySelectorAll(".menu-chats img.user-pfp");
  const promises = [];
  visibleChats.forEach((img) => {
    const jid = img.getAttribute("data-jid");
    if (jid) promises.push(updateProfilePicture(jid));
  });
  await Promise.all(promises);
}

// Mudar aba
function changeTab(tab) {
  currentTab = tab;
  document
    .querySelectorAll(".menu-header-options")
    .forEach((el, i) => el.classList.toggle("selected", i === tab - 1));
  fetchConversations();
}

// Fazer logout
document.addEventListener("DOMContentLoaded", () => {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn)
    logoutBtn.addEventListener("click", async () => {
      try {
        await fetch("/logout", { method: "POST" }).catch(() => {});
      } catch (e) {
        console.warn("Erro no logout backend:", e);
      }
      clearToken();
      localStorage.removeItem("token");
      sessionStorage.removeItem("token");
      window.location.href = "/login.html";
    });

  // Inicializar event listeners do menu de auto-mensagens
  autoMessage();
});

// Adicionar usuário
async function addUser() {
  const token = getToken();
  if (!token) return;
  if (admin) window.location.href = "/register.html";
  else alert("Você não tem permissão para fazer essa ação");
}

// Handler do menu de deletar usuários
async function deleteMenu() {
  const deleteMenuEl = document.getElementById("delete-menu");
  const res = await fetch("/users");
  const users = await res.json();
  const div = document.getElementById("delete-options");
  deleteMenuEl.style.display = "block";
  div.innerHTML = "";
  users.forEach((u) => {
    div.innerHTML += `<option value="${u.email}">${u.username}</option>`;
  });
}

// Deletar usuário
async function deleteUser() {
  const select = document.getElementById("delete-sel");
  const userEmail = select.value;
  if (!userEmail) {
    alert("Escolha um usuário para deletar");
    return;
  }
  const token = getToken();
  if (!token) {
    alert("Você não está logado");
    return;
  }
  const meRes = await fetch("/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const me = await meRes.json();
  if (!me.role.includes(5)) {
    alert("Você não tem permissão para fazer essa ação");
    return;
  }
  const userRes = await fetch(`/user-id/${userEmail}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const userData = await userRes.json();
  if (!userData.success) {
    alert("Usuário não encontrado");
    return;
  }
  const res = await fetch(`/users/${userData.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    alert("Usuário deletado com sucesso");
    deleteMenu();
  } else {
    const err = await res.json();
    alert("Erro ao deletar usuário: " + (err.error || "Tente novamente"));
  }
}

// Deletar conversa
async function deleteConversation(jid) {
  // Validação: não deleta se JID for inválido
  if (!jid || jid === "undefined" || jid === "null") {
    console.error("deleteConversation: JID inválido:", jid);
    alert("Erro: Conversa inválida");
    return;
  }

  const more = document.getElementById("more-chat");
  const header = document.getElementById("chat-header");
  const token = getToken();
  if (!token) {
    alert("Você não está logado");
    return;
  }
  const convRes = await fetch(`/conversation-id/${encodeURIComponent(jid)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const convData = await convRes.json();
  if (!convData.success) {
    alert("Conversa não encontrada");
    return;
  }
  const res = await fetch(`/conversations/${convData.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    alert("Conversa deletada com sucesso");
    // Limpa o estado antes de fechar o menu
    currentChat = null;
    currentChatJid = null;
    if (more) more.style.display = "none";
    if (header) header.style.visibility = "visible";
    moreOpened = false;
    const chatEl = document.getElementById("chat");
    if (chatEl) chatEl.style.display = "none";
    // Atualiza a lista de conversas
    await fetchConversations();
  } else {
    const err = await res.json();
    alert("Erro ao deletar essa conversa: " + (err.error || "Tente novamente"));
  }
}

// Salvar contato diretamente do chat
function saveContactFromChat() {
  const jid = currentChatJid;
  if (!jid || jid === "undefined" || jid === "null") {
    alert("Nenhuma conversa aberta");
    return;
  }
  const phoneNumber = jid.replace(/\D/g, "");
  openAdd();
  const numberInput = document.getElementById("add-number");
  if (numberInput) {
    numberInput.value = phoneNumber;
    numberInput.disabled = true;
  }
  const nameInput = document.getElementById("add-name");
  if (nameInput) {
    nameInput.focus();
    nameInput.value = "";
  }
}

// Deletar contato
async function deleteContact() {
  const jid = currentChatJid;
  if (!jid || jid === "undefined" || jid === "null") {
    alert("Nenhuma conversa aberta");
    return;
  }
  const token = getToken();
  if (!token) {
    alert("Você não está logado");
    return;
  }
  if (!confirm("Tem certeza que deseja deletar este contato?")) return;
  try {
    const res = await fetch(`/contacts/${encodeURIComponent(jid)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) {
      alert("✅ Contato deletado com sucesso!");
      fetchConversations();
      if (moreOpened) expandContact();
      checkAndToggleSaveContactButton(jid);
    } else {
      alert(`❌ Erro: ${data.error || "Não foi possível deletar o contato"}`);
    }
  } catch (err) {
    console.error("Erro ao deletar contato:", err);
    alert("❌ Erro ao deletar contato. Tente novamente.");
  }
}

// Checar e alternar botão de salvar contato
async function checkAndToggleSaveContactButton(jid) {
  const saveContactBtn = document.getElementById("save-contact-btn");
  const deleteContactBtn = document.getElementById("delete-contact-btn");
  const token = getToken();
  if (!token) {
    if (saveContactBtn) saveContactBtn.classList.remove("visible");
    if (deleteContactBtn) deleteContactBtn.classList.remove("visible");
    return;
  }
  try {
    const encodedJid = encodeURIComponent(jid);
    const res = await fetch(`/contact-exists/${encodedJid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.exists === false) {
        if (saveContactBtn) saveContactBtn.classList.add("visible");
        if (deleteContactBtn) deleteContactBtn.classList.remove("visible");
      } else {
        if (saveContactBtn) saveContactBtn.classList.remove("visible");
        if (deleteContactBtn) deleteContactBtn.classList.add("visible");
      }
    } else {
      if (saveContactBtn) saveContactBtn.classList.remove("visible");
      if (deleteContactBtn) deleteContactBtn.classList.remove("visible");
    }
  } catch (err) {
    console.error("Erro ao verificar contato:", err);
    if (saveContactBtn) saveContactBtn.classList.remove("visible");
    if (deleteContactBtn) deleteContactBtn.classList.remove("visible");
  }
}

// Expandir contato
function expandContact() {
  const more = document.getElementById("more-chat");
  const button = document.getElementById("mais-sym");
  const buttons = document.getElementById("more-buttons");
  const header = document.getElementById("chat-header");
  const div = document.querySelector(".menu-chats.selected");
  if (!div) return;
  if (moreOpened === false) {
    const jid = div.getAttribute("data-jid");

    // Validação: não expande se JID for inválido
    if (!jid || jid === "undefined" || jid === "null") {
      console.error("expandContact: JID inválido:", jid);
      return;
    }

    if (buttons)
      buttons.innerHTML = `<button class="configbtn green add" id="save-contact-btn" onclick="saveContactFromChat('${jid}')">Salvar contato</button><button class="configbtn red remove" id="delete-contact-btn" onclick="deleteContact('${jid}')">Deletar contato</button><button id="delete-conv" class="configbtn delete" onclick="deleteConversation('${jid}')">Deletar conversa</button>`;
    if (header) header.style.visibility = "hidden";
    if (more) more.style.display = "block";
    if (button) {
      button.style.visibility = "visible";
      button.classList.add("opened");
    }
    checkAndToggleSaveContactButton(jid);
    moreOpened = true;
  } else {
    const moreEl = document.getElementById("more-chat");
    if (moreEl) moreEl.style.display = "none";
    if (header) header.style.visibility = "visible";
    if (button) button.classList.remove("opened");
    moreOpened = false;
  }
}

// Abrir conversa
async function openChat(jid) {
  // Validação: não abre se JID for inválido
  if (!jid || jid === "undefined" || jid === "null") {
    console.error("openChat chamado com JID inválido:", jid);
    return;
  }

  const token = getToken();
  if (!token) return (window.location.href = "/login.html");

  // Mostra o bloco de chat quando uma conversa é selecionada
  const chatEl = document.getElementById("chat");
  if (chatEl) chatEl.style.display = "flex";
  const chatContainer = document.getElementById("chat-history");
  const headerName = document.getElementById("client-name-header");
  const headerImg = document.getElementById("pfp");
  if (headerImg) {
    headerImg.setAttribute("data-jid", jid);
    // Define avatar padrão imediatamente
    const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(
      jid
    )}&background=random`;
    headerImg.src = defaultAvatar;
    headerImg.alt = jid;
    headerImg.onerror = () => (headerImg.src = defaultAvatar);
  }
  const cached = chatHeaderCache[jid];
  if (cached) {
    if (headerName) headerName.textContent = cached.name;
    if (headerImg) headerImg.src = cached.img;
  } else {
    if (headerName) headerName.textContent = "Carregando...";
    const cachedImage = imageCache[jid];
    if (headerImg)
      headerImg.src = cachedImage
        ? cachedImage.url
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(
            jid
          )}&background=random`;
  }
  try {
    const res = await fetch(`/conversations/${encodeURIComponent(jid)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Não foi possível carregar a conversa");
    await fetch("/mark-as-read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jid }),
    });
    const data = await res.json();
    if (headerName) headerName.textContent = data.name;
    try {
      const imgRes = await fetch(
        `/update-profile-picture/${encodeURIComponent(jid)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      let imgUrl;
      if (imgRes.status === 204)
        imgUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
          data.name
        )}&background=random`;
      else {
        const contentType = imgRes.headers.get("content-type") || "";
        imgUrl = contentType.includes("application/json")
          ? (await imgRes.json()).img
          : `/profile-pics/${encodeURIComponent(jid)}.jpg`;
      }
      if (headerImg) headerImg.src = imgUrl;
      imageCache[jid] = { url: imgUrl, timestamp: Date.now() };
    } catch (e) {
      if (headerImg)
        headerImg.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
          data.name
        )}&background=random`;
    }
    chatHeaderCache[jid] = {
      name: data.name,
      img: headerImg ? headerImg.src : null,
    };
    renderStatusButtons(data);

    // Verifica se a conversa está fechada ou em fila e bloqueia/desbloqueia o input
    const textInput = document.getElementById("text");
    if (textInput) {
      if (data.status === "closed") {
        textInput.disabled = true;
        textInput.placeholder = "Esta conversa foi encerrada";
      } else if (data.status === "queue") {
        textInput.disabled = true;
        textInput.placeholder = "Conversa em fila - não pode enviar mensagens";
      } else {
        textInput.disabled = false;
        textInput.placeholder = "Mensagem";
      }
    }

    if (chatContainer) {
      chatContainer.innerHTML = "";
      renderMessages(chatContainer, data.messages || []);
    }
    lastMessageCountMap[jid] = (data.messages || []).length;
    scrollToBottom(false);
    currentChatJid = jid;
    currentChat = jid;
  } catch (err) {
    console.error("Erro ao abrir conversa:", err);
  }
}

// Atualizar chat
async function updateChat(jid) {
  // Validação: não atualiza se JID for inválido
  if (!jid || jid === "undefined" || jid === "null") {
    console.error("updateChat: JID inválido:", jid);
    return;
  }

  const token = getToken();
  if (!token) return;
  const chatContainer = document.getElementById("chat-history");
  if (!chatContainer) return;
  try {
    const res = await fetch(`/conversations/${encodeURIComponent(jid)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.messages || !Array.isArray(data.messages)) return;
    const lastMessageCount = lastMessageCountMap[jid] || 0;
    const newMessages = data.messages.slice(lastMessageCount);
    if (newMessages.length > 0) {
      renderMessages(chatContainer, newMessages);
      const isNearBottom =
        chatContainer.scrollHeight -
          chatContainer.scrollTop -
          chatContainer.clientHeight <
        30;
      if (isNearBottom) scrollToBottom(true);
      lastMessageCountMap[jid] = data.messages.length;
    }
  } catch (err) {
    console.error("Erro ao atualizar chat:", err);
  }
}

// Renderizar botões de status
function renderStatusButtons(c) {
  const statusContainer = document.getElementById("status-buttons");
  if (!statusContainer) return;

  // Validação: não renderiza botões se JID for inválido
  if (!c || !c.jid || c.jid === "undefined" || c.jid === "null") {
    console.error("renderStatusButtons: JID inválido:", c?.jid);
    statusContainer.innerHTML = "";
    statusContainer.style.display = "none";
    sMBOpen = false;
    return;
  }

  const ativarClass = c.status === "active" ? " current-status" : "";
  const filaClass = c.status === "queue" ? " current-status" : "";
  const fecharClass = c.status === "closed" ? " current-status" : "";

  statusContainer.innerHTML = `<button id="ativar" class="status-btn${ativarClass}" onclick="updateStatus('${c.jid}','active')">Ativar</button><button id="fila" class="status-btn${filaClass}" onclick="updateStatus('${c.jid}','queue')">Fila</button><button id="fechar" class="status-btn${fecharClass}" onclick="updateStatus('${c.jid}','closed')">Fechar</button>`;
  // Não abre automaticamente, apenas prepara os botões
  statusContainer.style.display = "none";
  sMBOpen = false;
}

// Atualizar status da conversa
async function updateStatus(jid, status) {
  // Validação: não atualiza se JID for inválido
  if (!jid || jid === "undefined" || jid === "null") {
    console.error("updateStatus: JID inválido:", jid);
    return;
  }

  // Se for fechar, abre o menu de opções
  if (status === "closed") {
    openCloseMenu(jid);
    openStatus(); // Fecha o menu de status
    return;
  }

  await fetch(`/conversations/${encodeURIComponent(jid)}/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ status }),
  });

  // Atualiza o input conforme o novo status
  const textInput = document.getElementById("text");
  if (textInput && currentChatJid === jid) {
    if (status === "active") {
      textInput.disabled = false;
      textInput.placeholder = "Mensagem";
    } else if (status === "queue") {
      textInput.disabled = true;
      textInput.placeholder = "Conversa em fila - não pode enviar mensagens";
    }
  }

  // Atualiza os botões de status para refletir o novo status
  const statusContainer = document.getElementById("status-buttons");
  if (statusContainer) {
    const ativarBtn = document.getElementById("ativar");
    const filaBtn = document.getElementById("fila");
    const fecharBtn = document.getElementById("fechar");

    // Remove a classe current-status de todos
    if (ativarBtn) ativarBtn.classList.remove("current-status");
    if (filaBtn) filaBtn.classList.remove("current-status");
    if (fecharBtn) fecharBtn.classList.remove("current-status");

    // Adiciona a classe ao botão correspondente ao novo status
    if (status === "active" && ativarBtn)
      ativarBtn.classList.add("current-status");
    if (status === "queue" && filaBtn) filaBtn.classList.add("current-status");
  }

  // Fecha o menu após atualizar o status
  openStatus();
  switch (status) {
    case "active":
      changeTab(1);
      break;
    case "queue":
      changeTab(2);
      break;
  }
  fetchConversations();
}

// Abrir e fechar menu de fechamento de conversa
let closeMenuJid = null;

function openCloseMenu(jid) {
  closeMenuJid = jid;
  const closeMenu = document.getElementById("close-menu");
  if (closeMenu) closeMenu.style.display = "block";
}

function cancelCloseMenu() {
  closeMenuJid = null;
  const closeMenu = document.getElementById("close-menu");
  if (closeMenu) closeMenu.style.display = "none";
}

// Fechar conversa
async function closeConversation(message = null) {
  if (!closeMenuJid) return;

  const token = getToken();
  if (!token) {
    alert("Você não está logado");
    return;
  }

  try {
    // Envia mensagem se fornecida
    if (message) {
      const res = await fetch("/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const username = await res.json();
      const user = username.username;
      const userFormatted = capitalizeFirstLetter(user);

      // Renderiza a mensagem temporária na tela
      const tempId = `temp-${Date.now()}`;
      sentThisSession.push(tempId);

      const chatContainer = document.getElementById("chat-history");
      if (chatContainer) {
        const time = formatTime12h();

        const msgDiv = document.createElement("div");
        msgDiv.id = tempId;
        msgDiv.className = "msg-bubble";
        msgDiv.innerHTML = `
          <p class="msg-bubble-text"><strong>${userFormatted}:</strong><br>${escapeHtml(
          message
        )}</p>
          <span class="msg-info">
            <p class="msg-hour">${time}</p>
            <img class="msg-status" src="../images/pending.png" />
          </span>
        `;
        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }

      // Envia a mensagem
      const resSend = await fetch("/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jid: closeMenuJid,
          textFormatted: `*${userFormatted}:*\n${message}`,
        }),
      });

      if (resSend.ok) {
        const data = await resSend.json();
        if (data?.message?.messageId) {
          const newId = data.message.messageId;
          const tempDiv = document.getElementById(tempId);
          if (tempDiv) tempDiv.id = newId;
          sentThisSession.push(newId);
        }
      }
    }

    // Atualiza o status para fechado
    await fetch(`/conversations/${encodeURIComponent(closeMenuJid)}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "closed" }),
    });

    // Bloqueia o input de mensagem
    const textInput = document.getElementById("text");
    if (textInput) {
      textInput.disabled = true;
      textInput.placeholder = "Esta conversa foi encerrada";
    }

    // Atualiza os botões de status para refletir o status fechado
    const statusContainer = document.getElementById("status-buttons");
    if (statusContainer) {
      const ativarBtn = document.getElementById("ativar");
      const filaBtn = document.getElementById("fila");
      const fecharBtn = document.getElementById("fechar");

      // Remove a classe current-status de todos
      if (ativarBtn) ativarBtn.classList.remove("current-status");
      if (filaBtn) filaBtn.classList.remove("current-status");
      if (fecharBtn) fecharBtn.classList.remove("current-status");

      // Adiciona a classe ao botão Fechar
      if (fecharBtn) fecharBtn.classList.add("current-status");
    }

    // Fecha os menus e atualiza a interface
    cancelCloseMenu();

    // Fecha o menu de status se estiver aberto
    if (sMBOpen) {
      openStatus();
    }

    changeTab(3);
    fetchConversations();
  } catch (err) {
    alert("Erro ao fechar conversa");
  }
}

// Fechar com sucesso
async function closeWithSuccess() {
  const message =
    "Obrigado por entrar em contato com nossa empresa! Seu atendimento foi concluído com sucesso. Estamos à disposição sempre que precisar. Tenha um ótimo dia! 😊";
  await closeConversation(message);
}

// Fechar com demora
async function closeWithTimeout() {
  const message =
    "Olá! Notamos que você não respondeu nas últimas mensagens. Por conta do tempo de inatividade, este atendimento será encerrado. Caso precise de ajuda novamente, fique à vontade para nos contatar. Até logo! 👋";
  await closeConversation(message);
}

// Fechar sem mensagem
async function closeWithoutMessage() {
  await closeConversation();
}

// Enviar mensagem
async function sendMessage() {
  const input = document.querySelector("#text");
  if (!input) return;
  const token = getToken();
  if (!token) return (window.location.href = "/login.html");
  try {
    const res = await fetch("/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const username = await res.json();
    const user = username.username;
    const userFormatted = capitalizeFirstLetter(user);
    const inputValue = input.value.trim();
    if (!inputValue) return;
    if (!currentChatJid) return;
    const tempId = `temp-${Date.now()}`;
    sentThisSession.push(tempId);
    renderMessage({
      text: `<strong>${userFormatted}:</strong><br>${escapeHtml(inputValue)}`,
      fromMe: true,
      name: "Você",
      status: "pending",
      messageId: tempId,
      timestamp: Date.now(),
      jid: currentChatJid,
    });
    input.value = "";
    const resSend = await fetch("/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jid: currentChatJid,
        textFormatted: `*${userFormatted}:*\n${inputValue}`,
      }),
    });
    if (!resSend.ok) {
      const error = await resSend.json();
      const tempDiv = document.getElementById(tempId);
      if (tempDiv) tempDiv.remove();
      alert("Erro ao enviar mensagem: " + (error.error || "Tente novamente"));
      return;
    }
    const data = await resSend.json();
    if (data?.message?.messageId) {
      const newId = data.message.messageId;
      const tempDiv = document.getElementById(tempId);
      if (tempDiv) tempDiv.id = newId;
      sentThisSession.push(newId);
    }
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err);
    const tempDiv = document.getElementById(`temp-${Date.now()}`);
    if (tempDiv) tempDiv.remove();
    alert("Erro de conexão ao enviar mensagem");
  }
}

// Enviar mensagem ao apertar enter
if (textInput) {
  textInput.addEventListener("keypress", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await sendMessage();
    }
  });
}

// Intervals
setInterval(fetchConversations, 2000);
setInterval(() => {
  if (!socket.connected && currentChatJid) updateChat(currentChatJid);
}, 3000);

// Inicializações
initializeApp();
checkChat();

// Controle do player de audio
function toggleAudioPlay(audioId) {
  const audio = document.getElementById(audioId);
  const btn = audio.parentElement.querySelector(".audio-play-btn span");
  const progress = document.getElementById(`progress-${audioId}`);
  const durationEl = document.getElementById(`duration-${audioId}`);

  if (audio.paused) {
    // Para todos os outros áudios
    document.querySelectorAll("audio").forEach((a) => {
      if (a.id !== audioId && !a.paused) {
        a.pause();
        const otherBtn = a.parentElement.querySelector(".audio-play-btn span");
        if (otherBtn) otherBtn.textContent = "play_arrow";
      }
    });

    audio.play();
    btn.textContent = "pause";
  } else {
    audio.pause();
    btn.textContent = "play_arrow";
  }

  // Atualiza duração quando metadata carrega
  audio.onloadedmetadata = () => {
    if (
      audio.duration &&
      !isNaN(audio.duration) &&
      audio.duration !== Infinity
    ) {
      const minutes = Math.floor(audio.duration / 60);
      const seconds = Math.floor(audio.duration % 60);
      durationEl.textContent = `${minutes}:${seconds
        .toString()
        .padStart(2, "0")}`;
      progress.max = audio.duration * 100; // Multiplica por 100 para maior precisão
    }
  };

  // Atualiza barra de progresso em tempo real
  audio.ontimeupdate = () => {
    if (
      audio.duration &&
      !isNaN(audio.duration) &&
      audio.duration !== Infinity
    ) {
      progress.value = (audio.currentTime / audio.duration) * 100;
      const minutes = Math.floor(audio.currentTime / 60);
      const seconds = Math.floor(audio.currentTime % 60);
      durationEl.textContent = `${minutes}:${seconds
        .toString()
        .padStart(2, "0")}`;
    }
  };

  // Quando terminar
  audio.onended = () => {
    btn.textContent = "play_arrow";
    progress.value = 0;
    if (
      audio.duration &&
      !isNaN(audio.duration) &&
      audio.duration !== Infinity
    ) {
      const minutes = Math.floor(audio.duration / 60);
      const seconds = Math.floor(audio.duration % 60);
      durationEl.textContent = `${minutes}:${seconds
        .toString()
        .padStart(2, "0")}`;
    }
  };

  // Permitir buscar no áudio (converte % para segundos)
  progress.oninput = () => {
    if (
      audio.duration &&
      !isNaN(audio.duration) &&
      audio.duration !== Infinity
    ) {
      audio.currentTime = (progress.value / 100) * audio.duration;
    }
  };
}

// Mostrar o tamanho da tela (debug)
function logScreenSize() {
  console.log(
    `Largura: ${window.innerWidth}px | Altura: ${window.innerHeight}px`
  );
}
logScreenSize();

// Atualiza quando a tela é redimensionada (debug)
window.addEventListener("resize", logScreenSize);

// Funções para que os botões funcionem
window.changeTab = changeTab;
window.openAdd = openAdd;
window.openSettings = openSettings;
window.expandContact = expandContact;
window.openStatus = openStatus;
window.updateStatus = updateStatus;
window.quitSession = quitSession;
window.deleteMenu = deleteMenu;
window.addUser = addUser;
window.deleteUser = deleteUser;
window.cancelDelete = cancelDelete;
window.deleteConversation = deleteConversation;
window.emojiWindow = emojiWindow;
window.addContact = addContact;
window.saveContactFromChat = saveContactFromChat;
window.deleteContact = deleteContact;
window.openStickerMenu = openStickerMenu;
window.closeStickerMenu = closeStickerMenu;
window.sendSticker = sendSticker;
window.sendStickerFromFile = sendStickerFromFile;
window.saveReceivedSticker = saveReceivedSticker;
window.closeWithSuccess = closeWithSuccess;
window.closeWithTimeout = closeWithTimeout;
window.closeWithoutMessage = closeWithoutMessage;
window.toggleAudioRecording = toggleAudioRecording;
window.switchToEmojis = switchToEmojis;
window.switchToStickers = switchToStickers;
window.toggleAudioPlay = toggleAudioPlay;
window.cancelCloseMenu = cancelCloseMenu;

// Fim do arquivo
