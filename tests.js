/* Suite de pruebas de navegador para weBOT.
   Simula HBInit/room con un host falso y ejecuta casos reales. */
(function () {
    "use strict";

    const BANS_KEY = "webot_bans";
    const TEST_PREFIX = "__t_";

    let currentMock = null;
    let mockCount = 0;
    let playerSeq = 1000;
    const results = [];
    const consoleLines = [];

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    class SkipError extends Error {}
    class AssertError extends Error {}

    function assert(cond, msg) {
        if (!cond) throw new AssertError(msg || "Assertion fallida");
    }
    function assertEq(actual, expected, msg) {
        if (actual !== expected) throw new AssertError((msg || "Valor inesperado") + " (esperado: " + expected + ", recibido: " + actual + ")");
    }

    function hasLocalStorage() {
        try {
            localStorage.setItem(TEST_PREFIX + "probe", "1");
            localStorage.removeItem(TEST_PREFIX + "probe");
            return true;
        } catch (e) { return false; }
    }

    function cleanupTestData() {
        if (!hasLocalStorage()) return;
        try {
            const raw = localStorage.getItem(BANS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            if (Array.isArray(arr)) {
                const filtered = arr.filter(e => !String((e && e.name) || "").startsWith(TEST_PREFIX));
                localStorage.setItem(BANS_KEY, JSON.stringify(filtered));
            }
        } catch (e) { /* ignora */ }
        try {
            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf(TEST_PREFIX) !== -1) toRemove.push(k);
            }
            toRemove.forEach(k => localStorage.removeItem(k));
        } catch (e) { /* ignora */ }
    }

    /* ============================ MOCK DE HAXBALL ============================ */
    function createMockRoom(options) {
        const mock = {
            options: options || {},
            players: [],
            scores: null,
            paused: false,
            announcements: [],
            calls: {
                startGame: 0,
                stopGame: 0,
                kickPlayer: [],
                setDefaultStadium: [],
                setCustomStadium: [],
                setTeamsLock: [],
                setScoreLimit: [],
                setTimeLimit: [],
                clearBan: [],
                clearBans: 0
            },
            room: null
        };

        const room = {
            setTeamsLock(v) { mock.calls.setTeamsLock.push(v); },
            setScoreLimit(v) { mock.calls.setScoreLimit.push(v); },
            setTimeLimit(v) { mock.calls.setTimeLimit.push(v); },
            setCustomStadium(v) {
                mock.calls.setCustomStadium.push(v);
                return mock.options.customStadiumResult !== false;
            },
            setDefaultStadium(v) { mock.calls.setDefaultStadium.push(v); },
            setPlayerAvatar() {},
            sendAnnouncement(message, target) {
                mock.announcements.push({ message: String(message), target: target == null ? null : target });
            },
            getPlayerList() { return mock.players.map(p => ({ ...p })); },
            getPlayer(id) {
                const p = mock.players.find(x => x.id === id);
                return p ? { ...p } : null;
            },
            setPlayerTeam(id, team) {
                const p = mock.players.find(x => x.id === id);
                if (p) p.team = team;
            },
            setPlayerAdmin(id, admin) {
                const p = mock.players.find(x => x.id === id);
                if (p) p.admin = !!admin;
            },
            kickPlayer(id, reason, ban) {
                const p = mock.players.find(x => x.id === id);
                if (!p) return;
                mock.calls.kickPlayer.push({ id: id, name: p.name, reason: reason, ban: !!ban });
                mock.players = mock.players.filter(x => x.id !== id);
                if (typeof room.onPlayerLeave === "function") room.onPlayerLeave(p);
            },
            clearBan(id) { mock.calls.clearBan.push(id); },
            clearBans() { mock.calls.clearBans++; },
            getScores() { return mock.scores; },
            getBallPosition() { return { x: 0, y: 0 }; },
            startGame() {
                mock.calls.startGame++;
                mock.scores = { red: 0, blue: 0, time: 0 };
                if (typeof room.onGameStart === "function") room.onGameStart();
            },
            stopGame() {
                mock.calls.stopGame++;
                mock.scores = null;
            },
            pauseGame(v) {
                mock.paused = !!v;
                if (v && typeof room.onGamePause === "function") room.onGamePause();
                if (!v && typeof room.onGameUnpause === "function") room.onGameUnpause();
            }
        };

        mock.room = room;
        mockCount++;
        return mock;
    }

    window.HBInit = function () {
        currentMock = createMockRoom(window.__nextMockOptions || {});
        window.__nextMockOptions = null;
        return currentMock.room;
    };

    /* ============================ CARGA / TEARDOWN ============================ */
    function loadWebot() {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "webot.js?v=" + Date.now() + "_" + Math.random();
            s.async = false;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error("No se pudo cargar webot.js. Verificá que esté en la misma carpeta que tests.html."));
            document.head.appendChild(s);
        });
    }

    function teardownWebot() {
        try {
            if (window.__webot && typeof window.__webot.stop === "function") window.__webot.stop();
        } catch (e) { /* ignora */ }
        try { delete window.__webot; } catch (e) { window.__webot = undefined; }
        currentMock = null;
    }

    async function resetWebot(options) {
        teardownWebot();
        window.__nextMockOptions = options || {};
        await loadWebot();
        await wait(40);
        if (!window.__webot) throw new Error("webot.js no se inicializó (HBInit no fue llamado).");
        return currentMock;
    }

    /* ============================ HELPERS ============================ */
    function mkPlayer(name, opts) {
        opts = opts || {};
        const id = opts.id != null ? opts.id : ++playerSeq;
        return {
            id: id,
            name: TEST_PREFIX + name,
            team: 0,
            admin: false,
            auth: opts.auth !== undefined ? opts.auth : TEST_PREFIX + "auth_" + name,
            position: { x: 0, y: 0 }
        };
    }
    function join(mock, player) {
        mock.players.push(player);
        mock.room.onPlayerJoin(player);
        return player;
    }
    function leave(mock, player) {
        mock.players = mock.players.filter(p => p.id !== player.id);
        mock.room.onPlayerLeave(player);
    }
    function chat(mock, player, message) {
        return mock.room.onPlayerChat(player, message);
    }
    function byName(mock, name) {
        return mock.players.find(p => p.name === TEST_PREFIX + name) || null;
    }
    function said(mock, text) {
        return mock.announcements.some(a => a.message.indexOf(text) !== -1);
    }
    function saidTo(mock, id, text) {
        return mock.announcements.some(a => a.target === id && a.message.indexOf(text) !== -1);
    }
    function debugApi() {
        if (!window.__webot || !window.__webot.debug) throw new Error("Falta __webot.debug");
        return window.__webot.debug;
    }

    /* ============================ FRAMEWORK ============================ */
    const resultsEl = document.getElementById("results");
    const summaryEl = document.getElementById("summary");
    const logEl = document.getElementById("log");

    function render() {
        const ok = results.filter(r => r.status === "ok").length;
        const fail = results.filter(r => r.status === "fail").length;
        const skip = results.filter(r => r.status === "skip").length;
        summaryEl.className = "summary " + (fail > 0 ? "has-fail" : "all-ok");
        summaryEl.textContent = results.length + " pruebas · " + ok + " OK · " + fail + " fallos · " + skip + " saltadas";
        resultsEl.innerHTML = results.map(r => {
            const cls = r.status === "ok" ? "ok" : (r.status === "fail" ? "fail" : "skip");
            const label = r.status === "ok" ? "OK" : (r.status === "fail" ? "FALLO" : "SALTADA");
            const detail = r.msg ? '<div class="detail">' + escapeHtml(r.msg) + "</div>" : "";
            return '<div class="row ' + cls + '"><span class="badge">' + label + "</span>" +
                '<span class="name">' + escapeHtml(r.name) + "</span>" +
                '<span class="ms">' + r.ms + " ms</span>" + detail + "</div>";
        }).join("");
        if (logEl) logEl.textContent = consoleLines.slice(-120).join("\n");
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    async function test(name, fn) {
        const t0 = performance.now();
        try {
            await Promise.race([
                fn(),
                new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout de 20s")), 20000))
            ]);
            results.push({ name: name, status: "ok", ms: Math.round(performance.now() - t0) });
        } catch (e) {
            if (e instanceof SkipError) {
                results.push({ name: name, status: "skip", msg: e.message, ms: Math.round(performance.now() - t0) });
            } else {
                results.push({
                    name: name,
                    status: "fail",
                    msg: (e && e.message) ? e.message : String(e),
                    ms: Math.round(performance.now() - t0)
                });
            }
        }
        render();
    }

    /* ============================ PRUEBAS ============================ */
    async function runSuite() {
        results.length = 0;
        cleanupTestData();
        render();

        await test("Carga: expone __webot, sala y API de debug", async () => {
            const mock = await resetWebot();
            assert(window.__webot, "No se expuso __webot");
            assertEq(window.__webot.room, mock.room, "La sala expuesta no coincide");
            assertEq(mock.calls.setCustomStadium.length, 1, "No aplicó el mapa embebido");
            assertEq(mock.calls.setDefaultStadium.length, 0, "Usó Classic aunque el mapa era válido");
            assert(typeof debugApi().getPlayers === "function", "Falta debug.getPlayers");
        });

        await test("Guard: re-ejecutar no crea una segunda sala", async () => {
            const mock = await resetWebot();
            const roomRef = window.__webot.room;
            const countBefore = mockCount;
            await loadWebot();
            await wait(60);
            assertEq(window.__webot.room, roomRef, "Cambió la sala activa");
            assertEq(mockCount, countBefore, "Se creó otra sala");
            assertEq(mock.room, roomRef, "La sala original ya no coincide");
        });

        await test("Bienvenida y bloqueo de nombres duplicados", async () => {
            const mock = await resetWebot();
            const ana = join(mock, mkPlayer("Ana"));
            assert(saidTo(mock, ana.id, "Ganas y sigues"), "No envió la bienvenida");
            const dup = mkPlayer("Ana", { id: ana.id + 500, auth: TEST_PREFIX + "auth_Ana2" });
            join(mock, dup);
            assert(!mock.players.some(p => p.id === dup.id), "El duplicado no fue expulsado");
            assert(saidTo(mock, dup.id, "Ya hay alguien con el nombre"), "No avisó del duplicado");
        });

        await test("Autoarranque: 2 jugadores forman un 1v1", async () => {
            const mock = await resetWebot();
            join(mock, mkPlayer("P1"));
            join(mock, mkPlayer("P2"));
            await wait(1300);
            assert(mock.calls.startGame >= 1, "No inició la partida");
            assert(mock.scores != null, "No hay partida en curso");
            const red = mock.players.filter(p => p.team === 1).length;
            const blue = mock.players.filter(p => p.team === 2).length;
            assertEq(red, 1, "Rojos inesperados: " + red);
            assertEq(blue, 1, "Azules inesperados: " + blue);
            assert(said(mock, "(1v1)"), "No anunció los equipos");
        });

        await test("Admin: clave correcta, clave incorrecta y bloqueo por intentos", async () => {
            const mock = await resetWebot();
            const ana = join(mock, mkPlayer("AdminAna"));
            join(mock, mkPlayer("AdminBeto"));
            await wait(1200);
            chat(mock, ana, "!admin 3434");
            assert(byName(mock, "AdminAna").admin === true, "No se hizo admin con la clave correcta");
            assert(said(mock, "ahora es admin"), "No anunció al nuevo admin");

            const carlos = join(mock, mkPlayer("AdminCarlos"));
            for (let i = 0; i < 5; i++) chat(mock, carlos, "!admin 0000");
            await wait(4200); // deja pasar el anti-flood (4s) antes del intento bloqueado
            chat(mock, carlos, "!admin 0000");
            assert(saidTo(mock, carlos.id, "Demasiados intentos"), "No bloqueó tras 5 intentos fallidos");
            assert(byName(mock, "AdminCarlos").admin === false, "Carlos quedó como admin");
        });

        await test("Admin: los intentos fallidos se limpian al salir", async () => {
            const mock = await resetWebot();
            const carlos = join(mock, mkPlayer("LeaveCarlos"));
            chat(mock, carlos, "!admin 0000");
            chat(mock, carlos, "!admin 0000");
            assertEq(debugApi().getAdminAttempts(), 1, "No registró los intentos");
            leave(mock, carlos);
            assertEq(debugApi().getAdminAttempts(), 0, "No limpió los intentos al salir");
        });

        await test("Mapa: si el mapa custom falla, cae a Classic", async () => {
            const mock = await resetWebot({ customStadiumResult: false });
            assertEq(mock.calls.setCustomStadium.length, 1, "No intentó aplicar el mapa custom");
            assert(mock.calls.setDefaultStadium.indexOf("Classic") !== -1, "No cayó a Classic");
        });

        await test("AFK: toggle manual y regreso", async () => {
            const mock = await resetWebot();
            join(mock, mkPlayer("Afk1"));
            join(mock, mkPlayer("Afk2"));
            join(mock, mkPlayer("Afk3"));
            await wait(1300);
            const spec = mock.players.find(p => p.team === 0);
            assert(spec, "No quedó nadie en espera");
            chat(mock, spec, "!afk");
            assert(debugApi().getAfk().indexOf(spec.id) !== -1, "No quedó AFK");
            assert(said(mock, "está AFK"), "No anunció AFK");
            chat(mock, spec, "!afk");
            assert(debugApi().getAfk().indexOf(spec.id) === -1, "No volvió de AFK");
            assert(said(mock, "volvió"), "No anunció el regreso");
        });

        await test("AFK: no se permite durante una partida", async () => {
            const mock = await resetWebot();
            join(mock, mkPlayer("AfkGame1"));
            join(mock, mkPlayer("AfkGame2"));
            await wait(1300);
            const onField = mock.players.find(p => p.team !== 0);
            assert(onField, "Nadie quedó en cancha");
            chat(mock, onField, "!afk");
            assert(debugApi().getAfk().indexOf(onField.id) === -1, "Se pudo poner AFK en partida");
            assert(saidTo(mock, onField.id, "AFK durante una partida"), "No avisó que no se puede");
        });

        await test("AFK en cola: expulsa al superar el máximo configurado", async () => {
            const mock = await resetWebot();
            debugApi().setAfkQueueMaxMin(0.02); // 1.2 s para la prueba
            const afk = join(mock, mkPlayer("AfkQueue"));
            chat(mock, afk, "!afk");
            assert(debugApi().getAfk().indexOf(afk.id) !== -1, "No quedó AFK");
            assert(debugApi().getAfkSince().some(x => x.id === afk.id), "No registró el inicio del AFK");
            await wait(2300);
            assert(mock.calls.kickPlayer.some(k => k.id === afk.id && /AFK/i.test(k.reason)), "No expulsó al AFK de la cola");
            assert(said(mock, "demasiado tiempo AFK"), "No avisó la expulsión");
            assert(debugApi().getAfk().indexOf(afk.id) === -1, "Sigue marcado como AFK");
        });

        await test("Rotación: ganadores siguen en rojo y perdedores al fondo", async () => {
            const mock = await resetWebot();
            for (let i = 1; i <= 10; i++) join(mock, mkPlayer("Rot" + i));
            await wait(1400);
            assert(mock.calls.startGame >= 1, "No arrancó el partido");
            const before = debugApi().getPlayers();
            const reds = before.filter(p => p.team === 1).map(p => p.name);
            const blues = before.filter(p => p.team === 2).map(p => p.name);
            const waiters = before.filter(p => p.team === 0).map(p => p.name);
            assertEq(reds.length, 4, "Rojos: " + reds.length);
            assertEq(blues.length, 4, "Azules: " + blues.length);
            assertEq(waiters.length, 2, "En espera: " + waiters.length);

            mock.room.onTeamVictory({ red: 3, blue: 0 });
            await wait(1500);

            const after = debugApi().getPlayers();
            const stillRed = after.filter(p => p.team === 1).map(p => p.name);
            reds.forEach(n => assert(stillRed.indexOf(n) !== -1, n + " no se quedó en rojo"));
            const playing = after.filter(p => p.team !== 0).map(p => p.name);
            waiters.forEach(n => assert(playing.indexOf(n) !== -1, n + " (esperaba turno) no entró"));
            const spec = after.filter(p => p.team === 0).map(p => p.name);
            assertEq(spec.length, 2, "En espera tras rotar: " + spec.length);
            spec.forEach(n => assert(blues.indexOf(n) !== -1, n + " en espera no era perdedor"));
            assert(said(mock, "Al fondo de la cola"), "No anunció la rotación");
        });

        await test("Expansión: 2v2 sube a 3v3 y 4v4, y baja al salir uno", async () => {
            const mock = await resetWebot();
            for (let i = 1; i <= 4; i++) join(mock, mkPlayer("Exp" + i));
            await wait(1300);
            let ps = debugApi().getPlayers();
            assertEq(ps.filter(p => p.team === 1).length, 2, "No arrancó 2v2 (rojos)");
            assertEq(ps.filter(p => p.team === 2).length, 2, "No arrancó 2v2 (azules)");

            join(mock, mkPlayer("Exp5"));
            join(mock, mkPlayer("Exp6"));
            await wait(3300);
            ps = debugApi().getPlayers();
            assertEq(debugApi().getTarget(), 3, "No subió el objetivo a 3");
            assertEq(ps.filter(p => p.team === 1).length, 3, "Rojos no llegaron a 3");
            assertEq(ps.filter(p => p.team === 2).length, 3, "Azules no llegaron a 3");

            join(mock, mkPlayer("Exp7"));
            join(mock, mkPlayer("Exp8"));
            await wait(3500);
            ps = debugApi().getPlayers();
            assertEq(debugApi().getTarget(), 4, "No subió el objetivo a 4");
            assertEq(ps.filter(p => p.team === 1).length, 4, "Rojos no llegaron a 4");
            assertEq(ps.filter(p => p.team === 2).length, 4, "Azules no llegaron a 4");

            const red = mock.players.find(p => p.team === 1);
            leave(mock, red);
            await wait(3500);
            ps = debugApi().getPlayers();
            assertEq(debugApi().getTarget(), 3, "No bajó el objetivo a 3");
            assertEq(ps.filter(p => p.team === 1).length, 3, "Rojos no bajaron a 3");
            assertEq(ps.filter(p => p.team === 2).length, 3, "Azules no bajaron a 3");
        });

        await test("Expansión: no rebaja equipos ya subidos ni anuncia de más", async () => {
            const mock = await resetWebot();
            for (let i = 1; i <= 4; i++) join(mock, mkPlayer("ExpSet" + i));
            await wait(1300);
            const p5 = join(mock, mkPlayer("ExpSet5"));
            const p6 = join(mock, mkPlayer("ExpSet6"));
            const by = mock.players.find(p => p.team === 1);
            mock.room.setPlayerTeam(p5.id, 1);
            mock.room.onPlayerTeamChange(p5, by);
            mock.room.setPlayerTeam(p6.id, 2);
            mock.room.onPlayerTeamChange(p6, by);

            await wait(2600);
            const ps = debugApi().getPlayers();
            assertEq(debugApi().getTarget(), 3, "No confirmó el objetivo 3");
            assertEq(ps.filter(p => p.team === 1).length, 3, "Rojos no quedaron en 3");
            assertEq(ps.filter(p => p.team === 2).length, 3, "Azules no quedaron en 3");
            assert(!said(mock, "Partida ampliada a 3v3"), "Anunció expansión ya estando 3v3");
            assert(!said(mock, "va a la cola"), "Mandó gente a la cola antes de expandir");
        });

        await test("Bans: ban, bloqueo por nombre y por auth, y unban", async () => {
            const mock = await resetWebot();
            const ana = join(mock, mkPlayer("BanAna"));
            join(mock, mkPlayer("BanBeto"));
            await wait(1200);
            chat(mock, ana, "!admin 3434");
            assert(byName(mock, "BanAna").admin === true, "Ana no es admin");

            chat(mock, ana, "!ban BanBeto");
            assert(!byName(mock, "BanBeto"), "Beto no fue expulsado");
            assert(debugApi().getBanned().some(b => b.name === TEST_PREFIX + "BanBeto"), "No registró el ban");

            const sameName = mkPlayer("BanBeto", { id: 9001, auth: TEST_PREFIX + "auth_otro" });
            join(mock, sameName);
            assert(!mock.players.some(p => p.id === sameName.id), "El baneado por nombre pudo entrar");

            const sameAuth = mkPlayer("BanOtro", { id: 9002, auth: TEST_PREFIX + "auth_BanBeto" });
            join(mock, sameAuth);
            assert(!mock.players.some(p => p.id === sameAuth.id), "El baneado por auth pudo entrar");

            chat(mock, ana, "!unban BanBeto");
            assertEq(debugApi().getBanned().length, 0, "No se levantó el ban");

            const vuelve = mkPlayer("BanBeto", { id: 9003, auth: TEST_PREFIX + "auth_BanBeto_nuevo" });
            join(mock, vuelve);
            assert(mock.players.some(p => p.id === vuelve.id), "No pudo volver tras el unban");
        });

        await test("Bans: persisten al reiniciar el script", async () => {
            if (!hasLocalStorage()) throw new SkipError("localStorage no disponible; abre la página vía http://localhost");
            let mock = await resetWebot();
            const ana = join(mock, mkPlayer("PersistAna"));
            join(mock, mkPlayer("PersistBeto"));
            await wait(1200);
            chat(mock, ana, "!admin 3434");
            chat(mock, ana, "!ban PersistBeto");
            assert(debugApi().getBanned().some(b => b.name === TEST_PREFIX + "PersistBeto"), "No registró el ban");

            mock = await resetWebot();
            assert(debugApi().getBanned().some(b => b.name === TEST_PREFIX + "PersistBeto"), "El ban no sobrevivió al reinicio");

            const ana2 = join(mock, mkPlayer("PersistAna2"));
            chat(mock, ana2, "!admin 3434");
            chat(mock, ana2, "!unban PersistBeto");
            assert(!debugApi().getBanned().some(b => b.name === TEST_PREFIX + "PersistBeto"), "No se pudo limpiar el ban");
        });

        await test("Búsqueda: acentos, emoji, unicode, espacios y #id", async () => {
            const mock = await resetWebot();
            const admin = join(mock, mkPlayer("FindAdmin"));
            join(mock, mkPlayer("José Pepe"));
            join(mock, mkPlayer("🔥Gabriel🔥"));
            join(mock, mkPlayer("𝕁𝕦𝕒𝕟"));
            const doble = join(mock, mkPlayer("Doble  Espacio", { id: 7777 }));
            join(mock, mkPlayer("Pedro1"));
            join(mock, mkPlayer("Pedro2"));

            chat(mock, admin, "!admin 3434");
            assert(byName(mock, "FindAdmin").admin === true, "No se hizo admin");

            chat(mock, admin, "!mute Jose Pepe");
            assert(said(mock, "José Pepe fue silenciado"), "No encontró el nombre con acento");

            chat(mock, admin, "!mute @Gabriel");
            assert(said(mock, "Gabriel🔥 fue silenciado"), "No encontró con emoji y prefijo @");

            chat(mock, admin, "!mute Juan");
            assert(said(mock, "𝕁𝕦𝕒𝕟 fue silenciado"), "No encontró unicode estilizado");

            chat(mock, admin, "!mute #" + doble.id);
            assert(said(mock, "Doble  Espacio fue silenciado"), "No encontró por #id");

            chat(mock, admin, "!mute Pedro");
            assert(saidTo(mock, admin.id, "Hay varios que coinciden"), "No detectó nombres ambiguos");
        });

        await test("Cola: muestra posición y estimación de partidos", async () => {
            const mock = await resetWebot();
            for (let i = 1; i <= 10; i++) join(mock, mkPlayer("Cola" + i));
            await wait(1400);
            const specs = mock.players.filter(p => p.team === 0);
            assertEq(specs.length, 2, "En espera: " + specs.length);
            const segundo = specs[1];
            chat(mock, segundo, "!cola");
            assert(saidTo(mock, segundo.id, "Cola:"), "No mostró la cola");
            assert(saidTo(mock, segundo.id, "Te toca en ~1 partido"), "No estimó el turno");
        });

        await test("Goles: muestra marcador y asistencia", async () => {
            const mock = await resetWebot();
            join(mock, mkPlayer("GolA"));
            join(mock, mkPlayer("GolB"));
            join(mock, mkPlayer("GolC"));
            join(mock, mkPlayer("GolD"));
            await wait(1300);
            const reds = mock.players.filter(p => p.team === 1);
            assertEq(reds.length, 2, "Rojos: " + reds.length);
            mock.scores.red = 1;
            mock.room.onPlayerBallKick(reds[0]);
            mock.room.onPlayerBallKick(reds[1]);
            mock.room.onTeamGoal(1);
            assert(said(mock, "GOL de"), "No anunció el gol");
            assert(said(mock, "1-0"), "No mostró el marcador");
            assert(said(mock, "Asistencia:"), "No mostró la asistencia");
        });

        await test("Stats y top: solo los ve quien los pide", async () => {
            if (!hasLocalStorage()) throw new SkipError("localStorage no disponible; abre la página vía http://localhost");
            const mock = await resetWebot();
            const ana = join(mock, mkPlayer("StatsAna"));
            const beto = join(mock, mkPlayer("StatsBeto"));
            localStorage.setItem("webot_stats:" + ana.auth, JSON.stringify({
                name: ana.name, games: 5, wins: 3, losses: 2,
                goals: 10, assists: 4, cleanSheets: 1
            }));
            localStorage.setItem("webot_stats:" + beto.auth, JSON.stringify({
                name: beto.name, games: 7, wins: 4, losses: 3,
                goals: 5, assists: 2, cleanSheets: 0
            }));

            chat(mock, ana, "!stats");
            assert(saidTo(mock, ana.id, "PJ 5"), "No le llegó el stats a Ana");
            assert(!mock.announcements.some(a => a.target === null && a.message.indexOf("PJ 5") !== -1), "El stats salió al chat público");

            chat(mock, ana, "!stats StatsBeto");
            assert(saidTo(mock, ana.id, "PJ 7"), "No le llegó el stats de Beto");
            assert(!mock.announcements.some(a => a.target === null && a.message.indexOf("PJ 7") !== -1), "El stats de otro salió al chat público");

            chat(mock, ana, "!top");
            assert(saidTo(mock, ana.id, "TOP PUNTOS"), "No le llegó el top a Ana");
            assert(saidTo(mock, ana.id, "StatsAna"), "El top no incluye a Ana");
            assert(!mock.announcements.some(a => a.target === null && a.message.indexOf("TOP PUNTOS") !== -1), "El top salió al chat público");

            chat(mock, ana, "!goals");
            assert(saidTo(mock, ana.id, "TOP GOLES"), "No le llegó el top de goles");
            assert(saidTo(mock, ana.id, "StatsAna"), "El top de goles no incluye a Ana");
            assert(!mock.announcements.some(a => a.target === null && a.message.indexOf("TOP GOLES") !== -1), "El top de goles salió al chat público");
        });

        await test("Quien: equipos, cola y AFK en privado", async () => {
            const mock = await resetWebot();
            join(mock, mkPlayer("Who1"));
            join(mock, mkPlayer("Who2"));
            join(mock, mkPlayer("Who3"));
            await wait(1300);
            const spec = mock.players.find(p => p.team === 0);
            assert(spec, "No quedó nadie en espera");
            chat(mock, spec, "!quien");
            assert(saidTo(mock, spec.id, "SALA"), "No mostró la sala");
            assert(saidTo(mock, spec.id, "Cola"), "No mostró la cola");
            assert(!mock.announcements.some(a => a.target === null && a.message.indexOf("SALA") !== -1), "El quién salió al chat público");
        });

        await test("Resumen: marcador, MVP y !ultimo privado", async () => {
            const mock = await resetWebot();
            for (let i = 1; i <= 4; i++) join(mock, mkPlayer("Sum" + i));
            await wait(1300);
            const reds = mock.players.filter(p => p.team === 1);
            assertEq(reds.length, 2, "Rojos: " + reds.length);
            mock.scores.red = 3;
            mock.scores.blue = 1;
            mock.room.onPlayerBallKick(reds[0]);
            mock.room.onTeamGoal(1);
            mock.room.onPlayerBallKick(reds[1]);
            mock.room.onPlayerBallKick(reds[0]);
            mock.room.onTeamGoal(1);
            mock.room.onTeamVictory({ red: 3, blue: 1 });
            assert(said(mock, "FINAL"), "No mostró el resumen final");
            assert(said(mock, "MVP"), "No mostró el MVP");
            chat(mock, reds[0], "!ultimo");
            assert(saidTo(mock, reds[0].id, "FINAL"), "No le llegó el último partido");
        });

        await test("Reglas y estado: privados", async () => {
            const mock = await resetWebot();
            const ana = join(mock, mkPlayer("InfoAna"));
            chat(mock, ana, "!reglas");
            assert(saidTo(mock, ana.id, "REGLAS"), "No le llegaron las reglas");
            assert(!mock.announcements.some(a => a.target === null && a.message.indexOf("REGLAS") !== -1), "Las reglas salieron al público");
            chat(mock, ana, "!estado");
            assert(saidTo(mock, ana.id, "ESTADO"), "No le llegó el estado");
            assert(saidTo(mock, ana.id, "en línea"), "El estado no muestra uptime");
            assert(!mock.announcements.some(a => a.target === null && a.message.indexOf("ESTADO") !== -1), "El estado salió al público");
        });

        await test("Warn: tres avisos silencian al jugador", async () => {
            const mock = await resetWebot();
            const admin = join(mock, mkPlayer("WarnAdmin"));
            const bad = join(mock, mkPlayer("WarnBad"));
            chat(mock, admin, "!admin 3434");
            for (let i = 0; i < 3; i++) chat(mock, admin, "!warn WarnBad insulta");
            assert(said(mock, "recibió un aviso"), "No anunció el aviso");
            assert(said(mock, "silenciado por acumular 3 avisos"), "No silenció al tercer aviso");
            assert(debugApi().isMuted(bad.id), "El jugador no quedó silenciado");
            chat(mock, bad, "hola a todos");
            assert(!mock.announcements.some(a => a.message.indexOf("hola a todos") !== -1), "El silenciado pudo hablar");
            chat(mock, admin, "!warns WarnBad");
            assert(saidTo(mock, admin.id, "3 avisos"), "No mostró el historial de avisos");
        });

        await test("Mapa: el admin cambia entre Classic y Futsal", async () => {
            const mock = await resetWebot();
            const admin = join(mock, mkPlayer("MapAdmin"));
            chat(mock, admin, "!admin 3434");
            assertEq(debugApi().getMap(), "futsal", "No arrancó en Futsal");
            chat(mock, admin, "!mapa classic");
            assertEq(debugApi().getMap(), "classic", "No cambió a Classic");
            assert(mock.calls.setDefaultStadium.indexOf("Classic") !== -1, "No aplicó Classic");
            chat(mock, admin, "!mapa futsal");
            assertEq(debugApi().getMap(), "futsal", "No volvió a Futsal");
            assertEq(mock.calls.setCustomStadium.length, 2, "No reaplicó el mapa custom");
            const noAdmin = join(mock, mkPlayer("MapNoAdmin"));
            chat(mock, noAdmin, "!mapa classic");
            assert(saidTo(mock, noAdmin.id, "permisos"), "No bloqueó al no-admin");
        });

        await test("Pausa: el admin pausa y reanuda", async () => {
            const mock = await resetWebot();
            const admin = join(mock, mkPlayer("PauseAdmin"));
            join(mock, mkPlayer("PauseBeto"));
            await wait(1300);
            chat(mock, admin, "!admin 3434");
            chat(mock, admin, "!pausa");
            assert(mock.paused === true, "No pausó el partido");
            assert(said(mock, "Partido pausado"), "No avisó la pausa");
            chat(mock, admin, "!reanudar");
            assert(mock.paused === false, "No reanudó el partido");
            assert(said(mock, "Partido reanudado"), "No avisó la reanudación");
        });

        await test("Filtros: links, mayúsculas y repetidos", async () => {
            const mock = await resetWebot();
            const ana = join(mock, mkPlayer("FilterAna"));
            chat(mock, ana, "mira https://ejemplo.com");
            assert(saidTo(mock, ana.id, "No se permiten links"), "No bloqueó el link");
            assert(!mock.announcements.some(a => a.message.indexOf("ejemplo.com") !== -1), "El link salió al chat");
            chat(mock, ana, "ESTO ES UN MENSAJE MUY GRITADO");
            assert(saidTo(mock, ana.id, "mayúsculas"), "No bloqueó las mayúsculas");
            chat(mock, ana, "mensaje repetido");
            chat(mock, ana, "mensaje repetido");
            assert(saidTo(mock, ana.id, "No repitas"), "No bloqueó el mensaje repetido");
        });

        await test("Report: avisa a los admins en privado", async () => {
            const mock = await resetWebot();
            const admin = join(mock, mkPlayer("RepAdmin"));
            const beto = join(mock, mkPlayer("RepBeto"));
            join(mock, mkPlayer("RepToxic"));
            chat(mock, admin, "!admin 3434");
            chat(mock, beto, "!report RepToxic insulta");
            assert(saidTo(mock, admin.id, "REPORTE"), "El admin no recibió el reporte");
            assert(saidTo(mock, admin.id, "RepToxic"), "El reporte no incluye al reportado");
            assert(saidTo(mock, beto.id, "Reporte enviado"), "No confirmó al reportero");
            assert(!mock.announcements.some(a => a.target === null && a.message.indexOf("REPORTE") !== -1), "El reporte salió al público");
        });

        await test("Chistes: sin fútbol ni huevos", async () => {
            const mock = await resetWebot();
            const ana = join(mock, mkPlayer("JokeAna"));
            chat(mock, ana, "!chiste");
            const chiste = mock.announcements.find(a => a.message.indexOf("💀") === 0);
            assert(chiste, "No envió ningún chiste");
            assert(!/(arquero|gol|fútbol|futbol|huevo|cancha|defensa|delantero|portero)/i.test(chiste.message), "El chiste menciona fútbol o huevos");
        });

        await test("Comandos: uno desconocido responde sin romper", async () => {
            const mock = await resetWebot();
            const p = join(mock, mkPlayer("Cmd"));
            chat(mock, p, "!nada");
            assert(saidTo(mock, p.id, "Comando no reconocido"), "No respondió al comando desconocido");
        });

        teardownWebot();
        cleanupTestData();
        render();
    }

    /* ============================ LOG ============================ */
    ["log", "warn", "error"].forEach(level => {
        const original = console[level] ? console[level].bind(console) : function () {};
        console[level] = function () {
            const args = Array.prototype.slice.call(arguments);
            const text = args.map(a => {
                if (typeof a === "string") return a;
                if (a && a.stack) return a.stack;
                try { return JSON.stringify(a); } catch (e) { return String(a); }
            }).join(" ");
            consoleLines.push("[" + level + "] " + text);
            if (logEl) logEl.textContent = consoleLines.slice(-120).join("\n");
            original.apply(null, args);
        };
    });

    runSuite().catch(e => {
        consoleLines.push("[error] " + (e && e.stack ? e.stack : e));
        render();
    });
})();
