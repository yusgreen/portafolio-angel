/* =============================================================
   WeBOT - Bot de sala para Haxball — MODO ROTATIVO PURO  (v2 pulida)
   (sin draft, sin capitanes, sin comandos que aprender)

   Reglas del rotativo:
     - El que GANA se queda en ROJO (sin tope de victorias).
     - El que PIERDE va al FONDO de la cola.
     - El siguiente partido lo arman los PRIMEROS de la cola (FIFO).
     - Si alguien se va o se duerme EN PLENA cancha, entra el ÚLTIMO
       de la cola (no se le roba el turno limpio al que sigue en fila).
     - Si sobra gente, la partida SUBE de tamaño sin detenerse
       (debounce de 1s para no hacer vaivén 2->3->2).
     - AFK en cancha: no se expulsa, se pasa a la cola; vuelve solo
       con cualquier mensaje o con !afk.
     - AFK en cola: si supera CONFIG.afkQueueMaxMin, se expulsa.
     - !cola muestra tu posición y quiénes siguen.

   Para tener varias salas, corre cada archivo con su propio CONFIG.roomName.

   Uso: pega todo este archivo en la consola del Haxball Headless Host y Enter.
   Si ya hay una instancia corriendo, no se crea otra sala (recarga el host
   para cargar una versión nueva del script).
============================================================= */
(() => {
if (typeof globalThis !== "undefined" && globalThis.__webot) {
    if (typeof console !== "undefined") console.warn("[weBOT] Ya hay una instancia activa. No se crea otra sala. Recarga el Headless Host para actualizar el script.");
    return;
}

const ENV_ADMIN_PASSWORD =
    (typeof process !== "undefined" && process.env && process.env.WEBOT_ADMIN_PASSWORD) ||
    (typeof globalThis !== "undefined" && globalThis.WEBOT_ADMIN_PASSWORD) ||
    "";
const DEFAULT_ADMIN_PASSWORD = ENV_ADMIN_PASSWORD || "3434";

const CONFIG = {
    roomName: "🥚 𝟰𝘃𝟰 𝗥𝗢𝗧𝗔𝗧𝗜𝗩𝗢 • 𝗦𝗢𝗟𝗢 𝗠𝗘𝗠𝗘𝗦 🥚",
    botName: " 🥚 ",
    maxPlayers: 30,
    public: true,
    token: "",                  // opcional: solo para hostear automatizado (Node/Puppeteer). Pegando en la consola del headless NO hace falta
    geo: null,                  // opcional, para mostrar bandera: { code: "XX", lat: 0, lon: 0 }
    useCustomStadium: true,     // true = usa el mapa Futsal x4 embebido abajo; false = "Classic"
    maxTeamSize: 4,
    scoreLimit: 3,
    gameTimeLimit: 3,
    minPlayersToStart: 2,
    autoStart: true,            // arranque automático de partidos
    autoStartDelay: 0.5,        // segundos
    afkWarnSec: 10,
    afkKickSec: 20,             // en rotativo = tiempo antes de pasar a la cola
    afkQueueMaxMin: 30,         // minutos AFK en la cola antes de expulsar (0 = sin límite)
    shuffleLosers: true,        // perdedores al fondo en orden aleatorio
    adminPassword: DEFAULT_ADMIN_PASSWORD, // se puede sobreescribir con WEBOT_ADMIN_PASSWORD
    preventDuplicates: true,
    warnLimit: 3,               // avisos antes de silenciar automáticamente
    filterLinks: true,          // bloquear links de no-admins
    filterCaps: true,           // bloquear mensajes TODO EN MAYÚSCULAS
    filterRepeat: true,         // bloquear el mismo mensaje repetido
    autoAvisoMin: 0,            // 0 = desactivado; >0 = recordatorio cada X minutos
    rules: [
        "Ganas y sigues en rojo; pierdes y vas al fondo.",
        "Juegan los primeros de la cola (!cola).",
        "AFK: pasas a la cola; vuelve con !afk o escribiendo.",
        "No insultos, spam ni links.",
        "Stats y top son privados: !stats o !top.",
        "AFK en cola: si supera el tiempo máximo, se expulsa."
    ]
};

const ADMIN_MAX_ATTEMPTS = 5;
const ADMIN_ATTEMPT_WINDOW_MS = 60000;

// Parámetros de estabilidad.
const EXPANSION_COOLDOWN_MS = 3000;   // mínimo desde el inicio del partido para anunciar expansión
const EXPAND_DEBOUNCE_MS   = 1000;    // la gente debe sostener el nuevo tamaño 1s antes de aplicar
const WATCHDOG_INTERVAL_MS = 1500;
const LOBBY_IDLE_LIMIT_MS  = 4000;
const PAUSE_LIMIT_MS       = 4000;
const EMPTY_TEAM_CONFIRM_MS = 1500;
const FILL_ACTIVE_WINDOW_MS = 90000;  // preferir rellenos con actividad reciente
const FLOOD_WINDOW_MS      = 4000;    // anti-spam: máx. mensajes por ventana
const FLOOD_MAX_MSGS       = 5;
const FUN_COOLDOWN_MS      = 4000;    // cooldown de !dado / !pinga / !chiste
const NO_TEAMS_MSG_COOLDOWN_MS = 10000;

const Team = { SPEC: 0, RED: 1, BLUE: 2 };

const THEME = {
    primary: 0xFFF8DC, accent: 0xFFD700, warn: 0xFFA500,
    danger: 0xFF5252, info: 0xB0BEC5, red: 0xFF6B6B,
    blue: 0x64B5F6, success: 0x2ECC71, white: 0xFFFFFF
};

function logError(e) {
    if (typeof console !== "undefined") console.error("[weBOT] Error:", e && e.stack ? e.stack : e);
}
function later(fn, ms) {
    return setTimeout(function () {
        try { fn(); } catch (e) { logError(e); }
    }, ms);
}

function bold(s) {
    return String(s).split("").map(ch => {
        const c = ch.charCodeAt(0);
        if (c >= 65 && c <= 90) return String.fromCodePoint(0x1D400 + c - 65);
        if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D41A + c - 97);
        if (c >= 48 && c <= 57) return String.fromCodePoint(0x1D7CE + c - 48);   // (antes: c - 97 => dígitos rotos)
        return ch;
    }).join("");
}
function strLen(s) { return Array.from(String(s)).length; }
function eggLineFor(text) {
    const longest = Math.max(...text.split("\n").map(l => strLen(l)));
    return "🥚".repeat(Math.min(20, Math.max(4, Math.ceil(longest / 2))));
}
function frame(text) {
    const line = eggLineFor(text);
    return `${line}\n${text}\n${line}`;
}
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

if (CONFIG.adminPassword === "3434" && typeof console !== "undefined") {
    console.warn("[weBOT] ⚠️ Estás usando la contraseña de admin por defecto. Cámbiala en CONFIG.adminPassword.");
}

/* =============================================================
   ALMACENAMIENTO  (localStorage > archivo JSON > memoria)
============================================================= */
function createStorage() {
    if (typeof localStorage !== "undefined" && localStorage) {
        try {
            localStorage.setItem("__webot_test__", "1");
            localStorage.removeItem("__webot_test__");
            return { kind: "localStorage", impl: localStorage };
        } catch (e) { /* sigue probando otras opciones */ }
    }
    try {
        if (typeof require === "function") {
            const fsMod = require("fs");
            const filePath = "./webot_stats.json";
            let data = {};
            try {
                if (fsMod.existsSync(filePath)) {
                    data = JSON.parse(fsMod.readFileSync(filePath, "utf8")) || {};
                }
            } catch (e) { data = {}; }
            let saveTimer = null;
            function scheduleSave() {
                clearTimeout(saveTimer);
                saveTimer = setTimeout(() => {
                    try { fsMod.writeFileSync(filePath, JSON.stringify(data)); } catch (e) {}
                }, 500);
            }
            return {
                kind: "file",
                impl: {
                    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
                    setItem(k, v) { data[k] = String(v); scheduleSave(); },
                    removeItem(k) { delete data[k]; scheduleSave(); },
                    key(i) { return Object.keys(data)[i] || null; },
                    get length() { return Object.keys(data).length; }
                }
            };
        }
    } catch (e) { /* sigue al fallback final */ }
    return {
        kind: "memory",
        impl: {
            _d: {},
            getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
            setItem(k, v) { this._d[k] = String(v); },
            removeItem(k) { delete this._d[k]; },
            key(i) { return Object.keys(this._d)[i] || null; },
            get length() { return Object.keys(this._d).length; }
        }
    };
}
const storageInfo = createStorage();
const storage = storageInfo.impl;
if (storageInfo.kind === "memory" && typeof console !== "undefined") {
    console.warn("[weBOT] No se encontró localStorage ni sistema de archivos: las estadísticas NO sobrevivirán a un reinicio del bot.");
} else if (typeof console !== "undefined") {
    console.log(`[weBOT] Estadísticas persistidas via: ${storageInfo.kind}`);
}
function jsonParse(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch (e) { return fb; } }

/* =============================================================
   MENSAJES
============================================================= */
const MSG = {
    /* Sistema */
    join:    (n) => `🥚 ${n} entró a la sala.`,
    welcome: () => (
        `🥚 ¡Bienvenido a WeBOT, causa!\n` +
        `Ganas y sigues · Pierdes y vas al fondo\n` +
        `🕒 !cola  ·  💬 t mensaje  ·  📖 !help`
    ),
    help: (esAdmin) => (
        `📖 COMANDOS\n` +
        `🕒 !cola  !afklist  !quien  !estado\n` +
        `👤 !stats [nombre]  !top  !ultimo  !reglas\n` +
        `📊 !goals  !assists  !wins  !games  !porteriacero\n` +
        `🚨 !report nombre motivo\n` +
        `🎲 !dado  !pinga  !chiste\n` +
        `💬 Chat de equipo: t mensaje` +
        (esAdmin ? `\n🛠️ ADMIN\n!start !stop !reset !aviso !sorteo !mapa !pausa !reanudar\n!kick !ban !unban !mute !unmute !warn !warns !chatpausado` : "")
    ),
    aviso: (txt) => `📢 AVISO\n${txt}`,
    autoAviso: () => `📢 Recordatorio: ganas y sigues, pierdes y vas al fondo. Cola: !cola · Reglas: !reglas.`,
    reglas: () => `📖 REGLAS\n${CONFIG.rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
    estado: (uptime, total, cola, afk, partido, mapa) => (
        `📡 ESTADO\n` +
        `⏱️ ${uptime} en línea\n` +
        `👥 ${total} conectados · 🕒 ${cola} en cola · 💤 ${afk} AFK\n` +
        `⚽ ${partido}\n` +
        `🗺️ Mapa: ${mapa}`
    ),

    /* Admin / moderación */
    yaAdmin:   () => `✅ Ya eres admin.`,
    adminOk:   (n) => `✅ ${n} ahora es admin.`,
    claveMal:  (restantes) => `❌ Contraseña incorrecta. Intentos restantes: ${restantes}.`,
    demasiadosIntentos: () => `⛔ Demasiados intentos. Espera un minuto antes de volver a probar.`,
    sinPermiso:() => `🚫 No tienes permisos para eso.`,
    kickOk:    (n) => `👢 ${n} fue expulsado.`,
    banOk:     (n) => `🔨 ${n} fue baneado.`,
    unbanOk:   (n) => `✅ ${n} puede volver a entrar.`,
    unbanTodos: () => `✅ Se levantaron todos los baneos.`,
    banLista:  (l) => `🔨 Baneados: ${l}\nUsa !unban nombre o !unban todos.`,
    banVacia:  () => `🕊️ No hay baneados.`,
    muteOk:    (n) => `🔇 ${n} fue silenciado.`,
    unmuteOk:  (n) => `🔊 ${n} puede hablar de nuevo.`,
    chatLentoOn:  () => `🔇 Chat lento activado (1 mensaje cada 2s).`,
    chatLentoOff: () => `🔊 Chat libre reactivado.`,
    chatLentoEspera: () => `⏳ Chat lento: espera un momento.`,
    warnOk: (n, c, max) => `⚠️ ${n} recibió un aviso (${c}/${max}).`,
    warnMute: (n, max) => `🔇 ${n} fue silenciado por acumular ${max} avisos.`,
    warnRecibido: (c, max, motivo) => `⚠️ Recibiste un aviso (${c}/${max})${motivo ? `: ${motivo}` : "."}`,
    warnsVacio: () => `✅ No hay avisos registrados.`,
    warnsLinea: (n, c, motivo) => `⚠️ ${n}: ${c} aviso${c === 1 ? "" : "s"}${motivo ? ` · ${motivo}` : ""}`,
    reporte: (de, sobre, motivo) => `🚨 REPORTE\nDe: ${de}\nSobre: ${sobre}\nMotivo: ${motivo || "Sin motivo"}`,
    reporteOk: () => `✅ Reporte enviado a los admins.`,
    reporteSinAdmin: () => `⚠️ No hay admins conectados ahora. Avisa por el chat.`,
    reporteEspera: () => `⏳ Espera un momento antes de reportar de nuevo.`,
    filtroLink: () => `🔗 No se permiten links en el chat.`,
    filtroCaps: () => `🔠 No escribas todo en mayúsculas.`,
    filtroRepetir: () => `🔁 No repitas el mismo mensaje.`,
    floodAviso: () => `🐢 Tranquilo, causa: estás escribiendo muy rápido.`,
    noEncontrado: () => `❌ No encontré a nadie con ese nombre.`,
    ambiguo:   (l) => `❓ Hay varios que coinciden: ${l}\n👉 Usa #id para elegir uno.`,
    autoAccion: () => `❌ No puedes hacerte eso a ti mismo.`,
    sorteo:    (n) => `🎲 El sorteo eligió a ${n}.`,
    duplicado: (n) => `❌ Ya hay alguien con el nombre "${n}" en la sala.`,

    /* AFK */
    afkWarn:   (n) => `⚠️ ${n}, muévete o pasas a la cola.`,
    afkWarnP:  (n, s) => `⏳ Te quedan ${s}s antes de pasar a la cola.`,
    afkNoPartida: () => `❌ No puedes ponerte AFK durante una partida.`,
    yaAfk:     () => `💤 Ya estás AFK.`,
    afkOn:     (n) => `💤 ${n} está AFK.`,
    noAfk:     () => `❌ No estás AFK.`,
    afkOff:    (n) => `✅ ${n} volvió.`,
    afkList: (n) => `💤 AFK (${n}):`,
    afkListEmpty: () => `💤 Nadie está AFK.`,
    afkBanca:  (n) => `💤 ${n} estaba inactivo y pasó a la cola.`,
    afkBancaP: () => `💤 Te pasé a la cola por inactividad.\nEscribe cualquier mensaje o !afk para volver.`,
    afkVolvio: (n) => `✅ ${n} volvió a la cola.`,
    afkQueueKick: (n) => `⏰ ${n} estuvo demasiado tiempo AFK en la cola y fue expulsado.`,

    /* Partido / rotación */
    iniciando: (t) => `⏳ Armando partido ${t}v${t}...`,
    equipos:   (r, b, nr, nb) => `⚽ EQUIPOS (${r}v${b})\n🔴 ${nr}\n🔵 ${nb}`,
    noEquipos: () => `⚠️ No se pudieron formar los equipos. Reintentando...`,
    subiendo:  (d) => `📈 Partida ampliada a ${d}v${d}.`,
    equilibrio:(n, t) => `⚖️ ${n} va a la cola (${t}v${t}).`,
    relleno:   (n, lado) => `🔄 ${n} entra como relleno${lado ? ` (${lado})` : ""}.`,
    rotacion:  (n) => `🔁 Al fondo de la cola: ${n}.`,
    sinRival:  () => `⚠️ Se quedó sin rivales. Reorganizando...`,
    noHaySuficientes: () => `⚠️ Faltan jugadores para iniciar.`,
    noIniciar: () => `⚠️ No se puede iniciar ahora.`,
    partido:   (r, b) => `⚽ ¡A JUGAR! (${r}v${b})`,
    detenido:  () => `⏹️ Partido detenido por un admin.`,
    reset:     () => `♻️ Sala reiniciada, al toque.`,
    pausado:   () => `⏸️ Partido pausado por un admin.`,
    reanudado: () => `▶️ Partido reanudado.`,
    sinPartido:() => `⚠️ No hay partido en curso.`,
    mapaActual: (m) => `🗺️ Mapa actual: ${m}.`,
    mapaOk:    (m) => `🗺️ Mapa cambiado a ${m}.`,
    mapaUso:   () => `🗺️ Usa: !mapa classic | !mapa futsal`,
    mapaError: () => `❌ No se pudo cargar el mapa Futsal.`,
    mapaOcupado: () => `⚠️ Cambia el mapa cuando no haya partido en curso.`,

    /* Goles */
    gol:      (t, n, sc) => `⚽ GOL de ${n}  ·  ${sc}  ·  ${t}`,
    golSinAutor: (t, sc) => `⚽ GOL  ·  ${sc}  ·  ${t}`,
    doblete:  (t, n, sc) => `⚽⚽ DOBLETE de ${n}  ·  ${sc}  ·  ${t}`,
    triplete: (t, n, sc) => `⚽⚽⚽ TRIPLETE de ${n}  ·  ${sc}  ·  ${t}`,
    autogol:  (t, n, sc) => `⚽ GOL EN CONTRA de ${n}  ·  ${sc}  ·  ${t}`,
    asistencia: (n) => `🅰️ Asistencia: ${n}`,

    /* Rachas / valla */
    racha:     (n, c) => `🔥 ${n}: ${c} victorias seguidas.`,
    rachaImparable: (n, c, plural) => `🔥 ${n} ${plural ? "están imparables" : "está imparable"}: ${c} seguidas.`,
    rachaLegendaria: (n, c) => `🔥 RACHA LEGENDARIA\n${n} — ${c} victorias seguidas`,
    rachaFin:  (n, c) => `🔥 Se cortó la racha de ${n} (${c}).`,
    valla:     (n) => `🧤 Valla invicta para ${n}.`,

    /* Cola */
    colaJugando: () => `⚽ Estás jugando ahora mismo.`,
    colaAfk:   () => `💤 Estás AFK: no cuentas para la cola. Escribe !afk para volver.`,
    colaPos:   (p, t, sig, eta) => {
        const lines = [`🕒 Cola: ${p}º de ${t}`];
        if (p <= 1) lines.push(`👉 Eres el próximo, causa.`);
        else if (eta > 0) lines.push(`⏳ Te toca en ~${eta} partido${eta === 1 ? "" : "s"}.`);
        if (sig) lines.push(`➡️ Siguen: ${sig}.`);
        return lines.join("\n");
    },
    colaVacia: () => `🕒 No hay nadie en la cola: todos están jugando.`,
    quien: (total, red, blue, colaCount, colaNames, afk, partido) => {
        const lines = [`👥 SALA (${total})`, `🔴 ${red || "—"}`, `🔵 ${blue || "—"}`];
        if (colaCount) lines.push(`🕒 Cola (${colaCount}): ${colaNames}`);
        if (afk) lines.push(`💤 AFK: ${afk}`);
        lines.push(`⚽ ${partido}`);
        return lines.join("\n");
    },

    /* Stats */
    stats: (s) => {
        const wr = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;
        const cs = s.games > 0 ? Math.round((s.cleanSheets / s.games) * 100) : 0;
        return (
            `📊 ${s.name}\n` +
            `PJ ${s.games} · ${s.wins}G ${s.losses}P · WR ${wr}%\n` +
            `⚽ ${s.goals} goles · 🅰️ ${s.assists} asist · 🧤 ${s.cleanSheets} vallas (${cs}%)`
        );
    },
    statsPublic: (s) => {
        const wr = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;
        return `📊 ${s.name}: PJ ${s.games} · ${s.wins}G-${s.losses}P · WR ${wr}% · ⚽ ${s.goals} · 🅰️ ${s.assists} · 🧤 ${s.cleanSheets}`;
    },
    sinStats:  () => `📊 Todavía no tienes estadísticas.`,
    sinStatsDe: (n) => `📊 ${n} todavía no tiene estadísticas.`,
    topTitle: (m) => ({
        goals: "⚽ TOP GOLES", assists: "🅰️ TOP ASISTENCIAS", wins: "🏆 TOP VICTORIAS",
        games: "📅 TOP PARTIDOS", cleanSheets: "🧤 TOP VALLAS INVICTAS", points: "⭐ TOP PUNTOS"
    }[m] || "🏆 TOP"),
    topVacio: () => `📊 Todavía no hay estadísticas.`,
    ultimoVacio: () => `🏁 Todavía no terminó ningún partido.`,

    /* Juegos */
    dado: (n, v) => `🎲 ${n} tiró ${v}.`,
    tula: (n, cm) => `📏 A ${n} la gampi le mide ${cm}cm.`,
    chiste: (j) => `💀 ${j}`
};

/* Humor negro. Se reparten en "bolsa": no se repite ninguno hasta agotarlos todos. */
const CHISTES = [
    "Mi abuela dice que antes se vivía mejor. Claro, antes no sabía que tenía la presión alta.",
    "El médico me dijo que baje el estrés. Le dije que lo intentaría cuando baje el muerto del departamento de al lado.",
    "En mi familia somos muy unidos: todos vivimos en la misma casa porque nadie pudo pagar el alquiler.",
    "Mi viejo me dijo que el dinero no compra la felicidad. Igual le pedí plata y me dijo que no.",
    "Me gustan los velorios: hay comida gratis y todos están demasiado tristes para pelear por el último pan.",
    "Mi terapeuta dice que evito los problemas. Por eso no voy a su consultorio.",
    "Tengo un plan de salud privado. El plan es no enfermarme.",
    "Ahorro para la jubilación en una cuenta que no voy a usar porque no voy a llegar.",
    "Mi padre me enseñó a trabajar duro. Después se fue y me dejó el trabajo.",
    "Compré una planta para tener algo que cuidar. Se murió en tres días. Ya me acostumbré.",
    "Mi relación más estable es con el insomnio. Nunca me deja.",
    "El día que por fin ahorré para unas vacaciones, el techo decidió irse primero.",
    "Mi currículum dice que trabajo bien bajo presión. En realidad me congelo y lloro.",
    "La esperanza de vida subió, pero las ganas de vivir no.",
    "Mi mamá dice que soy un milagro. El médico dice que fue un error de laboratorio.",
    "No tengo miedo a la muerte. Tengo miedo a que me encuentren así.",
    "Mi vida amorosa es como un velorio: todos pasan, saludan y se van.",
    "El único que me llama es el banco. A veces contesto para sentirme querido.",
    "Me pidieron referencias. Puse a mi mamá y dijo que siempre llego tarde.",
    "Mi casero subió el alquiler porque subió el dólar. Mi sueldo no sabe leer noticias.",
    "Mi médico me dio seis meses de vida. Le pedí una segunda opinión y me dio tres.",
    "El seguro me cubre todo menos lo que me pasa."
];
let jokeBag = [];
function nextJoke() {
    if (!jokeBag.length) jokeBag = shuffle(CHISTES.map((_, i) => i));
    return CHISTES[jokeBag.pop()];
}

/* =============================================================
   ESTADO GLOBAL
============================================================= */
let players = [], teamR = [], teamB = [], teamS = [];
let gone = new Set();
let queue = [];
let lastMatch = null;
const warnings = new Map();
const reportCooldown = new Map();
const lastChatMsg = new Map();
const startedAt = Date.now();
let currentMap = "classic";
let autoAvisoTimer = null;
let afkPlayers = new Set();
let afkSince = new Map();           // id -> cuándo quedó AFK en la cola
let autoAfk = new Set();            // AFK puestos por el bot (vuelven al escribir)
let lastActivity = new Map();
let warnedAfk = new Set();
let botMoving = false, botMoveTimer = null;
let lastWinner = Team.SPEC;
let currentTarget = 1;
let pendingTarget = null, pendingTargetSince = 0;   // debounce de expansión
let gamePaused = false;
let botPaused = false;              // true solo si la pausa la puso el bot
let autoStartTimer = null;
let tickCounter = 0;
let lastScheduleAt = 0;
let lastGameStart = 0;
let lastBotStop = 0;
let lastNoTeamsMsg = 0;
let rotationScheduled = false;
let pendingLaunch = false, pendingLaunchSince = 0;
let pausedSince = 0;
let lobbyIdleSince = 0;
let emptyTeamSince = 0;
let mutedKeys = new Set();          // por auth (sobrevive a reconexión) o por id
let slowMode = false;
let lastChatTime = new Map();
let floodLog = new Map();
let funCooldown = new Map();
let bannedNames = new Map();        // nombre en minúsculas -> { id, name, auth }
let bannedAuths = new Set();        // auths baneadas (sobreviven a cambios de nombre)
let goalCount = new Map();
let matchAssists = new Map();
let matchOwnGoals = new Map();
let goalsAgainst = { 1: 0, 2: 0 };
let lastKicker = null, prevKicker = null;
let lastKickSpeed = 0, lastKickPos = null;
let pendingKickMeasure = null;
let posAccum = new Map();
let streak = { ids: [], count: 0 };
let adminAttempts = new Map();

/* Baneos persistentes (por auth y por nombre). */
const BANS_KEY = "webot_bans";
function loadBans() {
    const arr = jsonParse(storage.getItem(BANS_KEY), []);
    bannedNames.clear();
    bannedAuths.clear();
    if (!Array.isArray(arr)) return;
    arr.forEach(e => {
        if (!e || typeof e !== "object") return;
        if (e.name) bannedNames.set(String(e.name).toLowerCase(), { id: e.id, name: e.name, auth: e.auth || null });
        if (e.auth) bannedAuths.add(e.auth);
    });
}
function saveBans() {
    try { storage.setItem(BANS_KEY, JSON.stringify([...bannedNames.values()])); }
    catch (e) { logError(e); }
}
function isBanned(player) {
    if (!player) return false;
    if (player.auth && bannedAuths.has(player.auth)) return true;
    return !!bannedNames.get(String(player.name || "").toLowerCase());
}
loadBans();

/* =============================================================
   MAPA: Futsal x4 by Bazinga (HaxMaps) — embebido en el archivo
============================================================= */
const CUSTOM_STADIUM = {"name":"Futsal x4 by Bazinga from HaxMaps","width":800,"height":350,"bg":{"type":"hockey","width":700,"height":320,"kickOffRadius":80},"vertexes":[{"x":-700,"y":321,"cMask":["ball"]},{"x":-700,"y":-319,"cMask":["ball"]},{"x":699,"y":319,"cMask":["ball"]},{"x":601,"y":-320,"cMask":["ball"]},{"x":0,"y":350,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":80,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":-80,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":-350,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":-700,"y":-99,"bCoef":0.1,"cMask":["ball"]},{"x":-750,"y":-99,"bCoef":0.1,"cMask":["ball"]},{"x":-750,"y":90,"bCoef":0.1,"cMask":["ball"]},{"x":-700,"y":90,"bCoef":0.1,"cMask":["ball"]},{"x":700,"y":-90,"bCoef":0.1,"cMask":["ball"]},{"x":749,"y":-90,"bCoef":0.1,"cMask":["ball"]},{"x":749,"y":90,"bCoef":0.1,"cMask":["ball"]},{"x":699,"y":90,"bCoef":0.1,"cMask":["ball"]},{"x":-700,"y":90,"bCoef":1.25,"cMask":["ball"]},{"x":-700,"y":321,"bCoef":1.25,"cMask":["ball"]},{"x":-700,"y":-99,"bCoef":1.25,"cMask":["ball"]},{"x":-700,"y":-319,"bCoef":1.25,"cMask":["ball"]},{"x":-700,"y":321,"bCoef":2,"cMask":["ball"]},{"x":699,"y":319,"bCoef":2,"cMask":["ball"]},{"x":699,"y":90,"bCoef":1.25,"cMask":["ball"]},{"x":699,"y":319,"bCoef":1.25,"cMask":["ball"]},{"x":699,"y":-321,"bCoef":1.25,"cMask":["ball"]},{"x":699,"y":-90,"bCoef":1.25,"cMask":["ball"]},{"x":601,"y":-320,"bCoef":0,"cMask":["ball"]},{"x":601,"y":-320,"bCoef":0,"cMask":["ball"]},{"x":-699,"y":-320,"bCoef":2,"cMask":["ball"]},{"x":699,"y":-321,"bCoef":2,"cMask":["ball"]},{"x":0,"y":-320,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":-80,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":80,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":320,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":-80,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":80,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":-150,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":90,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":80,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":-80,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":80,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":-80,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":-710,"y":90,"cMask":["ball"]},{"x":-710,"y":321,"cMask":["ball"]},{"x":-710,"y":90,"cMask":["ball"]},{"x":-710,"y":321,"cMask":["ball"]},{"x":-710,"y":-315,"cMask":["ball"]},{"x":-710,"y":-99,"cMask":["ball"]},{"x":710,"y":-90,"cMask":["ball"]},{"x":709,"y":-317,"cMask":["ball"]},{"x":709,"y":-90,"cMask":["ball"]},{"x":709,"y":94,"cMask":["ball"]},{"x":709,"y":319,"cMask":["ball"]},{"x":-699,"y":274,"bCoef":0.1,"cMask":["blue"],"cGroup":["redKO","blueKO"]},{"x":-506,"y":141,"bCoef":0.1,"cMask":["blue"],"cGroup":["redKO","blueKO"]},{"x":-506,"y":141,"bCoef":0.1,"cMask":["blue"],"cGroup":["redKO","blueKO"]},{"x":-506,"y":-141,"bCoef":0.1,"cMask":["blue"],"cGroup":["redKO","blueKO"]},{"x":-506,"y":-141,"bCoef":0.1,"cMask":["blue"],"cGroup":["redKO","blueKO"]},{"x":-699,"y":-274,"bCoef":0.1,"cMask":["blue"],"cGroup":["redKO","blueKO"]},{"x":698,"y":273,"bCoef":0.1,"cMask":["red"],"cGroup":["redKO","blueKO"]},{"x":505,"y":140,"bCoef":0.1,"cMask":["red"],"cGroup":["redKO","blueKO"]},{"x":505,"y":140,"bCoef":0.1,"cMask":["red"],"cGroup":["redKO","blueKO"]},{"x":505,"y":-142,"bCoef":0.1,"cMask":["red"],"cGroup":["redKO","blueKO"]},{"x":505,"y":-142,"bCoef":0.1,"cMask":["red"],"cGroup":["redKO","blueKO"]},{"x":698,"y":-275,"bCoef":0.1,"cMask":["red"],"cGroup":["redKO","blueKO"]},{"x":-701,"y":90,"bCoef":0.1,"cMask":["blue"],"cGroup":["redKO","blueKO"]},{"x":-701,"y":-90,"bCoef":0.1,"cMask":["blue"],"cGroup":["redKO","blueKO"]},{"x":699,"y":90,"bCoef":0.1,"cMask":["red"],"cGroup":["redKO","blueKO"]},{"x":699,"y":-90,"bCoef":0.1,"cMask":["red"],"cGroup":["redKO","blueKO"]},{"x":-713,"y":90,"cMask":["ball"]},{"x":-713,"y":321,"cMask":["ball"]},{"x":-713,"y":-315,"cMask":["ball"]},{"x":-713,"y":-99,"cMask":["ball"]},{"x":712,"y":-317,"cMask":["ball"]},{"x":712,"y":-90,"cMask":["ball"]},{"x":712,"y":94,"cMask":["ball"]},{"x":712,"y":319,"cMask":["ball"]},{"x":704,"y":-317,"cMask":["ball"]},{"x":704,"y":-90,"cMask":["ball"]},{"x":704,"y":-317,"cMask":["ball"]},{"x":704,"y":-90,"cMask":["ball"]},{"x":704,"y":94,"cMask":["ball"]},{"x":704,"y":319,"cMask":["ball"]},{"x":704,"y":94,"cMask":["ball"]},{"x":704,"y":319,"cMask":["ball"]},{"x":-705,"y":90,"cMask":["ball"]},{"x":-705,"y":321,"cMask":["ball"]},{"x":-705,"y":90,"cMask":["ball"]},{"x":-705,"y":321,"cMask":["ball"]},{"x":-705,"y":-315,"cMask":["ball"]},{"x":-705,"y":-99,"cMask":["ball"]},{"x":-705,"y":-315,"cMask":["ball"]},{"x":-705,"y":-99,"cMask":["ball"]},{"x":-699,"y":319.88890075683594,"bCoef":2,"cMask":["ball"]},{"x":699,"y":318.88890075683594,"bCoef":2,"cMask":["ball"]}],"segments":[{"v0":8,"v1":9,"bCoef":0.1,"cMask":["ball"],"color":"F8F8F8"},{"v0":9,"v1":10,"bCoef":0.1,"cMask":["ball"],"color":"F8F8F8"},{"v0":10,"v1":11,"bCoef":0.1,"cMask":["ball"],"color":"F8F8F8"},{"v0":12,"v1":13,"bCoef":0.1,"cMask":["ball"],"color":"F8F8F8"},{"v0":13,"v1":14,"bCoef":0.1,"cMask":["ball"],"color":"F8F8F8"},{"v0":14,"v1":15,"bCoef":0.1,"cMask":["ball"],"color":"F8F8F8"},{"v0":4,"v1":5,"bCoef":0.1,"vis":false,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"v0":5,"v1":6,"bCoef":0.1,"curve":180,"curveF":6.123233995736766e-17,"cMask":["red","blue"],"cGroup":["blueKO"],"color":"F8F8F8"},{"v0":6,"v1":5,"bCoef":0.1,"curve":180,"curveF":6.123233995736766e-17,"cMask":["red","blue"],"cGroup":["redKO"],"color":"F8F8F8"},{"v0":6,"v1":7,"bCoef":0.1,"vis":false,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"v0":16,"v1":17,"bCoef":1.25,"cMask":["ball"],"color":"F8F8F8"},{"v0":18,"v1":19,"bCoef":1.25,"cMask":["ball"],"color":"F8F8F8"},{"v0":22,"v1":23,"bCoef":1.25,"cMask":["ball"],"color":"F8F8F8"},{"v0":24,"v1":25,"bCoef":1.25,"cMask":["ball"],"color":"F8F8F8"},{"v0":26,"v1":27,"bCoef":0,"cMask":["ball"],"color":"F8F8F8"},{"v0":28,"v1":29,"bCoef":2,"cMask":["ball"],"color":"F8F8F8"},{"v0":30,"v1":31,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"],"color":"F8F8F8"},{"v0":32,"v1":33,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"],"color":"F8F8F8"},{"v0":42,"v1":43,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":44,"v1":45,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":46,"v1":47,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":49,"v1":50,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":51,"v1":52,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":54,"v1":53,"bCoef":0.1,"curve":89.99999999999997,"curveF":1.0000000000000004,"cMask":["blue"],"cGroup":["redKO"],"color":"F8F8F8"},{"v0":56,"v1":55,"bCoef":0.1,"curve":10,"curveF":11.430052302761343,"cMask":["blue"],"cGroup":["redKO"],"color":"F8F8F8"},{"v0":58,"v1":57,"bCoef":0.1,"curve":89.99999999999997,"curveF":1.0000000000000004,"cMask":["blue"],"cGroup":["redKO"],"color":"F8F8F8"},{"v0":59,"v1":60,"bCoef":0.1,"curve":89.99999999999997,"curveF":1.0000000000000004,"cMask":["red"],"cGroup":["redKO"],"color":"F8F8F8"},{"v0":61,"v1":62,"bCoef":0.1,"curve":10,"curveF":11.430052302761343,"cMask":["red"],"cGroup":["redKO"],"color":"F8F8F8"},{"v0":63,"v1":64,"bCoef":0.1,"curve":89.99999999999997,"curveF":1.0000000000000004,"cMask":["red"],"cGroup":["redKO"],"color":"F8F8F8"},{"v0":65,"v1":66,"bCoef":0.1,"cMask":["blue"],"cGroup":["redKO"],"color":"F8F8F8"},{"v0":67,"v1":68,"bCoef":0.1,"cMask":["red"],"cGroup":["redKO"],"color":"F8F8F8"},{"v0":69,"v1":70,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":71,"v1":72,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":73,"v1":74,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":75,"v1":76,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":77,"v1":78,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":79,"v1":80,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":81,"v1":82,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":83,"v1":84,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":85,"v1":86,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":87,"v1":88,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":89,"v1":90,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":91,"v1":92,"vis":false,"cMask":["ball"],"color":"F8F8F8"},{"v0":93,"v1":94,"bCoef":2,"cMask":["ball"],"color":"F8F8F8"}],"planes":[{"normal":[0,1],"dist":-320,"cMask":["ball"]},{"normal":[0,-1],"dist":-317.5,"cMask":["ball"]},{"normal":[0,1],"dist":-350,"bCoef":0.1},{"normal":[0,-1],"dist":-350,"bCoef":0.1},{"normal":[1,0],"dist":-800,"bCoef":0.1},{"normal":[-1,0],"dist":-800,"bCoef":0.1}],"goals":[{"p0":[-707,-94],"p1":[-707,86],"team":"red"},{"p0":[706,90],"p1":[706,-90],"team":"blue"}],"discs":[{"radius":6.25,"bCoef":0.4,"invMass":1.5,"color":"FFCC00","cGroup":["ball","kick","score"]},{"pos":[-700,89],"radius":6,"invMass":0,"color":"FF0000"},{"pos":[-700,-99],"radius":6,"invMass":0,"color":"FF0000"},{"pos":[700,90],"radius":6,"invMass":0,"color":"33FF"},{"pos":[701,-89],"radius":6,"invMass":0,"color":"33FF"}],"playerPhysics":{"bCoef":0,"acceleration":0.11,"kickingAcceleration":0.083},"ballPhysics":"disc0","spawnDistance":350};

const roomConfig = {
    roomName: CONFIG.roomName,
    maxPlayers: CONFIG.maxPlayers,
    public: CONFIG.public,
    playerName: CONFIG.botName
};
if (CONFIG.token) roomConfig.token = CONFIG.token;
if (CONFIG.geo) roomConfig.geo = CONFIG.geo;

const room = HBInit(roomConfig);
room.setTeamsLock(true);
room.setScoreLimit(CONFIG.scoreLimit);
room.setTimeLimit(CONFIG.gameTimeLimit);
if (CONFIG.useCustomStadium) {
    let applied = false;
    try {
        const ret = room.setCustomStadium(JSON.stringify(CUSTOM_STADIUM));
        applied = ret !== false;   // la API devuelve false si el mapa es inválido
    } catch (e) { logError(e); }
    if (!applied) {
        if (typeof console !== "undefined") console.warn("[weBOT] El mapa personalizado no se pudo aplicar; usando Classic.");
        room.setDefaultStadium("Classic");
        currentMap = "classic";
    } else {
        currentMap = "futsal";
    }
} else {
    room.setDefaultStadium("Classic");
    currentMap = "classic";
}
room.onRoomLink = function (url) {
    if (typeof console !== "undefined") console.log("[weBOT] Sala abierta: " + url);
};

function updateTeams() {
    players = room.getPlayerList().filter(p => p.id !== 0 && !gone.has(p.id));
    teamR = players.filter(p => p.team === Team.RED);
    teamB = players.filter(p => p.team === Team.BLUE);
    teamS = players.filter(p => p.team === Team.SPEC);
}
function publicMsg(t, c = THEME.white) { room.sendAnnouncement(t, null, c, "normal", 1); }
function privateMsg(id, t, c = THEME.white) { room.sendAnnouncement(t, id, c, "normal", 1); }
function otherTeam(t) { return t === Team.RED ? Team.BLUE : Team.RED; }
function isAfk(id) { return afkPlayers.has(id); }
function getPlayerById(id) { return players.find(p => p.id === id) || null; }
function getActivePlayers() { return players.filter(p => !isAfk(p.id)); }
function getActiveTeam(t) { return (t === Team.RED ? teamR : teamB).filter(p => !isAfk(p.id)); }
function gameRunning() { return room.getScores() != null; }
function keyOf(p) { return p.auth ? "a:" + p.auth : "i:" + p.id; }
function isMuted(p) { return mutedKeys.has(keyOf(p)) || mutedKeys.has("i:" + p.id); }
function desiredTarget() {
    const a = getActivePlayers().length;
    return Math.max(1, Math.min(CONFIG.maxTeamSize, Math.floor(a / 2)));
}
function addToQueue(id) { if (!queue.includes(id)) queue.push(id); }
function syncQueue() {
    const ids = new Set(players.map(p => p.id));
    queue = queue.filter(id => ids.has(id));
    players.forEach(p => { if (p.team === Team.SPEC && !queue.includes(p.id)) queue.push(p.id); });
}
function getSelectableSpecs() {
    updateTeams();
    syncQueue();
    return queue.map(getPlayerById).filter(p => p && p.team === Team.SPEC && !isAfk(p.id));
}
/* Relleno de emergencia en vivo: el ÚLTIMO de la cola con actividad reciente.
   Si nadie tiene actividad reciente, igual se usa al último (antes el bot
   devolvía null y la partida podía quedarse trabada con un equipo vacío).
   Si el elegido está dormido, el sistema AFK lo devuelve a la cola solo. */
function pickFillFromBack(now) {
    const sel = getSelectableSpecs();
    if (!sel.length) return null;
    for (let i = sel.length - 1; i >= 0; i--) {
        if (now - (lastActivity.get(sel[i].id) || 0) < FILL_ACTIVE_WINDOW_MS) return sel[i];
    }
    return sel[sel.length - 1];
}
function matchClock() {
    const sc = room.getScores();
    const s = Math.floor(sc ? (sc.time || 0) : 0);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
}

/* =============================================================
   ESTADÍSTICAS
============================================================= */
function defaultStats(name) {
    return { name, games: 0, wins: 0, losses: 0, goals: 0, assists: 0, ownGoals: 0, cleanSheets: 0 };
}
function getStats(auth) { return jsonParse(storage.getItem("webot_stats:" + auth), null); }
function saveStats(auth, s) { try { storage.setItem("webot_stats:" + auth, JSON.stringify(s)); } catch (e) {} }
function getStatsByName(name) { return jsonParse(storage.getItem("webot_stats_name:" + name.toLowerCase()), null); }
function saveStatsByName(name, s) { try { storage.setItem("webot_stats_name:" + name.toLowerCase(), JSON.stringify(s)); } catch (e) {} }
function ensureStats(p) {
    let s = null;
    if (p.auth) s = getStats(p.auth);
    if (!s && p.name) s = getStatsByName(p.name);
    if (!s) s = defaultStats(p.name);
    s.name = p.name;
    return s;
}
function persistStats(p, s) {
    if (p.auth) saveStats(p.auth, s);
    else if (p.name) saveStatsByName(p.name, s);
}
function updateMatchStats(winner) {
    updateTeams();
    const redTeam = players.filter(p => p.team === Team.RED);
    const blueTeam = players.filter(p => p.team === Team.BLUE);
    // Solo exige que ambos bandos tengan alguien (antes exigía igualdad exacta
    // y se perdían las stats si un jugador se iba justo al final).
    if (redTeam.length < 1 || blueTeam.length < 1) return;
    const allParticipants = players.filter(p => p.team !== Team.SPEC);
    allParticipants.forEach(p => {
        if (!p.auth && !p.name) return;
        const s = ensureStats(p);
        s.games = (s.games || 0) + 1;
        if (winner !== Team.SPEC) {
            if (p.team === winner) s.wins = (s.wins || 0) + 1;
            else s.losses = (s.losses || 0) + 1;
        }
        s.goals = (s.goals || 0) + (goalCount.get(p.id) || 0);
        s.assists = (s.assists || 0) + (matchAssists.get(p.id) || 0);
        s.ownGoals = (s.ownGoals || 0) + (matchOwnGoals.get(p.id) || 0);
        persistStats(p, s);
    });
    if (winner !== Team.SPEC && goalsAgainst[winner] === 0) {
        const k = findKeeper(winner);
        if (k && (k.auth || k.name)) {
            const s = ensureStats(k);
            s.cleanSheets = (s.cleanSheets || 0) + 1;
            persistStats(k, s);
        }
    }
}
/* Si alguien se va en plena partida, se guardan sus goles/asistencias/autogoles
   (antes se perdían). No cuenta como partido jugado ni como derrota. */
function flushLeaverStats(p) {
    if (!gameRunning() || p.team === Team.SPEC) return;
    if (!p.auth && !p.name) return;
    const g = goalCount.get(p.id) || 0;
    const a = matchAssists.get(p.id) || 0;
    const o = matchOwnGoals.get(p.id) || 0;
    if (!g && !a && !o) return;
    const s = ensureStats(p);
    s.goals = (s.goals || 0) + g;
    s.assists = (s.assists || 0) + a;
    s.ownGoals = (s.ownGoals || 0) + o;
    persistStats(p, s);
    goalCount.delete(p.id); matchAssists.delete(p.id); matchOwnGoals.delete(p.id);
}
function statsOf(player) {
    let s = null;
    if (player.auth) s = getStats(player.auth);
    if (!s && player.name) s = getStatsByName(player.name);
    return s;
}
function showOwnStats(player) {
    const s = statsOf(player);
    if (!s) { privateMsg(player.id, MSG.sinStats(), THEME.warn); return; }
    privateMsg(player.id, MSG.stats(s), THEME.primary);
}
function showPublicStats(player) {
    const s = statsOf(player);
    if (!s) { publicMsg(MSG.sinStats(), THEME.warn); return; }
    publicMsg(MSG.statsPublic(s), THEME.primary);
}
function showTop(player, mode) {
    const entries = [];
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key) continue;
        const isAuth = key.indexOf("webot_stats:") === 0;
        const isName = key.indexOf("webot_stats_name:") === 0;
        if (!isAuth && !isName) continue;
        const s = jsonParse(storage.getItem(key), null);
        if (!s) continue;
        let v = 0;
        if (mode === "goals") v = s.goals || 0;
        else if (mode === "assists") v = s.assists || 0;
        else if (mode === "wins") v = s.wins || 0;
        else if (mode === "games") v = s.games || 0;
        else if (mode === "cleanSheets") v = s.cleanSheets || 0;
        else v = (s.wins || 0) * 3 + (s.goals || 0) + Math.floor((s.assists || 0) / 2);
        if (v > 0) entries.push({ name: s.name, v });
    }
    const seen = new Map();
    entries.forEach(e => {
        const k = (e.name || "").toLowerCase();
        const prev = seen.get(k);
        if (!prev || e.v > prev.v) seen.set(k, e);
    });
    const unique = [...seen.values()];
    unique.sort((a, b) => b.v - a.v);
    const top = unique.slice(0, 5);
    if (!top.length) { privateMsg(player.id, MSG.topVacio(), THEME.warn); return; }
    const lines = top.map((e, i) => `${i + 1}. ${e.name} — ${e.v}`);
    privateMsg(player.id, frame(`${MSG.topTitle(mode)}\n${lines.join("\n")}`), THEME.accent);
}

function showStatsOf(player, target) {
    const s = statsOf(target);
    if (!s) { privateMsg(player.id, MSG.sinStatsDe(target.name), THEME.warn); return; }
    privateMsg(player.id, MSG.stats(s), THEME.primary);
}
function formatUptime(ms) {
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 60) return `${totalMin}m`;
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return `${h}h ${m}m`;
}
function showWho(player) {
    updateTeams();
    const red = getActiveTeam(Team.RED).map(p => p.name).join(", ");
    const blue = getActiveTeam(Team.BLUE).map(p => p.name).join(", ");
    const specs = getSelectableSpecs();
    const colaNames = specs.slice(0, 10).map(p => p.name).join(", ") + (specs.length > 10 ? "..." : "");
    const afk = players.filter(p => isAfk(p.id)).map(p => p.name).join(", ");
    const sc = room.getScores();
    const partido = sc
        ? `${getActiveTeam(Team.RED).length}v${getActiveTeam(Team.BLUE).length} · ${sc.red}-${sc.blue} · ${matchClock()}`
        : "Sin partido";
    privateMsg(player.id, MSG.quien(players.length, red, blue, specs.length, colaNames, afk, partido), THEME.primary);
}
function showLastMatch(player) {
    privateMsg(player.id, lastMatch ? lastMatch.text : MSG.ultimoVacio(), THEME.primary);
}
function showStatus(player) {
    const sc = room.getScores();
    const partido = sc
        ? `${getActiveTeam(Team.RED).length}v${getActiveTeam(Team.BLUE).length} · ${sc.red}-${sc.blue} · ${matchClock()}`
        : "Sin partido";
    privateMsg(player.id, MSG.estado(
        formatUptime(Date.now() - startedAt),
        players.length,
        getSelectableSpecs().length,
        afkPlayers.size,
        partido,
        currentMap === "futsal" ? "Futsal" : "Classic"
    ), THEME.info);
}
function buildMatchSummary(winner, scores) {
    updateTeams();
    const sc = scores || room.getScores();
    if (!sc || winner === Team.SPEC) return null;
    const r = getActiveTeam(Team.RED).length;
    const b = getActiveTeam(Team.BLUE).length;
    const lines = [`🏁 FINAL ${r}v${b}`, `🔴 ${sc.red} - ${sc.blue} 🔵`];

    const scorers = [];
    goalCount.forEach((n, id) => {
        const p = getPlayerById(id);
        if (p && n > 0) scorers.push({ name: p.name, n });
    });
    scorers.sort((a, b) => b.n - a.n);
    if (scorers.length) lines.push(`⚽ ${scorers.slice(0, 3).map(x => `${x.name} x${x.n}`).join(", ")}`);

    const assisters = [];
    matchAssists.forEach((n, id) => {
        const p = getPlayerById(id);
        if (p && n > 0) assisters.push({ name: p.name, n });
    });
    assisters.sort((a, b) => b.n - a.n);
    if (assisters.length) lines.push(`🅰️ ${assisters.slice(0, 3).map(x => `${x.name} x${x.n}`).join(", ")}`);

    const candidates = players.filter(p => p.team !== Team.SPEC).map(p => {
        const g = goalCount.get(p.id) || 0;
        const a = matchAssists.get(p.id) || 0;
        const o = matchOwnGoals.get(p.id) || 0;
        return { p, g, a, pts: g * 3 + a * 2 - o * 2 };
    }).sort((x, y) => y.pts - x.pts || y.g - x.g || y.a - x.a);
    if (candidates.length && candidates[0].pts > 0) {
        const m = candidates[0];
        lines.push(`⭐ MVP: ${m.p.name} (${m.g}G ${m.a}A)`);
    }
    return { text: lines.join("\n"), at: Date.now() };
}
function warnPlayer(admin, target, motivo) {
    const k = keyOf(target);
    const w = warnings.get(k) || { count: 0, name: target.name, last: "" };
    w.count++;
    w.name = target.name;
    w.last = motivo || w.last;
    warnings.set(k, w);
    publicMsg(MSG.warnOk(target.name, w.count, CONFIG.warnLimit), THEME.warn);
    privateMsg(target.id, MSG.warnRecibido(w.count, CONFIG.warnLimit, motivo), THEME.warn);
    if (w.count >= CONFIG.warnLimit) {
        mutedKeys.add(k);
        mutedKeys.add("i:" + target.id);
        publicMsg(MSG.warnMute(target.name, CONFIG.warnLimit), THEME.danger);
    }
}
function showWarnings(player, args) {
    if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return; }
    if (args.length > 1) {
        const t = resolveTarget(player, args);
        if (!t) return;
        const w = warnings.get(keyOf(t));
        if (!w) { privateMsg(player.id, MSG.warnsVacio(), THEME.info); return; }
        privateMsg(player.id, MSG.warnsLinea(w.name, w.count, w.last), THEME.warn);
        return;
    }
    if (!warnings.size) { privateMsg(player.id, MSG.warnsVacio(), THEME.info); return; }
    const lines = [...warnings.values()].slice(0, 10).map(w => MSG.warnsLinea(w.name, w.count, w.last));
    privateMsg(player.id, lines.join("\n"), THEME.warn);
}
function reportPlayer(player, args) {
    const now = Date.now();
    if (now - (reportCooldown.get(player.id) || 0) < 30000) {
        privateMsg(player.id, MSG.reporteEspera(), THEME.warn);
        return;
    }
    const t = resolveTarget(player, [args[0], args[1]].filter(Boolean));
    if (!t) return;
    if (t.id === player.id) { privateMsg(player.id, MSG.autoAccion(), THEME.warn); return; }
    const motivo = args.slice(2).join(" ").trim();
    reportCooldown.set(player.id, now);
    const admins = players.filter(p => p.admin && p.id !== player.id);
    if (!admins.length) { privateMsg(player.id, MSG.reporteSinAdmin(), THEME.warn); return; }
    admins.forEach(a => privateMsg(a.id, MSG.reporte(player.name, t.name, motivo), THEME.danger));
    privateMsg(player.id, MSG.reporteOk(), THEME.success);
}
function filterChat(player, message) {
    if (player.admin) return false;
    if (CONFIG.filterLinks && /(https?:\/\/|www\.|discord\.gg\/|t\.me\/)/i.test(message)) {
        privateMsg(player.id, MSG.filtroLink(), THEME.warn);
        return true;
    }
    if (CONFIG.filterCaps) {
        const letters = message.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
        const upper = message.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length;
        if (letters.length >= 12 && upper / letters.length >= 0.75) {
            privateMsg(player.id, MSG.filtroCaps(), THEME.warn);
            return true;
        }
    }
    if (CONFIG.filterRepeat) {
        const norm = message.trim().toLowerCase();
        const prev = lastChatMsg.get(player.id);
        if (prev && prev.text === norm && Date.now() - prev.at < 10000 && norm.length >= 5) {
            privateMsg(player.id, MSG.filtroRepetir(), THEME.warn);
            return true;
        }
        lastChatMsg.set(player.id, { text: norm, at: Date.now() });
    }
    return false;
}

/* =============================================================
   MOVIMIENTO / PAUSA / AFK
============================================================= */
function safeSetTeam(id, t) { try { room.setPlayerTeam(id, t); } catch (e) { logError(e); } }
function beginBotMove() { botMoving = true; clearTimeout(botMoveTimer); }
function endBotMoveSoon() { clearTimeout(botMoveTimer); botMoveTimer = setTimeout(() => { botMoving = false; }, 100); }
function movePlayerToSpec(p) { if (p.team !== Team.SPEC) { beginBotMove(); safeSetTeam(p.id, Team.SPEC); endBotMoveSoon(); } }
function movePlayerToTeam(p, t) {
    beginBotMove(); safeSetTeam(p.id, t); endBotMoveSoon();
    touch(p.id);   // no expulsar por AFK al recién metido
}
function benchPlayer(p, size) {
    movePlayerToSpec(p);
    queue = queue.filter(id => id !== p.id);
    queue.unshift(p.id);   // el que sobra por equilibrio vuelve PRIMERO (no se castiga)
    publicMsg(MSG.equilibrio(p.name, size), THEME.info);
}
function botPauseGame() {
    if (gameRunning() && !gamePaused) {
        room.pauseGame(true);
        gamePaused = true;
        botPaused = true;
    }
}
function resumeBotPause() {
    if (!botPaused) return;
    botPaused = false;
    if (gameRunning() && gamePaused) {
        try { room.pauseGame(false); } catch (e) { logError(e); }
    }
    gamePaused = false;
    touchAll();
}
function botStop() {
    lastBotStop = Date.now();
    if (gameRunning()) room.stopGame();
}
function touch(id) { lastActivity.set(id, Date.now()); warnedAfk.delete(id); }
function touchAll() { players.forEach(p => touch(p.id)); }

function checkAfkQueue() {
    const maxMin = CONFIG.afkQueueMaxMin;
    if (!(maxMin > 0)) return;
    const now = Date.now();
    const maxMs = maxMin * 60000;
    [...afkPlayers].forEach(id => {
        const p = getPlayerById(id);
        if (!p) { afkSince.delete(id); return; }
        if (p.team !== Team.SPEC) { afkSince.delete(id); return; }
        const since = afkSince.get(id);
        if (!since) { afkSince.set(id, now); return; }
        if (now - since >= maxMs) kickAfkQueue(p);
    });
}
function kickAfkQueue(p) {
    publicMsg(MSG.afkQueueKick(p.name), THEME.danger);
    afkSince.delete(p.id);
    afkPlayers.delete(p.id);
    autoAfk.delete(p.id);
    warnedAfk.delete(p.id);
    queue = queue.filter(id => id !== p.id);
    try { room.kickPlayer(p.id, "AFK demasiado tiempo en la cola", false); }
    catch (e) { logError(e); }
}

function checkAutoAfk() {
    if (gamePaused || !gameRunning()) return;
    const now = Date.now();
    [...teamR, ...teamB].forEach(p => {
        if (isAfk(p.id)) return;
        const idle = (now - (lastActivity.get(p.id) || now)) / 1000;
        if (idle >= CONFIG.afkKickSec) {
            benchInactive(p);   // rotativo: nunca expulsa, pasa a la cola
        } else if (idle >= CONFIG.afkWarnSec && !warnedAfk.has(p.id)) {
            warnedAfk.add(p.id);
            const left = CONFIG.afkKickSec - CONFIG.afkWarnSec;
            publicMsg(MSG.afkWarn(p.name), THEME.warn);
            privateMsg(p.id, MSG.afkWarnP(p.name, left), THEME.danger);
        }
    });
}
function benchInactive(p) {
    autoAfk.add(p.id);
    afkPlayers.add(p.id);
    afkSince.set(p.id, Date.now());
    movePlayerToSpec(p);
    queue = queue.filter(id => id !== p.id);
    queue.push(p.id);   // al fondo: pierde su lugar en cancha, no su turno futuro
    publicMsg(MSG.afkBanca(p.name), THEME.info);
    privateMsg(p.id, MSG.afkBancaP(), THEME.warn);
    later(() => checkShortage(), 100);
}
function setAfk(player, value) {
    if (value) {
        if (gameRunning() && player.team !== Team.SPEC) { privateMsg(player.id, MSG.afkNoPartida(), THEME.warn); return; }
        if (afkPlayers.has(player.id)) { privateMsg(player.id, MSG.yaAfk(), THEME.warn); return; }
        afkPlayers.add(player.id);
        afkSince.set(player.id, Date.now());
        autoAfk.delete(player.id);
        publicMsg(MSG.afkOn(player.name), THEME.info);
        if (player.team !== Team.SPEC) {
            movePlayerToSpec(player);
            queue = queue.filter(id => id !== player.id);
            queue.push(player.id);
        }
    } else {
        if (!afkPlayers.has(player.id)) { privateMsg(player.id, MSG.noAfk(), THEME.warn); return; }
        afkPlayers.delete(player.id);
        afkSince.delete(player.id);
        autoAfk.delete(player.id);
        touch(player.id);
        publicMsg(MSG.afkOff(player.name), THEME.success);
    }
    later(() => {
        if (gameRunning()) checkShortage();
        else scheduleAutoStart();
    }, 100);
}

/* =============================================================
   EQUILIBRADO  (única función que pareja equipos; llena ADELANTE = FIFO)
============================================================= */
function equalizeTeams(cap) {
    const specs = getSelectableSpecs().slice();
    const red = getActiveTeam(Team.RED).slice();
    const blue = getActiveTeam(Team.BLUE).slice();
    const total = red.length + blue.length + specs.length;
    if (total < 2) return { size: Math.max(red.length, blue.length), benched: 0 };

    const size = Math.max(1, Math.min(cap, Math.floor(total / 2)));
    const extras = [];
    while (red.length > size) extras.push(red.pop());
    while (blue.length > size) extras.push(blue.pop());
    const extraIds = new Set(extras.map(p => p.id));

    const pool = specs.concat(extras);   // primero los que esperaban (adelante)
    let i = 0;
    while (i < pool.length) {
        const toRed = red.length <= blue.length;
        const side = toRed ? red : blue;
        if (side.length >= size) break;
        const p = pool[i++];
        movePlayerToTeam(p, toRed ? Team.RED : Team.BLUE);
        side.push(p);
    }
    let benched = 0;
    for (; i < pool.length; i++) {
        const p = pool[i];
        if (extraIds.has(p.id)) { benchPlayer(p, size); benched++; }
    }
    return { size, benched };
}
function rebalanceTeams() {
    if (!gameRunning()) return;
    const res = equalizeTeams(currentTarget);
    if (res.benched > 0 && res.size < currentTarget) currentTarget = res.size;
}

/* =============================================================
   ARRANQUE / LANZAMIENTO  (se arma directo con la cola)
============================================================= */
function balanceAndLaunch(attempt) {
    updateTeams();
    if (gameRunning()) return;
    equalizeTeams(desiredTarget());
    pendingLaunch = true;
    later(() => launchIfReady(attempt || 0), 120);
}
function launchIfReady(attempt) {
    pendingLaunch = false;
    updateTeams();
    if (gameRunning()) return;
    const r = getActiveTeam(Team.RED).length, b = getActiveTeam(Team.BLUE).length;
    if (r > 0 && r === b && r <= CONFIG.maxTeamSize && r + b >= CONFIG.minPlayersToStart) {
        const rn = getActiveTeam(Team.RED).map(p => p.name).join(", ");
        const bn = getActiveTeam(Team.BLUE).map(p => p.name).join(", ");
        publicMsg(MSG.equipos(r, b, rn, bn), THEME.primary);
        room.startGame();
        return;
    }
    if (attempt < 2) { balanceAndLaunch(attempt + 1); return; }
    const now = Date.now();
    if (getActivePlayers().length >= CONFIG.minPlayersToStart && now - lastNoTeamsMsg > NO_TEAMS_MSG_COOLDOWN_MS) {
        lastNoTeamsMsg = now;
        publicMsg(MSG.noEquipos(), THEME.warn);
    }
    lastWinner = Team.SPEC;
    scheduleAutoStart(3000);   // backoff: no reintentar cada 0.5s sin parar
}
function startRotativoMatch() {
    updateTeams();
    if (gameRunning() || pendingLaunch) return;
    if (getActivePlayers().length < CONFIG.minPlayersToStart) return;
    clearTimeout(autoStartTimer);
    publicMsg(MSG.iniciando(desiredTarget()), THEME.accent);
    balanceAndLaunch(0);
}

/* Relleno en vivo (vacancia / expansión): el ÚLTIMO. */
function rotativoRefill(team) {
    updateTeams();
    if (!gameRunning() || gamePaused) return;
    const p = pickFillFromBack(Date.now());
    if (!p) return;
    botPauseGame();
    publicMsg(MSG.relleno(p.name, team === Team.RED ? "🔴" : "🔵"), THEME.info);
    movePlayerToTeam(p, team);
    later(() => {
        resumeBotPause();
        if (gameRunning() && !gamePaused) checkShortage();
    }, 250);
}

/* =============================================================
   checkShortage: cerebro de la partida en curso
============================================================= */
function endMatchForLackOfPlayers() {
    if (!gameRunning()) return;
    emptyTeamSince = 0;
    publicMsg(MSG.sinRival(), THEME.warn);
    lastWinner = Team.SPEC;
    rotationScheduled = false;
    botStop();
    botPaused = false; gamePaused = false;
    later(() => scheduleAutoStart(), 300);
}
function checkShortage() {
    updateTeams();
    if (!gameRunning() || gamePaused) return;
    const now = Date.now();
    const desired = desiredTarget();
    const r = getActiveTeam(Team.RED).length, b = getActiveTeam(Team.BLUE).length;
    const sel = getSelectableSpecs();

    // 1) Un equipo sin jugadores.
    if (r === 0 || b === 0) {
        if (sel.length > 0) {
            emptyTeamSince = 0;
            rotativoRefill(r === 0 ? Team.RED : Team.BLUE);
            return;
        }
        // Sin suplentes pero el otro equipo tiene 2+: se reparten y sigue el partido
        // (antes se cortaba la partida aunque hubiera gente para un 1v1).
        if (r + b >= 2) {
            emptyTeamSince = 0;
            rebalanceTeams();
            return;
        }
        if (!emptyTeamSince) {
            emptyTeamSince = now;
            later(() => checkShortage(), EMPTY_TEAM_CONFIRM_MS + 100);
            return;
        }
        if (now - emptyTeamSince >= EMPTY_TEAM_CONFIRM_MS) endMatchForLackOfPlayers();
        else later(() => checkShortage(), EMPTY_TEAM_CONFIRM_MS - (now - emptyTeamSince) + 100);
        return;
    }
    emptyTeamSince = 0;

    // 2) Expansión con debounce: el tamaño solo cambia si la gente se
    //    sostiene estable 1s. No paramos el partido.
    const wasExpanding = desired > currentTarget;
    if (desired !== currentTarget) {
        if (desired !== pendingTarget) {
            pendingTarget = desired;
            pendingTargetSince = now;
        } else if (now - pendingTargetSince >= EXPAND_DEBOUNCE_MS) {
            // No anunciar si los equipos ya tienen ese tamaño (p. ej. un
            // admin los subió a mano antes de que venciera el debounce).
            if (wasExpanding && now - lastGameStart > EXPANSION_COOLDOWN_MS &&
                (r < desired || b < desired)) {
                publicMsg(MSG.subiendo(desired), THEME.primary);
            }
            currentTarget = desired;
            pendingTarget = null; pendingTargetSince = 0;
        }
    } else {
        pendingTarget = null; pendingTargetSince = 0;
    }

    // 3) Algún equipo por encima del tamaño actual. Mientras la expansión
    //    está pendiente no bajamos a currentTarget: equipos ya armados más
    //    grandes se respetan hasta que venza el debounce (evita bench+refill).
    if (!wasExpanding && (r > currentTarget || b > currentTarget)) { rebalanceTeams(); return; }

    // 4) Sin suplentes: si quedaron desparejos se igualan. Si la expansión
    //    está pendiente, esperamos al nuevo objetivo para no bajar de más.
    if (sel.length === 0) {
        if (!wasExpanding && r !== b) rebalanceTeams();
        return;
    }

    // 5) Partido ya decidido: relleno inmediato (último) sin pausar.
    const scores = room.getScores();
    if (scores && (r < currentTarget || b < currentTarget)) {
        if (scores.red >= CONFIG.scoreLimit || scores.blue >= CONFIG.scoreLimit) return;
        const elapsed = scores.time || 0;
        const timeLimit = CONFIG.gameTimeLimit * 60;
        const remaining = Math.max(0, timeLimit - elapsed);
        const diff = Math.abs(scores.red - scores.blue);
        const equipoFaltante = r < currentTarget ? Team.RED : Team.BLUE;
        const equipoPerdedor = scores.red < scores.blue ? Team.RED : (scores.blue < scores.red ? Team.BLUE : null);
        if (equipoPerdedor !== null && equipoFaltante === equipoPerdedor) {
            const partidoDecidido =
                remaining <= 30 ||
                (remaining <= 45 && diff >= 2) ||
                (remaining <= 75 && diff >= 3);
            if (partidoDecidido) {
                const activo = pickFillFromBack(now);
                if (!activo) return;
                publicMsg(MSG.relleno(activo.name, equipoFaltante === Team.RED ? "🔴" : "🔵"), THEME.info);
                movePlayerToTeam(activo, equipoFaltante);
                return;
            }
        }
    }

    // 6) Vacancia normal: entra el último de la cola al equipo que más falta.
    const needR = currentTarget - r, needB = currentTarget - b;
    if (needR > 0 || needB > 0) rotativoRefill(needR >= needB ? Team.RED : Team.BLUE);
}

function scheduleAutoStart(forcedDelayMs) {
    if (!CONFIG.autoStart) return;
    clearTimeout(autoStartTimer);
    const now = Date.now();
    const rapid = now - lastScheduleAt < 500;
    lastScheduleAt = now;
    const delay = (typeof forcedDelayMs === "number")
        ? forcedDelayMs
        : (rapid ? 1000 : CONFIG.autoStartDelay * 1000);
    autoStartTimer = later(() => {
        updateTeams();
        if (rotationScheduled) { scheduleAutoStart(); return; }
        if (!gameRunning() && !pendingLaunch && getActivePlayers().length >= CONFIG.minPlayersToStart) {
            startRotativoMatch();
        }
    }, delay);
}

/* =============================================================
   FIN DE PARTIDO / ROTACIÓN  (ganador -> ROJO, perdedor -> fondo)
============================================================= */
function findKeeper(team) {
    let best = null, bestX = null;
    for (const p of getActiveTeam(team)) {
        const a = posAccum.get(p.id);
        if (!a || a.n === 0) continue;
        const ax = a.x / a.n;
        if (team === Team.RED) { if (bestX === null || ax < bestX) { bestX = ax; best = p; } }
        else { if (bestX === null || ax > bestX) { bestX = ax; best = p; } }
    }
    return best || getActiveTeam(team)[0] || null;
}
function announceMatchEnd(winner) {
    const winners = getActiveTeam(winner);
    const winnerIds = winners.map(p => p.id).sort((a, b) => a - b);
    const samePlayers = streak.ids.length > 0 &&
        winnerIds.length === streak.ids.length &&
        winnerIds.every((id, i) => id === streak.ids[i]);
    if (samePlayers) {
        streak.count++;
        const names = winners.map(p => p.name).join(", ");
        if (streak.count === 5) publicMsg(MSG.rachaLegendaria(names, streak.count), THEME.accent);
        else if (streak.count === 3) publicMsg(MSG.rachaImparable(names, streak.count, winners.length > 1), THEME.warn);
        else if (streak.count >= 2) publicMsg(MSG.racha(names, streak.count), THEME.warn);
    } else {
        if (streak.count >= 2) {
            const oldNames = streak.ids.map(id => getPlayerById(id)).filter(p => p).map(p => p.name).join(", ");
            if (oldNames) publicMsg(MSG.rachaFin(oldNames, streak.count), THEME.info);
        }
        streak = { ids: winnerIds, count: 1 };
    }
    if (goalsAgainst[winner] === 0) {
        const k = findKeeper(winner);
        if (k) publicMsg(MSG.valla(k.name), THEME.primary);
    }
}
function requestRotation(winner) {
    lastWinner = winner;
    announceMatchEnd(winner);
    if (rotationScheduled) return;
    rotationScheduled = true;
    scheduleRotation(0);
}
function scheduleRotation(tries) {
    if (gameRunning()) {
        if (tries < 200) { later(() => scheduleRotation(tries + 1), 50); return; }
        rotationScheduled = false;
        scheduleAutoStart();
        return;
    }
    applyRotation();
}
function applyRotation() {
    rotationScheduled = false;
    updateTeams();
    if (lastWinner === Team.SPEC) { scheduleAutoStart(); return; }
    const target = desiredTarget();
    const allWin  = lastWinner === Team.RED ? teamR : teamB;
    const allLose = lastWinner === Team.RED ? teamB : teamR;
    syncQueue();
    // Se conservan también los AFK que estaban en cola (mantienen su lugar;
    // getSelectableSpecs ya los ignora mientras estén AFK).
    const waiters = queue.map(getPlayerById).filter(p => p && p.team === Team.SPEC);

    const activeWin = allWin.filter(p => !isAfk(p.id));
    const stay = activeWin.slice(0, target);
    const stayIds = new Set(stay.map(p => p.id));
    const surplus = allWin.filter(p => !stayIds.has(p.id));   // ganadores que ya no caben
    const loserOrder = CONFIG.shuffleLosers ? shuffle(allLose) : [...allLose].reverse();

    // Cola del próximo armado: sobrantes de ganadores, luego los que ya
    // esperaban (adelante = FIFO), y los perdedores al FONDO.
    queue = [];
    surplus.forEach(p => addToQueue(p.id));
    waiters.forEach(p => addToQueue(p.id));
    loserOrder.forEach(p => addToQueue(p.id));

    // Ganadores se quedan en ROJO (firma del bot); el resto a espera.
    beginBotMove();
    allWin.forEach(p => safeSetTeam(p.id, stayIds.has(p.id) ? Team.RED : Team.SPEC));
    allLose.forEach(p => safeSetTeam(p.id, Team.SPEC));
    endBotMoveSoon();

    if (loserOrder.length) publicMsg(MSG.rotacion(loserOrder.map(p => p.name).join(", ")), THEME.info);
    later(() => balanceAndLaunch(0), 150);
}

/* =============================================================
   COLA / AFK LIST
============================================================= */
function showQueue(player) {
    updateTeams();
    if (isAfk(player.id)) { privateMsg(player.id, MSG.colaAfk(), THEME.warn); return; }
    const me = getPlayerById(player.id);
    if (me && me.team !== Team.SPEC) { privateMsg(player.id, MSG.colaJugando(), THEME.primary); return; }
    const sel = getSelectableSpecs();
    if (!sel.length) { privateMsg(player.id, MSG.colaVacia(), THEME.info); return; }
    const pos = sel.findIndex(p => p.id === player.id) + 1;
    if (pos < 1) { privateMsg(player.id, MSG.colaVacia(), THEME.info); return; }
    const sig = sel.filter(p => p.id !== player.id).slice(0, 4).map(p => p.name).join(", ");
    const perMatch = Math.max(2, (gameRunning() ? currentTarget : desiredTarget()) * 2);
    const ahead = Math.max(0, pos - 1);
    const eta = ahead === 0 ? 0 : Math.ceil(ahead / perMatch);
    privateMsg(player.id, MSG.colaPos(pos, sel.length, sig, eta), THEME.primary);
}
function showAfkList(targetId) {
    updateTeams();
    const afkList = players.filter(p => afkPlayers.has(p.id));
    if (afkList.length === 0) { privateMsg(targetId, MSG.afkListEmpty(), THEME.info); return; }
    const names = afkList.map(p => p.name).join(", ");
    privateMsg(targetId, MSG.afkList(afkList.length), THEME.info);
    privateMsg(targetId, bold(names), THEME.warn);
}

/* =============================================================
   COMANDOS
============================================================= */
/* Normaliza nombres para comparar: quita acentos, unicode "decorativo"
   (𝕁𝕦𝕒𝕟 -> Juan), espacios invisibles y colapsa espacios repetidos. */
function normalizeNameForMatch(s) {
    let t = String(s == null ? "" : s);
    if (t.normalize) {
        try {
            t = t.normalize("NFKC").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        } catch (e) { /* motor sin normalize */ }
    }
    return t
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}
/* Búsqueda segura: exacto normalizado > único parcial > único compacto > #id.
   Si hay varios, NO adivina. */
function findTarget(query) {
    updateTeams();
    const raw = (query || "").trim();
    if (!raw) return { player: null };
    if (raw[0] === "#") {
        const id = parseInt(raw.slice(1), 10);
        return { player: players.find(p => p.id === id) || null };
    }
    const q = normalizeNameForMatch(raw.replace(/^@+/, ""));
    if (!q) return { player: null };

    const entries = players.map(p => ({ p: p, n: normalizeNameForMatch(p.name) }));
    const ambiguous = (list) => ({ player: null, ambiguous: true, matches: list.map(e => e.p) });

    let hits = entries.filter(e => e.n === q);
    if (hits.length === 1) return { player: hits[0].p };
    if (hits.length > 1) return ambiguous(hits);

    hits = entries.filter(e => e.n.indexOf(q) !== -1);
    if (hits.length === 1) return { player: hits[0].p };
    if (hits.length > 1) return ambiguous(hits);

    const qCompact = q.replace(/\s+/g, "");
    if (qCompact) {
        hits = entries.filter(e => e.n.replace(/\s+/g, "").indexOf(qCompact) !== -1);
        if (hits.length === 1) return { player: hits[0].p };
        if (hits.length > 1) return ambiguous(hits);
    }
    return { player: null };
}
function resolveTarget(admin, args) {
    const r = findTarget(args.slice(1).join(" "));
    if (r.player) return r.player;
    if (r.ambiguous) {
        privateMsg(admin.id, MSG.ambiguo(r.matches.slice(0, 5).map(p => `${p.name} (#${p.id})`).join(", ")), THEME.warn);
    } else {
        privateMsg(admin.id, MSG.noEncontrado(), THEME.warn);
        const list = players.slice(0, 8).map(p => `${p.name} (#${p.id})`).join(", ");
        if (list) privateMsg(admin.id, `Jugadores: ${list}`, THEME.info);
    }
    return null;
}
function funReady(player) {
    const now = Date.now();
    if (now - (funCooldown.get(player.id) || 0) < FUN_COOLDOWN_MS) return false;
    funCooldown.set(player.id, now);
    return true;
}
function isFlooding(player) {
    const now = Date.now();
    const arr = (floodLog.get(player.id) || []).filter(t => now - t < FLOOD_WINDOW_MS);
    arr.push(now);
    floodLog.set(player.id, arr);
    if (arr.length === FLOOD_MAX_MSGS + 1) privateMsg(player.id, MSG.floodAviso(), THEME.warn);
    return arr.length > FLOOD_MAX_MSGS;
}
function hardResetMatchFlags() {
    botPaused = false; gamePaused = false; pendingLaunch = false;
    pendingTarget = null; pendingTargetSince = 0; emptyTeamSince = 0;
    lastWinner = Team.SPEC; rotationScheduled = false;
}
function handleCommand(player, message) {
    // Solo cuenta como comando si es "!" + letra/número (así "!!!" o "! hola" son chat normal).
    if (!/^![a-z0-9]/i.test(message)) return false;
    updateTeams();
    const args = message.trim().split(/\s+/);
    const cmd = args[0].toLowerCase();
    switch (cmd) {
        case "!help":
            privateMsg(player.id, MSG.help(player.admin), THEME.primary);
            return true;
        case "!admin": {
            if (player.admin) { privateMsg(player.id, MSG.yaAdmin(), THEME.warn); return true; }
            const now = Date.now();
            const k = keyOf(player);
            let att = adminAttempts.get(k);
            if (!att || now - att.first > ADMIN_ATTEMPT_WINDOW_MS) att = { count: 0, first: now };
            if (att.count >= ADMIN_MAX_ATTEMPTS) {
                privateMsg(player.id, MSG.demasiadosIntentos(), THEME.danger);
                return true;
            }
            if (args[1] === CONFIG.adminPassword) {
                adminAttempts.delete(k);
                room.setPlayerAdmin(player.id, true);
                publicMsg(MSG.adminOk(player.name), THEME.success);
            } else {
                att.count++;
                adminAttempts.set(k, att);
                privateMsg(player.id, MSG.claveMal(ADMIN_MAX_ATTEMPTS - att.count), THEME.danger);
            }
            return true;
        }
        case "!aviso": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            const txt = args.slice(1).join(" ");
            if (!txt) { privateMsg(player.id, "Usa: !aviso tu mensaje", THEME.warn); return true; }
            publicMsg(MSG.aviso(txt), THEME.accent);
            return true;
        }
        case "!afklist": case "!afks": showAfkList(player.id); return true;
        case "!cola": case "!queue": showQueue(player); return true;
        case "!quien": case "!jugadores": showWho(player); return true;
        case "!me": showOwnStats(player); return true;
        case "!stats": {
            if (args.length > 1) {
                const t = resolveTarget(player, args);
                if (!t) return true;
                showStatsOf(player, t);
                return true;
            }
            showOwnStats(player);
            return true;
        }
        case "!mostrarstats": showPublicStats(player); return true;
        case "!ultimo": showLastMatch(player); return true;
        case "!reglas": privateMsg(player.id, MSG.reglas(), THEME.primary); return true;
        case "!estado": showStatus(player); return true;
        case "!report": reportPlayer(player, args); return true;
        case "!top": showTop(player, "points"); return true;
        case "!goals": showTop(player, "goals"); return true;
        case "!assists": showTop(player, "assists"); return true;
        case "!wins": showTop(player, "wins"); return true;
        case "!games": showTop(player, "games"); return true;
        case "!porteriacero": showTop(player, "cleanSheets"); return true;
        case "!dado": case "!tirardado": {
            if (!funReady(player)) return true;
            const v = Math.floor(Math.random() * 6) + 1;
            publicMsg(MSG.dado(player.name, v), THEME.accent);
            return true;
        }
        case "!pinga": {
            if (!funReady(player)) return true;
            const cm = Math.floor(Math.random() * 21) + 5;
            publicMsg(MSG.tula(player.name, cm), THEME.accent);
            return true;
        }
        case "!chiste": {
            if (!funReady(player)) return true;
            publicMsg(MSG.chiste(nextJoke()), THEME.accent);
            return true;
        }
        case "!warn": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            const t = resolveTarget(player, [args[0], args[1]].filter(Boolean));
            if (!t) return true;
            if (t.id === player.id) { privateMsg(player.id, MSG.autoAccion(), THEME.warn); return true; }
            warnPlayer(player, t, args.slice(2).join(" ").trim());
            return true;
        }
        case "!warns": showWarnings(player, args); return true;
        case "!kick": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            const t = resolveTarget(player, args);
            if (!t) return true;
            if (t.id === player.id) { privateMsg(player.id, MSG.autoAccion(), THEME.warn); return true; }
            room.kickPlayer(t.id, "Kick por admin", false);
            publicMsg(MSG.kickOk(t.name), THEME.danger);
            return true;
        }
        case "!ban": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            const t = resolveTarget(player, args);
            if (!t) return true;
            if (t.id === player.id) { privateMsg(player.id, MSG.autoAccion(), THEME.warn); return true; }
            bannedNames.set(t.name.toLowerCase(), { id: t.id, name: t.name, auth: t.auth || null });
            if (t.auth) bannedAuths.add(t.auth);
            saveBans();
            room.kickPlayer(t.id, "Ban por admin", true);
            publicMsg(MSG.banOk(t.name), THEME.danger);
            return true;
        }
        case "!unban": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            const q = args.slice(1).join(" ").toLowerCase().trim();
            if (!q) {
                if (!bannedNames.size) privateMsg(player.id, MSG.banVacia(), THEME.info);
                else privateMsg(player.id, MSG.banLista([...bannedNames.values()].map(e => e.name).join(", ")), THEME.info);
                return true;
            }
            if (q === "all" || q === "todos") {
                try { room.clearBans(); } catch (e) { logError(e); }
                bannedNames.clear();
                bannedAuths.clear();
                try { storage.removeItem(BANS_KEY); } catch (e) { logError(e); }
                publicMsg(MSG.unbanTodos(), THEME.success);
                return true;
            }
            let key = q, entry = bannedNames.get(q);
            if (!entry) {
                const matches = [...bannedNames.entries()].filter(([k]) => k.includes(q));
                if (matches.length === 1) { key = matches[0][0]; entry = matches[0][1]; }
            }
            if (!entry) { privateMsg(player.id, MSG.noEncontrado(), THEME.warn); return true; }
            try { room.clearBan(entry.id); } catch (e) { logError(e); }
            if (entry.auth) bannedAuths.delete(entry.auth);
            bannedNames.delete(key);
            saveBans();
            publicMsg(MSG.unbanOk(entry.name), THEME.success);
            return true;
        }
        case "!mute": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            const t = resolveTarget(player, args);
            if (!t) return true;
            if (t.id === player.id) { privateMsg(player.id, MSG.autoAccion(), THEME.warn); return true; }
            mutedKeys.add(keyOf(t));
            publicMsg(MSG.muteOk(t.name), THEME.warn);
            return true;
        }
        case "!unmute": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            const t = resolveTarget(player, args);
            if (!t) return true;
            mutedKeys.delete(keyOf(t));
            mutedKeys.delete("i:" + t.id);
            publicMsg(MSG.unmuteOk(t.name), THEME.success);
            return true;
        }
        case "!chatpausado": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            slowMode = !slowMode;
            publicMsg(slowMode ? MSG.chatLentoOn() : MSG.chatLentoOff(), THEME.warn);
            return true;
        }
        case "!sorteo": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            if (!players.length) { privateMsg(player.id, MSG.noEncontrado(), THEME.warn); return true; }
            const pick = players[Math.floor(Math.random() * players.length)];
            publicMsg(MSG.sorteo(pick.name), THEME.accent);
            return true;
        }
        case "!afk": setAfk(player, !isAfk(player.id)); return true;          // toggle
        case "!unafk": case "!back": setAfk(player, false); return true;      // alias
        case "!start":
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            if (gameRunning() || pendingLaunch) { privateMsg(player.id, MSG.noIniciar(), THEME.warn); return true; }
            if (getActivePlayers().length < CONFIG.minPlayersToStart) { privateMsg(player.id, MSG.noHaySuficientes(), THEME.warn); return true; }
            startRotativoMatch();
            return true;
        case "!stop":
            // Un corte manual NO suma estadísticas (antes podía regalar victorias/derrotas).
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            botStop();
            hardResetMatchFlags();
            publicMsg(MSG.detenido(), THEME.warn);
            later(() => scheduleAutoStart(), 300);
            return true;
        case "!reset":
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            botStop();
            hardResetMatchFlags();
            updateTeams();
            beginBotMove(); players.forEach(p => { if (p.team !== Team.SPEC) safeSetTeam(p.id, Team.SPEC); }); endBotMoveSoon();
            queue = [];
            players.forEach(p => addToQueue(p.id));
            players.forEach(p => { if (!afkPlayers.has(p.id)) touch(p.id); });
            streak = { ids: [], count: 0 };
            currentTarget = 1;
            publicMsg(MSG.reset(), THEME.success);
            later(() => scheduleAutoStart(), 300);
            return true;
        case "!mapa": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            const which = (args[1] || "").toLowerCase();
            if (!which) {
                privateMsg(player.id, MSG.mapaActual(currentMap === "futsal" ? "Futsal" : "Classic"), THEME.info);
                return true;
            }
            if (gameRunning() || pendingLaunch) { privateMsg(player.id, MSG.mapaOcupado(), THEME.warn); return true; }
            if (which === "classic") {
                room.setDefaultStadium("Classic");
                currentMap = "classic";
                publicMsg(MSG.mapaOk("Classic"), THEME.primary);
                return true;
            }
            if (which === "futsal" || which === "custom") {
                let ok = false;
                try { ok = room.setCustomStadium(JSON.stringify(CUSTOM_STADIUM)) !== false; } catch (e) { logError(e); }
                if (ok) {
                    currentMap = "futsal";
                    publicMsg(MSG.mapaOk("Futsal"), THEME.primary);
                } else {
                    privateMsg(player.id, MSG.mapaError(), THEME.danger);
                }
                return true;
            }
            privateMsg(player.id, MSG.mapaUso(), THEME.warn);
            return true;
        }
        case "!pausa": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            if (!gameRunning()) { privateMsg(player.id, MSG.sinPartido(), THEME.warn); return true; }
            try { room.pauseGame(true); } catch (e) { logError(e); }
            publicMsg(MSG.pausado(), THEME.warn);
            return true;
        }
        case "!reanudar": case "!seguir": {
            if (!player.admin) { privateMsg(player.id, MSG.sinPermiso(), THEME.danger); return true; }
            if (!gameRunning()) { privateMsg(player.id, MSG.sinPartido(), THEME.warn); return true; }
            try { room.pauseGame(false); } catch (e) { logError(e); }
            publicMsg(MSG.reanudado(), THEME.success);
            return true;
        }
        default:
            privateMsg(player.id, `❌ Comando no reconocido: ${cmd}`, THEME.warn);
            return true;
    }
}

/* =============================================================
   WATCHDOG
============================================================= */
function watchdog() {
    checkAfkQueue();
    updateTeams();
    const now = Date.now();
    const running = gameRunning();

    // 1) Pausa del bot que nunca se reanudó.
    if (running && gamePaused && botPaused) {
        if (!pausedSince) pausedSince = now;
        else if (now - pausedSince > PAUSE_LIMIT_MS) {
            pausedSince = 0;
            resumeBotPause();
        }
    } else pausedSince = 0;

    // 2) Arranque pendiente que nunca resolvió.
    if (pendingLaunch) {
        if (!pendingLaunchSince) pendingLaunchSince = now;
        else if (now - pendingLaunchSince > 5000) { pendingLaunch = false; pendingLaunchSince = 0; }
    } else pendingLaunchSince = 0;

    // 3) Sala ociosa con gente suficiente.
    const lobbyIdle = !running && !rotationScheduled && !pendingLaunch;
    if (CONFIG.autoStart && lobbyIdle && getActivePlayers().length >= CONFIG.minPlayersToStart) {
        if (!lobbyIdleSince) lobbyIdleSince = now;
        else if (now - lobbyIdleSince > LOBBY_IDLE_LIMIT_MS) {
            lobbyIdleSince = 0;
            scheduleAutoStart();
        }
    } else lobbyIdleSince = 0;

    // 4) Partida en curso: faltantes / desbalance / equipo vacío.
    if (running && !gamePaused) checkShortage();
}

/* =============================================================
   EVENTOS DE LA SALA
============================================================= */
room.onPlayerJoin = function (player) {
    try {
        gone.delete(player.id);
        updateTeams();
        if (isBanned(player)) {
            room.kickPlayer(player.id, "Estás baneado de esta sala", true);
            return;
        }
        if (CONFIG.preventDuplicates) {
            const duplicate = players.find(p => p.id !== player.id && p.name.toLowerCase() === player.name.toLowerCase());
            if (duplicate) {
                privateMsg(player.id, MSG.duplicado(player.name), THEME.danger);
                room.kickPlayer(player.id, "Usuario duplicado", false);
                return;
            }
        }
        afkPlayers.delete(player.id);
        autoAfk.delete(player.id);
        addToQueue(player.id);
        touch(player.id);
        publicMsg(MSG.join(player.name), THEME.primary);
        privateMsg(player.id, MSG.welcome(), THEME.primary);
        if (gameRunning()) checkShortage();
        else scheduleAutoStart();
    } catch (e) { logError(e); }
};
room.onPlayerLeave = function (player) {
    try {
        flushLeaverStats(player);   // antes de limpiar: rescata sus goles/asistencias
        gone.add(player.id);
        afkPlayers.delete(player.id);
        afkSince.delete(player.id);
        autoAfk.delete(player.id);
        queue = queue.filter(q => q !== player.id);
        lastActivity.delete(player.id);
        warnedAfk.delete(player.id);
        lastChatTime.delete(player.id);
        lastChatMsg.delete(player.id);
        reportCooldown.delete(player.id);
        floodLog.delete(player.id);
        funCooldown.delete(player.id);
        if (!player.auth) warnings.delete("i:" + player.id);
        mutedKeys.delete("i:" + player.id);   // los mute por auth se conservan al reconectar
        adminAttempts.delete(keyOf(player));
        adminAttempts.delete("i:" + player.id);
        updateTeams();
        if (gameRunning()) later(() => checkShortage(), 200);
        else scheduleAutoStart();
    } catch (e) { logError(e); }
};
room.onPlayerTeamChange = function (changed, by) {
    try {
        updateTeams();
        if (botMoving || !by || by.id === 0 || !changed || changed.id === 0) return;
        // Un admin movió gente a mano.
        if (gameRunning()) later(() => checkShortage(), 300);
        else scheduleAutoStart();
    } catch (e) { logError(e); }
};
room.onPlayerChat = function (player, message) {
    try {
        touch(player.id);
        if (isMuted(player)) return false;
        if (!player.admin && isFlooding(player)) return false;
        // Quien fue pasado a la cola por inactividad vuelve solo al escribir.
        if (autoAfk.has(player.id) && !message.startsWith("!")) {
            autoAfk.delete(player.id);
            afkPlayers.delete(player.id);
            afkSince.delete(player.id);
            publicMsg(MSG.afkVolvio(player.name), THEME.success);
            later(() => { if (gameRunning()) checkShortage(); else scheduleAutoStart(); }, 100);
        }
        if (handleCommand(player, message)) return false;
        // Chat lento (aplica también al chat de equipo, antes se saltaba).
        if (slowMode && !player.admin) {
            const now = Date.now();
            const last = lastChatTime.get(player.id) || 0;
            if (now - last < 2000) { privateMsg(player.id, MSG.chatLentoEspera(), THEME.warn); return false; }
            lastChatTime.set(player.id, now);
        }
        if (filterChat(player, message)) return false;
        const tm = message.match(/^t\s+(.+)/i);
        if (tm) {
            updateTeams();
            let color = THEME.info, circle = "⚪";
            if (player.team === Team.RED) { color = THEME.red; circle = "🔴"; }
            else if (player.team === Team.BLUE) { color = THEME.blue; circle = "🔵"; }
            const group = player.team === Team.SPEC ? teamS : (player.team === Team.RED ? teamR : teamB);
            group.forEach(p => privateMsg(p.id, `${circle} ${bold(player.name)}: ${bold(tm[1])}`, color));
            return false;
        }
        if (player.admin) {
            room.sendAnnouncement(`[🥚] ${bold(player.name)} 🥚: ${bold(message)}`, null, THEME.primary, "normal", 0);
            return false;
        }
        let color = THEME.white, circle = "⚪";
        if (player.team === Team.RED) { color = THEME.red; circle = "🔴"; }
        else if (player.team === Team.BLUE) { color = THEME.blue; circle = "🔵"; }
        room.sendAnnouncement(`${circle} ${player.name}: ${message}`, null, color, "normal", 0);
    } catch (e) { logError(e); }
    return false;
};
room.onPlayerActivity = function (player) { touch(player.id); };
room.onPlayerBallKick = function (player) {
    touch(player.id);
    prevKicker = lastKicker;
    lastKicker = player;
    lastKickPos = room.getBallPosition();
    pendingKickMeasure = lastKickPos;
};
/* Tras cada gol / saque el "último pateador" queda obsoleto: se limpia
   para no atribuir goles o asistencias a jugadas anteriores. */
room.onPositionsReset = function () {
    lastKicker = null; prevKicker = null;
    lastKickPos = null; pendingKickMeasure = null;
};

room.onTeamGoal = function (team) {
    try {
        // Se consulta el estado ACTUAL del pateador (el objeto guardado puede estar desactualizado).
        const scorer = lastKicker ? room.getPlayer(lastKicker.id) : null;
        const prev = prevKicker ? room.getPlayer(prevKicker.id) : null;
        goalsAgainst[otherTeam(team)]++;
        const clock = matchClock();
        const sc = room.getScores();
        const marcador = sc ? `${sc.red}-${sc.blue}` : "0-0";
        const lines = [];
        if (!scorer || scorer.team === Team.SPEC) {
            lines.push(MSG.golSinAutor(clock, marcador));
        } else if (scorer.team !== team) {
            matchOwnGoals.set(scorer.id, (matchOwnGoals.get(scorer.id) || 0) + 1);
            lines.push(MSG.autogol(clock, scorer.name, marcador));
        } else {
            const n = (goalCount.get(scorer.id) || 0) + 1;
            goalCount.set(scorer.id, n);
            let head;
            if (n >= 3) head = MSG.triplete(clock, scorer.name, marcador);
            else if (n === 2) head = MSG.doblete(clock, scorer.name, marcador);
            else head = MSG.gol(clock, scorer.name, marcador);
            lines.push(head);
            const assister = (prev && prev.id !== scorer.id && prev.team === team) ? prev : null;
            if (assister) {
                matchAssists.set(assister.id, (matchAssists.get(assister.id) || 0) + 1);
                lines.push(MSG.asistencia(assister.name));
            }
        }
        publicMsg(lines.join("\n"), team === Team.RED ? THEME.red : THEME.blue);
    } catch (e) { logError(e); }
};
room.onGameStart = function () {
    try {
        clearTimeout(autoStartTimer);
        pendingLaunch = false; pendingLaunchSince = 0;
        gamePaused = false; botPaused = false;
        emptyTeamSince = 0;
        pendingTarget = null; pendingTargetSince = 0;
        lastGameStart = Date.now();
        goalCount.clear();
        matchAssists.clear();
        matchOwnGoals.clear();
        goalsAgainst = { 1: 0, 2: 0 };
        posAccum.clear();
        lastKicker = null; prevKicker = null;
        lastKickSpeed = 0; lastKickPos = null;
        pendingKickMeasure = null;
        updateTeams();
        currentTarget = desiredTarget();
        touchAll();
        publicMsg(MSG.partido(getActiveTeam(Team.RED).length, getActiveTeam(Team.BLUE).length), THEME.primary);
        later(() => { rebalanceTeams(); checkShortage(); }, 100);
    } catch (e) { logError(e); }
};
room.onGamePause = function () { gamePaused = true; };
room.onGameUnpause = function () { gamePaused = false; botPaused = false; touchAll(); };
room.onTeamVictory = function (scores) {
    try {
        updateTeams();
        const winner = scores.red > scores.blue ? Team.RED : scores.blue > scores.red ? Team.BLUE : Team.SPEC;
        if (winner !== Team.SPEC) {
            const summary = buildMatchSummary(winner, scores);
            updateMatchStats(winner);
            if (summary) lastMatch = summary;
            botStop();
            if (summary) publicMsg(summary.text, THEME.accent);
            requestRotation(winner);
        } else {
            botStop();
            lastWinner = Team.SPEC;
            scheduleAutoStart();
        }
    } catch (e) { logError(e); }
};
room.onGameStop = function () {
    try {
        updateTeams();
        gamePaused = false; botPaused = false;
        // Si NO fue el bot quien detuvo (admin desde la interfaz), reprogramar.
        const byBot = Date.now() - lastBotStop < 1500;
        if (!byBot && !rotationScheduled) {
            lastWinner = Team.SPEC;
            later(() => scheduleAutoStart(), 500);
        }
    } catch (e) { logError(e); }
};
room.onGameTick = function () {
    tickCounter++;
    try {
        if (gameRunning() && !gamePaused) {
            const pos = room.getBallPosition();
            if (pos && pendingKickMeasure) {
                lastKickSpeed = Math.hypot(pos.x - pendingKickMeasure.x, pos.y - pendingKickMeasure.y);
                pendingKickMeasure = null;
            }
        }
        if (tickCounter % 60 === 0) {
            checkAutoAfk();
            if (gameRunning() && !gamePaused) {
                players.forEach(p => {
                    if (p.team !== Team.SPEC && p.position) {
                        const a = posAccum.get(p.id) || { x: 0, y: 0, n: 0 };
                        a.x += p.position.x; a.y += p.position.y; a.n++;
                        posAccum.set(p.id, a);
                    }
                });
            }
        }
    } catch (e) { logError(e); }
};

const watchdogInterval = setInterval(function () {
    try { watchdog(); } catch (e) { logError(e); }
}, WATCHDOG_INTERVAL_MS);

if (CONFIG.autoAvisoMin > 0) {
    autoAvisoTimer = setInterval(function () {
        try {
            if (players.length >= 2) publicMsg(MSG.autoAviso(), THEME.info);
        } catch (e) { logError(e); }
    }, CONFIG.autoAvisoMin * 60000);
}

if (typeof globalThis !== "undefined") {
    globalThis.__webot = {
        room: room,
        stop: function () {
            clearInterval(watchdogInterval);
            if (autoAvisoTimer) clearInterval(autoAvisoTimer);
            try { if (gameRunning()) room.stopGame(); } catch (e) { logError(e); }
        },
        debug: {
            isRunning: () => gameRunning(),
            getPlayers: () => players.map(p => ({ id: p.id, name: p.name, team: p.team, admin: p.admin, auth: p.auth || null })),
            getQueue: () => queue.slice(),
            getAfk: () => Array.from(afkPlayers),
            getAfkSince: () => [...afkSince.entries()].map(([id, at]) => ({ id, at })),
            setAfkQueueMaxMin: (min) => { CONFIG.afkQueueMaxMin = Number(min) || 0; },
            getAutoAfk: () => Array.from(autoAfk),
            getTarget: () => currentTarget,
            getLastWinner: () => lastWinner,
            getBanned: () => [...bannedNames.entries()].map(([key, v]) => ({ key, id: v.id, name: v.name, auth: v.auth || null })),
            getBannedAuths: () => Array.from(bannedAuths),
            getAdminAttempts: () => adminAttempts.size,
            getMap: () => currentMap,
            getWarnings: () => [...warnings.values()].map(w => ({ count: w.count, name: w.name, last: w.last })),
            getLastMatch: () => lastMatch ? { text: lastMatch.text, at: lastMatch.at } : null,
            isMuted: (id) => { const p = getPlayerById(id); return p ? isMuted(p) : false; }
        }
    };
}
if (typeof console !== "undefined") {
    console.log("[weBOT] Script cargado. Esperando jugadores...");
}
})();
