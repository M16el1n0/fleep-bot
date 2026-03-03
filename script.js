// ===== TELEGRAM WEBAPP =====
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#000000');
    tg.setBackgroundColor('#000000');
}
function getTgUser() {
    if (tg?.initDataUnsafe?.user) return tg.initDataUnsafe.user;
    return null;
}

// ===== БД в localStorage =====
const DB = {
    get: (key, def = null) => {
        try {
            const v = localStorage.getItem(key);
            return v ? JSON.parse(v) : def;
        } catch(e) { return def; }
    },
    set: (key, val) => {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
    }
};

// ===== ДЕФОЛТНЫЕ ДАННЫЕ =====
function getDefaultUserData() {
    return {
        balance: { silver: 1000, gold: 0 },
        registrationDate: new Date().toISOString(),
        lastVisit: new Date().toISOString(),
        lastDailyBonus: null,
        stats: { gamesPlayed: 0, gamesWon: 0, gamesLost: 0, totalWon: 0, maxCoefficient: 0 },
        gameHistory: [],
        rocketHistory: [],
        casesHistory: [],
        tasks: { 1: false, 2: false, 3: false, 4: false, 5: false },
        taskProgress: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        inventory: [],
        consecutiveWins: 0
    };
}

let userData = getDefaultUserData();

// ===== КОНФИГ ИГРЫ МИНЫ =====
const gameConfig = { size: 3, mines: 1 };

let gameState = {
    isPlaying: false,
    currentBet: 100,
    betType: 'silver',
    currentCoefficient: 1.0,
    totalCells: 9,
    revealedCells: 0,
    minesLeft: 1,
    gameBoard: [],
    minesPositions: [],
    canCashOut: false
};

// ===== КОНФИГ РАКЕТКИ =====
let rocketGameState = {
    isPlaying: false,
    isRoundActive: false,
    currentCoefficient: 1.0,
    currentBet: 100,
    betType: 'silver',
    rocketPosition: 0,
    roundCountdown: 5,
    startTime: 0,
    crashPoint: 1.1
};

let currentNewGift = null;

// ===== СИСТЕМА ПОДАРКОВ =====
const GIFT_SYSTEM = {
    gifts: [
        { type: 'bear',       name: 'Плюшевый медведь', minValue: 15,  maxValue: 50  },
        { type: 'heart',      name: 'Сердце',           minValue: 20,  maxValue: 80  },
        { type: 'rose',       name: 'Роза',             minValue: 30,  maxValue: 100 },
        { type: 'gift',       name: 'Подарок',          minValue: 50,  maxValue: 200 },
        { type: 'cake',       name: 'Торт',             minValue: 75,  maxValue: 300 },
        { type: 'champagne',  name: 'Шампанское',       minValue: 100, maxValue: 500 },
        { type: 'bouquet',    name: 'Букет',            minValue: 150, maxValue: 700 },
        { type: 'cup',        name: 'Кубок',            minValue: 200, maxValue: 1000},
        { type: 'ring',       name: 'Кольцо',           minValue: 500, maxValue: 2000},
        { type: 'diamond',    name: 'Алмаз',            minValue: 1000,maxValue: 5000},
        { type: 'crown',      name: 'Корона',           minValue: 2000,maxValue: 9999}
    ],
    getRandomGift(winAmount) {
        const eligible = this.gifts.filter(g => winAmount >= g.minValue);
        if (!eligible.length) return null;
        return eligible[Math.floor(Math.random() * eligible.length)];
    }
};

// ===== ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', function() {
    loadUserData();
    setupEventListeners();
    showSection('game');
    updateDailyBonusButton();
    updateRocketUI();
    updateRocketPrevRounds();
    startRocketCountdown();
    updateHeaderUsername();
    simulateOnlineCounts();
});

function updateHeaderUsername() {
    const tgUser = getTgUser();
    const el = document.getElementById('header-username');
    if (!el) return;
    if (tgUser) {
        el.textContent = (tgUser.username ? tgUser.username.toUpperCase() : tgUser.first_name.toUpperCase());
    } else {
        el.textContent = 'PLAYER';
    }
}

function simulateOnlineCounts() {
    const counts = {
        'online-rocket': [25, 45],
        'online-mines': [18, 38],
        'online-roulette': [40, 70],
        'online-cases': [10, 25]
    };
    function update() {
        for (const [id, [min, max]] of Object.entries(counts)) {
            const el = document.getElementById(id);
            if (el) {
                const n = Math.floor(Math.random() * (max - min + 1)) + min;
                el.textContent = n + ' ОНЛАЙН';
            }
        }
    }
    update();
    setInterval(update, 8000);
}

function loadUserData() {
    const saved = DB.get('userData');
    if (saved) userData = Object.assign(getDefaultUserData(), saved);
    userData.lastVisit = new Date().toISOString();
    saveUserData();
    updateBalance();
    updateStats();
    updateTasks();
    updateProfileInfo();
    updateGameHistory();
    updateCasesHistory();
}

function saveUserData() { DB.set('userData', userData); }

// ===== ОБРАБОТЧИКИ СОБЫТИЙ =====
function setupEventListeners() {
    // Новые кнопки размера поля
    document.querySelectorAll('.mines-toggle').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.mines-toggle').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            gameConfig.size = parseInt(this.dataset.size);
            updateCoefficients();
        });
    });
    // Старые кнопки (совместимость)
    document.querySelectorAll('.size-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            gameConfig.size = parseInt(this.dataset.size);
            updateCoefficients();
        });
    });
    document.querySelectorAll('.mine-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.mine-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            gameConfig.mines = parseInt(this.dataset.mines);
            updateCoefficients();
        });
    });
}

// ===== НАВИГАЦИЯ =====
function showSection(section) {
    const el = document.getElementById('welcome');
    if (el) el.style.display = 'none';
    ['game-section','profile-section','tasks-section','inventory-section'].forEach(id => {
        const s = document.getElementById(id);
        if (s) s.classList.remove('active-section');
    });
    document.querySelectorAll('.nav-button').forEach(b => b.classList.remove('active-btn'));

    // Восстановить нижнюю навигацию и скрыть кнопку назад
    const nav = document.querySelector('.navigation');
    if (nav) nav.style.bottom = '';
    const backBtn = document.getElementById('global-back-btn');
    if (backBtn) backBtn.style.display = 'none';

    if (section === 'game') {
        document.getElementById('game-section').classList.add('active-section');
        const n = document.getElementById('nav-game'); if(n) n.classList.add('active-btn');
    } else if (section === 'profile') {
        document.getElementById('profile-section').classList.add('active-section');
        const n = document.getElementById('nav-profile'); if(n) n.classList.add('active-btn');
        updateStats();
        updateProfileInfo();
    } else if (section === 'tasks') {
        document.getElementById('tasks-section').classList.add('active-section');
        const n = document.getElementById('nav-tasks'); if(n) n.classList.add('active-btn');
    } else if (section === 'inventory') {
        document.getElementById('inventory-section').classList.add('active-section');
        const n = document.getElementById('nav-inventory'); if(n) n.classList.add('active-btn');
        setTimeout(updateInventory, 30);
    } else if (section === 'rating') {
        // Rating section placeholder
        const n = document.getElementById('nav-rating'); if(n) n.classList.add('active-btn');
    }
}

function selectGame(game) {
    const list = document.querySelector('.game-cards-list');
    const title = document.querySelector('.game-section-title');
    if (list) list.style.display = 'none';
    if (title) title.style.display = 'none';
    document.querySelectorAll('.game-container').forEach(el => el.style.display = 'none');
    const target = document.getElementById(game + '-game');
    if (target) target.style.display = 'block';
    // Скрыть нижнюю навигацию, показать кнопку "назад"
    const nav = document.querySelector('.navigation');
    if (nav) nav.style.bottom = '-120px';
    const backBtn = document.getElementById('global-back-btn');
    if (backBtn) backBtn.style.display = 'flex';
}

function backToGamesList() {
    document.querySelectorAll('.game-container').forEach(el => el.style.display = 'none');
    const list = document.querySelector('.game-cards-list');
    const title = document.querySelector('.game-section-title');
    if (list) list.style.display = 'flex';
    if (title) title.style.display = 'block';
    // Вернуть нижнюю навигацию, скрыть кнопку "назад"
    const nav = document.querySelector('.navigation');
    if (nav) nav.style.bottom = '';
    const backBtn = document.getElementById('global-back-btn');
    if (backBtn) backBtn.style.display = 'none';
}

// ===== БЕЗОПАСНЫЕ ХЕЛПЕРЫ =====
function $id(id) { return document.getElementById(id); }
function setText(id, val) { const el = $id(id); if (el) el.textContent = val; }
function setHTML(id, html) { const el = $id(id); if (el) el.innerHTML = html; }

// ===== БАЛАНС =====
function updateBalance() {
    const gold = userData.balance.gold;
    const silver = userData.balance.silver;
    setText('header-gold-flip', gold);
    setText('header-silver-flip', silver);
    setHTML('game-balance',    `${silver} <span class="coin-symbol silver">F</span>`);
    setHTML('current-balance', `${silver} <span class="coin-symbol silver">F</span>`);
    setHTML('user-balance',    `${silver} <span class="coin-symbol silver">F</span>`);
    setText('user-gold-flip',  gold);
    setText('user-silver-flip',silver);
    setHTML('rocket-balance',  `${silver} <span class="coin-symbol silver">F</span>`);
    // Новый дизайн мины
    setText('game-balance-val', silver);
    checkBetValidity();
}

// ===== СТАВКИ МИНЫ =====
function checkBetValidity() {
    const bet = gameState.currentBet;
    const balance = userData.balance[gameState.betType];
    const warning = $id('balance-warning');
    const playBtn = $id('play-btn');
    if (!warning || !playBtn) return;
    if (bet > balance) {
        warning.style.display = 'flex';
        playBtn.disabled = true;
        playBtn.style.opacity = '0.5';
    } else {
        warning.style.display = 'none';
        playBtn.disabled = false;
        playBtn.style.opacity = '1';
    }
}

function updateBetDisplay() {
    setText('current-bet', gameState.currentBet);
    const win = Math.floor(gameState.currentBet * gameState.currentCoefficient);
    setText('potential-win', win);
    // Новый дизайн
    const inp = document.getElementById('mines-bet-input');
    if (inp) inp.value = gameState.currentBet;
    setText('potential-win-new', win + ' F');
    checkBetValidity();
}

function changeBet(amount) {
    gameState.currentBet = Math.max(10, gameState.currentBet + amount);
    updateBetDisplay();
}

function setBet(amount) {
    gameState.currentBet = Math.max(10, amount);
    updateBetDisplay();
}

// Новые функции управления для нового дизайна
function minesBetInputChange(val) {
    gameState.currentBet = Math.max(10, parseInt(val) || 10);
    updateBetDisplay();
}

function minesSetMax() {
    gameState.currentBet = userData.balance[gameState.betType];
    updateBetDisplay();
}

function mineCountChange(delta) {
    const maxMines = Math.max(1, gameConfig.size * gameConfig.size - 1);
    gameConfig.mines = Math.max(1, Math.min(maxMines, gameConfig.mines + delta));
    setText('mines-count-display', gameConfig.mines);
    updateCoefficients();
}

function updateCoefficients() {
    const sizeCoef  = { 3: 1.2, 5: 1.5 };
    const minesCoef = { 1: 1.5, 2: 2.0, 3: 2.5, 5: 3.5 };
    const sc = sizeCoef[gameConfig.size]   || 1.5;
    const mc = minesCoef[gameConfig.mines] || 2.0;
    gameState.currentCoefficient = sc * mc;
    setText('size-coef',  sc + 'x');
    setText('mine-coef',  mc + 'x');
    setText('total-coef', gameState.currentCoefficient.toFixed(1) + 'x');
    setText('mines-count-display', gameConfig.mines);
    updateBetDisplay();
}

// ===== ИГРА МИНЫ =====
function startGame() {
    const bet = gameState.currentBet;
    if (bet > userData.balance[gameState.betType]) {
        alert('Недостаточно средств!'); return;
    }
    if (gameConfig.mines >= gameConfig.size * gameConfig.size) {
        alert('Слишком много мин!'); return;
    }
    userData.balance[gameState.betType] -= bet;
    saveUserData();
    updateBalance();

    gameState.isPlaying = true;
    gameState.currentCoefficient = gameState.currentCoefficient || 3.0;
    gameState.totalCells = gameConfig.size * gameConfig.size;
    gameState.revealedCells = 0;
    gameState.minesLeft = gameConfig.mines;
    gameState.gameBoard = [];
    gameState.minesPositions = [];
    gameState.canCashOut = false;

    createGameBoard();
    placeMines();

    const board = $id('game-board');
    const settings = document.querySelector('.mines-settings-new') || document.querySelector('.game-settings');
    if (board) board.classList.remove('hidden');
    if (settings) settings.style.display = 'none';

    updateGameInterface();
    const cb = $id('cashout-btn'); if (cb) cb.disabled = true;
}

function createGameBoard() {
    const grid = $id('mines-grid');
    if (!grid) return;
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${gameConfig.size}, 1fr)`;
    // Адаптируем размер эмодзи под размер поля
    const fontSize = gameConfig.size <= 3 ? '2rem' : '1.5rem';
    grid.style.fontSize = fontSize;
    gameState.gameBoard = [];
    for (let i = 0; i < gameState.totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.index = i;
        cell.textContent = '👑';
        cell.addEventListener('click', () => revealCell(i));
        grid.appendChild(cell);
        gameState.gameBoard.push({ isMine: false, isRevealed: false, element: cell });
    }
}

function placeMines() {
    const positions = new Set();
    while (positions.size < gameConfig.mines) {
        const pos = Math.floor(Math.random() * gameState.totalCells);
        positions.add(pos);
    }
    positions.forEach(pos => {
        gameState.gameBoard[pos].isMine = true;
        gameState.minesPositions.push(pos);
    });
}

function revealCell(index) {
    if (!gameState.isPlaying || gameState.gameBoard[index].isRevealed) return;
    const cell = gameState.gameBoard[index];
    cell.isRevealed = true;
    cell.element.classList.add('revealed');

    if (cell.isMine) {
        cell.element.classList.add('mine');
        cell.element.textContent = '💥';
        endGameLose();
    } else {
        cell.element.classList.add('safe');
        cell.element.textContent = '💎';
        gameState.revealedCells++;
        gameState.canCashOut = true;
        const cb = $id('cashout-btn');
        if (cb) cb.disabled = false;
        updateGameInterface();

        const safeCells = gameState.totalCells - gameConfig.mines;
        if (gameState.revealedCells >= safeCells) endGameWin();
    }
}

function updateGameInterface() {
    setText('current-coef', gameState.currentCoefficient.toFixed(2) + 'x');
    const win = Math.floor(gameState.currentBet * gameState.currentCoefficient);
    setText('current-win', win);
    setText('mines-left', gameState.minesLeft);
}

function cashOut() {
    if (!gameState.isPlaying || !gameState.canCashOut) return;
    const win = Math.floor(gameState.currentBet * gameState.currentCoefficient);
    userData.balance[gameState.betType] += win;
    userData.stats.gamesPlayed++;
    userData.stats.gamesWon++;
    userData.stats.totalWon += win;
    userData.consecutiveWins = (userData.consecutiveWins || 0) + 1;
    if (gameState.currentCoefficient > userData.stats.maxCoefficient)
        userData.stats.maxCoefficient = gameState.currentCoefficient;
    saveUserData();
    updateBalance();
    updateStats();
    addToGameHistory(true, gameState.currentBet, win, gameState.currentCoefficient);
    updateTasks();
    gameState.isPlaying = false;
    revealAllMines();
    if (win >= 15) {
        const gift = GIFT_SYSTEM.getRandomGift(win);
        if (gift) setTimeout(() => showGiftChoiceModal(gift, win), 800);
    }
    setTimeout(newGame, 1500);
}

function endGameLose() {
    gameState.isPlaying = false;
    userData.stats.gamesPlayed++;
    userData.stats.gamesLost++;
    userData.consecutiveWins = 0;
    saveUserData();
    updateStats();
    addToGameHistory(false, gameState.currentBet, 0, gameState.currentCoefficient);
    updateTasks();
    revealAllMines();
    setTimeout(newGame, 1500);
}

function endGameWin() {
    const win = Math.floor(gameState.currentBet * gameState.currentCoefficient);
    userData.balance[gameState.betType] += win;
    userData.stats.gamesPlayed++;
    userData.stats.gamesWon++;
    userData.stats.totalWon += win;
    userData.consecutiveWins = (userData.consecutiveWins || 0) + 1;
    if (gameState.currentCoefficient > userData.stats.maxCoefficient)
        userData.stats.maxCoefficient = gameState.currentCoefficient;
    saveUserData();
    updateBalance();
    updateStats();
    addToGameHistory(true, gameState.currentBet, win, gameState.currentCoefficient);
    updateTasks();
    gameState.isPlaying = false;
    if (win >= 15) {
        const gift = GIFT_SYSTEM.getRandomGift(win);
        if (gift) setTimeout(() => showGiftChoiceModal(gift, win), 800);
    }
    setTimeout(newGame, 1500);
}

function revealAllMines() {
    gameState.minesPositions.forEach(pos => {
        const cell = gameState.gameBoard[pos];
        if (cell && !cell.isRevealed) {
            cell.element.classList.add('revealed','mine');
            cell.element.textContent = '💥';
        }
    });
}

function newGame() {
    gameState.isPlaying = false;
    const board = $id('game-board');
    const settings = document.querySelector('.mines-settings-new') || document.querySelector('.game-settings');
    if (board) board.classList.add('hidden');
    if (settings) settings.style.display = 'flex';
    updateBetDisplay();
    updateBalance();
}

function endGame() { newGame(); }

function addToGameHistory(isWin, bet, win, coef) {
    userData.gameHistory.unshift({
        timestamp: new Date().toISOString(), bet, win,
        coefficient: coef, isWin
    });
    if (userData.gameHistory.length > 20)
        userData.gameHistory = userData.gameHistory.slice(0, 20);
    saveUserData();
    updateGameHistory();
}

function updateGameHistory() {
    const list = $id('history-list');
    if (!list) return;
    list.innerHTML = '';
    (userData.gameHistory || []).slice(0, 10).forEach(game => {
        const d = new Date(game.timestamp);
        const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const item = document.createElement('div');
        item.className = `history-item ${game.isWin ? 'win' : 'lose'}`;
        item.innerHTML = `<span>${time}</span><span>Ставка: ${game.bet}F</span><span>${game.isWin ? '+'+game.win : '-'+game.bet}F</span><span>${game.coefficient.toFixed(2)}x</span>`;
        list.appendChild(item);
    });
}

// ===== РАКЕТКА =====
function updateRocketUI() {
    setText('rocket-current-bet', rocketGameState.currentBet);
    const bd = $id('rocket-bet-display');
    if (bd) bd.innerHTML = `${rocketGameState.currentBet} <span style="font-size:0.85rem;color:#777;font-weight:400;">F</span>`;
    checkRocketBetValidity();
    updateRocketHistory();
}

function checkRocketBetValidity() {
    const bet = rocketGameState.currentBet;
    const balance = userData.balance[rocketGameState.betType];
    const w1 = $id('rocket-balance-warning');
    const w2 = $id('rocket-balance-warning2');
    const tooLow = bet > balance;
    if (w1) w1.style.display = tooLow ? 'block' : 'none';
    if (w2) w2.style.display = tooLow ? 'block' : 'none';
}

function changeRocketBet(amount) {
    rocketGameState.currentBet = Math.max(10, rocketGameState.currentBet + amount);
    updateRocketUI();
}

function setRocketBet(amount) {
    rocketGameState.currentBet = Math.max(10, amount);
    updateRocketUI();
}

function openRocketBetSheet() {
    if (rocketGameState.isRoundActive) return; // нельзя ставить во время раунда
    const sheet = $id('rocket-bet-sheet');
    if (sheet) sheet.style.display = 'block';
    updateRocketUI();
}

function closeRocketBetSheet(e) {
    const sheet = $id('rocket-bet-sheet');
    if (sheet && (!e || e.target === sheet)) sheet.style.display = 'none';
}

function confirmRocketBet() {
    closeRocketBetSheet();
    startRocketGame();
}

function generateCrashPoint() {
    const r = Math.random();
    if (r < 0.3)  return 1.1 + Math.random() * 0.4;
    if (r < 0.6)  return 1.5 + Math.random() * 0.5;
    if (r < 0.8)  return 2.0 + Math.random() * 3.0;
    if (r < 0.9)  return 5.0 + Math.random() * 2.0;
    if (r < 0.97) return 7.0 + Math.random() * 3.0;
    return 10.0 + Math.random() * 40.0;
}

function startRocketGame() {
    if (rocketGameState.isRoundActive) return;
    if (rocketGameState.currentBet > userData.balance[rocketGameState.betType]) {
        alert('Недостаточно средств!'); return;
    }
    userData.balance[rocketGameState.betType] -= rocketGameState.currentBet;
    saveUserData();
    updateBalance();

    rocketGameState.isPlaying = true;
    rocketGameState.isRoundActive = true;
    rocketGameState.currentCoefficient = 1.0;
    rocketGameState.startTime = Date.now();
    rocketGameState.crashPoint = generateCrashPoint();

    // Кнопка → "Забрать"
    const playBtn = $id('rocket-play-btn');
    const cashBtn = $id('rocket-cashout-btn');
    if (playBtn) playBtn.style.display = 'none';
    if (cashBtn) {
        cashBtn.style.display = 'block';
        cashBtn.textContent = `ЗАБРАТЬ ×${rocketGameState.currentCoefficient.toFixed(2)}`;
    }

    animateRocket();

    const crashTime = Math.pow((rocketGameState.crashPoint - 1.0), 2) * 36 * 1000;
    setTimeout(() => {
        if (rocketGameState.isRoundActive) endRocketGame(false, rocketGameState.currentCoefficient);
    }, Math.max(crashTime, 500));
}

function animateRocket() {
    const rocketEl = $id('rocket-emoji');
    const fireEl   = $id('rocket-fire');
    const cvs      = $id('rocket-canvas');
    const ctx      = cvs ? cvs.getContext('2d') : null;

    if (!rocketEl || !cvs) return;
    rocketEl.style.display = 'block';
    rocketEl.style.opacity = '1';
    if (fireEl) { fireEl.style.display = 'block'; fireEl.style.opacity = '0.9'; }

    cvs.width  = cvs.offsetWidth  || 400;
    cvs.height = cvs.offsetHeight || 260;
    const W = cvs.width;
    const H = cvs.height;

    // Ракета на левой трети, по центру высоты
    const rocketX = W * 0.33;
    const rocketBaseY = H * 0.52;

    const chartSpeed = W * 0.035; // px/sec — скорость скролла
    const chartPoints = []; // {vx, vy} — виртуальные координаты

    // Параметры «живого» кривого графика
    // vx = время * speed, vy = набегаемая высота (в px от rocketBaseY вверх), случайно колышется
    let chartNoiseY = 0;
    let chartNoiseVel = 0;
    let lastElapsed = 0;

    function getScreenX(vx, curVX) { return rocketX + (vx - curVX); }
    function getScreenY(vy)        { return rocketBaseY - vy; }

    function drawGrid() {
        // Вертикальные линии сетки
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        const gridStep = W / 6;
        for (let x = 0; x < W; x += gridStep) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        // Горизонтальные
        const hStep = H / 5;
        for (let y = 0; y < H; y += hStep) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
    }

    function animate() {
        if (!rocketGameState.isRoundActive) return;
        const elapsed = (Date.now() - rocketGameState.startTime) / 1000;
        const dt = elapsed - lastElapsed;
        lastElapsed = elapsed;

        // Коэффициент — только растёт, экспоненциально
        rocketGameState.currentCoefficient = Math.pow(1.06, elapsed);

        if (rocketGameState.currentCoefficient > rocketGameState.crashPoint)
            rocketGameState.currentCoefficient = rocketGameState.crashPoint;

        setText('rocket-coefficient', '×' + rocketGameState.currentCoefficient.toFixed(2));

        // Обновляем кнопку "Забрать"
        const cashBtn = $id('rocket-cashout-btn');
        if (cashBtn) cashBtn.textContent = `ЗАБРАТЬ ×${rocketGameState.currentCoefficient.toFixed(2)}`;

        // «Живое» вертикальное отклонение графика — случайное Броуново движение
        chartNoiseVel += (Math.random() - 0.5) * 18 * dt;
        chartNoiseVel *= 0.88; // затухание
        chartNoiseY += chartNoiseVel;
        chartNoiseY = Math.max(-30, Math.min(30, chartNoiseY));

        // Базовый рост: постепенно идёт наверх
        const baseRiseY = elapsed * 22; // 22px/sec подъём
        const currentVX = elapsed * chartSpeed;
        const currentVY = baseRiseY + chartNoiseY;

        chartPoints.push({ vx: currentVX, vy: currentVY });
        // Удаляем точки за левым краем
        while (chartPoints.length > 2 && getScreenX(chartPoints[0].vx, currentVX) < -60) chartPoints.shift();

        if (ctx) {
            ctx.clearRect(0, 0, W, H);

            // Фон
            ctx.fillStyle = '#080814';
            ctx.fillRect(0, 0, W, H);

            // Сетка
            drawGrid();

            // График
            if (chartPoints.length > 2) {
                // Линия
                ctx.beginPath();
                ctx.moveTo(getScreenX(chartPoints[0].vx, currentVX), getScreenY(chartPoints[0].vy));
                for (let i = 1; i < chartPoints.length; i++) {
                    // Плавная кривая через точки
                    const px = getScreenX(chartPoints[i].vx, currentVX);
                    const py = getScreenY(chartPoints[i].vy);
                    ctx.lineTo(px, py);
                }
                ctx.strokeStyle = 'rgba(138,90,255,0.95)';
                ctx.lineWidth = 3.5;
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                ctx.stroke();

                // Заливка под линией
                ctx.beginPath();
                ctx.moveTo(getScreenX(chartPoints[0].vx, currentVX), getScreenY(chartPoints[0].vy));
                for (let i = 1; i < chartPoints.length; i++) {
                    ctx.lineTo(getScreenX(chartPoints[i].vx, currentVX), getScreenY(chartPoints[i].vy));
                }
                const lastP = chartPoints[chartPoints.length - 1];
                const lastSX = getScreenX(lastP.vx, currentVX);
                ctx.lineTo(lastSX, H + 10);
                ctx.lineTo(getScreenX(chartPoints[0].vx, currentVX), H + 10);
                ctx.closePath();
                const grad = ctx.createLinearGradient(0, 0, 0, H);
                grad.addColorStop(0, 'rgba(138,90,255,0.30)');
                grad.addColorStop(1, 'rgba(138,90,255,0.02)');
                ctx.fillStyle = grad;
                ctx.fill();
            }

            // Свечение под ракетой
            const grd = ctx.createRadialGradient(rocketX, rocketBaseY, 4, rocketX, rocketBaseY, 60);
            grd.addColorStop(0, 'rgba(138,43,226,0.18)');
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grd;
            ctx.beginPath(); ctx.arc(rocketX, rocketBaseY, 60, 0, Math.PI*2); ctx.fill();
        }

        // Покачивание ракеты
        const wobbleX = Math.sin(elapsed * 0.7) * 5 + Math.sin(elapsed * 1.2) * 2;
        const wobbleY = Math.cos(elapsed * 0.6) * 4 + Math.cos(elapsed * 1.4) * 1.5;
        const wobbleAngle = Math.sin(elapsed * 0.8) * 5;
        const rx = rocketX + wobbleX;
        const ry = rocketBaseY + wobbleY;

        rocketEl.style.left = rx + 'px';
        rocketEl.style.top  = ry + 'px';
        rocketEl.style.transform = `translate(-50%,-50%) rotate(${-45 + wobbleAngle}deg)`;

        if (fireEl) {
            const ang = -45 + wobbleAngle;
            const rad = (ang + 135) * Math.PI / 180;
            const fo = 28;
            fireEl.style.left = (rx + Math.cos(rad)*fo) + 'px';
            fireEl.style.top  = (ry + Math.sin(rad)*fo) + 'px';
            fireEl.style.transform = `translate(-50%,-50%) rotate(${ang+135}deg)`;
            const fs = 0.85 + Math.sin(elapsed*4)*0.15;
            fireEl.style.fontSize = (40*fs) + 'px';
        }

        // Сохраняем для краша
        rocketGameState._chartPoints  = chartPoints;
        rocketGameState._chartVX      = currentVX;
        rocketGameState._rocketX      = rocketX;
        rocketGameState._rocketBaseY  = rocketBaseY;
        rocketGameState._W = W; rocketGameState._H = H;

        requestAnimationFrame(animate);
    }
    animate();
}

function cashOutRocket() {
    if (rocketGameState.isPlaying && rocketGameState.isRoundActive)
        endRocketGame(true, rocketGameState.currentCoefficient);
}

function endRocketGame(isWin, multiplier) {
    rocketGameState.isRoundActive = false;
    rocketGameState.isPlaying = false;

    const winAmount = isWin ? Math.floor(rocketGameState.currentBet * multiplier) : 0;
    const result = { timestamp: new Date().toISOString(), bet: rocketGameState.currentBet,
                     win: winAmount, coefficient: multiplier, isWin };
    userData.rocketHistory.unshift(result);
    if (userData.rocketHistory.length > 20) userData.rocketHistory = userData.rocketHistory.slice(0,20);

    if (isWin) {
        userData.balance[rocketGameState.betType] += winAmount;
        userData.stats.totalWon += winAmount;
        if (winAmount >= 15) {
            const gift = GIFT_SYSTEM.getRandomGift(winAmount);
            if (gift) setTimeout(() => showGiftChoiceModal(gift, winAmount), 1000);
        }
    }
    saveUserData();
    updateBalance();
    updateStats();
    updateRocketHistory();
    updateRocketPrevRounds();

    // Восстановить кнопки
    const playBtn = $id('rocket-play-btn');
    const cashBtn = $id('rocket-cashout-btn');
    if (cashBtn) cashBtn.style.display = 'none';
    if (playBtn) {
        playBtn.style.display = 'block';
        playBtn.disabled = true;
        playBtn.style.opacity = '0.5';
    }

    startRocketCountdown();

    // Анимация краша
    const rocketEl = $id('rocket-emoji');
    const fireEl   = $id('rocket-fire');
    const cvs      = $id('rocket-canvas');
    const ctx      = cvs ? cvs.getContext('2d') : null;

    if (!isWin && rocketEl) {
        if (fireEl) fireEl.style.display = 'none'; // топливо кончилось

        const crashPoints = rocketGameState._chartPoints ? [...rocketGameState._chartPoints] : [];
        const crashVX    = rocketGameState._chartVX || 0;
        const rocketX    = rocketGameState._rocketX || 140;
        const rocketBaseY= rocketGameState._rocketBaseY || 130;
        const W = rocketGameState._W || 400;
        const H = rocketGameState._H || 260;

        let spin = -45, vy = 0;
        let rx = parseFloat(rocketEl.style.left) || rocketX;
        let ry = parseFloat(rocketEl.style.top)  || rocketBaseY;
        const crashStart = Date.now();

        function fall() {
            const ft = (Date.now() - crashStart) / 1000;
            const prog = Math.min(ft / 1.4, 1);
            vy += 2.8; ry += vy * 0.5; rx += 1.2; spin += 15;
            const op = Math.max(0, 1 - prog * 1.5);
            rocketEl.style.top   = ry + 'px';
            rocketEl.style.left  = rx + 'px';
            rocketEl.style.transform = `translate(-50%,-50%) rotate(${spin}deg)`;
            rocketEl.style.opacity = op;

            if (ctx) {
                ctx.clearRect(0, 0, W, H);
                ctx.fillStyle = '#080814'; ctx.fillRect(0,0,W,H);
                // Сетка
                ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
                for (let x=0; x<W; x+=W/6){ ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke(); }
                for (let y=0; y<H; y+=H/5){ ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke(); }

                const dropY = prog * H * 0.55;
                if (crashPoints.length > 2) {
                    ctx.beginPath();
                    ctx.moveTo(rocketX+(crashPoints[0].vx-crashVX), rocketBaseY-crashPoints[0].vy+dropY);
                    for (let i=1; i<crashPoints.length; i++) {
                        ctx.lineTo(rocketX+(crashPoints[i].vx-crashVX), rocketBaseY-crashPoints[i].vy+dropY);
                    }
                    ctx.strokeStyle = `rgba(255,60,60,${0.9*op+0.1})`;
                    ctx.lineWidth = 3.5; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();

                    // Заливка
                    ctx.beginPath();
                    ctx.moveTo(rocketX+(crashPoints[0].vx-crashVX), rocketBaseY-crashPoints[0].vy+dropY);
                    for (let i=1;i<crashPoints.length;i++) ctx.lineTo(rocketX+(crashPoints[i].vx-crashVX),rocketBaseY-crashPoints[i].vy+dropY);
                    const lp=crashPoints[crashPoints.length-1];
                    ctx.lineTo(rocketX+(lp.vx-crashVX), H+10);
                    ctx.lineTo(rocketX+(crashPoints[0].vx-crashVX), H+10);
                    ctx.closePath();
                    const g=ctx.createLinearGradient(0,0,0,H);
                    g.addColorStop(0,`rgba(255,60,60,${0.25*op})`);
                    g.addColorStop(1,'rgba(255,60,60,0)');
                    ctx.fillStyle=g; ctx.fill();
                }
            }

            if (prog < 1) requestAnimationFrame(fall);
            else resetRocketEmoji();
        }
        requestAnimationFrame(fall);
    } else {
        setTimeout(resetRocketEmoji, 400);
    }
}

function resetRocketEmoji() {
    const r = $id('rocket-emoji');
    const f = $id('rocket-fire');
    const c = $id('rocket-canvas');
    const W = c ? (c.offsetWidth  || 400) : 400;
    const H = c ? (c.offsetHeight || 340) : 340;
    if (r) {
        r.style.display   = 'block';
        r.style.opacity   = '1';
        r.style.left      = (W * 0.33) + 'px';
        r.style.top       = (H * 0.52) + 'px';
        r.style.transform = 'translate(-50%,-50%) rotate(-45deg)';
    }
    if (f) { f.style.display = 'none'; f.style.opacity = '0.9'; }
    if (c) {
        const ctx = c.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#080814'; ctx.fillRect(0,0,c.width,c.height);
            ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1;
            for(let x=0;x<c.width;x+=c.width/6){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,c.height);ctx.stroke();}
            for(let y=0;y<c.height;y+=c.height/5){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke();}
        }
    }
    setText('rocket-coefficient', '×1.00');
}

function updateRocketPrevRounds() {
    const container = $id('rocket-prev-rounds');
    if (!container) return;
    container.innerHTML = '';
    const last8 = (userData.rocketHistory || []).slice(0, 8);
    last8.forEach(r => {
        const pill = document.createElement('div');
        const coef = r.coefficient.toFixed(2);
        const crashed = !r.isWin;
        const color = crashed
            ? (r.coefficient < 2 ? '#e74c3c' : r.coefficient < 5 ? '#e67e22' : '#8e44ad')
            : '#27ae60';
        pill.style.cssText = `
            padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;
            color:#fff;background:${color};flex-shrink:0;cursor:default;
        `;
        pill.textContent = '×' + coef;
        container.appendChild(pill);
    });
}

function updateRocketHistory() {
    const list = $id('rocket-history-list');
    if (!list) return;
    list.innerHTML = '';
    (userData.rocketHistory || []).slice(0,10).forEach(g => {
        const d = new Date(g.timestamp);
        const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const item = document.createElement('div');
        item.className = `history-item ${g.isWin ? 'win':'lose'}`;
        item.innerHTML = `<span>${time}</span><span>Ставка: ${g.bet}F</span><span>${g.isWin?'+'+g.win:'-'+g.bet}F</span><span>×${g.coefficient.toFixed(2)}</span>`;
        list.appendChild(item);
    });
}

function startRocketCountdown() {
    rocketGameState.roundCountdown = 5;
    const status = $id('round-status');
    if (status) status.style.display = 'block';
    setText('round-timer', 5);
    const playBtn = $id('rocket-play-btn');
    if (playBtn) { playBtn.disabled = true; playBtn.style.opacity = '0.5'; }
    const interval = setInterval(() => {
        rocketGameState.roundCountdown--;
        setText('round-timer', rocketGameState.roundCountdown);
        if (rocketGameState.roundCountdown <= 0) {
            clearInterval(interval);
            if (status) status.style.display = 'none';
            if (playBtn) { playBtn.disabled = false; playBtn.style.opacity = '1'; }
        }
    }, 1000);
}

// ===== ПРОФИЛЬ =====
function updateStats() {
    const s = userData.stats;
    setText('games-played', s.gamesPlayed || 0);
    setText('games-won',    s.gamesWon    || 0);
    setText('games-lost',   s.gamesLost   || 0);
    const wr = s.gamesPlayed > 0 ? Math.round((s.gamesWon/s.gamesPlayed)*100) : 0;
    setText('win-rate',   wr);
    setText('total-won',  s.totalWon     || 0);
    setText('max-coef',   s.maxCoefficient ? s.maxCoefficient.toFixed(2) : '0');
}

function updateProfileInfo() {
    const regDate  = new Date(userData.registrationDate);
    const lastVisit = new Date(userData.lastVisit);
    setText('reg-date',   regDate.toLocaleDateString('ru-RU'));
    setText('last-visit', lastVisit.toLocaleDateString('ru-RU'));
    const tgUser = getTgUser();
    const userName = tgUser
        ? (tgUser.username ? '@'+tgUser.username : tgUser.first_name)
        : `Игрок#${Math.abs(regDate.getTime() % 10000).toString().padStart(4,'0')}`;
    setText('user-name', userName);
    updateDailyBonusButton();
}

// ===== ЕЖЕДНЕВНЫЙ БОНУС =====
function claimDailyBonus() {
    const now = new Date();
    const last = userData.lastDailyBonus ? new Date(userData.lastDailyBonus) : null;
    if (last) {
        const diff = (now - last) / (1000*60*60);
        if (diff < 24) {
            const rem = Math.ceil(24 - diff);
            alert(`Следующий бонус через ${rem} ч.`); return;
        }
    }
    const bonus = 100;
    userData.balance.silver += bonus;
    userData.lastDailyBonus = now.toISOString();
    saveUserData();
    updateBalance();
    updateDailyBonusButton();
    alert(`+${bonus} серебряных F-коинов!`);
}

function updateDailyBonusButton() {
    const now  = new Date();
    const last = userData.lastDailyBonus ? new Date(userData.lastDailyBonus) : null;
    const canClaim = !last || (now - last) / (1000*60*60) >= 24;
    ['daily-bonus-btn','rocket-daily-bonus-btn'].forEach(id => {
        const btn = $id(id);
        if (!btn) return;
        btn.disabled = !canClaim;
        btn.style.opacity = canClaim ? '1' : '0.5';
    });
    if (last && !canClaim) {
        const rem = Math.ceil(24 - (now-last)/(1000*60*60));
        setText('next-bonus', `Через ${rem} ч.`);
    } else {
        setText('next-bonus', 'Доступен!');
    }
}

// ===== ЗАДАНИЯ =====
const TASKS = {
    1: { name:'Первая игра',      target:1,   reward:100,  type:'gamesPlayed' },
    2: { name:'Маленький выигрыш',target:500, reward:200,  type:'totalWon'    },
    3: { name:'Пять побед',       target:5,   reward:500,  type:'gamesWon'    },
    4: { name:'Коэффициент 10x',  target:10,  reward:1000, type:'maxCoef'     },
    5: { name:'Серия побед',      target:3,   reward:1500, type:'consecutive' }
};

function updateTasks() {
    const p = userData.stats;
    const progress = {
        1: Math.min(p.gamesPlayed||0, 1),
        2: Math.min(p.totalWon||0, 500),
        3: Math.min(p.gamesWon||0, 5),
        4: Math.min(p.maxCoefficient||0, 10),
        5: Math.min(userData.consecutiveWins||0, 3)
    };
    for (let i=1; i<=5; i++) {
        const task = TASKS[i];
        const prog = progress[i];
        const target = task.target;
        const pct = Math.min((prog/target)*100, 100);
        const fill = $id(`task-${i}-progress`);
        const text = $id(`task-${i}-text`);
        const btn  = $id(`task-${i}-btn`);
        if (fill) fill.style.width = pct + '%';
        if (text) {
            if (i===4) text.textContent = `${prog.toFixed(1)}/${target}x`;
            else text.textContent = `${Math.floor(prog)}/${target}`;
        }
        if (btn) btn.disabled = prog < target || userData.tasks[i];
    }
    let completed=0, totalRewards=0;
    for (let i=1; i<=5; i++) { if(userData.tasks[i]){ completed++; totalRewards+=TASKS[i].reward; } }
    setText('tasks-completed', completed);
    setText('total-rewards', totalRewards);
}

function claimTaskReward(id) {
    const p = userData.stats;
    const progress = {
        1: p.gamesPlayed||0, 2: p.totalWon||0, 3: p.gamesWon||0,
        4: p.maxCoefficient||0, 5: userData.consecutiveWins||0
    };
    if (userData.tasks[id] || progress[id] < TASKS[id].target) return;
    userData.tasks[id] = true;
    userData.balance.silver += TASKS[id].reward;
    saveUserData();
    updateBalance();
    updateTasks();
    alert(`Получено ${TASKS[id].reward} F-коинов!`);
}

// ===== КЕЙСЫ =====
const CASE_REWARDS = {
    peace:   [{name:'Монеты',val:50},{name:'Подарок',val:100}],
    stars67: [{name:'Звёздный приз',val:150},{name:'Кристалл',val:300}],
    daily:   [{name:'Ежедневная монета',val:30},{name:'Бонус',val:80}],
    strike:  [{name:'Страйк приз',val:200},{name:'Мега приз',val:500}],
    stars15: [{name:'Малая звезда',val:50},{name:'Средняя звезда',val:100}],
    stars50: [{name:'Большая звезда',val:120},{name:'Супер звезда',val:250}]
};

function openCase(type) {
    const rewards = CASE_REWARDS[type] || [{name:'Приз',val:50}];
    const reward = rewards[Math.floor(Math.random()*rewards.length)];
    userData.balance.silver += reward.val;
    userData.casesHistory.unshift({ timestamp:new Date().toISOString(), case:type, reward:reward.name, val:reward.val });
    if (userData.casesHistory.length > 20) userData.casesHistory = userData.casesHistory.slice(0,20);
    saveUserData();
    updateBalance();
    updateCasesHistory();
    alert(`Получено: ${reward.name} (+${reward.val}F)`);
}

function updateCasesHistory() {
    const list = $id('cases-history-list');
    if (!list) return;
    list.innerHTML = '';
    (userData.casesHistory||[]).slice(0,10).forEach(c => {
        const d = new Date(c.timestamp);
        const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const item = document.createElement('div');
        item.className = 'history-item win';
        item.innerHTML = `<span>${time}</span><span>${c.reward}</span><span>+${c.val}F</span>`;
        list.appendChild(item);
    });
}

// ===== ИНВЕНТАРЬ =====
function updateInventory() {
    const GIFT_ICONS = {
        bear:'🐻',heart:'❤️',rose:'🌹',gift:'🎁',cake:'🎂',
        champagne:'🍾',bouquet:'💐',rocket:'🚀',cup:'🏆',
        ring:'💍',diamond:'💎',crown:'👑',star:'⭐',flame:'🔥'
    };

    function renderMcGrid(gridId, items) {
        const grid = $id(gridId);
        if (!grid) return;
        grid.innerHTML = '';
        const MIN = 9;
        const extra = items.length > MIN ? (3 - items.length%3)%3 : 0;
        const total = Math.max(MIN, items.length + extra);
        for (let i=0; i<total; i++) {
            const slot = document.createElement('div');
            slot.className = 'mc-slot';
            if (i < items.length) {
                const g = items[i];
                const icon = GIFT_ICONS[g.type] || '🎁';
                slot.classList.add('mc-slot-filled');
                slot.title = (g.name||'Подарок') + ' · ' + (g.value||0) + 'F';
                slot.innerHTML = `<span class="mc-slot-icon">${icon}</span><span class="mc-slot-qty">x1</span>`;
                slot.onclick = () => showManageGiftModal(g.id);
            }
            grid.appendChild(slot);
        }
    }

    const now = Date.now();
    const active=[], ready=[], sold=[];
    (userData.inventory||[]).forEach(g => {
        if (g.status==='active') {
            const unlock = new Date(g.receivedDate).getTime() + 21*24*60*60*1000;
            if (now >= unlock) ready.push(g); else active.push(g);
        } else if (g.status==='sold') sold.push(g);
    });
    renderMcGrid('inventory-active-grid', active);
    renderMcGrid('inventory-ready-grid',  ready);
    renderMcGrid('inventory-sold-grid',   sold);
}

function showInventoryTab(tab) {
    document.querySelectorAll('.inventory-tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.mc-inv-tab').forEach(btn => btn.classList.remove('active'));
    const content = $id('inventory-' + tab);
    if (content) content.classList.add('active');
    document.querySelectorAll('.mc-inv-tab').forEach(btn => {
        if ((btn.getAttribute('onclick')||'').includes(`'${tab}'`)) btn.classList.add('active');
    });
}

// ===== ПОДАРКИ =====
function showGiftChoiceModal(gift, winAmount) {
    currentNewGift = { ...gift, id: Date.now(), value: winAmount, receivedDate: new Date().toISOString(), status: 'active' };
    setText('new-gift-name',  gift.name);
    setText('new-gift-value', winAmount);
    setText('new-gift-tier',  `Уровень: ${winAmount>=1000?'Легендарный':winAmount>=500?'Редкий':winAmount>=100?'Необычный':'Обычный'}`);
    const modal = $id('gift-choice-modal');
    if (modal) modal.style.display = 'flex';
}

function keepGift() {
    if (!currentNewGift) return;
    userData.inventory = userData.inventory || [];
    userData.inventory.push(currentNewGift);
    saveUserData();
    const modal = $id('gift-choice-modal');
    if (modal) modal.style.display = 'none';
    currentNewGift = null;
    alert('Подарок добавлен в инвентарь!');
}

function sellGift() {
    if (!currentNewGift) return;
    const sellPrice = Math.floor(currentNewGift.value * 0.5);
    userData.balance.silver += sellPrice;
    saveUserData();
    updateBalance();
    const modal = $id('gift-choice-modal');
    if (modal) modal.style.display = 'none';
    currentNewGift = null;
    alert(`Подарок продан за ${sellPrice}F!`);
}

function showManageGiftModal(giftId) {
    const gift = (userData.inventory||[]).find(g => g.id === giftId);
    if (!gift) return;
    const sellPrice = Math.floor((gift.value||0) * 0.5);
    if (confirm(`${gift.name||'Подарок'} (${gift.value||0}F)\nПродать за ${sellPrice}F?`)) {
        gift.status = 'sold';
        userData.balance.silver += sellPrice;
        saveUserData();
        updateBalance();
        updateInventory();
    }
}
