// The match page: setup, the game loop that asks the server for each move, and the HUD floating over the
// full-screen 3D battle. The theater (static/js/theater) is optional: without WebGL the scoreboard, fleet
// status and commentary still tell the story.
const $ = (id) => document.getElementById(id);
const PLAYERS = ['gpt', 'claude'];
const SHIPS = {Carrier: 5, Battleship: 4, Cruiser: 3, Submarine: 3, Destroyer: 2};
const names = {gpt: 'GPT', claude: 'Claude'};
const settingsKey = 'battleship-settings';
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem(settingsKey)) || {}; } catch {}
let configuration = null;
let mode = 'loading';
let state = null;
let loopActive = false;
let timer = null;
let theater = null;
const scores = {gpt: 0, claude: 0};
const other = (team) => (team === 'gpt' ? 'claude' : 'gpt');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const speeds = [1, 2, 4];
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const team = (key) => `<span class="team-${key}">${escapeHtml(names[key])}</span>`;

function setStatus(title, detail = '') {
    $('game-status').textContent = title;
    $('status-detail').textContent = detail;
}

function setStatusHtml(html, detail = '') {
    $('game-status').innerHTML = html;
    $('status-detail').textContent = detail;
}

function savePreferences() {
    try { localStorage.setItem(settingsKey, JSON.stringify(preferences)); } catch {}
}

function setMode(next) {
    mode = next;
    const active = ['running', 'pausing'].includes(mode);
    const loading = ['loading', 'starting'].includes(mode);
    $('play-mode').disabled = active || loading || !configuration;
    for (const key of PLAYERS) $(key + '-model').disabled = active || loading || !configuration;
    $('btn-run').disabled = loading || (configuration ? !PLAYERS.every(key => $(key + '-model').value) : mode !== 'error');
    $('btn-run').querySelector('span').textContent = ({loading: 'Loading…', starting: 'Starting…', error: 'Try again'})[mode] || 'Start battle';
    $('btn-pause').classList.toggle('hidden', !active);
    $('btn-pause').disabled = mode === 'pausing';
    $('btn-pause').textContent = mode === 'pausing' ? 'Pausing…' : 'Pause';
    $('btn-resume').classList.toggle('hidden', !(state && ['paused', 'error'].includes(mode)));
    $('btn-resume').textContent = mode === 'error' ? 'Retry move' : 'Resume';
    $('btn-new').disabled = active || loading;
    $('session-title').textContent = ({loading: 'Loading', idle: 'Ready', starting: 'Starting', running: 'Live', pausing: 'Finishing turn', paused: 'Paused', error: 'Interrupted', complete: 'Game over'})[mode];
    $('session-indicator').className = 'status-dot ' + mode;
    document.body.classList.toggle('is-live', mode === 'running' || mode === 'pausing');
}

async function request(path, options = {}) {
    const response = await fetch('/api/' + path, options);
    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error('The server returned an unexpected response. Check that the app is running, then try again.');
    }
    if (!response.ok || data.success === false || data.error) throw new Error(data.error || 'The request could not be completed. Please try again.');
    return data;
}

function showError(error) {
    $('error-message').textContent = error.message || 'Connection lost. Check that the app is running, then try again.';
    $('error-message').classList.remove('hidden');
    setMode('error');
    setStatus('Match interrupted.', state ? 'Retry the move or start a new match.' : '');
}

// ---------------------------------------------------------------------------------------------------------
// The 3D theater and the screen around it
// ---------------------------------------------------------------------------------------------------------

async function loadTheater() {
    const element = $('theater');
    try {
        const {createTheater} = await import('/static/js/theater/index.js');
        theater = await createTheater(element);
        element.classList.add('has-3d');
        theater.setSpeed(speeds[preferences.speed || 0] || 1);
        theater.setMuted(Boolean(preferences.muted));
        applyCamera(preferences.camera || 'cinematic');
        // A drag on the battle hands the camera to the viewer.
        theater.onFrame = placeBoardTags;
        theater.onCameraModeChange = (camera) => {
            if (!document.body.classList.contains('is-match')) return;
            applyCamera(camera);
            showCameraHint();
        };
        updateSafeArea();
        showNames();
        if (!state?.started) await theater.setAttract(true);
        else await theater.syncState(state);
    } catch (error) {
        console.warn('3D theater unavailable:', error);
        theater = null;
        element.classList.add('no-3d');
    }
}

// Tell the camera which part of the screen the panels leave free, so the fleets are framed inside it.
function updateSafeArea() {
    if (!theater) return;
    const width = innerWidth, height = innerHeight;
    const hidden = document.body.classList.contains('hud-hidden');
    let insets = {top: 0, right: 0, bottom: 0, left: 0};
    if (document.body.classList.contains('is-menu')) {
        const menu = document.querySelector('.menu-card').getBoundingClientRect();
        if (width > 760) insets.left = Math.min(width * .55, menu.right + 8);
        else insets.bottom = height * .35;
    } else if (!hidden) {
        const board = document.querySelector('.scoreboard').getBoundingClientRect();
        const commentary = document.querySelector('.match-center').getBoundingClientRect();
        insets.top = board.bottom - 6;
        // Frame the fleets above the commentary, leaving room under the boards for their floating tags.
        insets.bottom = Math.min(Math.max(0, height - commentary.top) + (width > 760 ? 70 : 34), height * .4);
    }
    theater.setSafeArea(insets);
}

// The tags float on the water under each board: the theater says where that is on screen after every frame.
const TAG_REFERENCE = 62;   // pixels per grid square in the default tactical view
function placeBoardTags() {
    const inMatch = document.body.classList.contains('is-match');
    for (const key of PLAYERS) {
        const tag = $(key + '-panel');
        const anchor = inMatch && theater ? theater.boardAnchor(key) : null;
        if (!anchor) {
            tag.style.setProperty('--tag-opacity', '0');
            continue;
        }
        const scale = Math.min(1.2, Math.max(.72, anchor.unit / TAG_REFERENCE));
        // Fade out when the board is far off, filling the screen, or its edge leaves the view.
        const near = 1 - Math.min(1, Math.max(0, (anchor.unit - 180) / 160));
        const far = Math.min(1, Math.max(0, (anchor.unit - 14) / 14));
        const inside = Math.min(1, Math.max(0, (innerHeight - 30 - anchor.y) / 60)) * Math.min(1, Math.max(0, Math.min(anchor.x, innerWidth - anchor.x) / 80));
        const width = Math.min(620, Math.max(250, anchor.unit * 9.6 / scale), (innerWidth / 2 - 24) / scale);
        // Keep the whole tag on screen when the board's edge runs near the side of the window.
        const half = width * scale / 2 + 12;
        const x = Math.min(innerWidth - half, Math.max(half, anchor.x));
        tag.style.setProperty('--tag-x', x.toFixed(1) + 'px');
        tag.style.setProperty('--tag-y', (anchor.y + 6).toFixed(1) + 'px');
        tag.style.setProperty('--tag-scale', scale.toFixed(3));
        tag.style.setProperty('--tag-width', width.toFixed(0) + 'px');
        tag.style.setProperty('--tag-opacity', (near * far * inside).toFixed(3));
    }
}
addEventListener('resize', () => requestAnimationFrame(updateSafeArea));

function setScreen(screen) {
    document.body.classList.toggle('is-menu', screen === 'menu');
    document.body.classList.toggle('is-match', screen === 'match');
    document.querySelector('.skip-link').href = screen === 'menu' ? '#setup' : '#match-view';
    document.querySelector('.skip-link').textContent = screen === 'menu' ? 'Skip to setup' : 'Skip to match';
    $('setup').classList.toggle('hidden', screen !== 'menu');
    $('match-view').classList.toggle('hidden', screen !== 'match');
    requestAnimationFrame(updateSafeArea);
    showNames();
}

function applyCamera(camera) {
    preferences.camera = camera;
    savePreferences();
    $('theater').dataset.camera = camera;
    for (const button of document.querySelectorAll('.seg')) button.setAttribute('aria-checked', String(button.dataset.camera === camera));
    theater?.setCameraMode(camera);
}

let hintTimer = null;
function showCameraHint() {
    const hint = $('camera-hint');
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('show'), 4200);
}

function setPhase(text) {
    $('phase-text').textContent = text;
}

let bannerTimer = null;
function banner(kind, kicker, title) {
    const element = $('theater-banner');
    element.dataset.kind = kind;
    element.querySelector('.banner-kicker').textContent = kicker;
    element.querySelector('.banner-title').textContent = title;
    element.classList.remove('show');
    void element.offsetWidth;
    element.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => element.classList.remove('show'), kind === 'victory' ? 6200 : 2300);
}

// ---------------------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------------------

function clearThinking() {
    clearInterval(timer);
    timer = null;
    for (const model of PLAYERS) {
        $(model + '-thinking').classList.add('hidden');
        $(model + '-idle').classList.remove('hidden');
        $(model + '-panel').classList.remove('is-thinking');
    }
}

function showThinking(model, label) {
    clearThinking();
    $(model + '-thinking-label').textContent = label;
    $(model + '-thinking').classList.remove('hidden');
    $(model + '-idle').classList.add('hidden');
    $(model + '-panel').classList.add('is-thinking');
    $(model + '-timer').textContent = '0.0s';
    const start = performance.now();
    timer = setInterval(() => {
        $(model + '-timer').textContent = ((performance.now() - start) / 1000).toFixed(1) + 's';
    }, 100);
}

function renderPlayers(current) {
    for (const key of PLAYERS) {
        const player = current.players[key];
        // The model's name, or the side's name and "Simulated" when no model is connected.
        names[key] = player.name;
        $(key + '-name').textContent = player.name;
        $(key + '-name').title = player.name;
        const stats = player.stats;
        // The big number: enemy ships this side has sunk.
        if (scores[key] !== stats.sunk) {
            const score = $(key + '-score');
            score.textContent = stats.sunk;
            if (stats.sunk > scores[key]) {
                score.classList.remove('bump');
                void score.offsetWidth;
                score.classList.add('bump');
            }
            scores[key] = stats.sunk;
        }
        // Own fleet: the legend under the board, and pips on the scoreboard.
        const fleet = new Map(player.fleet.map(ship => [ship.name, ship]));
        let afloat = 0;
        for (const icon of $(key + '-fleet').children) {
            const ship = fleet.get(icon.dataset.ship);
            const hits = ship ? ship.hits.length : 0;
            icon.classList.toggle('sunk', Boolean(ship?.sunk));
            icon.classList.toggle('damaged', Boolean(ship && !ship.sunk && hits));
            icon.setAttribute('aria-label', `${icon.dataset.ship}: ${ship?.sunk ? 'sunk' : hits ? `${hits} of ${SHIPS[icon.dataset.ship]} hit` : 'afloat'}`);
            if (ship && !ship.sunk) afloat++;
        }
        for (const pip of $(key + '-pips').children) {
            const ship = fleet.get(pip.dataset.ship);
            const size = SHIPS[pip.dataset.ship];
            pip.classList.toggle('sunk', Boolean(ship?.sunk));
            pip.classList.toggle('damaged', Boolean(ship && !ship.sunk && ship.hits.length));
            pip.style.setProperty('--health', ship ? Math.round((1 - ship.hits.length / size) * 100) + '%' : '100%');
        }
        const deployed = player.fleet.length > 0;
        $(key + '-pips').setAttribute('aria-label', deployed ? `${afloat} of 5 ships afloat` : 'Fleet not deployed');
        $(key + '-reasoning').textContent = player.reasoning || 'No moves yet.';
        $(key + '-reasoning').title = player.reasoning || '';
        $(key + '-idle').textContent = current.game_over ? (current.winner === key ? 'Victorious' : 'Fleet destroyed')
            : current.phase === 'placement' ? (deployed ? 'Fleet deployed' : 'Preparing fleet')
            : current.current_player === key ? 'Up next' : `${afloat} ships afloat`;
    }
}

function renderScoreboard(current) {
    showNames();
    const crowned = current.game_over ? current.winner : null;
    for (const model of PLAYERS) document.querySelector('.' + model + '-side').classList.toggle('has-crown', crowned === model);
    $('turn-counter').textContent = current.phase === 'placement' ? 'Deploying' : current.game_over ? `${current.turn} shots` : 'Turn ' + (current.turn + 1);
}

function render(current) {
    state = current;
    renderPlayers(current);
    renderScoreboard(current);
    if (current.phase === 'placement') setPhase('Fleet deployment');
    else if (current.game_over) setPhase(`${names[current.winner]} wins`);
    else setPhase(current.mode === 'test' ? 'Live · simulated' : 'Live · API');
}

// ---------------------------------------------------------------------------------------------------------
// Celebration
// ---------------------------------------------------------------------------------------------------------

const confettiColors = ['#3d8bff', '#ff8552', '#f5c211', '#34c759', '#ffffff', '#ff453a'];
let confetti = [];
let confettiRunning = false;

function celebrate(current) {
    const winner = current.winner;
    if (!winner || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let canvas = $('confetti');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'confetti';
        canvas.className = 'confetti';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.append(canvas);
    }
    const avatar = document.querySelector('.' + winner + '-side .avatar').getBoundingClientRect();
    const bursts = [
        {x: avatar.left + avatar.width / 2, y: avatar.top + avatar.height / 2, angle: -Math.PI / 2, spread: 2.6, speed: [250, 750], count: 110},
        {x: 0, y: innerHeight, angle: Math.PI / 3, spread: .7, speed: [900, 1500], count: 110},
        {x: innerWidth, y: innerHeight, angle: Math.PI * 2 / 3, spread: .7, speed: [900, 1500], count: 110},
    ];
    for (const burst of bursts) {
        for (let i = 0; i < burst.count; i++) {
            const angle = burst.angle + (Math.random() - .5) * burst.spread;
            const speed = burst.speed[0] + Math.random() * (burst.speed[1] - burst.speed[0]);
            confetti.push({x: burst.x, y: burst.y, vx: Math.cos(angle) * speed, vy: -Math.sin(angle) * speed, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, rotation: Math.random() * Math.PI, spin: (Math.random() - .5) * 12, flutter: Math.random() * Math.PI * 2, color: confettiColors[Math.floor(Math.random() * confettiColors.length)], age: 0});
        }
    }
    if (!confettiRunning) {
        confettiRunning = true;
        requestAnimationFrame(time => drawConfetti(canvas, time, time));
    }
}

function drawConfetti(canvas, time, last) {
    const dt = Math.min((time - last) / 1000, .05);
    const ratio = devicePixelRatio || 1;
    if (canvas.width !== Math.round(innerWidth * ratio) || canvas.height !== Math.round(innerHeight * ratio)) {
        canvas.width = Math.round(innerWidth * ratio);
        canvas.height = Math.round(innerHeight * ratio);
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, innerWidth, innerHeight);
    confetti = confetti.filter(piece => piece.y < innerHeight + 30 && piece.age < 6);
    for (const piece of confetti) {
        const drag = Math.exp(-1.6 * dt);
        piece.vx *= drag;
        piece.vy = piece.vy * drag + 1100 * dt;
        piece.x += (piece.vx + Math.sin(piece.flutter) * 40) * dt;
        piece.y += piece.vy * dt;
        piece.rotation += piece.spin * dt;
        piece.flutter += 9 * dt;
        piece.age += dt;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.scale(1, Math.cos(piece.flutter));
        context.globalAlpha = Math.min(1, 6 - piece.age);
        context.fillStyle = piece.color;
        context.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
        context.restore();
    }
    if (confetti.length) requestAnimationFrame(next => drawConfetti(canvas, next, time));
    else confettiRunning = false;
}

// ---------------------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------------------

async function loadMatchHistory() {
    try {
        const archive = await request('match-history', {cache: 'no-store'});
        renderHistory(archive.games, archive.totals);
    } catch {
        renderHistory([]);
        $('history-empty').textContent = 'Match history is unavailable.';
    }
}

function gamePlayers(game) {
    return [game.gpt_name, game.claude_name].filter(Boolean).join(' vs ') || '—';
}

function gameResult(game) {
    return game.winner === 'gpt' ? (game.gpt_name || 'GPT') + ' won' : game.winner === 'claude' ? (game.claude_name || 'Claude') + ' won' : '—';
}

function renderHistory(games, totals = {gpt: 0, claude: 0}) {
    $('history-empty').classList.toggle('hidden', games.length > 0);
    $('history-table-wrap').classList.toggle('hidden', games.length === 0);
    $('history-count').textContent = games.length + (games.length === 1 ? ' battle' : ' battles');
    $('universal-games').textContent = games.length;
    for (const element of document.querySelectorAll('[data-match-total]')) element.textContent = totals[element.dataset.matchTotal] || 0;
    $('overall-score').setAttribute('aria-label', `All-time battles: GPT won ${totals.gpt || 0}, Claude won ${totals.claude || 0}`);
    const rows = [...games].reverse().map(game => {
        const row = document.createElement('li');
        row.className = 'universal-match';
        const badge = document.createElement('span');
        badge.className = 'match-badge';
        const pip = document.createElement('span');
        pip.className = 'pip';
        pip.dataset.result = game.winner;
        badge.appendChild(pip);
        badge.title = gameResult(game);
        const info = document.createElement('span');
        info.className = 'match-players';
        const players = document.createElement('b');
        players.textContent = gamePlayers(game);
        const when = document.createElement('small');
        when.textContent = [game.finished_at || '—', game.turns ? game.turns + ' shots' : ''].filter(Boolean).join(' · ');
        info.append(players, when);
        row.append(badge, info);
        return row;
    });
    $('universal-matches').replaceChildren(...rows);
    $('universal-matches').classList.toggle('hidden', rows.length === 0);
    $('stats-body').replaceChildren(...[...games].reverse().map(game => {
        const row = document.createElement('tr');
        const accuracy = (shots, hits) => shots ? Math.round(hits / shots * 100) + '%' : '—';
        const seconds = (value) => value == null ? '—' : Number(value).toFixed(1) + 's';
        for (const value of [game.finished_at || '—', gamePlayers(game), gameResult(game), `${game.gpt_shots ?? '—'} / ${game.claude_shots ?? '—'}`,
            `${accuracy(game.gpt_shots, game.gpt_hits)} / ${accuracy(game.claude_shots, game.claude_hits)}`, `${seconds(game.gpt_time)} / ${seconds(game.claude_time)}`]) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        }
        return row;
    }));
}

// ---------------------------------------------------------------------------------------------------------
// The game loop
// ---------------------------------------------------------------------------------------------------------

function thinkingPause(current) {
    // Simulated players answer instantly; a short pause lets the thinking state read.
    if (current.mode !== 'test') return Promise.resolve();
    const speed = theater ? theater.speed : 1;
    return sleep((450 + Math.random() * 650) / speed);
}

function announceResult(player, shot) {
    const enemy = other(player);
    if (shot.result === 'miss') {
        setStatusHtml(`${team(player)} fires at ${shot.target} · <span class="result-miss">Miss</span>`, state?.players[player].reasoning);
        banner('miss', shot.target, 'Miss');
    } else if (shot.result === 'hit') {
        setStatusHtml(`${team(player)} hits ${team(enemy)}'s <span class="result-hit">${escapeHtml(shot.ship)}</span> at ${shot.target}`, state?.players[player].reasoning);
        banner('hit', `${shot.target} · ${shot.ship}`, 'Direct hit');
    } else {
        setStatusHtml(`${team(player)} sinks ${team(enemy)}'s <span class="result-sunk">${escapeHtml(shot.ship)}</span>`, state?.players[player].reasoning);
        banner('sunk', `${names[enemy]}'s ${shot.ship}`, 'Sunk');
    }
}

async function finishGame(current, animate) {
    setMode('complete');
    const winner = current.winner;
    const stats = current.players[winner].stats;
    setStatusHtml(`${team(winner)} wins the battle`, `${stats.shots} shots, ${stats.hits} hits, ${Math.round(stats.hits / Math.max(1, stats.shots) * 100)}% accuracy.`);
    if (animate) {
        banner('victory', 'Enemy fleet destroyed', `${names[winner]} wins`);
        celebrate(current);
        await theater?.celebrate(winner);
    }
}

async function runGameLoop() {
    if (loopActive) return;
    loopActive = true;
    setMode('running');
    try {
        while (mode === 'running') {
            const current = await request('game-state');
            render(current);
            if (current.game_over) {
                await finishGame(current, false);
                break;
            }
            if (current.phase === 'placement') {
                const placer = [current.first_player, other(current.first_player)].find(key => !current.placement_done[key]);
                showThinking(placer, 'Deploying fleet');
                setStatusHtml(`${team(placer)} is deploying its fleet`);
                const [data] = await Promise.all([request('place-ships', {method: 'POST'}), thinkingPause(current)]);
                clearThinking();
                render(data.game_state);
                setStatusHtml(`${team(data.player)} deploys its fleet`, data.game_state.players[data.player].reasoning);
                banner('deploy', `${names[data.player]}`, 'Fleet deploying');
                if (theater) await theater.deploy(data.player, data.game_state.players[data.player].fleet);
                continue;
            }
            const shooter = current.current_player;
            showThinking(shooter, 'Thinking');
            setStatusHtml(`${team(shooter)} is thinking`);
            const [move] = await Promise.all([request('next-move', {method: 'POST'}), thinkingPause(current)]);
            clearThinking();
            setStatusHtml(`${team(move.player)} fires at ${move.shot.target}`);
            let landed = false;
            const land = () => {
                if (landed) return;
                landed = true;
                render(move.game_state);
                announceResult(move.player, move.shot);
            };
            if (theater) await theater.playShot({...move.shot, player: move.player}, {onImpact: land});
            land();
            if (move.game_state.game_over) {
                loadMatchHistory();
                await finishGame(move.game_state, true);
                break;
            }
            if (mode !== 'running') break;
            if (!theater) await sleep(move.game_state.mode === 'test' ? 450 : 900);
        }
    } catch (error) {
        showError(error);
    } finally {
        clearThinking();
        loopActive = false;
        if (mode === 'pausing') {
            setMode('paused');
            setStatus('Paused.', 'Resume when you are ready.');
        }
    }
}

// ---------------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------------

function renderMode(selected) {
    $('play-mode').value = selected;
    $('test-badge').classList.toggle('hidden', selected !== 'test');
    $('mode-description').textContent = ({test: 'Simulated moves, no LLM calls', api: 'Live models, keys in .env'})[selected];
}

function populateModels(selected, preferred = {}) {
    const saved = preferences.models?.[selected] || {};
    for (const key of PLAYERS) {
        const info = configuration.models[selected][key];
        const select = $(key + '-model');
        select.replaceChildren(...info.models.map(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            return option;
        }));
        const wanted = preferred[key] || saved[key + '_model'] || info.default;
        select.value = info.models.some(model => model.id === wanted) ? wanted : info.default;
    }
    showNames();
}

// The fleet banners on the water name the models: the ones playing, or before a match the ones picked in the menu.
function showNames() {
    if (!theater) return;
    const inMatch = document.body.classList.contains('is-match');
    theater.setNames(Object.fromEntries(PLAYERS.map(key => {
        const option = $(key + '-model').selectedOptions[0];
        return [key, inMatch || !option?.value ? names[key] : option.textContent];
    })));
}

function rememberSettings() {
    const selected = $('play-mode').value;
    preferences.mode = selected;
    preferences.models = preferences.models || {};
    preferences.models[selected] = {gpt_model: $('gpt-model').value, claude_model: $('claude-model').value};
    savePreferences();
}

function resetScores() {
    for (const key of PLAYERS) {
        scores[key] = 0;
        $(key + '-score').textContent = '0';
    }
}

async function startGames(event) {
    event?.preventDefault();
    if (loopActive || ['loading', 'starting'].includes(mode)) return;
    theater?.unlockAudio();
    $('error-message').classList.add('hidden');
    if (!configuration) {
        await restoreSession();
        return;
    }
    const settings = {mode: $('play-mode').value, gpt_model: $('gpt-model').value, claude_model: $('claude-model').value};
    setMode('starting');
    try {
        const data = await request('start-games', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(settings)});
        rememberSettings();
        theater?.reset();
        resetScores();
        render(data.game_state);
        setScreen('match');
        applyCamera(preferences.camera || 'cinematic');
        await runGameLoop();
    } catch (error) { showError(error); }
}

async function newMatch() {
    if (loopActive) return;
    $('btn-new').disabled = true;
    try {
        await request('reset', {method: 'POST'});
        state = null;
        clearThinking();
        $('error-message').classList.add('hidden');
        setScreen('menu');
        if (theater) {
            theater.reset();
            theater.setAttract(true);
        }
        if (configuration) populateModels($('play-mode').value);
        setMode('idle');
        loadMatchHistory();
        $('setup-title').focus({preventScroll: true});
    } catch (error) { showError(error); }
}

// A match still held by the server comes back paused after a reload.
async function restoreSession() {
    loadMatchHistory();
    setMode('loading');
    try {
        configuration = await request('config');
        const selected = configuration.models[preferences.mode] ? preferences.mode : configuration.default_mode;
        renderMode(selected);
        populateModels(selected);
        const saved = await request('game-state');
        if (saved.started) {
            renderMode(saved.mode);
            populateModels(saved.mode, {gpt: saved.players.gpt.model, claude: saved.players.claude.model});
            render(saved);
            setScreen('match');
            if (saved.game_over) await finishGame(saved, false);
            else {
                setMode('paused');
                setStatus('Match paused.', 'Resume to continue the battle.');
            }
        } else setMode('idle');
    } catch (error) { showError(error); }
}

// ---------------------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------------------

$('setup-form').addEventListener('submit', startGames);
$('btn-new').addEventListener('click', newMatch);
$('btn-resume').addEventListener('click', () => {
    if (loopActive) return;
    theater?.unlockAudio();
    $('error-message').classList.add('hidden');
    runGameLoop();
});
$('btn-pause').addEventListener('click', () => {
    if (mode !== 'running') return;
    setMode('pausing');
    setStatus('Pausing after this turn.');
});
for (const key of PLAYERS) $(key + '-model').addEventListener('change', showNames);
$('play-mode').addEventListener('change', () => {
    const selected = $('play-mode').value;
    renderMode(selected);
    populateModels(selected);
    setMode(mode);
});
for (const button of document.querySelectorAll('.seg')) button.addEventListener('click', () => applyCamera(button.dataset.camera));
$('btn-speed').addEventListener('click', () => {
    preferences.speed = ((preferences.speed || 0) + 1) % speeds.length;
    savePreferences();
    $('btn-speed').textContent = speeds[preferences.speed] + '×';
    theater?.setSpeed(speeds[preferences.speed]);
});
$('btn-speed').textContent = speeds[preferences.speed || 0] + '×';
function toggleSound() {
    preferences.muted = !preferences.muted;
    savePreferences();
    $('btn-sound').setAttribute('aria-pressed', String(!preferences.muted));
    theater?.unlockAudio();
    theater?.setMuted(preferences.muted);
}
$('btn-sound').addEventListener('click', toggleSound);
$('btn-sound').setAttribute('aria-pressed', String(!preferences.muted));
function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
}
$('btn-fullscreen').addEventListener('click', toggleFullscreen);
function toggleHud() {
    const hidden = !document.body.classList.contains('hud-hidden');
    document.body.classList.toggle('hud-hidden', hidden);
    $('btn-hud').setAttribute('aria-pressed', String(hidden));
    $('btn-hud').title = hidden ? 'Show the overlay (H)' : 'Hide the overlay (H)';
    updateSafeArea();
}
$('btn-hud').addEventListener('click', toggleHud);
const historyDialog = $('history-dialog');
for (const button of document.querySelectorAll('[data-open-history]')) button.addEventListener('click', () => {
    loadMatchHistory();
    historyDialog.showModal();
});
historyDialog.querySelector('.close-dialog').addEventListener('click', () => historyDialog.close());
historyDialog.addEventListener('click', (event) => { if (event.target === historyDialog) historyDialog.close(); });
document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, select, textarea') || event.metaKey || event.ctrlKey || event.altKey || historyDialog.open) return;
    const inMatch = document.body.classList.contains('is-match');
    if (event.key === 'm' || event.key === 'M') toggleSound();
    else if (event.key === 'f' || event.key === 'F') toggleFullscreen();
    else if ((event.key === 'h' || event.key === 'H') && inMatch) toggleHud();
    else if (['1', '2', '3'].includes(event.key) && inMatch) applyCamera(['cinematic', 'tactical', 'free'][Number(event.key) - 1]);
});
// The first click anywhere lets the preview make sound.
document.addEventListener('pointerdown', () => theater?.unlockAudio(), {once: true});

// Liquid Glass controls catch light where the pointer is.
document.addEventListener('pointermove', event => {
    const glass = event.target.closest?.('.button, select');
    if (!glass) return;
    const box = glass.getBoundingClientRect();
    glass.style.setProperty('--mx', `${event.clientX - box.left}px`);
    glass.style.setProperty('--my', `${event.clientY - box.top}px`);
}, {passive: true});

await restoreSession();
loadTheater();
