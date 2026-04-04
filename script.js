// ===== TELEGRAM WEBAPP =====
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor('#000000'); } catch(e) {}
    try { tg.setBackgroundColor('#000000'); } catch(e) {}
    try { tg.setBottomBarColor('#000000'); } catch(e) {}
}

// Форсируем тёмный фон — работает даже без Telegram
(function forceDarkMode() {
    const r = document.documentElement;
    const b = document.body;
    // Перебиваем CSS переменные Telegram
    r.style.setProperty('--tg-theme-bg-color', '#000000', 'important');
    r.style.setProperty('--tg-theme-secondary-bg-color', '#0d0d1a', 'important');
    r.style.setProperty('--tg-theme-text-color', '#ffffff', 'important');
    r.style.setProperty('--tg-color-scheme', 'dark', 'important');
    // Принудительный фон
    r.style.background = '#000000';
    r.style.backgroundColor = '#000000';
    if (b) {
        b.style.background = '#000000';
        b.style.backgroundColor = '#000000';
    }
    // MutationObserver — перехватываем Telegram inline-style инъекции
    const obs = new MutationObserver(() => {
        if (r.style.backgroundColor !== '#000000' && r.style.backgroundColor !== '') {
            r.style.background = '#000000';
            r.style.backgroundColor = '#000000';
        }
        if (b && b.style.backgroundColor !== '#000000' && b.style.backgroundColor !== '') {
            b.style.background = '#000000';
            b.style.backgroundColor = '#000000';
        }
    });
    obs.observe(r, { attributes: true, attributeFilter: ['style'] });
    if (b) obs.observe(b, { attributes: true, attributeFilter: ['style'] });
})();
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
        consecutiveWins: 0,
        depositStreak: 0,
        lastDailyCase: null
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
    crashPoint: 1.1,
    trailPoints: []
};

let currentNewGift = null;

// ===== СИСТЕМА ПОДАРКОВ =====
const GIFT_SYSTEM = {
    gifts: [
        { type: 'heart',      name: 'Сердце',           minValue: 15,  maxValue: 50  },
        { type: 'bear',       name: 'Плюшевый медведь', minValue: 15,  maxValue: 50  },
        { type: 'gift',       name: 'Подарок',          minValue: 25,  maxValue: 100 },
        { type: 'rose',       name: 'Роза',             minValue: 25,  maxValue: 100 },
        { type: 'cake',       name: 'Торт',             minValue: 50,  maxValue: 200 },
        { type: 'bouquet',    name: 'Букет',            minValue: 50,  maxValue: 200 },
        { type: 'rocket',     name: 'Ракета',           minValue: 50,  maxValue: 200 },
        { type: 'cup',        name: 'Кубок',            minValue: 100, maxValue: 500 },
        { type: 'ring',       name: 'Кольцо',           minValue: 100, maxValue: 500 },
        { type: 'diamond',    name: 'Алмаз',            minValue: 100, maxValue: 500 },
        { type: 'champagne',  name: 'Шампанское',       minValue: 100, maxValue: 500 }
    ],
    getRandomGift(winAmount) {
        const eligible = this.gifts.filter(g => winAmount >= g.minValue);
        if (!eligible.length) return null;
        return eligible[Math.floor(Math.random() * eligible.length)];
    }
};

// ===== ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', function() {
    try {
        loadUserData();
        setupEventListeners();
        showSection('game');
        updateDailyBonusButton();
        updateRocketUI();
        updateRocketPrevRounds();
        startRocketCountdown();
        updateHeaderUsername();
        simulateOnlineCounts();
    } catch(e) {
        console.error('INIT ERROR:', e);
        // Показываем ошибку на экране для дебага
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'position:fixed;top:70px;left:0;right:0;background:#f87171;color:#fff;padding:12px;font-size:12px;z-index:99999;word-break:break-all;';
        errDiv.textContent = 'Init error: ' + e.message + ' at ' + e.stack?.split('\n')[1];
        document.body.appendChild(errDiv);
        setTimeout(() => errDiv.remove(), 10000);
    }
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
    // Синхронизируем золото из Telegram CloudStorage (начисляется ботом после оплаты)
    syncGoldFromServer();
}

function saveUserData() {
    DB.set('userData', userData);
    // Backup inventory count to detect loss
    try {
        const invCount = (userData.inventory || []).length;
        DB.set('invCount', invCount);
    } catch(e) {}
}

// ===== СИНХРОНИЗАЦИЯ ЗОЛОТА С TELEGRAM CLOUDSTORAGE =====
function syncGoldFromCloud() {
    // Читаем параметр ?startapp=gold_XXX переданный ботом через deeplink
    try {
        const param = tg?.initDataUnsafe?.start_param || '';
        if (param.startsWith('gold_')) {
            const cloudGold = parseInt(param.replace('gold_', '')) || 0;
            if (cloudGold > 0 && cloudGold > userData.balance.gold) {
                userData.balance.gold = cloudGold;
                saveUserData();
                updateBalance();
                showGoldSyncNotif(cloudGold);
            }
        }
    } catch(e) {
        console.log('syncGold error:', e);
    }
}

function showGoldSyncNotif(gold) {
    showNotif(`🟡 Баланс обновлён: ${gold} коинов`, '#f59e0b');
}

function showNotif(text, color = '#8b5cf6') {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position:fixed;top:20px;left:50%;transform:translateX(-50%);
        background:${color};
        color:#fff;padding:12px 22px;border-radius:14px;
        font-weight:800;font-size:0.9rem;z-index:9999;
        box-shadow:0 8px 30px rgba(0,0,0,0.5);
        text-align:center;white-space:nowrap;
        animation:notifSlide .3s ease;
    `;
    notif.textContent = text;
    // CSS анимация
    if (!document.getElementById('notif-style')) {
        const s = document.createElement('style');
        s.id = 'notif-style';
        s.textContent = '@keyframes notifSlide{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}';
        document.head.appendChild(s);
    }
    document.body.appendChild(notif);
    setTimeout(() => { notif.style.opacity = '0'; notif.style.transition = 'opacity .3s'; setTimeout(() => notif.remove(), 300); }, 2500);
}

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
    // Форсируем тёмный фон на body и html (Telegram может перебивать)
    document.body.style.setProperty('background','#000','important');
    document.body.style.setProperty('background-color','#000','important');
    document.documentElement.style.setProperty('background','#000','important');
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
        updateProfileGifts();
    } else if (section === 'tasks') {
        document.getElementById('tasks-section').classList.add('active-section');
        const n = document.getElementById('nav-tasks'); if(n) n.classList.add('active-btn');
    } else if (section === 'inventory') {
        const invSec = document.getElementById('inventory-section');
        invSec.classList.add('active-section');
        invSec.style.setProperty('background','#0d0d1a','important');
        invSec.style.setProperty('color','#fff','important');
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
    setText('cases-balance-val', silver);
    setText('cases-gold-val', gold);
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
    gameState.currentBet = Math.max(1, gameState.currentBet + amount);
    updateBetDisplay();
}

function setBet(amount) {
    gameState.currentBet = Math.max(1, amount);
    updateBetDisplay();
}

// Новые функции управления для нового дизайна
function minesBetInputChange(val) {
    gameState.currentBet = Math.max(1, parseInt(val) || 1);
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
    gameState.baseCoefficient = sc * mc;
    // До начала игры показываем 1.00
    if (!gameState.isPlaying) {
        gameState.currentCoefficient = 1.00;
    }
    setText('size-coef',  sc + 'x');
    setText('mine-coef',  mc + 'x');
    setText('total-coef', gameState.currentCoefficient.toFixed(2) + 'x');
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
    gameState.currentCoefficient = 1.00;
    // Инициализируем baseCoefficient чтобы не было NaN
    const sizeCoef  = { 3: 1.2, 5: 1.5 };
    const minesCoef = { 1: 1.5, 2: 2.0, 3: 2.5, 5: 3.5 };
    gameState.baseCoefficient = (sizeCoef[gameConfig.size] || 1.5) * (minesCoef[gameConfig.mines] || 2.0);
    gameState.totalCells = gameConfig.size * gameConfig.size;
    gameState.revealedCells = 0;
    gameState.minesLeft = gameConfig.mines;
    gameState.gameBoard = [];
    gameState.minesPositions = [];
    gameState.canCashOut = false;

    createGameBoard();
    placeMines();

    const board = $id('game-board');
    const minesGame = $id('mines-game');
    const settings = minesGame ? minesGame.querySelector('.mines-settings-new') || minesGame.querySelector('.game-settings') : null;
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
    const fontSize = gameConfig.size <= 3 ? '2rem' : gameConfig.size <= 5 ? '1.5rem' : '1rem';
    grid.style.fontSize = fontSize;
    gameState.gameBoard = [];
    for (let i = 0; i < gameState.totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.index = i;
        const img = document.createElement('img');
        img.src = 'data:image/png;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/2Q==';
        img.style.cssText = 'width:60%;height:60%;object-fit:contain;pointer-events:none;';
        cell.appendChild(img);
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
        endGameLose();
    } else {
        cell.element.classList.add('safe');
        gameState.revealedCells++;
        gameState.canCashOut = true;
        // Растим коэффициент: каждый шаг умножает на базу ^ (1 / безопасных клеток)
        const safeCells = gameState.totalCells - gameConfig.mines;
        const stepMult = Math.pow(gameState.baseCoefficient, 1 / safeCells);
        gameState.currentCoefficient = Math.max(gameState.currentCoefficient * stepMult, 1.00);
        const cb = $id('cashout-btn');
        if (cb) cb.disabled = false;
        updateGameInterface();

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
    userData.stats.gamesPlayed++; userData.stats.minesPlayed=(userData.stats.minesPlayed||0)+1;
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
        }
    });
}

function newGame() {
    gameState.isPlaying = false;
    const board = $id('game-board');
    const minesGame = $id('mines-game');
    const settings = minesGame ? minesGame.querySelector('.mines-settings-new') || minesGame.querySelector('.game-settings') : null;
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
        item.innerHTML = `<span>${time}</span><span>Ставка: ${game.bet}F</span><span>${game.isWin ? '+'+game.win : '-'+game.bet}F</span><span>${(game.coefficient || 1).toFixed(2)}x</span>`;
        list.appendChild(item);
    });
}

// ===== РАКЕТКА =====
function updateRocketUI() {
    setText('rocket-current-bet', rocketGameState.currentBet);
    const inp = $id('rocket-bet-input');
    if (inp) inp.value = rocketGameState.currentBet;
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
    rocketGameState.currentBet = Math.max(1, rocketGameState.currentBet + amount);
    const inp = document.getElementById('rocket-bet-input');
    if (inp) inp.value = rocketGameState.currentBet;
    updateRocketUI();
}

function setRocketBet(amount) {
    rocketGameState.currentBet = Math.max(1, amount);
    const inp = document.getElementById('rocket-bet-input');
    if (inp) inp.value = rocketGameState.currentBet;
    updateRocketUI();
}

function setRocketCurrency(type) {
    rocketGameState.betType = type;
    const silver = document.getElementById('rocket-currency-silver');
    const gold   = document.getElementById('rocket-currency-gold');
    if (silver && gold) {
        if (type === 'silver') {
            silver.style.borderColor = '#7b5cff';
            silver.style.background  = 'rgba(123,92,255,0.25)';
            silver.style.color = '#fff';
            gold.style.borderColor = '#2a2a3a';
            gold.style.background  = '#1a1a2a';
            gold.style.color = '#aaa';
        } else {
            gold.style.borderColor = '#f59e0b';
            gold.style.background  = 'rgba(245,158,11,0.2)';
            gold.style.color = '#fcd34d';
            silver.style.borderColor = '#2a2a3a';
            silver.style.background  = '#1a1a2a';
            silver.style.color = '#aaa';
        }
    }
    checkRocketBetValidity();
}

function setMinesCurrency(type) {
    gameState.betType = type;
    const silver = document.getElementById('mines-currency-silver');
    const gold   = document.getElementById('mines-currency-gold');
    if (!silver || !gold) return;
    if (type === 'silver') {
        silver.style.borderColor = '#7b5cff';
        silver.style.background  = 'rgba(123,92,255,0.2)';
        silver.querySelector('span').style.color = '#c084fc';
        gold.style.borderColor = '#2a2a3a';
        gold.style.background  = 'rgba(255,255,255,0.05)';
        gold.querySelector('span').style.color = '#aaa';
    } else {
        gold.style.borderColor = '#f59e0b';
        gold.style.background  = 'rgba(245,158,11,0.15)';
        gold.querySelector('span').style.color = '#fcd34d';
        silver.style.borderColor = '#2a2a3a';
        silver.style.background  = 'rgba(255,255,255,0.05)';
        silver.querySelector('span').style.color = '#aaa';
    }
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

    // t = log(crashPoint) / log(1.10)
    const crashTime = Math.log(rocketGameState.crashPoint) / Math.log(1.10) * 1000;
    setTimeout(() => {
        if (rocketGameState.isRoundActive) endRocketGame(false, rocketGameState.currentCoefficient);
    }, Math.max(crashTime, 500));
}

function animateRocket() {
    const rocketEl = $id('rocket-emoji');
    const cvs      = $id('rocket-canvas');
    const ctx      = cvs ? cvs.getContext('2d') : null;
    if (!rocketEl || !cvs) return;

    cvs.width  = cvs.offsetWidth  || cvs.parentElement.offsetWidth || 400;
    cvs.height = cvs.offsetHeight || 340;
    const W = cvs.width;
    const H = cvs.height;

    rocketEl.style.display = 'block';
    rocketEl.style.opacity = '1';
    rocketGameState.trailPoints = [];

    let lastElapsed = 0;

    // Ракета на экране всегда в этой точке (25% ширины, 75% высоты)
    const rocketPctX = 0.50;
    const rocketPctY = 0.50;

    // Мировые координаты растут: X — линейно, Y — вверх с коэфом
    // Масштаб: сколько пикселей мира = 1 пиксель экрана изначально
    const speedX = 80; // мировых px/сек по горизонтали

    function animate() {
        if (!rocketGameState.isRoundActive && !rocketGameState._continueAfterCashout) return;
        const elapsed = (Date.now() - rocketGameState.startTime) / 1000;
        lastElapsed = elapsed;

        rocketGameState.currentCoefficient = Math.pow(1.10, elapsed);

        const coef = rocketGameState.currentCoefficient;

        setText('rocket-coefficient', '×' + coef.toFixed(2));
        if (rocketGameState.isRoundActive) {
            const cashBtn = $id('rocket-cashout-btn');
            if (cashBtn) cashBtn.textContent = `ЗАБРАТЬ ×${coef.toFixed(2)}`;
        }

        // Мировая позиция ракеты
        const worldX = elapsed * speedX;
        const worldY = -(coef - 1) * 350;

        // Стартовая точка — левый нижний угол
        const startSX = W * 0.10;
        const startSY = H * 0.88;
        const targetSX = W * 0.50;
        const targetSY = H * 0.50;

        // До центра — ракета просто летит по экрану
        // После центра — камера следит
        const rawSX = startSX + worldX;
        const rawSY = startSY + worldY;
        const camX = rawSX > targetSX ? worldX - (targetSX - startSX) : 0;
        const camY = rawSY < targetSY ? worldY - (targetSY - startSY) : 0;

        // Сохраняем точку следа
        rocketGameState.trailPoints.push({ wx: worldX, wy: worldY });

        // Экранные координаты точки мира
        function toScreen(wx, wy) {
            return { x: startSX + wx - camX, y: startSY + wy - camY };
        }

        // Рисуем
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#080814';
        ctx.fillRect(0, 0, W, H);

        // Сетка — прокручивается с камерой + плавное покачивание
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        const gridX = 80, gridY = 60;
        const floatX = Math.sin(elapsed * 0.4) * 6;
        const floatY = Math.cos(elapsed * 0.3) * 4;
        const offX = ((-camX + floatX) % gridX + gridX) % gridX;
        const offY = ((-camY + floatY) % gridY + gridY) % gridY;
        for (let x = offX - gridX; x < W + gridX; x += gridX) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = offY - gridY; y < H + gridY; y += gridY) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }

        const tp = rocketGameState.trailPoints;
        if (tp.length > 1) {
            const origin = toScreen(0, 0);
            const pts = tp.map(p => toScreen(p.wx, p.wy));
            const last = pts[pts.length - 1];

            // Заливка
            ctx.beginPath();
            ctx.moveTo(origin.x, origin.y);
            for (const p of pts) ctx.lineTo(p.x, p.y);
            ctx.lineTo(last.x, origin.y);
            ctx.closePath();
            const fillGrad = ctx.createLinearGradient(0, last.y, 0, origin.y);
            fillGrad.addColorStop(0, 'rgba(123,92,255,0.3)');
            fillGrad.addColorStop(1, 'rgba(123,92,255,0.03)');
            ctx.fillStyle = fillGrad;
            ctx.fill();

            // Линия следа
            ctx.beginPath();
            ctx.moveTo(origin.x, origin.y);
            for (const p of pts) ctx.lineTo(p.x, p.y);
            const lineGrad = ctx.createLinearGradient(origin.x, origin.y, last.x, last.y);
            lineGrad.addColorStop(0, 'rgba(123,92,255,0.3)');
            lineGrad.addColorStop(1, 'rgba(200,160,255,1)');
            ctx.strokeStyle = lineGrad;
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();

            // Свечение
            const glow = ctx.createRadialGradient(last.x, last.y, 0, last.x, last.y, 24);
            glow.addColorStop(0, 'rgba(200,160,255,0.7)');
            glow.addColorStop(1, 'rgba(123,92,255,0)');
            ctx.beginPath();
            ctx.arc(last.x, last.y, 24, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();
        }

        // Позиция ракеты на экране
        const rPos = toScreen(worldX, worldY);
        const sx = rPos.x;
        const sy = rPos.y;
        const wobble = Math.sin(elapsed * 3) * 2;
        rocketEl.style.left      = sx + 'px';
        rocketEl.style.top       = sy + 'px';
        rocketEl.style.transform = `translate(-50%,-50%) rotate(${-45 + wobble}deg)`;

        rocketGameState._elapsed = elapsed;
        rocketGameState._W = W; rocketGameState._H = H;
        rocketGameState._rocketScreenX = sx;
        rocketGameState._rocketScreenY = sy;

        requestAnimationFrame(animate);
    }
    animate();
}


function cashOutRocket() {
    if (!rocketGameState.isPlaying || !rocketGameState.isRoundActive) return;

    const multiplier = rocketGameState.currentCoefficient;
    const winAmount  = Math.floor(rocketGameState.currentBet * multiplier);

    // Начисляем выигрыш
    userData.balance[rocketGameState.betType] += winAmount;
    userData.stats.totalWon += winAmount;
    saveUserData();
    updateBalance();

    // Записываем в историю
    const result = { timestamp: new Date().toISOString(), bet: rocketGameState.currentBet,
                     win: winAmount, coefficient: multiplier, isWin: true };
    userData.rocketHistory.unshift(result);
    if (userData.rocketHistory.length > 20) userData.rocketHistory = userData.rocketHistory.slice(0,20);
    userData.stats.rocketPlayed=(userData.stats.rocketPlayed||0)+1; updateTasks();

    // Подарок
    if (winAmount >= 15) {
        const gift = GIFT_SYSTEM.getRandomGift(winAmount);
        if (gift) setTimeout(() => showGiftChoiceModal(gift, winAmount), 1200);
    }

    updateStats();
    updateRocketHistory();

    // Прячем кнопку забрать, НО ракетка продолжает лететь до краша
    const cashBtn = $id('rocket-cashout-btn');
    if (cashBtn) cashBtn.style.display = 'none';

    // Показываем «забрал» на коэффициенте
    setText('rocket-coefficient', '✓ ×' + multiplier.toFixed(2));

    // Флаг: раунд закончился для игрока, но анимация продолжается
    rocketGameState.isRoundActive = false;
    rocketGameState._continueAfterCashout = true;

    // Ждём краша (оставшееся время) — потом запускаем сброс
    const elapsed    = rocketGameState._elapsed || 0;
    const crashCoef  = rocketGameState.crashPoint;
    // Когда 1.06^t = crashCoef → t = log(crashCoef)/log(1.06)
    const crashTime  = Math.log(crashCoef) / Math.log(1.10);
    const remaining  = Math.max((crashTime - elapsed) * 1000, 500);

    setTimeout(() => {
        rocketGameState._continueAfterCashout = false;
        rocketGameState.isPlaying = false;
        crashAnimateRocket();
        startRocketCountdown();
    }, remaining);
}

function endRocketGame(isWin, multiplier) {
    rocketGameState.isRoundActive = false;
    rocketGameState.isPlaying     = false;
    rocketGameState._continueAfterCashout = false;

    if (!isWin) {
        // Краш — записываем проигрыш
        const result = { timestamp: new Date().toISOString(), bet: rocketGameState.currentBet,
                         win: 0, coefficient: multiplier, isWin: false };
        userData.rocketHistory.unshift(result);
        if (userData.rocketHistory.length > 20) userData.rocketHistory = userData.rocketHistory.slice(0,20);
        saveUserData();
        updateBalance();
        updateStats();
        updateRocketHistory();
        updateRocketPrevRounds();
    }

    // Восстановить кнопки
    const playBtn = $id('rocket-play-btn');
    const cashBtn = $id('rocket-cashout-btn');
    if (cashBtn) cashBtn.style.display = 'none';
    if (playBtn) {
        playBtn.style.display = 'block';
        playBtn.disabled = true;
        playBtn.style.opacity = '0.5';
    }

    crashAnimateRocket();
    startRocketCountdown();
}

function crashAnimateRocket() {
    const rocketEl = $id('rocket-emoji');
    const cvs      = $id('rocket-canvas');
    const ctx      = cvs ? cvs.getContext('2d') : null;
    if (!rocketEl) { setTimeout(resetRocketEmoji, 400); return; }

    const W = rocketGameState._W || 400;
    const H = rocketGameState._H || 340;
    let rx  = rocketGameState._rocketScreenX || parseFloat(rocketEl.style.left) || W * 0.8;
    let ry  = rocketGameState._rocketScreenY || parseFloat(rocketEl.style.top)  || H * 0.5;
    let spin = -45, vy = 0;
    const crashStart = Date.now();

    function fall() {
        const ft   = (Date.now() - crashStart) / 1000;
        const prog = Math.min(ft / 1.4, 1);
        vy  += 2.8; ry += vy * 0.5; rx += 1.2; spin += 15;
        const op = Math.max(0, 1 - prog * 1.5);
        rocketEl.style.top       = ry + 'px';
        rocketEl.style.left      = rx + 'px';
        rocketEl.style.transform = `translate(-50%,-50%) rotate(${spin}deg)`;
        rocketEl.style.opacity   = op;

        if (ctx) {
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = '#080814'; ctx.fillRect(0, 0, W, H);
            ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
            for (let x = 0; x < W; x += W/6){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
            for (let y = 0; y < H; y += H/5){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

            // Рисуем сохранённый след
            const tp = rocketGameState.trailPoints;
            if (tp && tp.length > 1) {
                ctx.beginPath();
                ctx.moveTo(tp[0].x, tp[0].y);
                for (let i = 1; i < tp.length; i++) ctx.lineTo(tp[i].x, tp[i].y);
                ctx.strokeStyle = 'rgba(180,140,255,0.5)';
                ctx.lineWidth = 3;
                ctx.lineJoin = 'round';
                ctx.stroke();
            }
        }

        if (prog < 1) requestAnimationFrame(fall);
        else resetRocketEmoji();
    }
    requestAnimationFrame(fall);
}

function resetRocketEmoji() {
    const r = $id('rocket-emoji');
    const c = $id('rocket-canvas');
    const W = c ? (c.offsetWidth  || 400) : 400;
    const H = c ? (c.offsetHeight || 340) : 340;
    if (r) {
        r.style.display   = 'block';
        r.style.opacity   = '1';
        r.style.left      = (W * 0.10) + 'px';
        r.style.top       = (H * 0.88) + 'px';
        r.style.transform = 'translate(-50%,-50%) rotate(-45deg)';
    }
    if (c) {
        const ctx = c.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#080814'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
            for (let x = 0; x < c.width; x += c.width/6)  { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,c.height); ctx.stroke(); }
            for (let y = 0; y < c.height; y += c.height/5) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(c.width,y);  ctx.stroke(); }
        }
    }
    rocketGameState.isPlaying = false;
    setText('rocket-coefficient', '×1.00');
    updateRocketPrevRounds();
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
    // Показываем кнопку сразу но заблокированной
    if (playBtn) {
        playBtn.style.display = 'block';
        playBtn.disabled = true;
        playBtn.style.opacity = '0.5';
    }
    const interval = setInterval(() => {
        rocketGameState.roundCountdown--;
        setText('round-timer', rocketGameState.roundCountdown);
        if (rocketGameState.roundCountdown <= 0) {
            clearInterval(interval);
            if (status) status.style.display = 'none';
            const pb = $id('rocket-play-btn');
            if (pb) {
                pb.style.display = 'block';
                pb.disabled = false;
                pb.style.opacity = '1';
            }
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
    setText('win-rate',        wr);
    setText('total-won',       s.totalWon || 0);
    setText('total-won-gold',  userData.balance.gold || 0);
    setText('max-coef',        s.maxCoefficient ? s.maxCoefficient.toFixed(2) : '0');
    renderProfileHistory();
}


function renderProfileHistory() {
    const list = document.getElementById('profile-history-list');
    if (!list) return;
    const allHistory = [
        ...(userData.gameHistory || []).map(g => ({...g, type: 'Мины'})),
        ...(userData.rocketHistory || []).map(g => ({...g, type: 'Ракета'})),
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 15);

    if (!allHistory.length) {
        list.innerHTML = '<p class="prf-hist-empty">История пуста</p>';
        return;
    }
    list.innerHTML = allHistory.map(g => {
        const d = new Date(g.timestamp);
        const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const cls = g.isWin ? 'win' : 'lose';
        const result = g.isWin ? `<span class="prf-hist-win">+${g.win} 🪙</span>` : `<span class="prf-hist-lose">-${g.bet} 🪙</span>`;
        return `<div class="prf-hist-item ${cls}">
            <span style="color:#6b7280">${time}</span>
            <span style="color:#9ca3af">${g.type}</span>
            <span style="color:#9ca3af">x${(g.coefficient||1).toFixed(2)}</span>
            ${result}
        </div>`;
    }).join('');
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

    // Фото профиля Telegram
    if (tgUser?.photo_url) {
        const img = document.getElementById('prf-tg-photo');
        const em  = document.getElementById('prf-avatar-emoji');
        if (img) { img.src = tgUser.photo_url; img.style.display = 'block'; }
        if (em)  { em.style.display = 'none'; }
    }

    updateDailyBonusButton();
}

function switchProfTab(tab) {
    ['stats','gifts','refs','hist'].forEach(t => {
        const btn = document.getElementById('ptab-' + t);
        const panel = document.getElementById('ppanel-' + t);
        const active = (t === tab);
        if (btn) btn.classList.toggle('active', active);
        if (panel) panel.classList.toggle('active', active);
    });
    if (tab === 'stats') { updateStats(); }
    if (tab === 'gifts') { updateProfileGifts(); }
}

function updateProfileGifts() {
    var grid    = document.getElementById('prf-gifts-grid');
    var empty   = document.getElementById('prf-gifts-empty');
    var counter = document.getElementById('prf-gifts-total');
    if (!grid) return;
    var inv = (userData.inventory || []).filter(function(g) {
        return g.status === 'active' || g.status === 'withdrawn';
    });
    if (counter) counter.textContent = inv.length;
    if (!inv.length) {
        grid.innerHTML = '';
        if (empty) { empty.style.display = 'flex'; empty.style.flexDirection = 'column'; empty.style.alignItems = 'center'; }
        return;
    }
    if (empty) empty.style.display = 'none';
    grid.innerHTML = '';
    var items = inv.slice(-9).reverse();
    items.forEach(function(g) {
        var isW  = (g.status === 'withdrawn');
        var card = document.createElement('div');
        card.className = 'prf-gift-mini';
        if (isW) card.style.opacity = '0.5';
        card.addEventListener('click', function() { showSection('inventory'); });
        var iconDiv = document.createElement('div');
        iconDiv.className = 'prf-gift-mini-emoji';
        iconDiv.innerHTML = (typeof giftIcon === 'function') ? giftIcon(g.type, 52) : (GIFT_EMOJIS[g.type] || '🎁');
        var valDiv = document.createElement('div');
        valDiv.className = 'prf-gift-mini-val';
        valDiv.textContent = '🟡 ' + (g.value || 0);
        var lblDiv = document.createElement('div');
        lblDiv.className = 'prf-gift-mini-lbl';
        lblDiv.textContent = isW ? 'Выведен' : (g.name || 'Подарок');
        card.appendChild(iconDiv); card.appendChild(valDiv); card.appendChild(lblDiv);
        grid.appendChild(card);
    });
}

function copyRefLink() {
    const tgUser = getTgUser();
    const botUsername = 'fleep_gift_bot';
    const refId = tgUser?.id || 'guest';
    const link = `https://t.me/${botUsername}?start=ref_${refId}`;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => {
            showNotif('📋 Ссылка скопирована!', '#8b5cf6');
        }).catch(() => { alert(link); });
    } else {
        alert(link);
    }
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
    1: { name:'Пополнить баланс', target:1, reward:15,  rewardType:'gold',   type:'deposit100'  },
    2: { name:'Мины',             target:5, reward:10,  rewardType:'silver', type:'minesPlayed' },
    3: { name:'Ракетка',          target:5, reward:10,  rewardType:'silver', type:'rocketPlayed'},
    4: { name:'Кейсы',            target:5, reward:10,  rewardType:'silver', type:'casesOpened' },
};

function getTaskProgress(id) {
    const tp = userData.taskProgress || {};
    const t = TASKS[id].type;
    if (t==='deposit100')  return (tp.deposit100  ? 1 : 0);
    if (t==='minesPlayed') return Math.min(userData.stats.minesPlayed  ||0, TASKS[id].target);
    if (t==='rocketPlayed')return Math.min(userData.stats.rocketPlayed ||0, TASKS[id].target);
    if (t==='casesOpened') return Math.min(tp.casesOpened||0, TASKS[id].target);
    return 0;
}

function updateTasks() {
    for (let i=1; i<=4; i++) {
        const prog = getTaskProgress(i);
        const target = TASKS[i].target;
        const fill = document.getElementById('task-'+i+'-progress');
        const text = document.getElementById('task-'+i+'-text');
        const btn  = document.getElementById('task-'+i+'-btn');
        if (fill) fill.style.width = Math.min((prog/target)*100,100)+'%';
        if (text) text.textContent = Math.min(prog,target)+'/'+target;
        if (btn)  btn.disabled = prog < target || !!userData.tasks[i];
        const card = document.getElementById('task-'+i);
        if (card) card.classList.toggle('task-done', !!userData.tasks[i]);
    }
    let c=0,r=0; for(let i=1;i<=4;i++){if(userData.tasks[i]){c++;r+=TASKS[i].reward;}}
    const tc=document.getElementById('tasks-completed'); if(tc)tc.textContent=c;
    const tr=document.getElementById('total-rewards');   if(tr)tr.textContent=r;
}

function claimTaskReward(id) {
    if (userData.tasks[id] || getTaskProgress(id) < TASKS[id].target) return;
    userData.tasks[id] = true;
    const task = TASKS[id];
    if (task.rewardType==='gold') userData.balance.gold=(userData.balance.gold||0)+task.reward;
    else userData.balance.silver += task.reward;
    saveUserData(); updateBalance(); updateTasks();
    const cur = task.rewardType==='gold' ? '🟡' : 'F';
    if (typeof showNotif==='function') showNotif('🎉 +'+task.reward+' '+cur+' получено!','#7b5cff');
}

// ===== КЕЙСЫ — КОНФИГ =====
const CASE_CONFIG = {
    peace:    { name: 'Покой в богатстве', currency: 'silver', cost: 555,  allowGold: false },
    stars67:  { name: '67 звёзд',          currency: 'gold',   cost: 67,   allowGold: true  },
    daily:    { name: 'Ежедневный',         currency: null,     cost: 0,    free: true       },
    strike:   { name: 'СТРАЙК',            currency: null,     cost: 0,    strike: true     },
    stars15:  { name: '15 звёзд',           currency: 'gold',   cost: 15,   allowGold: true  },
    stars25:  { name: '25 звёзд',           currency: 'gold',   cost: 25,   allowGold: true  },
    stars50:  { name: '50 звёзд',           currency: 'gold',   cost: 50,   allowGold: true  },
    stars100: { name: '100 звёзд',          currency: 'gold',   cost: 100,  allowGold: true  },
};

// ===== КЕЙСЫ - ПОДАРКИ С ЦЕНАМИ =====
const CASE_GIFTS = [
    { type: 'rocket',     name: 'Ракета',          emoji: '🚀', value: 50  },
    { type: 'heart',      name: 'Сердце',           emoji: '❤️', value: 15  },
    { type: 'bear',       name: 'Мишка',            emoji: '🐻', value: 15  },
    { type: 'diamond',    name: 'Алмаз',            emoji: '💎', value: 50  },
    { type: 'champagne',  name: 'Шампанское',       emoji: '🍾', value: 50  },
    { type: 'cup',        name: 'Кубок',            emoji: '🏆', value: 100 }
];

let pendingCasePrize = null;
let pendingCaseType  = null;
let selectedCaseType = null;
let selectedCaseCurrency = 'silver';

function selectCase(type) {
    selectedCaseType = type;
    const cfg = CASE_CONFIG[type];
    if (!cfg) return;

    const modal = $id('case-select-modal');
    if (!modal) return;

    // Название
    const nameEl = $id('case-modal-name');
    if (nameEl) nameEl.textContent = cfg.name;

    // Цена
    const priceEl = $id('case-modal-price');
    if (priceEl) {
        if (cfg.free) priceEl.textContent = 'Бесплатно';
        else if (cfg.strike) priceEl.textContent = 'Требуется 7 дней подряд депозита';
        else if (cfg.goldCost) priceEl.textContent = cfg.cost + ' серебра  или  ' + cfg.goldCost + ' 🟡 золотом';
        else if (cfg.allowGold) priceEl.textContent = cfg.cost + ' 🟡 золотых';
        else priceEl.textContent = cfg.cost + ' серебра';
    }

    // Кнопки валюты
    const currDiv = $id('case-modal-currency');

    if (cfg.free || cfg.strike) {
        if (currDiv) currDiv.style.display = 'none';
        selectedCaseCurrency = null;
    } else if (cfg.goldCost) {
        // peace — и серебро и золото
        if (currDiv) currDiv.style.display = 'block';
        selectedCaseCurrency = 'silver';
        setCaseCurrency('silver');
    } else if (cfg.allowGold) {
        // звёздные — только золото
        if (currDiv) currDiv.style.display = 'none';
        selectedCaseCurrency = 'gold';
    } else {
        if (currDiv) currDiv.style.display = 'none';
        selectedCaseCurrency = 'silver';
    }

    // Обновляем баланс в модале
    const balEl = $id('case-modal-balance');
    if (balEl) {
        const silv = userData.balance.silver || 0;
        const gold = userData.balance.gold || 0;
        balEl.textContent = silv + ' F серебра  •  ' + gold + ' 🟡 золота';
    }

    // Подарки из CASE_GIFTS с процентами
    const oddsList = $id('case-odds-list');
    if (oddsList) {
        const weights = [2, 3, 3, 2, 2, 1];
        const total = weights.reduce((a,b)=>a+b,0);
        const colors = ['#a78bfa','#f87171','#fbbf24','#38bdf8','#34d399','#fcd34d'];
        oddsList.innerHTML = '';
        CASE_GIFTS.forEach((g, i) => {
            const pct = Math.round(weights[i]/total*100);
            const el = document.createElement('div');
            el.className = 'case-odds-item';
            el.innerHTML =
                '<div class="case-odds-left">'
                + '<span class="case-odds-emoji">' + g.emoji + '</span>'
                + '<div><div class="case-odds-name">' + g.name + '</div>'
                + '<div class="case-odds-val">' + g.value + ' F</div></div>'
                + '</div>'
                + '<span class="case-odds-pct" style="color:' + colors[i] + ';">' + pct + '%</span>';
            oddsList.appendChild(el);
        });
    }

    checkCaseBalance();
    modal.style.display = 'flex';
}

function closeCaseSelectModal() {
    const modal = $id('case-select-modal');
    if (modal) modal.style.display = 'none';
    selectedCaseType = null;
}

function setCaseCurrency(type) {
    selectedCaseCurrency = type;
    const silverBtn = $id('case-currency-silver');
    const goldBtn   = $id('case-currency-gold');
    if (silverBtn) {
        const active = type === 'silver';
        silverBtn.style.borderColor   = active ? 'rgba(123,92,255,0.7)' : 'rgba(255,255,255,0.08)';
        silverBtn.style.background    = active ? 'rgba(123,92,255,0.22)' : 'rgba(255,255,255,0.04)';
        silverBtn.style.color         = active ? '#c4b5fd' : '#555';
        silverBtn.style.boxShadow     = active ? '0 0 14px rgba(123,92,255,0.3)' : 'none';
    }
    if (goldBtn) {
        const active = type === 'gold';
        goldBtn.style.borderColor     = active ? 'rgba(252,211,77,0.6)' : 'rgba(255,255,255,0.08)';
        goldBtn.style.background      = active ? 'rgba(252,211,77,0.12)' : 'rgba(255,255,255,0.04)';
        goldBtn.style.color           = active ? '#fcd34d' : '#555';
        goldBtn.style.boxShadow       = active ? '0 0 14px rgba(252,211,77,0.25)' : 'none';
    }
    checkCaseBalance();
}

function checkCaseBalance() {
    const cfg = CASE_CONFIG[selectedCaseType];
    if (!cfg) return;
    const warning = $id('case-balance-warning');
    const btn = $id('case-open-btn');
    if (cfg.free || cfg.strike) {
        if (warning) warning.style.display = 'none';
        if (btn) btn.disabled = false;
        return;
    }
    const currency = selectedCaseCurrency || 'silver';
    const cost = (currency === 'gold' && cfg.goldCost) ? cfg.goldCost : cfg.cost;
    const balance = userData.balance[currency === 'gold' ? 'gold' : 'silver'] || 0;
    const enough = balance >= cost;
    if (warning) warning.style.display = enough ? 'none' : 'block';
    if (btn) btn.disabled = !enough;
    if (btn) btn.style.opacity = enough ? '1' : '0.45';
}

function showCasesList() {
    const listPanel = $id('cases-list-panel');
    const openPanel = $id('case-open-panel');
    if (listPanel) listPanel.style.display = 'block';
    if (openPanel) openPanel.style.display = 'none';
}

function confirmOpenCase() {
    const cfg = CASE_CONFIG[selectedCaseType];
    if (!cfg) return;

    // Проверки
    if (cfg.strike) {
        const streak = userData.depositStreak || 0;
        if (streak < 7) { alert(`Нужно ${7 - streak} дней подряд депозита!`); return; }
    }
    if (cfg.free) {
        const today = new Date().toDateString();
        if (userData.lastDailyCase === today) { alert('Ежедневный кейс уже получен сегодня!'); return; }
        userData.lastDailyCase = today;
    }
    if (!cfg.free && !cfg.strike) {
        const cost = (selectedCaseCurrency === 'gold' && cfg.goldCost) ? cfg.goldCost : cfg.cost;
        if ((userData.balance[selectedCaseCurrency]||0) < cost) { alert('Недостаточно средств!'); return; }
        userData.balance[selectedCaseCurrency] -= cost;
        userData.taskProgress=userData.taskProgress||{}; userData.taskProgress.casesOpened=(userData.taskProgress.casesOpened||0)+1;
        saveUserData(); updateBalance(); updateTasks();
    }

    // Скрываем панель, открываем кейс
    closeCaseSelectModal();
    openCase(selectedCaseType);
}

function openCase(type) {
    pendingCaseType = type;

    // Случайный победитель (взвешенно: дешёвые чаще)
    const weights = [2, 3, 3, 2, 2, 1]; // rocket50, heart15, bear15, diamond50, champagne50, cup100
    const total = weights.reduce((a,b)=>a+b,0);
    let r = Math.random() * total;
    let winIdx = 0;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) { winIdx = i; break; }
    }
    pendingCasePrize = CASE_GIFTS[winIdx];

    // Показываем модал
    const modal = document.getElementById('case-open-modal');
    modal.style.display = 'flex';

    // Скрыть результат
    document.getElementById('spin-result').style.display = 'none';

    // Строим ленту: много случайных + победитель в позиции ~60 (из 80 итемов)
    const track = document.getElementById('spin-track');
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
    track.innerHTML = '';

    const ITEM_W = 100; // px (ширина + gap)
    const WIN_POS = 62; // индекс победителя в ленте
    const TOTAL_ITEMS = 80;

    const items = [];
    for (let i = 0; i < TOTAL_ITEMS; i++) {
        const g = (i === WIN_POS)
            ? pendingCasePrize
            : CASE_GIFTS[Math.floor(Math.random() * CASE_GIFTS.length)];
        items.push(g);
    }

    items.forEach((g, i) => {
        const el = document.createElement('div');
        el.style.cssText = `
            min-width:90px;height:90px;border-radius:12px;
            background:rgba(123,92,255,0.12);border:1.5px solid rgba(123,92,255,0.3);
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            flex-shrink:0;font-size:2.4rem;gap:2px;
        `;
        el.innerHTML = `${g.emoji}<span style="font-size:0.55rem;color:#a98fff;font-weight:700;">${g.value}F</span>`;
        track.appendChild(el);
    });

    // Вычислить смещение — победитель по центру viewport
    const viewportW = document.getElementById('spin-viewport').offsetWidth;
    const targetOffset = WIN_POS * ITEM_W - (viewportW / 2 - 45) + Math.random() * 20 - 10;

    // Запуск анимации
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            track.style.transition = 'transform 4s cubic-bezier(0.12, 0.8, 0.2, 1)';
            track.style.transform = `translateX(-${targetOffset}px)`;
        });
    });

    setTimeout(() => {
        // Подсветить победителя
        const winEl = track.children[WIN_POS];
        if (winEl) {
            winEl.style.background = 'rgba(255,215,0,0.2)';
            winEl.style.borderColor = 'rgba(255,215,0,0.8)';
            winEl.style.boxShadow = '0 0 20px rgba(255,215,0,0.5)';
        }
        // Показать результат
        document.getElementById('spin-prize-icon').textContent  = pendingCasePrize.emoji;
        document.getElementById('spin-prize-name').textContent  = pendingCasePrize.name;
        document.getElementById('spin-prize-value').textContent = `Стоимость: ${pendingCasePrize.value} F`;
        document.getElementById('spin-result').style.display = 'block';
    }, 4200);
}

function claimCasePrize() {
    if (!pendingCasePrize) return;
    const val = pendingCasePrize.value;

    // Добавляем подарок в инвентарь
    if (!userData.inventory) userData.inventory = [];
    const tier = val >= 2000 ? 'legendary' : val >= 500 ? 'rare' : val >= 100 ? 'epic' : 'common';
    userData.inventory.push({
        id: Date.now(),
        type: pendingCasePrize.type,
        name: pendingCasePrize.name,
        value: val,
        tier: tier,
        receivedDate: new Date().toISOString(),
        status: 'active',
        source: 'case'
    });

    userData.casesHistory.unshift({
        timestamp: new Date().toISOString(),
        case: pendingCaseType || 'unknown',
        reward: pendingCasePrize.name,
        val
    });
    if (userData.casesHistory.length > 20) userData.casesHistory = userData.casesHistory.slice(0,20);
    saveUserData();
    updateBalance();
    updateCasesHistory();
    if (typeof updateInventory === 'function') updateInventory();
    if (typeof updateProfileGifts === 'function') updateProfileGifts();
    document.getElementById('case-open-modal').style.display = 'none';
    showNotif('🎁 Подарок добавлен в инвентарь!', '#7b5cff');
    pendingCasePrize = null;
    pendingCaseType  = null;
}

function closeCaseModal() {
    document.getElementById('case-open-modal').style.display = 'none';
    pendingCasePrize = null;
    pendingCaseType  = null;
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
        const grid = document.getElementById(gridId);
        if (!grid) return;
        grid.innerHTML = '';
        if (!items.length) {
            grid.innerHTML = '<div style="grid-column:span 3;text-align:center;color:#333;padding:36px 0;font-size:0.85rem;">Пусто</div>';
            return;
        }
        const EMOJIS = {bear:'🧸',heart:'❤️',rose:'🌹',gift:'🎁',cake:'🎂',champagne:'🥂',bouquet:'💐',cup:'🏆',ring:'💍',diamond:'💎',crown:'👑',rocket:'🚀',star:'⭐'};
        items.forEach(g => {
            const icon = EMOJIS[g.type] || '🎁';
            const isSold = g.status==='sold';
            const card = document.createElement('div');
            const tierClass = g.tier ? 'tier-'+g.tier : 'tier-common'; card.className = 'inv-gift-card ' + tierClass + (isSold?' inv-gift-card-sold':'');
            const tierNames = {common:'Обычный',rare:'Редкий',epic:'Эпический',legendary:'Легендарный'};
            const tierName = tierNames[g.tier||'common']||'Обычный';
            card.innerHTML =
                '<div class="inv-gift-tier-badge">'+tierName+'</div>'+
                '<div class="inv-gift-emoji">'+giftIcon(g.type,52)+'</div>'+
                '<div class="inv-gift-name">'+(g.name||'Подарок')+'</div>'+
                '<div class="inv-gift-value"><span>🟡</span><span>'+(g.value||0)+'</span></div>'+
                (!isSold ? '<div style="font-size:0.6rem;color:#555;margin-top:6px;">нажми для управления</div>' : '');
            if (!isSold) card.onclick = () => showManageGiftModal(g.id);
            grid.appendChild(card);
        });
    }

    const now = Date.now();
    const active=[], ready=[], sold=[];
    (userData.inventory||[]).forEach(g => {
        if (g.status==='sold') { sold.push(g); return; }
        if (g.status==='withdrawn') { sold.push({...g, name:(g.name||'Подарок')+' (выведен)'}); return; }
        const unlock = new Date(g.receivedDate || Date.now()).getTime() + 21*24*60*60*1000;
        if (now >= unlock) ready.push(g); else active.push(g);
    });
    renderMcGrid('inventory-active-grid', active);
    renderMcGrid('inventory-ready-grid',  ready);
    renderMcGrid('inventory-sold-grid',   sold);
    // Обновляем счётчики
    const elActive = document.getElementById('inv-count-active');
    const elReady = document.getElementById('inv-count-ready');
    const elTotal = document.getElementById('inv-total-value');
    if (elActive) elActive.textContent = active.length;
    if (elReady) elReady.textContent = ready.length;
    const allItems = [...active, ...ready];
    const totalVal = allItems.reduce((s, g) => s + (g.value||0), 0);
    if (elTotal) elTotal.textContent = totalVal;
    // Показываем/скрываем empty states
    const emptyActive = document.getElementById('no-active-items');
    const emptyReady = document.getElementById('no-ready-items');
    const emptySold = document.getElementById('no-sold-items');
    if (emptyActive) emptyActive.style.display = active.length ? 'none' : 'block';
    if (emptyReady) emptyReady.style.display = ready.length ? 'none' : 'block';
    if (emptySold) emptySold.style.display = sold.length ? 'none' : 'block';
}

function showInventoryTab(tab) {
    document.querySelectorAll('.inv-tab-panel').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.inv-tab-btn').forEach(b => b.classList.remove('active'));
    const content = document.getElementById('inventory-'+tab);
    if (content) content.classList.add('active');
    const activeBtn = document.getElementById('invtab-'+tab);
    if (activeBtn) activeBtn.classList.add('active');
}

// ===== ПОДАРКИ =====
const GIFT_EMOJIS = {bear:'🧸',heart:'❤️',rose:'🌹',gift:'🎁',cake:'🎂',champagne:'🥂',bouquet:'💐',cup:'🏆',ring:'💍',diamond:'💎'};
const GIFT_IMGS = {
    bear: 'data:image/png;base64,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',
    heart: 'data:image/png;base64,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',
    rose: 'data:image/png;base64,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',
    gift: 'data:image/png;base64,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',
    cake: 'data:image/png;base64,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qxajdu26QfeIHxUoax2oVH0XZ3fpQcE0MjAfxN3fzXIK6m291P0fZdc2g4dM6KMf+40n4ArllWr2RIiIrIEREBERAREQEREBERAREQEREBdpaaqfpmnLZV5z29JFJn8TAfzXFq652TVP0rZtYZc53aRsf+TLP9qrZMNt2929TxP6sB+CucCs9kdvW+A/s493BXiBVSr4uSmYoYuSmYoSlapWqJqlaoEzVI1RNUrUSkapWqJqlaiUrVK1RsUjFAlapWqJqlaoSkavS8t5L0iJMpkoiD7koHFfEQfd4r7vnxXlO9B633JvleUVh93nJvFfEQfclfERAXxy+r47kgiconKVyicgiconKVyicgjconKVyiciqJ6icpXqJ6CJyicpXqJykROUMnJTOUMvJBQ1Cx3VTsUbG9ZB8isinWL6td9QzxcfkpQ0b5TVT2WhKSAHjNcGA+oMefnhc4re3lT1OKWw0YPpPmlI9QYB/EVolXr2RPcREUoEREBERAREQEREBERAREQEREBdQeT3U9vsxoo//wBeaaP/AKy7/cuX10R5MFTv6OuNKTxiry8epzG//wCSq27Jh0Fpt29b2j7riPjn81fYFjmlXZppG9H594WRwdyqlXxclMxQxclMxQlK1SsUTVMxQJGqVqjapGolI1StUTVK1EpWqVqiapWqBK1StUTVK1QlI1el5avSIkREQEREAp3oiAiIrAiIgIiIC+O5L6vLkEblE5SuUTkETlE5SuUTkEblE5SuUTkQieonKV6iciET1E5SvUTlIicoZOSmcoZOSChnWI6rdmtjb0jz7yf5LLqhYXqR29dXj7rWj4Z/NShzR5UNTv6rtdJn6qh7T/M9w/2LUS2J5Q9T2+02qiz/AGenhj97d/8A3LXavHZEiIilAiIgIiICIiAiIgIiICIiAiIgLd3ksVOJr/Rk+k2CVo9W+D8wtIravkyVPZa5rKcnhNb34HUtew/LKieyYdU6Td+knZ1DT81lMHcsQ0s7Fwc370Z+YWYU6olXRclM1QxclMxQlKxTNULFK1QJWKVqiapWoJGqVqiapWoslYpWKJqlaoErFK1RNUrVCUjV6Xxq+oiRERAREQEREBERWBERAREQF8cvq+OQROUT1K5ROQROUTlK5ROQRuUT1K5RPRVE5RPUr1E5BE5ROUrlE5SInqGXkVM9QyckFDP3rBLy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cf4d5Xam2m6EqMdnqOmbn/iMfH/E0LkxFHLBu7Eg1lpGf6vU9mJ6GtjB9xKrY77Y5RmO8254/ZqmH81xcicpu7ZZX0LxllbTO9UrT+akZU07xlk8TvU8FcRInKnd246qpWnDqmFp6F4UT7nbY879wpG455maMfFcUInKbuzptR6eh+uv1rj7vPq4x8yqGo11o2AZfqe0n8FUx/8ACSuP0TlRu6tqtqugqckOv7Hkd0dPK/PtDcKz1m27RkH1Ud0qT/y6cD+JwXNSJywbt71+32lbkUGm5pOHB09SGY9gafmsduW3PVU4LaOitlG08j2bpHj2l2PgtVIp2g3ZZddo+t7lkT6irIwe6nIhH/QAsYqaiepmM1TNJNIeb5HFzj7SokUoEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQf/2Q==',
    bouquet: 'data:image/png;base64,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',
    cup: 'data:image/png;base64,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fH+W7vXma/8AyMYp902VFhu1UsolbE97hs03Z5LcNAAyAAGWoKLiWTL74/vX0SyfjH96gqUalR5lLJJGUY8ESlfVFt9k/GP9JN9k/GP9JR+aPqZ9r7iVBdkUUkz9CJhc7mAUTEso2SP9IqW7nz3OZWl7icizWT9ZRztnCOcmUam08EM3RbWLfcKeYta19Swue0HlBGtV5iho0YHZa83D2K0t1ypp57jRMhnjkdHG4PDHA6OZG3mVXYo+9wdbvcum0nOzDJotZS7Gfy+6NEiIuhONCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCzrRXcDnOkCYn6nAcnSsFFjKKmsMkpVZUpqceKJnBPDOzThka8dBXYoSCWnMEg9C7BU1AGQnl9Mqk7LozdQ1rd60PEmWZ50zPOobwmp84l9Mpwmp84l9MrHzF9TL01DueJMszzpmedQ3hNT5xL6ZThNT5xL6ZTzF9R6ah3PEmWZ50zPOobwmp84l9Mpwmp84l9Mp5i+o9NQ7niTLM86ZnnUN4TU+cS+mU4TU+cS+mU8xfUemodzxJlmedMzzqG8JqfOJfTKcJqfOJfTKeYvqPTUe54kyzPOmZ51DeE1PnEvplOE1PnEvplPMX1HpqPc8SZZnnTM86hvCanziX0ynCanziX0ynmL6j01HueJMszzpmecqG8JqfOJfTKcJqfOJfTKeYvqPTUO54kyzPOUzPOVDeE1PnEvplOE1PnEvplPMX1HpqHc8SZZnnKZnnKhvCanziX0ynCanziX0ynmL6j01DueJMszzlMzzlQ3hNT5xL6ZThNT5xL6ZTzF9R6ah3PEmWZ5ymZ5yobwmp84l9Mpwmp84l9Mp5i+o9NQ7niTLM85TM85UN4TU+cS+mU4TU+cS+mU8xfUemodzxJlmecpmecqG8JqfOJfTKcJqfOJfTKeYvqPTUO54kyzPOUzPOVDeE1PnEvplOE1PnEvplPMX1HpqHc8SZZnnKZnLLM5FQ3hNT5xL6ZQ1FQds8p/PKeYvqPTUe54kummihZpSyNYOkqM3et4ZUAtBEbBk3Pl6VhuJcc3Ek85XxWKNsqbznLKN5qM7iOwlhBERWTWhERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAf//Z',
    ring: 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAIAAgADASIAAhEBAxEB/8QAHQABAAIDAQEBAQAAAAAAAAAAAAYHAwQFCAIBCf/EAE8QAAEDAgMEBgcEBggDBgcAAAEAAgMEBQYRIRIxQVEHEyJhcYEUMkKRobHBI1Jy0RUzQ2Lh8AgWJIKSorLCU2NzNERVg9LxFyVFdISTo//EABsBAQADAQEBAQAAAAAAAAAAAAABAgMEBQYH/8QANxEBAAICAAQEAgcHBAMAAAAAAAECAxEEEiExBRNBUSKBBjJhcbHR8BQVQlKRoeEWI0PxcpLB/9oADAMBAAIRAxEAPwDxkiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIstJTVFXUMpqWCWeaQ5MjjYXOce4DepdT9F2OZoRK2yFoIzDX1ETXe4u081MRM9kTaI7yhiLq3rDt9sriLpaaulA023xnYPg4aH3rlKOxE77CIiJEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERARFOuhTDNJiTFbv0gwS0dFF1z4jukdmA1p7t5PhlxUxG50ra0Vjco9hzC1/xDJs2i1z1DM8jLlsxt8XnIZ92eatHDXQi3ZEuIrqS7/gUY0Hi9w+Ab5r0bgjAVwv1E2elNNQ26MmMPcMgMgNGtHAZ9wVg2vB+EbJk+dr7vVN4yasB/Du9+a3jHWPtcls15jfaHlKq6G8HywbEX6Qp35aSMnzPucCFVPSH0d3bCbzUtJrrY49mpYwjY7njXZ8dx+C/oZem0V0pjSy2yiZARkGtiG0PB2WY8slU2MsORW5zoJHw1VHUAt6uTIkg7w5p3jv3K9sMTDOvETWe+3hdFbHS10Yi1Mfe8PMe+kdIBLSAFzoy45As5tzIGW8Z8Ruh1t6P8a3FrXU2Grjsu3Oli6oHzflosq8PlvOqVmfujbfJxvD4q82W8Vj7ZiPxRhFYVP0NY/lGb7VBB/1KuP8A2krab0IY4IzLLc3uNT/BdMeF8ZP/ABW/pLgt9IvCq9J4in/tCs1v2Cz3C+3SK22yndPUSnQDc0cXOPADmpxN0K48Z6tHRy/hqm/XJW70UYKfhfDUYqbd1N0nzNW4ua92YJyaC0kbOWRyHPmn7s4qJ+LHaI+6T/UHhto+DPSZ/wDKPzbHRhgKlw5Sx0dFCKu6VGQmqNntPP3RyYP4lXTaujSCqpGuqMRQwVJGsYgJa08sy4Z+5RvCl7p7I9/X25z3yHIyg5PA5AH+Cm9uxJZ67IR1jI3n2JewfjofJTycvTsmMsX+KOsI5eujDElIx5gip7jDl+xf2iO9rsvcM1U+L+i3D1U98V0w6bbVEHKSKIwPB55DIO8wV6UFxfQQun9LMMTBtOcXdnL5KA9IOM3YiporeyFjoYJesE5bk9xyI0HAa+eipNfdpF4716PC2NsPVOF8R1NoqHiTq8nRSgZCRh1DsuHI94K4qsn+kRUw1GOIBEQ7qqFjHOHE7bz9VWy5LRqdPRx2m1YmRERVXEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBWP/R/u0dtxbUQTHKOqpi3za4EfDNVwujhm4G1X+jr88mxSjb/AAHR3wJVqzqYlTJXmrMPa2HMU3C2wCOkqRPROdtGEuzYSd5HIqZR40tBohO8TNm4wBuZz8d2So3C1QW3BsQO0yZuQA3Z7wf55qc01GG9qXtHlwXs8FwWbi78uOOnrPpD5bxfxfhfC8XmZ56z2iO8/r37O3ccVXe4Zsomiih+8Dm4+f5LjilDnmSd75pHHMlx3lSC3WGoniE9S70WDhtDtO8Aujh+nFLieljhi2onbey8jNxOyfcvo8XAcHwtZmY57R79vy/F8Hk8Z8U8Wy1x0t5NLT6d/wCvf8IROXq6WMue3qwN+ixTVbY6dswY5wPDcrAxJg+CtrnVUszooZiDIyMDPa4nPhn5rbpLHaKWEbFBE/k6QbZ08V218Uw1pXlj5Q5L/RyIy28202+2Z7/r71cWqU10mRjc1u1l2e0VIKewTzyiNjJ8zxLMgFPqV7Y4gyNrWNAzyaMgu5bJR1QOep3rh4nxjJG5pXXz/wAOvB9HOFvaIn9f3QKy4KpJ4y6sqpy7lGA0fEFdKs6MBPSma0XA9YP2VQBkf7w3e5WFA5jgNtrXeIzW3EyJrfsxsZ8l42Txri4tzVt+Gn1WH6L+E3x8l8Xz3MT+LzrcLTW0dVLSzw5yRHJ7RrkeS5c1HESQWFju7T4K3elijdR07b11L5Ws7Ezo2k6cCeXEZ+CpqsxRVS1ALIYjCN8cjcw4fMeIOa+o4K37zwxa9ImP/r5DjPCb+FcRMcJmtSfT7vt1/kniq2wdSJpJIAdoM2jkDzyUWxRWSwujpopCzabtPy3kcPqrKs9FT4gon1FneW1Mf62jkd2h3tdpmFGMS4eZWueHsdTVsembgR5OC8jjPA6Wmf2adTHes/r/AB9r2eB+lPE8JNcfidPht2vHb56/vrUx7PJXSPV+l4xrnA9mJwiH90AH45qOrrYutd2s+IaujvVO6Cs6wveDqH5knaaeIPNclfG5K2raYtGpfp+G9L462pO4mOkx6iIio1EREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBZKaCaqqI6amifNNK4MjjY3NznHQAAbysav8A/o44GbT0oxhc4c55QW0DHD1GbjJ4nUDuz5ru8P4G/G54xV+c+0PI8c8YxeEcJbiMnWe0R7z6R+f2LE6NMN1Vnw/QRXINmuvUtZIWdrZ0yDRzOWQJ4lWdbqKCzRitr4mzTewzPRp7uZXVwVao7aYbjcGNLpmkNa8fq2ncfE/JMTWyeWoMtJnJEdOpO9vhzX2nnYseuFxdKR6+/wA35fg8Py8ReeN8Q65L9Yj+WPTp+Een3tSG4fpao2G7TCN+0NGhd2kjhpGfYntcX56lcmlp4qOnEcWh3uPMoZnNdoSPBc+SvP0r2dccDOCefvPu7Lq6XIxzASMPHcVkl0pY+7f5rkMmc5uuTh8Vux1PXU7mOPaA9657Y9a066XtaJi/dkil0dryC6ltqcgG5qPRvyaR3rcpXkEHNRlxRMIxZJrO0wpqjQardjqBlvUXp6rLLMrfhqgRvXl5OHevi4zo7FVMHMDDrnwVe4rwVYqenmudHZo5Mu3LCwkeJGug7gpaJHudtE5raheeKvw+XJws7pOvfr3Y5rV4i3xQr7CdtobU11xkgho3PHZbu6sd5PEreutJacVU7/Rn7FZF6s2xltdx5j5fPmY2tzqS+F8srnUso24WuOjebfI/AhaluuPotRG+AOc8HINaN/cvZil8muIraeb0/J5vEcbi1+x2xc2P+L849p9VW9LfR/T4otstrr2CluVKSaWcjWN3I82HT4ELyJeLdWWi6VFsuEDoKqneWSMPA/UHeDxC/pbi+xuvNmFxgh2auFm0G5dp7d5ae8cP4ryf/SSwYyutIxZQxf2ujAZVho/WQ56O8Wk+4nkuXxPh6eIcPPFY41ev1o9/1+HT0a+A8Zl8C4+PDs9t4cnWkz6TPp8+0/bqem5ed0RF8g/ThERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQFKejHCrsW4ohoZuvZQRgyVksWW0xgByAJ0BccgNDlnnkclFl6N/o/2plFgNlZ1f21wnfI45alrTsNHhoT5q+OvNOmWW/JXcOpaeizBtPK5sFjNW9xzAme6Ugcst3wXYj6NrAANnBtMf8A8LP6L0NFY6XD9vo6CCJrZepD6h43ved5J5aaIuutKzDz75LROpl56nwLhykc30jCNthLvV623sGfvarC6PrfSzSwCoEUVHSsGTMgG5DRrQOWnuC/ek6Xau1NDn6kG173H8l17dh6WLDdJNET10kYlcx2gdtajLyXr+D3jHkvHNrca/u+d+kGCvEVwzeu+W3N1+yJ6fOdb+50sVXu3bHohroWlw2j2xn3LPaMQWueBsj66F0rGAPAfn2lU8trud0uk8vUPjZtkbcoLQANApvhDD1PSUL3PD53l+pAz4Dhw819JxXA8NgwxE33P2PCjj8/G5+aax0duvqqarzkpg8uPtDLIrWpKd05LjK1uW8e17lmnc2MbIa5gHAtIWg+RjnbTX5PG4g6ripHw6q0tMxb4nSnibDGHRknI9rM71ibMQ4Fu8LHBVPI2JwHA6ZhfUTAH9k5gbioiJj6ybRFvqs0biTuWxC5wd3LFGzVbDGaqlphXypbUJJIW9DJsgBaMIy0W5E3cuTJpvTHMNyOZx3DJbUMmXFaLNBotmnjcTm45LkvEaaVrbbi9JcRlsMNSyMySQzgADk7Q/HJQ2CSrtcIqZSylJGfayLgOeo0CsTFdVHRWCaZwBO00NB55qmLzJdb1Uu6uCXqc89p3ZDu/XhyXseFY5y4+W3SsT6ubj7VxfFH1vsWRgvEzrhtxtrGykDaAyAI56ZKvukikiiv9ZRmNppahmboiOy5rx2mkbiN+nJalhjitd6ppZrjEJNvY2IM3nXTU6Ab+a3Mdz+lXOGftH7EMzcRmcieXisPF+F/Zom2GfhnW/T/ALdvg2anFzWuesTau9b66/JCj0c2J7Gu/qXSbJ1BbbwM/cFr1PRrhrYd12EaeNuWpFMWZeYyyV84Zl67D1A//kNafIZfRdJfOeXD6vzbe7x5jfoksH9Xq6pw/S1UVyjHWwRtmL2PA3sydruzyOe/mqEIIORGRC/od0t2Kloo7ZeKOFsTauPYna0ZN6xoGTsuZGefh3rxF0zWuO1dIdxZCwMiqC2pYB++M3f5tpcuWkR1h3YMkzPLKGoiLF0iIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiIC9h9Cltb+iMI27Z0lZTbY/Hsud8yvHi9T2XEFRQWOySWmYwzMooJGSt1LOwCMu9bYe8ubiZ6Q9V4oeDdHZkAMYB9fquQ2aJzi1srHEcA4Feaat98vEpqa2oq6yR+pkqJS4nzcVhNqrsv1IP8AfH5rqrOo04bRzTMrQx7KZsUTsGvVtYwf4QfqrYjDzRR0cDQGxxBm0RoABkvNuHrJiCS90UUEMjHOladpz+yADmc9d2S9LmtggpHMZE/dqdNV3YMWTHM81ZifteFxuTheKmv+5ExXfad/gjFxtM0WZjPWN7t6WpzHxSQyN2ZGnMEaE/x0W/VXOPX7MjxcFzjX05qAXRjXQkO1Xs1m9q6mHmTiwVtzY7fi+5n1DDk2TbHJ+vxWFsjXHKWMg894W1MWtaXP3DiuZPNM92zEBE3779M/Ab1bHHMmZtX1bUr6aIAZMLjuACzU7QRmNc+SxWy3tlO3m6Qne525dR1IAdhugG5VyXrWeWJbUw2tHNMPiOMFbEcfcv2GEhuRGoK3YYiW6rmvk06K8OwsiWzDG7ks0MOmeS2I4yOGi5rZGscOwiPIZ8VlpIZpX5RtJ7+CymPPIDXNdGJ8dLTl73BrGjMlc98k66L4+Gi1uvZxcT4er7rRw0kNTDGQ/bdtZ8sh8yqrxjgbF9AC+cmqpuBiOTf58Vc9HcHyzGRxGp0HILpyV0b4HRSsD2uGRHNb8L4nxHB2iIiJj7mvEeC8LxVOszE/r0eTuoqKOtjbPC+J7Xg5PblxXavsnWtidnuJCsvENfYv0jPbq+jiLmO0c5p1G8EjIhQ3HuGBdrSz+qO1PWtkDpaaKXtOZkcy0HXQ5aL1/EfEa8Vwsxaup1+UvA8P8PvwPFxMW3G/aY94SLAM4fhiAOcB1b3szJ/eJ+q7rJYnnJkjHEcnArzpe8JYmtJh/S1tlpjOCYxLI3MgZZ6Z5jeN65xtVe3URajk8fmvlYs+xiObrD0n0nw+kdGtPLxp6prv9Tf9wXiL+krTBmJrZVgay0ZjP915P+5WtDf8RW+jfbXXCr9DkILqaV5dGcjmCAd2vEKrf6RdZFWSWCRgycYpi4Z6jtNGXwKwyR8MurDPxwqVERcrvEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQFcXRZexcbA2hlkBqaICPI7zH7J8t3kOap1btkulXZ7jHXUT9mRm8Hc4cWkcQVeluWds8tOeunq22VjKuAagSNGT2/VbarjB2Jae80ja2if1c8eQliJ1YeR5g8Cp7bq2OsizHZePWby/guyt4lxTS0R1ejsFWu0V2F6G8Q0UIrZqIMfKM/XDdlxy3A5g6r4NtqaqkL4oetY7MENOZB5Zb1yOgS7tqLHVWaR/2tLJ1kY/5bt+Xg7P/EFOWE2urlbGBlKdsZj5LrxcRkjfXc+m3zWXgKxl5aRqNzPSPf1QefDF0cS6OleW79k5B3uJUWvNXPa5jTSWyop5cv8AvDS0nvA4hXfBVPkGb3aeC/L1QW68211Fcadk0Z9Ukdph5tPAruw+L2raIzV3H2frq24jwu2fFqmSYmPfXVRlrvkkzhT1kojH7Nw0A7iu0ylJOe9c6/4TdSVk0NPL2mOI2X7jyIPgviwVN1t9dHTVVO+WnGva9kDk76L3bxjyU58M/J89gyXx28vPHzTi3R+jxNjLdANct623Rh0mY3FY6Ovt8zW5zNikd7EnZP5LpRQh2RbkQdxC+fyWmJ3aH0+KIvWIrO4aph7G7XNbUUOWQW3HTZgacVmigO1uXPbK66YGsyPLgsrY9V9Vs9FRR7dZVQwDLPtvAz8OajdxxpQMc6K2xOqpANHuGyzP5n4JjxZc31I2xzZMWL69tJDUy09HCaipkbHG3e4/LvKi9wvEtxnaIgWU7DmxvE95UdrrjV3KQT1sxeRuYNA3wC/aSpOYDXAD4r0sXA+XHNbrLx83iETblr0j8UvoKnQa6rcqKg9UXA7tVwLfIHdknI8CuixzndjLMkeS5smOItt2046Ip1RfELaevurzOzPZaB1jNHA5fHwPwUg6MrIKOaruDpWTBwEUTgMiBvdmOB3LgyUcwuLqRrXPlMmyObidxU6r6qlwnhKWpmc0imiJAz/WSHcB4nRa+JTTHirWvefwPrzuPVT/AE2XMV+NX08bg6OiibDpu2vWd8Tl5KDrLW1M1ZVzVdQ8vmmeZJHHi4nMlR68XLb2qend2dz3jj3BeJMxWHt4seqxWGG+1jJ5RHGQY48+1zK8/wDSHev03iOSSN2dNTN6iEg6FoJJd5knyyUm6ScYtLZbLapc882VMzT72NPzPkq2XLlvvpDswYpj4pERFi6RERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERBvWO61lmuDK2ik2JG6EH1Xji0jiFeGDsS095pG1tE/q548hLETqw8jzB4FUCt6x3Wss1xjrqKTZe3RzT6r28WkcQrVtpS9OZ7J6NsUm03+lucWeTTsVMQ9qM+sPqO8Bem5BBc6GGpp5GyMc0SRPadHNI+q8G4PxJT3ekZXUL+rmZkJYidWHkeYPA8V6L6EOkWCFjbJdJRHA532T3HSFx4H90njwPw66331ju8risEx8VVuse7PYAyy39yzUlXTyzSQsniklj9dgeCW+I4KDdKWNIbYXWy0SB1wcMppG6iEf+r5KraK33p0IulHDVEBxImiJ28+Yy181rN4tHRx4MV9bmV4YhYw1ZkyA7IzOSj8sXWnbI7I9UfVQSjxte4T1da8VrQciJhk8ZfvD65qTWzGFmq4hHM59JLylHZJ/EPrkvR4fiaRWI28jiuCzReb63E+z9rItuU8hovy1wzic9XUyw8cmPLSfct8sZIwSRua9jhm1zTmCPFYxE5rw9uhB0K9Xn3XTipEUvEyySXK6tqHNjr6gMYNn1ydVx6yuu77g5slzrHRlpOyZnZcOGa7jYBs6kFx1PitWrpftNrLeFXFalZ7Q6cuS8xM7lwjGXOLnZuJ3k65r6pISyq2eB3LfEHcssNNtSMcBq0/ArrnLqHj4bbtp+MphtbtD8CvkW+QynIAN5rLcbta7aC2qqW9YB+rZ2ne4bvPJR64Y3kyLLfRsZykm1P+EafNedk46uL1eh+7L8XEbr0/omdvt5jb1r5tiNurnuOTQpPQsppKVj4XMkjcMw9rgQe/NUc7+sWI5Np3pVW0HTPSNvhuaF08A4pnwxdDS10b3ULn5TREdqJ27aA58xxXlZeMtkncvRr4N5ePVZ6+y6aG0wR1/wCkHNzm2Nlvd3+PBU90x4sberoLTQybVBRvO04HSWXcT4DUDz7l3+lLpCp/Q3WfD9SJXzsHX1UZ0a0j1WnmRvPDdv3ULeLlntU9O7Tc9449wXLfJNvitL1OC4Wa6mS83LaLqand2dz3jj3BVB0i402Oss9nl7Wraioad3NrTz5lWb+jmVlLJFUmRscjdkhjy1xHiNR5LmQ4CwjF6tmiP45Hu+bleOCzZY5uzbJ4rw+C006zMe3/AG89IvR7MH4XbusVD5xA/NfZwphkt2f0Dbcv/t25/JP3Vf8AmhT/AFBi/kn+zzai9HPwfhd4yNioR4RgfJak/R/hCUHOzsaebJpG/JyifC8vpMLV8fwT3rP9vzefEV3VfRdhqXPqn11OeGxKCB/iBXEruiM5F1DegTwbND/uB+i8+cdoe1XJW0bhViKX3Po4xRRAuZSxVjBxp5Afgcj8FF62jq6GbqaylnppPuyxlp+KrMTC0TEsCIihIiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiIN+xXasstxZW0Umy9ujmn1Xt4tI5L0P0aVsWI6Jl4p9uKNjiyRh3h4AJbnxGoOfeF5pXoroVu9tg6OKOLaImhfKJGAHNzi8nf4ELXF3c/EdK7XVg/Dj7rKKura5tGw+BlPId3M/yLJiYyKNscbGsY0ZNaBkAF2rJTWO62CirLUGtpJYGmExncMtxHMbjxzWOqstRHrC5so5biu2I082Z2jd0tNsr2F1bSxOIH6z1XD+8NVVN59AgrZ/Q5HmkjJ2XyEagbz4KZ9Il7fAX2WAuZJl/aTuIB3N8+KqTHD5v0ORC4hvWDrcuLeXvyVZWrE6Xp0Qsp7vgSkrmOfsvllAB4ASOG7wGfmp9VYeh/Rxkp5Gu0Dtot1Kqb+ijc21uEbjZy8ddQ1XWBp/4cg0/zNd7wrxoHGMOglH2TwR4LWc94iNT2eRWlYz3rkj62+vttCau1Pip5JNtgyatCWnlFuNVG5jnREdYwjeDxUsvVPM+k6uGJ7y5wB2RnouZSWyva850xMbwWvaXAZtO9elizxNN2mHynFZuIx8XFKVma666iZ+fyca3ttlVk2SV1PLydo0+a68NuZSvbJ1IIHHeuY3DF1dK5ogaGAkB7ngA9/NdL0Sqw3Z6y6V1yY2kpIHzyxAbQIaCSBnlkdOCnPmpEdL/ACdFeFyZJj4Ziff/AAoa4V8FbiG8MieS6CvnjcCdchI4A+YCnuC7TYaq3sq2w9fUNIEgmOew7uG7LiFQeGKqrqcTvqi87UxfJPludnqfiQrPwzeJLRcG1DM3Qv0lYPab+YXj+r7msTywttoDWhrQABoAOCjeMMNsukZq6RoZWtGo3CUcj38j/IllqpJblTRVVNkaeVocyQnIEH4rs0tkgZkZ3ulPIaBX7q9nma9UtQ+mlij2op25gtIyJy3t7lwLdZa2oY2bqTkdzXNOverL6Y7vYYccTUtGWRuggY2ocxubTLmcxpxDdnPv8F3rPhySa3U01VK6Mvia4xgdpuYGhPNUiI3uWlrzy6j1VKbXcWHtU2fgcvmskduqDoY2g8i5XE7DtvYMzF1h5vJP8F+spIKU/ZRRx/gYAtL57+8q4eEwzH1I/oqqnsFwlGcdE9/gxx+i34cJ3d//ANOHnkPmrOZIOLisrXNO4lZedf3dMcLij+GP6K1Zgu7Edq3xD/zW/mvp2Brk4f8AYWeU4/NWUHDmV9tf3p5+T3P2TD/LH9IVPU4FusYzFDLl+7I0/VcypwxcYT2qaoB/6e18ld7ZOaxTxNeNwKy5m+lCzWqsjOXV7R5DQ+45Fc24UMFTG6mr6SOVh9aOaMEe4q96yhjcCCwLhXO0wTR7EsLHty0Dm55eHJQl5yv/AEZ2GvDpKDrLdMd3Vnajz72n6EKt8TYHv1iDpZKcVVKNTPT5uAH7w3j5d69UXbDUbc30riw/dOo/NRypppqZ+zKwjv4FVmkStFph5TRXti7o/tF7D56VrbfWnUSRt7Dz+836jI+Kp7EdgueH6z0a405Znn1cjdWSDm0/TesrVmGkWiXKREVVhERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBSzo5xKLHcTTVTv7DUuG2f+G7g7w5/wUTRTEzE7hW1YtGpet8B4vrrBO0U1dLFSykO2o36DPjluI7ldlj6SqxjWC5U0dXGRn1sR2XEc8tx+C8L9HGMP0e9lpukv9jccoZXfsjyJ+78vDde2F78aMtpap+1TO9V2/Y/gu3Hki0PNy4ppOpdrHeImPxTc5IoJMpqh0kbn6dlxzGnMZ5eS0ayFldQSQ5gtlZkD47itjGVtFVStuFOA58be1l7TOfkuLYK3T0SQ/8ATP0Vp6Sik+jQwFjG+4Cv01bZoaSaokZ6PLBVucInDaGeZbqCMtCr3tXTmHU8f6Uw4Y5su2aaq2m59200FUHjO39XOK+JvYk0ky4O4HzXbwBStvsToSZJKiHLajbxbwcT8P8A3W+CMUzPmPM47Fk6Tj+a+IOmqwSuDBaLuXnc1jIz/uXSi6ULbKwFlpuDXHc1+wD8HFQex4RILY9gNLv2cQ18yp3ZcL0dE0PliZt/dGvvO8peuP8Ahhz0x2j607blDiq7XI50ljbBHxlqZyB/hDcyq1/pJYxraPDUWG/SY/SLlk+dsUeyGwtPeSe04Djua5Whd66is1pqLjWyNhpaWMve7kBwHfwAXkbE93rcbYzqLhLm01EmUbDuhiHqjyHvOfNZTER2deHFEztt4JozHTSVjxkZTss/CN/x+S61XdmUVQIiwyAtzdkdQeC+ppIbdQNDRk1jQ1jefJcqxUEt4uwEmZjB25nd3Lz3Kr0Z6RpeOC8dm24Ht1JHQvkqgx7i6V2TGhz3Obu1PZI5KJ9IXSLenxOpBXFssg/VRdlkY78tT3A5ri4kvsVri9FpQ19Ts5AcIxwJ/JcjBOHZsSXb0ivkkZQtftVE290h+63vPPh7gpmfSGfSOrp9FOEJb9dBdbhGTbqd+0dsZ9e/7veOJ93HS8nha1tkt1PSxUdFGIIImhkbA3INC2Jntb3nko7Kxu09GCfINJK5s3aJK25nOecytSYtaCXEAcyVnadu3Fj5I6tV4I3L5EzmnVY6iuomZ7dXADy2xmufUXm1s9arZ5AlVau1HUA71mEneom/ENsYezU5+AKy0+J7cTkJXH+6glTZO9ZGyLhQ3qikALZD/hW1Hcad26T4FQOnIGvC0KqHfossVXEd0gWVxZKNCCVCUerKcEHNoKj91tjJGuyHkVMqqHQrl1MO/RSKxuNvfTvOTSAuNdrdR3SikorhTsngf6zHc+Y5HvVl3Wha9js26KE1sIZK5vInI81PdDz3j/BdVhub0mnL6i2vOTZSNYz91358VEV6jqYIp4X09REySJ7S17HDMOB4EKiukbB8uHK30mmDpLbO77Nx1MZ+476Hisb011hrW2+koiiIs1xERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEX60FxAAJJ0AHFWHgvozrbh1dZfC+ipTqIBpK8d/wB0fHuG9a4sN8s6pDDiOJxcPXmyTpCbLaLjeawUltpJKiU79kaNHNx3AeKvPB+H7pZ7DHS3CvbVys1a1o0jb90OOrvcOS79mtVDa6VlFbKNkEY3NYNXHmTvJ7ypRaMPzVMjBOH5uOTYmDNzl61OCxYK7yT1fO5fE+I4q+sNdVj9dXGw5fH0LhS1ZL6U6a6mP+HcsWI7aKKoZV0jg6kmO1G5pzDTyz+Ssu59Dt0r7Q+4UjYaSsYzOOkdvm7idzXePnlvVY09VUWx89qudNL1O0WTQSNLXxu5gHcQuSfZ6NZ23KSaG6UD6eoALi3J4594UetFfXYQxRFVxZudC7tNzyE0Z3jzHuPgtpxdRVbZKeUSM3seNzh3j5hb91pIr3bRNBkJ2A7OfPi0pErzHPD1Fg+vtN2w/S3WzOD6apZtAn1geLXd4OYIXVcvLPQnj2fB99Ntr+tfaax+zLGBm6GTcHgfAjl4BTvpe6VauktptlljNNNVtc0zk9tjNxII3Hhxy3q/N0cNsU71CN/0hceNvFwOGLVMH0FI/OpkYdJpR7I5tb88+QUWwzbm26hdVVOTZZG5uz9hvJcvCdq9IlFdUtziYewD7TufgPmt+9V/Xv6iJ32TTqR7R/JUmXZjpFIYqmWe617IoGOcXHZjYu3U3GCwUH6Ntzmy1Z/XTAaB3d3/ACUepqt9NE8QdiSQZOk4gchyz4rds9HTB7aivBkYNWwM3v8AE8B8VG09ZdDCWGqu/VXpVT1jaTazfIfWkPED6lWrTi3WqmZBJNBTRxtybGDqB4b1AJ8QXKSIQU5bRwNGTWRDLIclzXPe8kve55O8k5pzRHZeuCbdbLNnxlZ6TSISTuG7IZA/X4LkV3SBVSEimpY4xzOp9/8ABQhFSZ26a0isah3avFd6qM86t7AfunZ+WS5c1fVzHOSd7j3layxSVNPH+snib4vAULM7pJHes9x8SvlaT7rb276lp8AT8lideqAbpHnwYVG4HSQEg5g5Fcv9OUP/ADf8K/RfKA+1IP7qbgSW317o3BripHRVYkAyOqrtl3t7jpUZHvaR9F1rXeKfbDW1MTuXbGadBYVPPu1XSp5t2qi9BViRoyOq69NNu1UJduTOWPsEbXfxXGrnTMJDhsnwXQppt2q2J4o6iIhzQVAhlcXvBD3Ejko1daXeQFNbrQSRZvZm5nxCjtZGCCFIiEgyJB3haV2oKW6W6agrYxJBM3ZcPqORG8Fdi5QFriQFzw7XJSPN+KrJU4fvU1uqMyGnaiflpIw7nfzxzXKV69K+Hm3nDz6uBmdZRAyMyGr2e033ajvHeqKXPaupa1ncCIiqsIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgLqYcsNzxBXCkttOXn25DoyMc3Hh8+SkmA+j+tvuxXXDbo7cdQcspJh+6DuH7x8s1dNotlFaqJlDbqZkEDNzWjeeZO8nvK9DheAtk+K/SHjcf4vTB/t4utv7QjmCsCWvDzWVMgFZcMtZ3t0Yf3Bw8d/yUxjjc86aDmtu222pralkEEL5pXnJrGDMq4sC9GVPSiOtv4E0w1bTA9lv4jx8B/Bdt+Jphjkww4MHh2XibebxU/L9dkQwBgu4XZzZooTBT55OqJB7wOaujDeG7ZY4h6NFtz5dqd4zcfDkF1YmMjjbHGxrGNGTWtGQA5AL7C4uebTuZehbFXHGqxqGQHRQrpM6O7VjKnM42aO7MblHVNbntAey8cR37x8DLKurhpY9qV2vBo1JUYvF1uFXnHAHQRcm7z4lSziJ30eZMT2C6YcucluukHVysOjmu2mPHMH+TzWrbax1JPtDMsdo9vML0BcMPtucDoKylbNE7e14+Pce9RK69EUPVyVNNczRRtG07rwHMaPxZjIeOarOobVi0+iL2Ww0VyuDbo2na9zMnB+ZyLuBy3ZruXXClPdoh6XEHOZmWPJI2fMcFlprrZcMWiO12wm7VEeZfPl1cRcTmTzP8N6jd2udxuryaypPV8IY+yweXHzzTnjS/kWtO+zlX2oFG39H0+y3ZGySwggAaZAhcaCCWd2zGwu5ngF3X0lO8gvjBI3arM1rWtDWgADcAFXmaeVuestGktrI8nSnbd8At1rWtGgAWrV3Kjpsw+UOcPZZqVyaq/zOzFPE2MfedqVSbQ2isR2SEkAZk5ALTqLpQwaOnDzyZ2lFqiqqKg5zTPf3E6e5cS5YkslvzFRcIi8exGdt3uG7zVZutpNJ8QDUQU5Pe8/QLRmvNfJukEY5Maq1uHSJTtzbQW+SQ8HTODR7hn81wK7HF/qMxHNFTNPCKMfN2ZVJutFJW7LPPL+tmkf+JxK0am42+mz9IrqWHL78rW/Mqlau53Grz9Jr6mYHg+Uke5airzLci5JsV4eh9e6RH8DXO+QK1ZMcYeaezUyv/DC76qpUUc0p5IWr/Xyw86r/APV/FfTMd2Bx1kqG+MR+iqhE5pOWFwQ4ww7LoLiGnk+N4+mS6VJdbZVkNprhSyuPstlaT7lRqJzI5HoijuFbRuDqWqmhy4NccvcpLace3OlIbWQxVbBvPqP940+C8xW+9XagI9Er54wPZ2s2+46KUWnpCqoyGXOlZO3/AIkXZd7tx+CtFkTSXrLDeMLPdHNijqOoqD+ym7JJ7juPzUwppV5Ts16tt3j2qGpa9wGbozo9viD89yn2Esc3KzPZBVOdW0Y02Hu7bB+6fofgrRZVeVRGHNzCi1/tzWsdURDLL1m/Vdmw3e3X63CehqOsjOjgHbL2HkRvBXIxFS1lPmXzSSwE6En5qyEPuEQe0qO1TDHIpVVBcK5RZ5kKRpNIc3Nee+kSzCx4qqqWNmzTyHroANwY7h5HMeS9AQOycWHxVfdOdsE1oo7qxvbp5OqkI+47d7iP8yreNwtSdSp9ERYNRERAREQEREBERAREQEREBERAREQEREBERARFs2yhq7lWx0VDA+eeQ5NY0fHuHegwRRySytiiY6SR5ya1ozJPIBW30fdHEdP1dyxDG2Sb1o6Q6tZ3v5nu3ePDt4CwRR4dibVVOxU3Jw1ly7Mfcz8957lNaeB0jgdQPmunBEUvFrRtycVW2XFalJ1M+pGwuOy0aD4KUYOwlcL9UhtPGWQg/aTuGTWhd/AeAZa8R1t0a6Ck3tj9qT+HereoKano6ZlNSwshhYMmtaMgF2Z+Ktl6R0h5/BeG4+G+K3W367NLCeGbZh6mDKSMPnI7c7h2neHIKQsK1mlZWlcr0my0r6Jds9nIHmsLSvsOQYH0AkeXSP2ieJT9H0sbC+RwDWjNxOgA5rhYvxxZcNsMc0npNZl2aaIgu/vH2R469xVMYvxtfMSPdHUz+j0ZOlNCSGf3uLj4+4ILKxZ0j2G0F9NZ4WXOqGm2HZQtP4va8veqnxJiS8Ygn6y41TnMBzZCzsxs8G/U6rkL8cQ0EuIAG8lEv1fjnNa0ucQAN5J3LlV18gizZTjrn8/ZH5rhVdbU1RzmlJHBo0A8lWbRBp3q2900ObYAZn8xo33ri1lzq6rMPlLWH2WaBRO+4utFrDmCb0qcfs4SDke87h8+5Qa940vFwLmQPFFAdNmI9rzdv92Szm68VmVkXa92u1tJrayON2WkYObz5DVRC7dIZzcy10WQ4STn/aPzUBc5znFziXOJzJJ1K/FSbLxWHSul9u1yJ9MrpXsPsA7LP8I0XNRFVYREQEREBERAREQEREBERB9wyyQytlhkdHI05tc05EFW7gy7PuVigmqX7cwzZI7mQePlkqfU86Lpy6lraYnRj2vHmCD/AKQr076VtHRamHb3X2K4NrbfNsu3PYdWyN5EK+cNXqgxRYxUwgZkbM8LjmY3cj9CvOdujdNDLsnN0eRy5hd3BWIajDl7jrY9p0DuxURD22fmN4V+0s1jYjt76CpLdTE/Msd9FHKtuYIVoXSCmvNobJBI18czBJDIN2ozBVZ1rHRyPjeNlzSQ4ciFYR+ZvV1DTzOS5eOKEXHCNzpcs3Gnc9g5ub2m/EBdqvZnqF8uDXsLXDNrhkQeIU90PLSLNWwmnrJ6c74pHMPkclhXM3EREBERAREQEREBERAREQEREBERAREQERdHDtmrr7c46Cgi2pHaucfVjbxc48Ag/LBaK6+XKOgt8JkldqSdGsbxc48Ar3wXhahwzQ9XD9tVSAddUOGRd3Dk3uWbCOHKDDdtFLSN25X5GaZw7UjvoOQ4fFSm12+erqY4YonSSyHJjANSt6U0xtbbFRUkk8jWhjnOccmsA1cVbmBMDRUgjr7vG18+9kB9Vnj39y3cEYTp7LG2pqgyaucPW3iPuHf3qXMKuq2GHIZLK0rXaVlaVKGw0rI0rXa5cDF+Mbbh2Ese4VFaR2IGHUd7jwCCR19fSW6kfV11RHTwMHae85D+J7lU+NOk6rrNuisG3SU+51QdJH/h+6Pj4KG4lxFdMQVfX3CclrT9nE3RjB3D671yUS/XvdI9z3uLnOObnE5knmvxYqqohpojJM8NHDmfBR25Xmaozjgzii/zH8lEzEDr3G609JmwHrZR7LTu8So9XV9TWO+1fkzgxugXEvd6t1ng6ytnDXEdmNur3eA+u5VxiLGdyue1DTE0dMfZYe24d7voPisrXXiu04xBiy1WnaiMnpNSP2UR3HvO4fPuVfX7Fd2u21G6b0enP7GI5AjvO8/LuXBRZzO14rECIihYREQEREBERAREQEREBERAREQEREBS/owflc6tnOEH3OH5qIKWdGI/+cVLuVPl/mCtTui3Za+HT/aJW82Z/FLwx1NNtNaNiTUHkeS+LBpVPP7n1C6dziFRRSN9po2m+IWs91IjcJ/0FX91VQVGHql+0+nzmpszqWE9pvkTn/e7luY/ovR7i2oaMmzjX8Q3/RVTgi6my4rt9w2tmNkwbL+B3Zd8CVfHSBSCaxSStGboXCQeG4/A/BWVVXVDMELC31R4LLUHesTdwSES83YvYI8V3dg3Ctmy8NsrlLs43IOMbvkMv7ZL/qK4y557to7CIihIiIgIiICIiAiIgIiICIiAiIgIi2LbRVVxroqKihdNPK7ZYxv87u9BsWC0Vt8ucdvoI9uV+pJ9VjeLnHgAr9whhyiw3bBSUo25X5GeYjtSO+g5BYMD4XpMNWwRR5SVcoBqJstXHkOTQphaaCerqY4oYjJLIcmMHzW9KaY2tt9We21FbVxwQRGSaQ5MYPmVcmD8OU1jpw47MtY8faS5bu5vd81hwhYILJS5nZkq5B9rJy/dHd81IWlXVbLSsrStZhWZpRDYaVk2wGkkgAbyStOephpYHz1ErYomDNznHQKrMcY2nuZfQ25zoaMHJzgcnSfwQd/G/SC2mD7fY3h83qvqd4b3N5nvVXTyyzzOmmkdJI85uc45klfC+ZHsjYXvcGtGpJOgUpfS5l0u8VLnHFlJN8G+K591vL5s4aUlke4v4u/IKK3690FmputrJe2fUibq9/gPqqWt7JiHUrap8hdUVUwyAzLnHINH0CgOKMdMj2qWy5PfuNQ4aD8IO/xKi+JcS3C9yFsjjDSg5tgYdPM8SuIsZs0ivuy1VRPVTunqJXyyvObnvOZKxIiquIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICmvRbHnNXzZbmsaPMk/RQpWL0aU/V2WWcjIzTHLvAAHzzV6d1bdk7smj5XdwC6zXLk2rswudzct9r1ee6I7OFUs6uokYNzXEBekbPN+mcAUsrjtPnoAHfi2Mj8c15zuX/bZO/I/BX90Pymbo/tzXHMtEjPdI7L4ZK6kqyndvXyNwX7XDYqJI/uvI+KxVUzKellqH+pEwvd4AZpCJebsTSibElzmG6Ssld73krnL6le6SR0jzm5xJPiV8rmbiIiAiIgIiICIiAiIgIiICIiAiIg/WNc97WMaXOccgAMyTyV6dGeEGYeoPTKxjTc6hvbO/qm79gd/P8Ago/0P4R2QzEVxi1OtHG4bh/xD9PfyVr08Rkfr6o3rWlfVne3oy0FK+omY1rC9ziGsaN7irZwdYY7RT9bMA+skHbd90fdH1WhhDD36Nhiraxg9KlZtMYR+qad3mfgpQxy1ZtthWZpWqxyzMcg2WlfFdXU1BSPqaqVscbBqTx7gtavrqe30j6mpeGsaPM9wVT4qxDU3qrJJLKdp7EYOmSDYxhiiqvk5iYTFRtPYjB395UcRalxroaKLaedp59Vg3n+CnsMtZUw0kJlmdkOA4k8gotc7jNWv7XYiB7LAfnzKwV1XJUyOmqJBkBx0DQq3xljR0hfQWaQtZufUt3nub3d/uWVrrRG3YxdjCntW3SUOzUVu4neyI9/M93vVZV1XU11U+pq5nzSvOZc4/zkO5YDqcyiymdtYjQiIoSIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiArfw5SehWKjpiMnNjBcP3jqfiVWOGqL9IXylpiM2F+0/8I1PyVvtGbgFrjj1Uv7OhS9iFre7NbDXLUa5ZGvRLUuBzqneXyV79DXYwJQn7z5T/AP0cPoqEqDtTvPer+6PR6BgOgc7QNpjN783/AFWnozlWtY4SXCUjcZHH4rgdIlYKHBV0mzyLoDEPF52P9y7FMS5znFQHp1uAistFbWuydUTGRwH3WD83D3KJnUEdZU8iIudsIiICIiAiIgIiICIiAiIgIiIClnRrhd2Irvt1DD+j6Yh053bZ4MHjx5DxCjlroam53CCgo4zJPO8MY36nuG8nkvRWF7LTWCywW2myOwM5H5ZGR53uP86DIcFeldyra2nUgiHZijaGtAyAAyACsfo2w22WRl1rI/sIz9gwj13D2j3D5qN4OsjrnXNjeC2FvamdyHId5VtbcdLRbELQxjGbLGjcOAW7Fhqputqnvz0zyHgjHLUY5ZmOQbjHL9qauGkp31E7wxjRmStd0rIo3SSODWtGZJ4Ku8XX59zqDDES2nYcgM96DFiq/T3irOpbTt0YwHRcRFpXavZRQ8HSu9Rv1Pcp7D8utwjoouDpXeqz6nuUSuFZpJV1kwa1o2nvccg0L5r6trGS1lZMGtaNp73HQBVNjPE816nMEBdHQsPZbuMh+876BY2stWu2fGmLZbq99FQudFQjQnc6Xx5Du9/dFERZbaxGhEREiIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiy0sElTUx08LdqSRwa0d5QTXoyt+zFUXJ41f8AZR+A1cffl7ipq1wa7Va1spI6C3w0keWzEwNzy3nifM6rG6baeTwW+tRplvcuo16yB+QXMin71tCQOaQFGltkbHzTNYwbT3uAA5kq/rw5tqwRUxMIDYaPqGnxAYPmqcwDRenYromFubIn9c/wbqPjkPNWZ0j1GVlp6Jp1qZxn+FozPxyV5ZoRSN2YG57zqqP6XrmLhjKaFjs46NggblzGrviSPJXTfK+K1WequEuWxTxF+R4kDQeZyHmvNNTNJU1MtRM4vlleXvceJJzJWeSeml6R12xoiLJoIiICIiAiIgIiICIiAiIgIi7mB7E/EOIoKDUQD7Sdw9lg3+/QeaRGxYfQxhsUtCb/AFcf29QC2nB9mPi7xJ+A71aVtpn1E7GsaXOLsmjmVqU8TWtZDE0Na0BrWgaABTvBNubG30+Ru4bMQPxK6axqGEzuUow/Qx2u3sp25F57Ujh7Tlt1s2bGsB3nMrWEuu9YpZNuTw0UobDHLMxy02OXJxPdhSUxgid9q8ZHuQaWMb4ZXGhpn9geuRxUUX65xc4uccyTmSsNXPHTQOmlOTW+89ykYrlWx0VOXuyLz6jeZUPr6vPraurlDQ0Fz3OOQaB9Flr6uSrndNKchwHBoVT49xObnOaChkIoYz2nD9q7n+Hl7+SytZasba2NMTS3qoNPAXR0Mbuw3cZD94/QKNoixbRGhERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAU06N7Vtyvu0zeyzNkOfE8T7tPMqLWihmuVwho4R2pHan7o4nyCt2gpYqOjipIG7McbQ1o+vitMddztW0+j9qnERlo3lc5+YXTmZmtOVi0lSGsJSCulREui2zx3LmGIvkDG7ycl2oIidiGMEk5NaOaQTKxOiKi2G1Vxe3V+UUZ7hqfjl7lvY1qPSL0Iwc208YYPxHU/7R5Lcw2IbTZmtOWxBHm7L2jx95UZuNW3Oorqp7WNG1LI47mjeT4KyqtOnK89VQ01jid25z10wB3MB7I8zmf7qqNdXFl3ffMQVdycCGyv8As2n2WDRo9y5S57TuW1Y1AiIqpEREBERAREQEREBERAREQFeXRFYRacONrZ48qqvykdmNWx+yPr59yqnAtl/T2JqWhc0mDPrJ8uEbd/v0HmvSFupTUVMVLE0NDiAMho0D8gtMcerO8+jo2O3Pqpom5ZGU7+TRvKsKNrIYmxRjZYwZNHctCy0LaeEz7OW12GdzR/PwW64rZm/TJkvxjuKwyuyGXNfjXgAknIBBlraxlLTOlcQMhooLXVL6qpdM8nU6dy38RVxnm6lp7Ld/5LkqYH44hrS5xAAGZJUTvNea2oyaSIWHJg5966GJK/8A7nEf+oR8lX+Ob+LLbtiBwNbOCIh90cXH+d/ms72TEbcPpHxKW7dmoZNd1TI07v3B9fdzVfL9c5znFziXOJzJJ1JX4sZnbaI0IiKEiIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIpTgOxenVQuNSz+zQu7APtvH0H88VMRudImdJDgSy/o6h9LqGZVVQNx3sZwHjxKllNCS3rCNOC+KaEzSBo3DUnuXTLAGhoGQC6IjUMplzZmLTmYutMzuWnMxENOliycZD4BSbB9F11W6reOxDo3vcfyH0XEhjdJIyKNpc5xDWgcSp7Q07LdbmQtyJaNT95x3qYJbFxqSYGUzTp6z/oFVvTRiAUdpZZKd+VRWdqXI6tiB+pGXgCp3dK6C30FRX1b9mGFhkeeOQ5d684Yju1Re7zU3KpPbmdmG8GNGgaPALO9tQtSNy56IixaiIiAiIgIiICIiAiIgIiICIstJBJVVUVNC3alleGMHMk5BBb3QhZ/RrLPeJWfaVb9iMn/AIbT9XZ+4K8MBWx0731JGrz1bD3b3H+e9Qmy0EdutlJbaZvYgjbG3IbyBv8AEnXzV3YPtjaOgY3L9UwM8XHVxXREajTCZ3OytjbGAxoya0ZAdy0nBda4R6lcupIhhfIdzRmrIc+okznIG5ui0brWCCnOR1O4cyvrrDq46lR+6VBnqSAc2t0H1QaziXOLnHMk5krTutW2jpHSabZ0YOZW2ole6z0usOyfsmdlnf3padQOVda6KipJ66rkyYwFzid5PLxJVK3y5T3a5y1057Tz2W8Gt4AKS9Jt79Lrhaqd/wBjTnOXI+tJy8vmSoYue0tqxoREVVhERAREQEREBERAREQEREBERAREQEREBERAREQEREBEW5aLfUXOuZSUzc3O9Zx3NHElBs4as815rxC3NsLMnSv5Dl4lWtRUscEMVJTRhrGANY0clrWW209roWUlMCQNXOO97uZUmt1H1DOskH2jh7gt610ytbZTwNgiDRqd7jzX04LM4L4cFdRrvbmubUODnkN3Bblwm2B1bT2iNe4L4s1A+4VjYhmIxrI7kPzRMOxg+377hKObYs/ifp7116iTrH6eqNyyTuZFE2niAa1oAyHAclEekTEseHLIXxuBrqjNlMzkeLj3DP35JM6O6EdNGJfSapuH6R+cUDg+pcD6z+DfLee89yrVfUr3yyOkkcXveS5zicySd5XyuaZ3O20RqBERQkREQEREBERAREQEREBERAUv6Ird6fjSnkc3OOkY6d3iNG/Eg+SiCtvoHodi33G5ObrJK2Fp7mjM/wCoe5WpG5VtOoXLgyj9MxBACM2RZyu/u7vjkrupKYwUMTCMiW7R8Tqq36JLf1z56hw/Wysp2n4n5tVzVtJodFuxROvjzz0UWxHKG7FO06ntO+imt2iEEL5ZNGMBJKrasndU1Ukz9C47uQ4BSNKvm6mmcQcnHRviuGt27y7c4jG5g+K0lMDm4gq/R6IsacpJeyO4cT/PNV/i26iz2OaqBHXO7EIPF53e7U+Skl7qfSa95B7DOw3y4qnekq6muvZoo3fY0ebPF59Y/TyKxvZesbRd73Pe573FznHMk7yV8oiyaiIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICItq10FTcqxtLSx7b3bzwaOZPJB+W6iqbhVspaWMvkf7gOZ5BWnh2z09noRDEA6V2Rlky1cfy5BfOHLLTWak6uPtzP/AFspGrj9B3KX2a2Hs1NQ3Texh+ZW9KaZWs+bRQbIFRM3tb2NPDvXRcFsOCxOC0Z7YHBatZM2CMuOrj6o5raqpGQxGR5yA+Kj1TM+omL3eQ5BQmCNktTUNYwF8kjsgOZU2t1JHaqARNydK7V7vvH8gtTDtsFBB6XUj7d40H3Ry8VtTyg7Usjg1oGZJOQARLUu9wprZb57hWy7EMLdp7uJ7hzJXnjFd8qsQ3mW4VObQezFHnmI2Dc0fzvJXe6UMWm/3D0Gief0bTP7JH7V4zG34cB7+KhawvbfRpWuhERUXEREBERAREQEREBERAREQEREBX70U0gpMDUGmTptuV2m/Nxy+ACoJelsMwejYcttPll1dJE0+IYM1pj7qX7Lq6LAylslJM7hU9a7wzH0CuJzWSMBzBBGYKpbCFSymo4aaRwa10TQCeDsvqpFPU1QgMAqZhF9wPOz7lqzZMeXGKcmhpHB0TTnI9u5x5DuCra4TiKUxNPbOpI9kcV375XR07HRsIdMeH3fFQyoc4vke4kudoSUhDA9xe8uO8nNal1qPRqCWUHtZZN8StpcHFc36mnB5vcPgPqpmdQIpfq9tss9VXOyziYS0Hi46NHvIVISPdJI6R7i5ziS4neSrD6Wa4spKS3Md+scZXgchoPiT7lXS57S2rHQREVVhERAREQEREBERAREQEREBERAREQEREBERAREQERd3DOG6q7vEr9qCkB1kI1d3N5+KmI2TOmlY7TV3eq6imZ2RrJIfVYO/wDJWfY7RSWilEFMzNx9eQ+s89/5LZtdBBRU8dHRQbLRoGtGZceZ5lTCyWQU4bUVYDpt7WcG/wAVtWmmVrNSy2gjZqatneyM/M/ku04LYcFjcFoz3truCwTvZFG6SR2y1upKz1EkcMTpJXBrG7yVFrnXPrJeLYm+q36nvQiHxX1b6qXM6MHqt5Lu4ZtIYG3CrAA3xMI/zH6LDhyzCUCtrG5RDVjD7Xee75ruzy9Ycho0bgoWfk8pkdnwG4KpelrGfWGXD1qlOyCW1krT63/LB5c/dzXT6U8ai3RPstpn/trxlPKw/qRyB+8fh47qdJJOZ1Kyvf0helfV+IiLJoIiICIiAiIgIiICIiAiIgIiICIiAvUkLOrhZGPZaG+5eW16mBBAI3Fa4/VnkT6B2UYbyGSS1VS1mw2olDeQeclqwS7l9THitFGrOSSVqPiL6eR+W52Q938VnqHZA5b1s0cO3adrm4oOEolfZetukvJpDR5fxzUwnYWSlqglQ/rKiST7zyfeVFyFP9ItX6ViqoAObYGtib5DM/ElR1bN0nNVc6qpJz62Z7/eSVrLnltAiIiRERAREQEREBERAREQEREBERAREQEREBERAX6xrnuDGNLnE5AAZkldCy2euu02xSxdgHtyO0a3xP0ViYew5Q2hgeB11TlrM4bvwjgrVrMqzbTgYYwcTs1V3bkN7afn+L8v/ZT63UMtTIymo4RoMgGjJrR9AuhZLHU3FwkdnFT56vI1d4DiprQ0NPQwCGmjDW8TxceZK3rXTK1nNs9mgtzA85STkavy3dwW+4LO4L4cFdm13BatbPFSwGWZwa0e8nkF9XWvp6CHbldm4+qwHVyhtwrZ66frJXaeywbmqFojb6ulfLWzZnsxj1Gcv4rqYesolDa2tblENWMPtd57vmstisYa0VdwZkBqyI/M/kuxPKZDkNGjcFCz9nmMnZGjRuCrzpMxwyzxvtVqkD7i4ZSSDUQA/wC7u4L86SsdMtDX2q0yNfcCMpJRqIPzd8lTMj3ySOkkc573ElznHMkniVne/pC1a+svx7nPe573FznHMknMk81+IixaiIiAiIgIiICIiAiIgIiICIiAiIgIiIC9PWqX0i2Uk4OfWQsfnzzaCvMK9EdHdUKzBNqlzz2YBEf7hLP9q0x92eRZlHGXQRvz3tB+CyS5gZFfVhHXWiB44N2T5HJbFXCeqJA1Gq1UceoXasrNu0N/E75riTrv4Y7dqePuykfAFBwL5CYw94G4FVjUuLKaV43tYT8Fc19pesp5MhqWkKmalhkp5WDe5hHwVbEKEREWDcREQEREBERAREQEREBERAREQEREBERARfUbHyPDI2Oe5xyDWjMlSiyYMraotlr3eiRb9nfIR4cPP3KYiZ7ImdIzTwzVEzYYInyyO3NYMyVM7BgrVs93d3iBh/1H6D3qV2q1UNsi6uip2sJGTnb3O8SpHbLFUVJD584Iu8do+AWtcfupN3IoKMAMpaKnAA0bHG3IBS2y4cji2Zq/KR+8Rj1R48/kunb6OmootinjDebjvPiVuArWIZTZlZkAGgZAaADgvtYmlfUkscUZkle1jGjMuccgFZV+uC4d9vcNDnDDsy1HEcGeP5LnX3Er5tqnt5cxm4y7i7w5LiUFFU18/VwMLj7Tjub3kqsytFfd8SPqa6q2nF800hyHEnuUms1mioWiprNl8+9rN4Z+ZWzbqCltUeTMpKgjtPI/nIL9qqiOKJ9RUytjjYC573nINA4k8FCzLLI6R2Z3cAqw6RukFtOJbTYZs58yyaqbuZzDDz7+HDXdyOkLpCluPWWyxvfFR+rJOMw+XuHJvxKrtZWv6QvWnu/XOc5xc4lzicySdSV+IiyaCIiAiIgIiICIiAiIgIiICIiAiIgIiICIiArj6C7gJrDWW5zs300+20fuvH5tPvVOKXdE12FrxhAyR+zDWNNO/M6ZnVp/xADzVqTqVbRuHqfAUolp6ikJ7THCRo7jofkPeu/NDv0UGwrXi33qCaR2UTj1cn4Tx8jkfJWXUw6ZreWKC18fVTvj+6dPDguvgp+0KuA7+y8fEH6LVxRD1c0cwGjhsnxH8/BYsI1Ahv0bScmzNMZ89R8QESklZFmCCFR1zgNLcammIyMUrme4q/qqLfoqe6SKE0mJHyhuTKlgkHjuPyz81Ww8z3umNHeKymIy6uZzR4Z6fBaauHE9hobsAahhbLlk2Vmjh3d47lXN8wzcrWXP6s1FOP2sY3DvG8fJZTWY6tYttxERFVYREQEREBERAREQEREBEX0xrnuDGNLnHcAMyUHyi7ltwreazJxp/R2H2pjs/Df8FJ7XgiggyfXTPqnfdHYb+Z96tFJlE2iEBpaaoqphDTQvmkO5rG5lSmz4Iq5i2S5TCnjOvVsO0/8AIfFTuio6eljENJTxxN+7G3LP811aW1VE2Rk+yb37/ctIxx6qTdwLTZ7da2ZUlO1ruMh1efNd6htdVVZO2erjPtO+gXZordS02RDNt/3naroNK0iGc2a9utlLSZOa3rJB7bt/lyXSaVhaV9tKlVnadVkaVpz1MNNEZJ5GsaOJ4qP3PEMsoMdEDEz759Y+HJDW3ful3pbe0h7usmy0jadfPkohdLnV3GTOd+TAezG31QsNJTVNbPsQMdI86k8u8lSe2WWloAJaotnn3gey3wHHxKLREQ5NnsU1WBNUkwwb9fWd4ch3qSM6mmhEFJGI2DiOK/JpXSHXQclC8b48t1gD6Wl2K24burDuxGf3yPkNfBVmYhPWUgxBerdY6F1ZcqgRs9lu98h5NHEqkMbYzuOJJjEc6agac2U7Tv73HifgPiuNe7tcLzXOrbjUOmldoM9A0cgNwC0Vja+2la6ERFRcREQEREBERAREQEREBERAREQEREBERAREQEREBfrHOY9r2OLXNOYI3gr8RB6LwPe23/DlNX5jrgOrnA4SDf79D5q58G3QXKziKR2dRTgMfnvI4O/nkvH3RXiUWK9+jVUmzQVhDJCTpG/2X/Q9x7l6EsVyltdxjq4tW7pG/ead4W9Z3DG0alN8UU/W26XIZuZ2x5fwzUMindHKyWM5PY4OaeRGqnk1TDV0zaiFwfFI3MFV9Xs9FrZYeDXdnw4K0Iha8EsdbQQ1cXqysDgOXMeW5QzpNs5rrKamJhdNSEvAHFh9YfI+S3eje5tkZLaZXdoZyQ58fvD6+9SeqhBBBAIO8FQPN8kYlAaTs67+Sw1VJUUx+1jIbwcNQfNSnHNgfZLq7qmH0OYl0J4N5t8vktG2VTXN9GmyI3Nz49yiJ0mEFuuG7TcS58lOIpT+0i7J8+B8woxcMC1TCXUNXHM3g2QbLvfqD8FclTaaSbMtaYnHizd7lzp7JUM1ikZIOR0KTFZW3MKQrMP3mlJ623zkDiwbY+Ga5r2PjdsvY5ruRGRV6S0dVF68Dx3gZj4LVlijkGzLG145Obmq+X7J51Jorgks1pk9e2UhPPqWg/JYHYcsbjrbYfLMKPLk51TIrY/q3Y//AA6L3n81kZYLKzdbKY+LAfmnlyc8KjWWCmqJzlBTyy/gYT8lcMVvoIv1VFTR/hiaPotgcgp8s51UUuGr5UEbNvlYOcmTMveuvR4Frn5Gqq4IRyYC8/QKwg1x3BZGwOO8gKYxwibyilDgq0wEOqDNVO5Odst9w1+K7tFQ0dE3ZpKWGHh2GAE+J4rqx00ftEuW1CyNnqMAKvERCs2c+Klnl9WMgczot6C2N3zSE9zVtMKyNKlXb7p4YYRlFG1vfxWw0rA0rI0ohmaVkaVrSTRxM25Xhg7yudVXprc20zNo/edu9yk07jpGRsL5HtY0byTkuVX35rAWUjdt333DTyC4dRUT1L85ZHPPAcB4BdK2WCrqsnzj0eLfm4do+X5qE6c2aWoq5tqRz5ZHaAb/ACAXZtmHZJAJq93Ux79gesfHku1R0tDbm5U0QdJuMjtT7/yX1JI5+r3aD3BE7fURgpYhDRxNjYOIG9aN1uNHbKR9ZcKlkELd73nf3Dme4KH4v6R7Zag+mtexcKwabTXfZMPeR63gPeFUd+vVyvlYaq5VT5n+y3c1g5NG4KlrxC0UmUvxr0kVlx26Oy7dHSHR026WQf7R4a9/BQAkk5nUr8RYzMz3aRGhERQkREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQFcXRJi8V1OyxXGX+1xNyp5HH9aweyT94fEeCp1fcMskEzJoZHRyMcHMe05FpG4gqa21KJjcPW9kuslC4wvJdTvOZH3TzC+sR7MnV1UZBGWRI4jgqy6OccQ3yFlvuUjIrmwZAnQTjmP3uY8x3TtsrhGYic2HguiJierHWigrZqOriqqd+zLE4OaVcNmuNPerXHWwZAnSRn3HcQqPcSxxB05Ls4UxDPYrh1zAZIJMhNFn6w5jvHBBZOIbRS3Wgko6tm0x24jew8CO9UniGzVlkrzTVTdDmY5B6rxzH5K/qOqpLnQx1tFKJYZBoeIPEHkVycRWSiu9E6lrYtth1a4aOYebTwKiY2KTorqxrxBUnLLc/811mkEAtIIO4haGLcHXKxyPma11VRZkiZg1aP3hw8dy4dHX1FKco35s+47UJpaJSl7VrzRtcMnNB8QtelvFNLkJgYnd+o963Q5kjdqN7XN5g5qEudJSwH9iz/AArXfSwj9mF05GrXkahpzn08Q9gLVqIcvV0XUkateRmYyKbQ4+Za7IkrIxyyVMJBzyWu05HIqUNpjlmY5arHLKwqUNphWZpWo14G8gL69JY3mfBEN5pWVrlyXVj9zGgeOqwyTSyeu8kcuClOnYlrYIt79o8m6rTnukztImiMc95XxRWuuq8jDTu2T7TtB8V26TDMUYD66oz/AHWaD3lBG/tqiUDtyyO0A1JK7Fvw5VzAPqXCnZyOrvdwUhgbSUbNikgazmct/nvK+ZJXv9Z2nJDb4o6O32/LqIg+Qe27U+/h5LJLK+TedOQUXxNjaxWIOjlqRU1Q/YQEOcD+8dzfPXuVXYn6Q75eNqGmf+jqU6bELu24d79/uyVZvEJisytHFGNbHYQ+OWoFTVjdTwnNwP7x3N89e5VJivG96xBtQvl9Eozp6PCSAR+8d7vl3KMIsZvMtIrECIiqsIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiIP1jnMe17HFrmnMEHIg81aeBOkkZR2/Ebzn6rKzL/WB8x581VaKYmYRMRL1G0w1ELZGOZJG8Ztc05gjmCteWme3WM7Q5cVQeFcXXnDr9mjmElMTm6nlzLD3jke8fFWxhnpCsV3DIqiX9H1R06uc5NJ7nbvfktovEsprMJnhrEdfYavbp3F0Tj9rA89l/wCR71athv1rv8G1Ry7M7RnJA/R7fzHeFUj445W9pocOBWFtPJDM2alnfFIw5tcDkQe4hWRtdNTBmCCNFCMS4EtVxL5qdvoNQddqIdgnvb+WSwWfHN0pWthutKK2MadbHpJl8j8FJ6HEVjuWTYa1kch/ZTdh2fLXf5ZoKhvODL3bnOLYBVxDc+HU/wCHf81HyJqeUtIkikG8HNpC9ETwAjdmFw7taKeqaRLBHKOT2goKaZcaxunXFw/eGayC6TH1o4z4ZhTS44Vt+0SKYs/A4j+C5UuF6TPsTzs8cj9FOk7cA3HPfCP8S+HVoP7L/Mu27CrfZriPGLP6r5/qqc/+3DL/AKX8VHKbcGScP/Z5ea13NBOe5ShuFW+1XE+EWX1WZmF6QevUzO8Mgp0jaJAAL9zKmceH7XHq9j3/AI5CPlktiOjtcHqU0OY47O0feU0bQiGCec5QwySHk1pK6FNYLnNkTC2IHjI7L4DVS41LGjJjNBu4LE+okduIb4IbcqmwvE3tVVU53MMGQ95XRp6S2Uf6mnY5w9ojaPvK+JpWsY6WaQNY0Zlz3ZAeZUYvGPsMW0Fpr/S5B7FKNv4+r8VEzEHWUvfUvd6uTQtWqqYaeJ09VPHFG3Vz5HhrR4kqor50q3KfajtNHFRt4SSfaP8AHLcPioNdbtcrrN11xrZ6l/DbdmB4DcPJUnJC0UlcOIekyxW8Oit4fcpxp9n2Ywe9x3+QKrjEeOcQXrbifVei0ztOop+yCO87z78u5RhFnN5leKxAiIqrCIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIg7dgxVfbIWtoK+QRD9jJ24/cd3lkp1ZellhDWXi2EHjLTOz/yu/NVUitFphE1iXoW142wxcQ0RXaCJ59ic9UQeXayB8iu9G+KeMPjeyVh3OaQQV5cWalqqqkf1lLUzQP8AvRvLT8FaMik0ep6SrqqQZU1TNC37rHkN925dGPEd1aMnzMlH78Y+mS8w0mNMU0uXV3uqdl/xSJP9QK6cHSZiqPLbqKab8cAGf+HJW8yEckvRcmIKuQZPgpz37J/NaktwdIczDGD3Zqi4+lfELdH0dsd/5bwf9ay//Fm9f+G2/wBz/wD1KfMhHJK6vSn/AHWr8NTJ+6PJUm/pYvxz2KC2jlmx5/3LXl6UsTP9VlBH+GE/VxTzIOSV5GolPtfBfJkkO97veqBqOkPFswI/SYjB4RwMHxyzXLq8TYhqwRPeq9zTvaJ3NHuGijzITyS9F1NTT0zOsqaiKFv3pHho95XCuGN8LUWYkvEEjhwgzlz/AMIIXnyWSSV5fK9z3HeXHMr5VZySnkXDculi1xZi326qqXcDI4Rt+p+Ci116T8R1WbaX0ahZw6uPad73Z/ABQdFWbzK0ViG5crrcrk/buFfU1R4dbIXAeA3BaaIqrCIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIg/9k=',
    diamond: 'data:image/png;base64,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',
    rocket: 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAIAAgADASIAAhEBAxEB/8QAHQABAAICAwEBAAAAAAAAAAAAAAUGBAcBAwgCCf/EAFQQAAEDAgMFBAYHBQUEBwYHAAEAAgMEBQYRIRIxQVFhBxMicRQygZGhsQgjQlJiwdEVM3Lh8BYkQ4KyU2OSohclNDZEg6M3VGTC0vFFVXOElKS0/8QAHAEBAAIDAQEBAAAAAAAAAAAAAAUGAwQHAgEI/8QAPhEAAgEDAQQHBwMDAgYDAQAAAAECAwQRBRIhMUEGE1FhcZHRIjKBobHB8BQj4QdCUhViJDNykqKyNVPi8f/aAAwDAQACEQMRAD8A8ZIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAimsG4WvmL70yz4fovSqt7S/IyNY1rRvc5ziA0aganeQBqQF3Y8wZiTA16FoxNbXUNU6MSx+Nr2SMJIDmuaSCMwfzQZK+iyaOgraw5UtNLL1a3T37lOUeD6+UA1M0VODwHjcPdp8Vt0LG4uP8Alwb+nma9a7o0ffkkVpFfaTCNsiyMzppzxzdsj4a/FStNabbTgd1QwNI4lgJ951UtS6OXMt82l8/zzI6prdCPupv5GsYYJpjlFDJIfwtJWXFZrrJ6tvqP8zCPmtqUtNPUPEVLTyTO4NjYXH3BTNJg7FlVkYMOXVwO5xpXtB9pGS3Y9G6Uf+ZU+i9TUlrlR+5D7mmG4dvThmKF3te0fmuThy9AZ+gu/wCNv6re8XZpjmQZtw7U/wCZ7G/Ny+39l+PG554dnOXKWM/Jy9f6FY//AGPzXoef9Yuv8F5P1PP8tlu0frW+oP8AC3a+SwpYpYnbMsb4zyc0hb9rcDYxowXT4ZugaN7mUznge1oKr9ZSuY51PWUxa4etHKzIjzBXiXRyjNftVPo/pg9x1ypH34fY0+i2HcsL2yqaTFGaWQ7nR7v+Hd7slTL1aKu1TBs7Q6N3qSN9V36HooW90m4tFtSWY9qJS11GjcvZi8PsZHoiKMN8IiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiLKttvrrlUimoKWWolP2WNzy6nkOpQGKu2mp56qZsNNDJNK7cyNpcT7AtjYd7MHu2Zr5V7A39xAcz5F36e9bDs9nt1riEFsoYoAcgdhvid5nefasipt8Ty5Ii/o1VFd2dY7p71fqFrbdURGKojzDpWAkFrwByIByzz9uS3j9ITFmBsb2u1W63sp7zUU1SakTvpzswN2C0t8YGriWnL8OuuSgMPdmWI781r56NtDSnXvKoFp9jfW+Q6rZuF+yLDFqaH1jJLlNx7w7Eef8I/Mle8KJjby8nm6vs1NOz6hrYHgabIyb7lL4K7Kb7iaE1UdbbqWma4teXS7bx/kbu9pC212h9lHctfcsMEbA1fRPfr/AOW47/4T7Cdy1jaLlcrDcxU0UslNUxnZc0jLPm1wO8dCpi01evRjsZyvoR1xptGs9pLDLnbuw+yUJDrrX1lc78GUUZ9mp+KtdqwLhK3bPotgos27nSs71w9r8ysKx9oEl7iFM9sNLVbPiYBnt6alufy3jqum6x3B5Mnpc8sXFpefD7FOUJ1LmO1t7iDuFG3ljZLkx9DRsEfeU9Owbm5hoHsXH7XtbN9ZGf4QXfJa/ijzWZFH0X2VpFcWa6vJPgi7NvtsB0lcfKMrtjvtuP25B5sKp0bFkxsWtO3pmRXdTuLlDd7c85CoA82kfkuyst9nvdOYa2korhFllsyxtkA9+5VGNiyoA5jg5ji1w3EHIrVnRS3xZmjdSfvIqHaF2G22ro5a3CJdR1jAXehveXRS9Gk6sPLUjcNN6833uhjfFUW+4x90Q4xvbJ4XMeDlx3EFe5LFcXS/3eodnIBmx33unmvIf0vLP+zO1Z1VE3Zp7jSsqQ0DJokzLX+0locf4ls2t/NKVGt7RlVrGrJTpvBoSsp30tVLTSevG4tPXqulZd0aROHnM7Tfl/QWIqncU+rqyiuRaabcopsIiLCewiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiALtpaeeqqGU9NC+aV5yaxjcyT5KzYRwPc77sVEoNHQnXvXjxPH4Rx89y2Xa6XD2FoDBQxB0+WT3jxSP/idw8vgvuElmTwjPb21a6n1dCDk+4qGF+zOaUMqb9MYW7/RoiC4/xO3DyGfmFsyzWqloYWUNromxNJybHE3MuPzJVfqcQ1TyRBGyIcz4j+i6Ka/3qlmM1JdaumlIy24JTG7Llm3JeHd04+6slnt+hGoVVmrKMO7OX8t3zN44U7K71cw2ourxa6c67LxtTOH8P2fbr0W2cL4Mw/h9rHUNAx1Q3/xEw25SeefD2ZLx43FeKWv224lvLXDiK6UH/Upm29qOPaEbLMSVk7OLakibPpm4E/Fef1sXxRnq9AbpL2KsW+/K9T2JPXU0Ghftu+63VYUt0qJNIgIm+8rQ2EO22B8jKfE1vEGZANVSglo6uYdfcT5Lc1lrqC7UMddbaqKqppB4ZI3Zg9Oh6LYhUhP3WVLUdIvdOli4hhdvFP4/jMmeXZikqJ3uIY0ucSc9BqoCTANHj6hdd5nx22UuLIZIo9p7wNM36gH59VZJ6ZtRTSQPz2ZGFhy5EZKIs0GLLOx9Db54fRnuJD3ZENJ4gHUeS9ZI1GhsRWe4YdvU1urWlk0DyGyNz2XgEjaaeWitmEMWtncyhurw2U+GOc6B3R3I9Vtu84Vt17sjbbc2umcM3CoGkjXk5lwPU8Ny0NjbCdzwtcDDVsMlM9x7ipaPDIPyPMLbtbudCWYv+THXoQrxxI2TU0AJMkLcjxbzXRGzLTJVLBOLzSbFvur3Og3RTE5mPo7p14eW7YUtOyZoliIJIzBB0cFZKV3GvHMSs3NlKjLDMKNiyI2LlkeRyIyWRGxeJzNdREbF3aMCHJgWLPNv1Ws3tGRLB2CqdDOyVh1Y4ELS30z4Y6qDD91j+zJLDnzDmscP9J962rVThjHPccg0ZkrTv0iaz9odlloqH6yNuxYTy8Ehy92S+7GGpG/Yy9po83XUeBjuRIUepK6f9nb/ABfkVGqD1FYrv4Fjoe4ERFomYIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIilsM4fuOIK30eij8Dcu9ld6kY6nn0RLII+ipaitqo6WkhfNNIcmsYMyVs/DGCLfZIo7jiJzKiq3sph4mNPX7x+A671KUtLZ8E0PcUbG1Fykb45XDxHz+63oP5qENbW1lcHyyPmke4DZ/IBeKtVUt3Fli0TQZX0lUrZjT+b8O7v8AInrleKmqzjjPcw7g1p1I6lYlNSzTguY0CNvrPccmt8yVDXvEFvsznQhra6tb/hNd9XGfxOG89B7SqVer9dLu7KtqnOiB8MLPDG3yaNPzWjs1a7z839kXi51zStCh+nt47Ulyj2/7pb9/m+3BsOqvOF7fpVXQ1cg3x0jdof8AFuPvWGcf4fiOUFinkbzlc3P81WLDgjE96Y2SjtcrYTulmIjZ5ja3+zNWql7HL29mdTdbfC77rNt/5BZFp8Ze82/jj6YKzX6e6i3+0owXdHL85Z+x2U/aJh97tmpsksbebGMfl8lP2utwtfhsUFTG2Yj93mWPH+U7/ZmqvcOyC/wxl9JXUFUR9jacxx8sxl8QqNdrXdLJWiC40s1HO3xN2tPaCND5hYqmlw4wk4vxNmy/qHfwl/xMI1I+GH8Gt3yZuC42WenBkhPfRjU5DxD2LNwLjG9YPujau2TkxOI7+mec45hyI4HqNQql2dY3kqJo7ReZduR5DYKh29x4Nd15H3q13+1hzXVdO3Jw1kaOPVaMa9W3q9XW48mdGoTsddsXWt1tQe6UXxXd+eKPWeA8T2rF9ijutrk09WaFx8cL+LXfkeIVljavG/ZJjSowXiuGsL3Ot05EVdENQ6PP1gPvN3j2jivZlK+OeGOeF7ZIpGh7HtOYc0jMEdFPUqvWR7zivSPQ3pVziG+nLfF/VfD6H2xi6bxaKC9W2W3XKnbPTyjItO8HgQeBHNZrGrvYxZMlfSPMfaTgauwjXh426i2TO+oqMtx+4/k757xxA+8BYtNtey3XJ5dRk5RyHfCf/p+S9K3O2UV1t01vuFOyoppm7MjHDQj8jxB4LzT2m4Fq8I3DvInGqtUziIKga7J+4/Lc757+YGzb3EoSyuJ4q0o1Y7MjaRjbK0SRkHMZgg6EL5OTBmd61p2fYwdbXstlykJonHKOR3+CeX8PyWyawbTNthzOWenFTtOoq8dqJXLm2lRlhmPPMsCeXquJ5eqwJ5VmhA02yPxTXdzbXsB8UvgHlx+C0/20Ve12e0dGT/8Ai3eAf+U4K8Ylr/Sq4tac44vCPPif65LU3bJVkx26kB02pJD/AMoH5rYlDEDes1iaNXXQ/UNH4vyUas+6nSMeZWAqtqLzXfwLLQXsBERaRmCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiK79n+CJbw6O43NroreDm1m50/lyb193NfUm+B8bwYOB8HVeIphPKXU9vY7J8uWr+bWdeu4fBbRuFRQYXtEdBbYY435fVxjXLm93P271LVc1LabYZNhkUELcmRsGQ6NAWuKypqLhWumlJfLK7QD4ALzXqKjHC4sntB0n9dV6yovYj832ep8tbU19ZkNqaeV2ZJ3kqGxHfY6MPt1nmDn5FtRVt+1zbGeDebt58t+fjO4CyUJstK8enVLM6yQb42HdGPPiq9g3DtTiK59wx3dU8eTp5svVHIdTwWjb0+t9uXDl39/p5k/0i1d2ebK3eJL3muX+1d/a/h2568LYbumI630e3xeBv7yZ+jIx1PPoNVunCWBbBh9rJnxNrq1upnnaCGn8LdzfPU9Vk0n7Mw7aY6WnY2CniGTWjVzzz6kqv3S/wA9YSwO7qH7gO/zPFSkY4Oft5LpW4hoqclrXmV44M3e9RcuKpiT3cEbR+Ik/oqYavqvh1X1Xo84LozFUoP1kDHD8JI/Vc3R1lxVbX22tZntDNodo9jvvNPP+iqO6r6r49MIOYdkRqCgSKFiG11FkvVRbpnZvhf4XjTabva4exbnwFd3XrDNPUyu2qhmcU55ubx9oyPtWse0Sq9OqaKpkGc4iMT3feDTmD5+IqzdiEznU10pyfCx8bwOrg4H/SFCaxRUqG1zR0L+nV/OhqyoJ+zUTTXek5J/Jr4kveqX0SvexoyY7xM8jwXqj6MeIH3vs5ZRVD9uotUppdd5jyDoz7iW/wCVeasWRju4JeIJatsfQ5rHNxFfrbteGakjny6seW5/+ovOnVXKMWy2dO7GM7Go8b4NSX0fybPSrGLvY1I2LvjYpVs4iVjHtRNBSUsQLhBLIe+2dCQMvD7dfcu68y4cr7KLY9tJVU9ZsQinblmQSOA1blvz0yI5qYu0NLV0jqapibJGeB4HmOSrtNarZbZjNTxEy8HPdtEeS+qWBg89do+D6nCd4MYL5rfMSaacjePuu/EPjv8AKS7PsVGLYtFxl+r9WnlcfV/CenL3eW4cT0lHebZNb6+MSQyj2tPBwPAhed8UWOqsN0fR1HjZvilAyEjefnzC3La4lTllcTFWoxqx2ZG07vEQ0zRj+IfmqliK5ei0pax31smjeg4ld2C8Tek03oFfJnPG36t5/wARo4eY+Kr+M6aWOsNYMzBIcgPudPJWm2lGtFSiVqtbypzxIg5ZOq1R2pVPfYiZEDpDA1uXUkn5ELZksi0ziiq9MxBW1AOYMpa08w3wj4BZq+6ODZs1meSt3R2c7W8mrEXdWO2ql565e5dKpdzPbrSfeWSmsRSCIiwHsIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiK+dm+C3XR7LrdIy2gac4oz/AI5HP8PzX1Jt4R8bwc9nOCXXMsut2jc2iBziiOhm6n8PzW7sN2StvVwittsgBcRyyZG0cTyAXOGrHW3y5RW22wguI1OWTI2jieQC3xabVasC4Tq6hjdptLTvqaqcjJ0uw0uPkNDkOHvWdJQRjy5PC4nmPt0koLZeYcJWx/fC3NDq6oI1mqHDPLo1rSABzc7NVKytittsq8RVbc46Vh7pp+0/cPiQPb0Ufcqyqu94qa+pcZKqsndLIeb3uzPxK7u1qQW7DNts8RyEjy5xH2gwa+8uB9igLmbrVY0/8n8uZ2Owox0jTKlwl/yo7u+b3J+bya4lkqrrdHSOzlqqqXPT7TnH+a3FaYaPC2HmQAjNozkcN8sh3/1yC152bUrZb46reM200ebf4joPhmpPE149LrnRsfnDEdluuhPEqZgkluOQ1JynJyk8tmZcbtNW1Blld/C0bmjkFiGq6qHNV1XwarqveTxgmDVdV8Gp6qHdVdV8Oquq+ZGCYNT1Xy6p6qGdVdV8OquqZPuDjEc/ezRMzz2Wk+//AOyvvYfTP9DulSGktfJGzMD7ocT/AKgtY1Ehlmc88dy9cdhdhdYOza3QzMDairBrJh1kyLfbsBg9ihtZrKFvjtf8lw6EZp6pG4xlQTfmsfcoGLCPRIW8TJn8Fs36HMTnY8u0oHhbbC0+Zljy+RVO7a6qF96pKONrA+GEvkcAMyXHQH2DP2rbP0L7Q5tsxBfHs8M00VLE4j7gLnf62e5YdMi1TiX7pheqpplWo1jKSx8Ueg42LieZrG5AriomaxuQURWVO/VTJw45rKnfqoasqd+q4rKnfqoesqd+qA5rKnfqqri6gprzb3U0+QePFFJxY79OYUjV1O/VQ9ZU79V6W4Gp6mGooK10Umcc0Tt4O48CFa7dWw3m2vhqGgvy2ZW/mF0Xqjkvl9itdrp5Ky6yfu4YhmS0by4nRoHMkBRd2tt6whdWx3ejfQzhu3syOBa5h/ECQRpvBUrY3jozy+D4mrc0FVjjmVnGTJLFFVukOYjjL43cHcvjotHSv2Wue455Ak5rdnbpeaOfCVBHTuY+SsmzaQcyGNGbv+bZWi7i/Zp9ni45KdvK6UNtckaNlRa3PmyMJzJJ4rhEVNJ0IiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAp3A+FbtjDENPY7PHGambM7cr9mONo3vceAHtPAAkgKCW3fowXxmHO0anulVStltj2CnrXn/DYXsdmNNSCzdxGa+pZZ8bwiTuX0esRYYrqWtv09NX2hzdt01DHPsbWfqOc+NuQPMbx8LxhyzVV3uNParZANt3haAMmxtHE8gAvWWILzYXYYqKiorKWpoqmBzWNbI1wn2m6NbzJzVI7O8L0uG7JGXBjq6ZgfUzZccs9kcmj+azxwkYXJviZeDsNUGGbWKWmAdI7J087hk6R3PoBwHD3qm9vV9fH2a3uOkdsxuibE5w3vD3taR5aq2Xi5GpJgpyRCN5+/wDyWve2uldP2X3lrGkuYyOT2NlYT8AUqL2G+4z6e07yknw2o/VHmrDcYlvtI08H7XuGf5LC7bi70+2g+r3T8vPMfyWfheQR36kceLi33gj8139s9vfPZaW4Mbn6LKWv6Nflr7wPeqzt7N7DPZ6natUt5V+jlyocU0/gnFv5ZZS8J1gobLdZ2nJ4Dcj1OYHxKhTVdV0w1D46eeAepMBtew5hdKn0ziplGpPNfJqHLoXCZB2mdxXBlceK60QH0XuPFcFxO8rhZdpt9XdK+OioojLNIdANwHEk8AF8lJRWWe6dOdWahBZb3JLiy19jOD34wxjDBLEXW6kInrXEeEtB0Z5uOnlmeC9dVM0NJSSVEzhHDCwveeDWgZlU3sbtFosGFIrbQlprM9usectuWTn/AA5aAcPeoztgxKGx/wBnqOTNzsnVbhwG8M+RPs5lVK6rSv7hRj7q/GzrmhaJPTaXVVFib3y9Pga+xBcpbzfKq4PB2p5M2t3kN3Nb7BkF7X7HrAcIdmlptEsYZVmLv6oce9k8Tgf4cw3/ACrzN9HTBZxRjaO4VkRNrtLm1ExI8MkgOccfvGZ6N6r1nV1O/VWG2pqK3Fd6c6lGUoWUH7u9+PJeW/4oVlTv1UPWVO/VcVlTv1UNV1O/VbRz05q6nfqoerqd+q4rKnfqoesqd+q9A5q6nfqoerqN+q4q6jfqoa41WzG459Avp8MLBWNxgHtLqr1X0UtXRVkDoH93lthhLXZtz0JBaBkSPkon6SmPP+kF1BWWmgqqW0UAczOfISSueRm4hpIDRkANTv8AdzWStcCHAOHIqCv1ZFDbah8rWujDCNk7nZ6AL3F4BqmvjfNAGhxOwSWtz013/Ie5Ve5v2pwzg0fFbIwTha/Yzv4seG7e+ure7Mr2hwa2NgIBc5ziABmR7xkqh2jYOxLgfEslmxVbnUNcWiZrdsPbIxxIDmuByIzBHsK2J3Eup6oRgtvaK2iItMzBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBEQDM5BAfcMbpZAxu8/BbywVb7c7CVC2i2WnYzle0amT7W11z+GS1BRQdzHmfXdv8A0XoHsD7NbrcMLVt/qqiSliq2ZW+B26UtOsjuQOWyOep3ZZzFPTn1Wf7vzcadS5jGW/gbE7CLFYZaqomq5+9uUXibC9oA7vmDx13+zgtn3m5GocaenJEI0c4fb/kvPcMtbabltxufTVUDyDwIO4jy4dVt3CN6p77QCVmTJ48hNH908x0K0sYe8+zy1lEvGxdV7tcd2sdda5ctirp3wknhtNIz+Kzo2LJjYj37jzCThJSXFHhyphqbZc5IJmGKppZix7Tva9pyI94WxaWmixJbm0rITPHWx7BYOu/Xhlz4ZKa+ktgmWguoxdQQk0dYQysDR+7m3Bx5Bwy9o6hUvsoxTT4fvfd3Ef3OcbHeb+5ccvF5aZH+s6tqNtLjHjE7v0e1unUtnPGYzWGux9j7vsaw7QsG3XBd7NvuMe1E8bVNUNHgmb0PMbiOHkQTWl7exFY7JiyxmhucEVbRzAPje12rTlo9jhuOu8fJaExp2D3ygkdPhmpZdabeIZXNjnb0zOTXeenks1lq1OolGq8S+TKBq/RmvQm6lstqD5Liu7vNOIpi6YXxHa6gwV9juEEg1ydA7L3gZFYsNou0xAitdbIT92Bx/JSqqwaymiu/o7jOOrefBmCis9swHiWtcM6IUrD9uoeG5ezV3wV1sHZtbaRzZrpO6ukGvdgbEY/M/DyWrW1G3pcZZfdvJ/Teh2r6hJbNJxj2y9lfPe/gma7w1hy53+oDKOEiEHKSd4yYz28T0C3JhTDdBh6j7qmb3k7x9bO4eJ/6DopaCGCmgbFBFHDEwZNaxoa1o8goq63pkYMVGQ9/F/AeXNQVe7rX0tiCxH84nWtB6KWOgR66o9ur/k+XdFcvHj4LcZF5ubaKPYjIM7hoPu9SofDdlumJr9T2m2QuqKyqfkMzoOJc48ABmSVxYbPdsSXmO22qllra2c6Nb8XEnQAcSV6u7J+z634BtDnOcyqvNQ0CqqgNAN/dsz3NHvJ1PACSs7NU1hfFkd0n6TwsaeeM37sfu+768ETuBsN2/BWFqex0B29gbc8xGRmlPrPPyA4AALKrKnfquKyp36qHq6nfqpZLG5HDq1adepKpUeZPe2Kup36qIq6nfquKyp36qHrKnfqvRiFXU79VEVdRv1XFXUb9VE1dRv1X0+CrqN+qgrpVZnZB3ald1bVbLXEncq9V1GZJJ3r6BUz79VTMZ15eY6NjtPXf+Q/ropyvq2xRPkecmtGZVCq53T1Ek8h1ccz0XuKCLl2D9p3/AEWY1q7jVW51woa6n7meON4bI0bQc1zSdDkRlkcs89+ihvpM9qcfanjCkuFLbjQ0VBTmCnY9wdI7N20XPI0zz4DdktY3OpNVWyS5+HPJvkFjLw2ZFHDyERF5PQREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBEXLGue4NY0ucdwAzKBLO5HCKVo7HWT5GUCBnN2/wBym6Gz0dNk4s71/wB5+vuCxSrRiTVnoN3c72tldr9OJXaC1VdZk5rNiM/bfoPZzUlJR0tEBFH9ZL9uRw3dByUzWzinhLvtHRo6rBsdsrr7eqa12+Iz1dXKGRt6neTyAGZJ4AFSWlW8q0uunwXDx/g863SttMp/p6XtVHxb5LuXLPnjxLp2Gdn8uOMUNNWx7bNROElY/UbfKIHm7jyGfReqLne6ShkjtFGGsijaI3FmjYwNA0f1oq/Z6GhwBhClwvaC11S1m1UzgZF0jvWeep4cgB0UQdSSTqrxZWe0tufwOYahftz2YGfjGwC4wmspWj0tg1A/xBy8+SpVludZZrkyrpXFsjDk9h3OHFpCv9kr8wKWZ2u5jj8lFY1w93wfc6Jn1oGc0YHrD7w6/wBecVq2mvLqwW/n395IaXqCaVOb3cu7uLg7E1PW4djrba/KSV3duafWiOWZB68lszBlhtceH6OpfBHVVFRC2WSeQbTiXDM5E7ss8tF5Ut1fU0Ewkgdm0kbcZPheP16rcmDbrieezxtslW9tFKDlnsERniMzmWnoFV5E9s4LjfLbbbh+0LTUQMqqNxMMsb9WuBAJHsz38wvJnbD2WXPBNW6uo2yVtjlce7nDc3Qa6Mk5dHbj0Oi9a2iiNJSNifI6WUkvkkccy9xOZKzpaaGpgfT1EMc0MjS18cjQ5rgd4IOhCwVaaqLeSmlatV06pmO+L4r85niHBGO7thkinH98oM9aeR2Wzz2D9n5dFtqz9o2FrjTGR1b6HK1uboagbLs+QO4+wqc7Q/o82u6Olr8I1bbXVOzd6JNm6nceTSPEz/mHQLR2J+zHHeHXv/aGG610TT+/pmd9GRz2mZ5e3JQd1pkZvLWH2o6Tp+vWtylsy39j3P8APDJcLtXm518tbmNmQ+EA55NGgWKtVh0sL3NDnxuByIzIIK+nVFQ4ZOnlI5F5Wh/pb5S+ReKfSOEIKKpcO/8Ag2ZNU08P72eNh5OcAVH1d9pYgRCHTO6aBU2z2e8XedsVptddXSk5BtNA6Q5/5QVt3CfYN2g3tzH1dBDZqY5Zy10mTsuOTG5uz6EDzWenpkeeWYavSqlCLdWUYY7Xv/Pga5rrlVVmkj9ln3G6D+atvZt2YYkxtMyangNDa8/HXzsIZlx2B9s+WnMhb+wZ2E4Nw46Opupkv9azXOpaGwA9Ihnn/mLgtiTzMijEcbWsYwBrWtGQAG4AKVpWqiscEUHWOnalmNmsv/J/ZeuPArOB8G2DA9r9DtEG1O8D0irkyMsx6ngOTRoPPVSFZU79VxWVO/VQ9XU79VuJJbkc3r16lxUdSrLMnxbOayp36qHrKnfquKyp36qHrKnfqvRiOaup1Oqh6up36pV1G/VRFVUb9V9PhzVVG/VRNVUb9Uq6jfqoW4VeyCAdSvoPi41W04tB0ChqqfquKmo36qIuFYIonSE7uHNegR+JKzbIpmn8T/yCqGIavuKXuWHxy6eTeKlKiXMvmldlvc4lU24VLqurfM7cdGjkOC+yeFg9RRjoiLEZAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCK0YTw8Klorq5v1J/dxn7XU9FM3G20bJADTxOaRpmwZhYJV4xeC0WnRS7uLVXMmop8E+OO018iubrTbnb6VnsJC+f2Pbf8A3Yf8bv1Xz9RHsPj6K3XKcfn6FORXRtrt7d1LH7dfmu+Omp4/3cETP4WAI7hckZIdFKz9+ol4ZfoUqGlqZv3UErxzDTks+nsNdJrIGRD8Tsz8FeLbaLrcnBtuttZVknL6mFz/AJBW6z9k2NLhk6ShhoIz9uqmDf8Albm4e5atbUadL35JfEkKPRe2hvqzcvl+eZqumw9TMyM8j5TyHhH6qUpqaCnbswQsZ5DUrfFi7DqGPZkvV4mqDvMVMwRt8to5k+4K827DOGsNRtbaLRTQ1GWkzm7cg67bsz8VC1+kFHOzDMn5L8+BMULS0tF+1BLv5+fE8+YfwDia8Oa5lA6kgP8Ai1WcYy6DefYFeY8BYawpZ5r1iGd1wdTs2ix3gjLuDQ3eTnpqcui2gdTmVoDt9xcbjdBh+il/utI499sn15dx92o/4l9sZ3OqXMaEHsrnjs8TBfagrahKtPgvm+SNdYjukl4u89a6OOJj3fVxRtDWRt4NAG4ALeHYNhyPDVn/ALT10TXXe4Rf3ONw1ggO55HN2WfkBzIWo+zuzRXa/Mkq2B9FSZSzMP8Ai6+GP2nf0B45L0RSCQxd7N+9k8TshkByaBwAGQA6Ls2mafFRSSxGJw/W9TnOUpN+3Lid8j3yPc+Rxc5xzJJ1JXCIrEVIBT9nuHftEEx+tA0P3h+qgFywuDgWkhwOYI4LxOCkt57pzcHlHTjTDvdl9yoI/qzrNG0er+IdOaw8B4qqsM3QSDalopSBUQ8x94fiH8leLRViqi7uXLvQNfxBU/GuGXUT33ChjzpXHORgH7o8/wCH5Km6rp2w3UprxX3Lbpt+qkVTm/B/Y39aaykudBDXUUzZqeZu0x7eP6HopBjOi859m+M6nC1xEcu1NbJ3Dv4s/V/G3qPiPZl6MttTTV9HFWUczJ6eZodHIw5hwVcksEzg72NXcxq5Yxd7GLG2fUYdVabZXHOtt1JVH/fQtf8AML4p8MYdieHxWC1Ru5to4wfkpVjF3taGjMrwzIqk0sJnzDFHDGGsa1jGjRrRkAuiqqAAQEq6gAEAqGq6nfqh5Oayp36qHrKnfquKyp36qHq6nfqvoFXU79VD1dTv1XFZU79VD1dTv1X0HNXU6nVRFXUb9VxV1O/VRNXUb9V9PhzVVG/VRNVUdVxV1G/VRFZUhoJJX1AV1UGtJJUDWVJcSSd6VlSXOJJ8lFVM+Z3r0DmpnzzCrt0qe+m2GnNjPiVmXOp7qPZafG/d0HNV+4VTKSldM7UjRo5lel2n1EZiWs2WijjOp1k8uAUAvqWR8sjpJHbTnHMlfKxN5ZkSwERF8PoREQBERAEREAREQBERAEREAREQBERAEREAU/hKyG4ziqqG5Usbtx/xDy8uaxMO2iS61mxq2BmsrxwHIdStn2a2y1NRTWu205fI8iOKNv8AXxWtcVlBYLr0V6PfrJfq7hftx4L/ACa+y59vDtM3DNkrb7dIbZbos3u9Y5eGNg3uPID+S3bR4GwxBQQ0L7TS1hYMjNNEDI88STvHlwWVhDDlHhCw91tMdVzNDqufmRwH4RmcvauY8QCOpc6OmEkY0aS7Inquf6nqzqzxB4iuHf3l6uKtS8ls0l7KOl/ZhgaQDvLDHnxLZ5W/JwXx/wBFWAv/AMh//tz/AP1qVZieE+vSyN8nArtbiWhO+KoH+UfqotalX5VX5s03aXC/tZGwdm+CITmzD1Of43vf83FS1FhnDlEQaSw2yFw+0ylYHe/LNfH9pKD7lR/wj9V8uxLRfZhnPmAPzXid7Un702/iz5+kuH/aybAAGQGQCKuSYnGX1dGfNz/5LDqMSVzmkt7qFoGeYbnl71rurEyR06vLisFrqpmQQmR53buqp11xJbad7nSVAnl+7F4vjuCpV/vNZdKg97Uyvhbo1pdp55blFqUoU9mOXxZ7WnrPtvyMnH+O6ymtMrqdwpA8FjA05vPXP9FoOR8tVUlx2nySO3bySVYMfXb9oXV0Mbs4YvC3Lcevt/RZXZlZxWXJ1ymbnDSkbAO50nD3b/cuwdEdIdCgpyXtT+SOWdNNWhKs6FL3Kfzl/HDzNidm+H226jgp3NHefvqg83cvIbvetgKOsFP3NH3hHil8Xs4f11UiunU4KEVFHHriq6lRyYREAzOi9mAAEnRd8Ua5ijWZDFu0WvUqYPcYima5j2vaSCNxCslDKyqhLJGguyye0jQhQ8MXRZkALHBzTkRuUfWntG5Rbgyk44wu+1yur6JhdQvOrRviJ4eXI+xZ3ZdjyowrWCkrC+e0TO+sjGphJ+238xx81f4TFVwOilY1wcMnscMwR+i1njnCklokdW0TXPoHnUbzCTwPTkfZ51i/slHM4cPoWmxvVUShPienbbUU9fRw1lFMyenmaHxyMOYcDxX3cK2ltsAlrJRGCcmjLMuPIBecuyPtCnwlXCiry+ezzO+sYNXQOP22/mOPnv2/frnTy4mobk2VtRQbEcsL2Haa5h12h7c/cqxXqzo1VFr2XzJeME1ku9FOJou8ME0IyzAlbkT7P1XxV1IGYBWBdMQ2mmtklQK6GQlh7tjHgucctBlvCwpap5haZNHloLvPithpcjwsn3WVO/VQ9XU79VxWVO/VQ9XU79UPpzV1O/VQ9ZU79VxWVO/VQ9XU79V9ArKnPPVRFXUb9UqqjfqoiqqN+q+pHw5qqjfqomqqN+q4qqjfqoiuqw0HM+xegc1lUGgklQVbVF5OZ9i4rKouJJKiqiYk5Zr6DmpnzOQKwp5WxRukedB8V9OPElQ1fU9/Jk0/Vt3deq+pZB0TymSR0sh6+QVRvNaayp8JPdM0YOfVSGIq/IGjidqf3hHDooFeZy5GSKCIi8HoIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiALJtlFPcKxlNA3Nzt54NHEldEUb5ZWxRtLnvIa1o3klbHw1aGWqiAcA6ok1ld/8AKOgWKrU2F3lg6PaHPVbjD3U4+8/su9/IzbRb4qGlio6Vhcd2g8T3Hj5legey3B0eG7abrc2tFxmjzdtf+HZ93z5n2ecB2NYL/d4lusIy30UTx/6p/L38laMVXg1TvRKZ57gesR9s/oqHrmqbTdCm/Hv7vU6rVxPFrbrEI7nj6GLfbrJcqosiJbAD4R97qVitAAAG4Lqp25DbPHcu1VGpLaZv0qcacdmIRcrhYzIcrhEQBQ+I6zYZ6JG7xO1f0HJSVbUMpaZ8z+A0HM8AqjNI+WV0jzm5xzJW9Y0NuW2+CMVWeFhHwobGFzFts0jg7KWUFjOfU/1zCmVq3tBunpt2MMbs4ofCMuOX88/grjoWn/rryMH7q3vwK9rmpLTrKdbnwXi+BXWtlqakNY0vllcA1o3kk6BbwwfZm0NDSWxmRI1lcOLjq4/10WvOy+0+lXN9ylbnFS6Mz4yH9B8wt0Yag0kqCB91v5/ku96bQUY7Xl4H5u1e6cpNZ38X4smWgNAAGQG5crhfTRmVLFcOGjNZEUa5hiWZDFuWvUqYMkYnEMfRZsMXRIY+iy42KPqVTYjERsWRGxI2LIjYtOczNGJzCC1wc3QhSLWxVMLo5WNe1wLXscMwQVjRsWRGNjxblqyqYNim3E1VjvCMtlldW0TXSW958zCeR6cj/R5wJiwWmRluuvezWl78/AfHTk73M6c28eGRW1pHRVMT4ZGtexwLXscMwQVqbHOFX2iZ1bRNc+ged28xHkenI/0Ye+sIyi2lu+hYbK92sRk9/wBTfNlsFlkihuUFUa+J7RJC8EbHQ6cVzdTJA/J2rTuPNaQ7M8d1WF6n0SqL57VK7N8Y1MR+838xxW9G1VFdbeyenlZUU0zdpj2HMEfqqlLrbKpiW+L/ADzJndUXeVyrqd+qh6up36rKv0MtFJk7WN3qv5/zVcq6jfqpSE4zjtR4GFrBzV1O/VRFXUb9VxV1G/VRNVUb9V7R5Oaqo36qJqqjfqvitq2szzd7FBVta5+euQX0HbXVoGYacyoSrqSSSTmVxVT79VGVExJIBXoComJJAWOSiwrjVd03u4z4zvPJOIOm51WecEZ0+0fyUDeK4UdP4cjM/Rg5dV311VHSU7ppDu3DiTyVRq55Kmd00pzc74DkvsnsrB7ijrc4ucXOJJJzJPFcIixHsIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIin8H2b0+q9KqGf3aI7j9t3Ly5rzKSiss3LCxq31xGhSW9/LvfgTGCrL3EQuNSz614+qafst5+Z+S272VYPdiO5+mVjCLZSuBk/wB67eGDpz6eagMI2CrxHe4bbSDZB8UsmWYjYN7v5c8lv6f0PDVjgtNsYGbDNmMZ5kDi49Scz5qpa5qvURcYv2n8l+cDslG2p6bbxsrb3u36t/m46sS3NkUf7OpMmNYMpCzQAD7I/roqnrJJ5ldtU8nQkknUkpTt02jx3KguTftMkaFGNGKgjtAyGSIiwmcFcouEARFi3SpFJRvkB8Z8LPMr1GLk1FHxvCyQ2IavvqnuGHNke/q5Ra5JJJJOZO9cKw0qapwUUacntPJHYjrhbrRPU7Wy7Z2WHqf03+xacle+ecuyJc92g3lXbtQuGcsNvYfVG0/zP8sveojs8tguGIo3yNzhpR3zvMeqPfr7Cuq9DNNcLfrWt838jkvTzVFKurdPdBZfi/4+psfClrFqslPRhv1uW1L1ed/6exbDooRT0scP3Rr58VXbJD31wZmPCzxn2bvjkrS1uZXVKcVCOFyOLXVRzlvDRmVkRRrmGPcsyGNYqlTBhjEQxdFmQxJFGsuNi0KlTJsRicRsWRGxcxsWRGxaU5maMRGxZEbEjYu9oDRmVqzmZooNaGjMrqnl00XRdbhS0NJLV1lRFT08TdqSSRwa1o6krQGP+22umrzTYSayGljORqpog50v8LTo1vnqei061xCiszZJ6fpVzqE9mity4t8Eb4lnLXbTTkQuxs8NXC6GVrXbQyexwzBH6LWPZj2gtxVbhBcWx09zZmCG6MmA+03PceY9o6WySocx4cxxDhuIW3bVIVobUHlGK8s7jT63VV44fHxXJruKxjLC77a99bQtL6MnMt3mL9R1XGAsX1mGqvu3F81vld9dDnuP3m8j8/cRbxeaeVpp5Cw1Bb+7P2hzVHxDZDA59VRtzhOrmD7Hl0UfqGmKUW0srmiUsb7axGb39pvCOsoLxbWzwSMqKWZuYI/rQj4Kg4popLY8yZ7dM4+F/LoeqpOFMRVdhrNuMmSmefrYSdHdRyPVbON3tNxsr6x08bqNzSJNvTLmCOapsqdWxqbt8X+eZM5VRd5risuDNdnMqGra57s9ch0Xdh2humLcUDD+HaZtRUBpfNJI/YihYCAXOORO8gaDeclL9pXZziHBlDHcK59NVUcjxGZqdxIY455BwIBGeR13KYSNcpNVUbzmouqn6pUz79VGTzFxyBX0+iomJJAK6Cixa6rbA3ZbkZDuHJAK+rEDdlush3Dl1UHUzshjfPM/IDUk8VzUzNYx88z8gNXOKqt1uD62XIZtiafC38yvreyj0kddyrJK2oL3Zhg0Y3kFioixGQIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIi5Y1z3BrQS4nIAcSgSyZdnt8tyrmUsWmer3Zeq3iVtG02/ZFPbqCFznEiOKNupcSfmSorDFpba6AB4BqJfFKeXJvsXojsCwIY6duLLnD9ZI0ihjcPVad8nmdw6ZniFCapqEbem5v4d7OtaFpsNDsncV1+5P5dkfu/wCCbwRhmDBmGiZw11bKA+pePtO4MHQZ5e8qJrnz1NS+ebVzjn0HRXS+g1c+y390zRvU81B11Hsx5ZauXLrm6lcVXKTy2SdpXxmpP3mVVwc+TcdVkgZADkpent+eby3oEfQdFhnNcCRjcxZErhSD6E8l1Oo3DdmvOTKq0WYqLtdTvHBfBjeN4TJ7Ukz4VbxFU99ViFpzbFofPip+um9GpZJnD1Rpnz4KnOcXOLnHMk5kqS0+lmTm+RjrS3YOF8yPayNz3HJrQST0X0oTG1b6Fh2oeDk+Qd232/yzU3b0ZV6saUeMml5mjXrRoUpVZ8Ipt/A1jf611fdqipcfWechyC2N2aW70PD4qXtylq3d4f4Ro38z7VrO10j6+5U9HHntTSBmfLM6n2b1vOmhZDDHDE3ZjjaGtHIAZBfoPSLWNGCUeEVhH5r1y9ncVJTlxm22WHDEB7iSYj13bI8grBDF0WPZ6buqCBmWuyCfM6/mpWGJS86mEVRrak2cQxLNij6JDHosqNi0KlQyxiI2LIjYkbFkxsWnOZnjE4jYsmNiRsXTcrlSW6POd+byPDG3VxWrKTfAyxjkzAA1uZVNx72g2TC9E6WomE0xzEcUZ1eeQ5/LqFR+1HtTbb2yUNM5slWRpTsd4Y+sh4/w/LetBXa5Vt1rn1tfUPnmfvLuA5AcB0UXd3saPsx3y+hbNF6N1LvFWv7MPm/47/IsHaBj2+4xqia6buaJjs4qSM5Mb1P3j1PsyWPgrCNfiWd7oz3FJF687hoXcGjmfl7gezAWEqnEldtP2orfE766bLf+FvX5e4HaWILvR4bt0dptUUbJms2WMaNIhzPMnf8AE9aFq+s1et/T2/tVXxfKPidi0PQ4OKxHZprgu385vmUE0tRZaz0YNdTT07tNk5Fp3gg/HNbGseMZK+0ubOwenRZNcQPC4cHfyWuWNqK2q3ulmkdmSTmSeJJVltlGyggLc9qR+r3fkrV0ZpXUqu1/b/d2N93x+RG/1MlpisI0qqXXrGxjilnfn/bj54xwJKWql7/v+8d3uee1nrmrRYL/ABVzRTVTgyp3DgJPLr0VIlkWK+UtcC0kEHMEK+qGThalgu99s4btVNI3Te+McOo/RQOZAyBUlhrEzaktoq9wbNuZIdz+h6/NZl4tjZSZ6YAP3uYPteXVQd/pj3zpr4ehL2l7/bPzITsUx5T9nOPaqrvNNLNRVcTqed0Tc5GeIOa8AkZjMajkc+GSvPbx20YexXh6PDOFxUVLZpmTVNVLEY2tYzUNaDqSTlrlllzz01xcLbSVo2aqAOcNM9QQqzc7c63O2WRjunHwvHHz6quyi0Sm57zHnmLjkCulFgV1cGZxwkF3F3JecZPp2V1Y2AbDMjJ8lC1MzY2PmmfkBq5xXzVVEdPE6ad+Q5neSqrc7hLWya+GIHws/M9V9bUT0kfV1uMlbJkM2wtPhbz6lYKIsbeTIERF8AREQBERAEREAREQBERAEREAREQBERAEREAVswNaNt/7TqG+FpyhB4ni5QVit0lzuDKduYYPFI77rVtrDlmqrrcqKx2mn7yoqHthgjbz/IDeTyC1bmsoRxku/Q/RlXqO9rr2IcM832+C+vgXLsWwJLjTEgNQxwtNERJVv1G3yjB5uy15DPovUdxgbDTtpoGNY3Z2QGjINaOAWT2e4MosGYTpbNShr3sG3USgazSn1nfkOQAUhNRF7i4jMlco1zVXdVfZ91cPX4m5qOsq9udpe5Hh6/EpklB0URXUZdOWgZ5aBX+oogyNzy3cM1D01uMlSCRnl4ioSnLG8+07/vK6LdsRhuzuXU+g/CrlJQfhWO+g/CvO2bENQ7ymvoOi6H0H4VcpKD8Kx30H4V6UzahqHeU59B0WFXwwUlNLVVL2RQxNLnvdoAFdpKD8K0B2x4tbdbm6y22UG30r8pHt3TSDf/lG7qdeSk9LsZ39ZU48Ob7F+cCUsqs7mezH4mBiLGza2R0FLQgUzX5tc5/ifyJHDyUP/aAk/wDY2/8AH/JU6+3yltRYyRrpJX67DctBzKhzjRueTbc4/wDm5fkujUdFt4wShDd4v1M13rOlWdR0q1TElx4v6Jmyf2//APB/+p/JU7H17fcGwUhg7nu3Fzht7WfLgFHjFecZP7NlDuA7wZKJraySunNRIzu3OHq555Ka0XSKULtVNnGzv4/DtKl0r6QWNXT3StKmZSwuD4c+K+HxLX2U2/0m9S1rhm2ljyb/ABO0HwDltilh7yVjPvOA96qnZZbxTYZZUObk+qkdIfIaD5Z+1XahyjqopHeq14J9hXUbf9ukkcIu5dZVb7NxdoIsshks2KPokDAQCMiDxWVGxY6lQjYxOI2LJjYkbOiyI2dFpTmZ4oRsXc4xwxmSV7WMaNXE5AKOuV3paAFmfez/AHGnd5ngqjf73swSVtzqmQ08Q2jtHJjP5/Fa8nne+Bs0qMptJE/d8SbLXMofA0DWV35Dh5laM7RO0lxkloLDOXyEkS1ueevEM5/xe7mq/wBoGPaq+ufQW4vprbudwfN58h096pCg7zUeMKPn6HQtF6NRp4rXS38o+vocvc573Pe4uc45ucTmSeancE4ZqsS3PuIyYqaLJ1RNl6o5DmTwWFhyz1d9u0Vvo2+J5ze8jSNvFx6BbtcbbgrDkVLSxhz8smD7Ur8tXu/rkFSdY1SVslQob6suHd3nSNK013U9qXur59x83u40WFbRDbbbExsoZswx8GD7zuevvK19/eK2rJJdLNK7MknMk8yuaiapr6x0srnTTyu1PElWK10TKGHNwBmcPE7l0C2ujfR11JYb75S+y/O8k+k3SS36PWmVh1Je7H7vuXz4eH1b6OKghyGTpXeu/n0HRfcsnVcSyLFlkXWre3hQgqdNYSPzffX1e+ryuLiW1OXF/nyXISydViSydUlkWJLItuMTTbOZZOqs+FsWBhZQ3OQ7OeUc7ju6O/VUyWTqsSWRZNhSW8+KWDcVyo2VH1keTZOfBy1/je7zW17KFlOxz5G7T+9bmAM8hkPYsexY3/YVP6PctuopwD3Qac3t6DPePkqfinFtbf7mKmeKOKBmbYomjVrert5Pw6Ku6rYQb2oe99SasK88Yl7p83W6T+jBjAI3OORLfy5L2v2HdleAIuyix1FRh613epulviqqqrq6dk0jnyMDiGucCWhueQDct2e/MrwZc7nS7DY2hzn55nL7KteE+2THWFLC6y2DFdXR287WzAI2SbGep2C9pLNdfCRrqqtL2ZYZLYytxh/SJslBhntixBYLTP3lupKgejt2sxEHMa8x58dkuLczr4Vr5ZNzrai4V89bVzSTTzvL5JJHlz3uJzLnE6kk6klYyxveZVwCIi+H0IiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiALkAkgAEk7gFwrHge1+lVhrpm5wwHwgj1n/AMt/uXmclFZZvadYVL+5hb0+L+S5v4FlwtaxbLcA8f3iXxSnlyb7PnmvWn0U8AG3Wx2NrpFlVVrCygY4axw8ZPN3D8Iz+0tM9imCJcc42p6CRrhbaYievkA3Rg+pnzcfD01OuS9txRxU1PHBBG2OKNoYxjRkGtAyAA5AKidJNT2I9TF73vfh2fH6eJ0TpBd07C1hpttu3b/D1fF/ycvOuXJfGQK5XXPPBA3bnmjibze4NHxXOZSc5ZKSlyRj3MNFMRkPEcl02umjLHvI3nJRt+xRhqnYwVGIbRDkTnt1sbeHUrAg7RcB0lNlLi6zZ5kkMqmv/wBJK2I21aUPZg38GbcLevKPswfky1OpGFdL6EHcFVZe13s4iz2sVUh/hZI75NWM/tp7MmDM4nYfKjqD8mL0tOvHwpS/7X6GaNlfcqUv+1+hbH0HRdD6D8KrLO2rsxechidvtoqgfONfN07Zez2mtNVWUt9grZoYi+OnZG9r5XZaNG00bzl5L0tOvc46qX/azNG1v00uql5MpP0hsYMw3aBYLdLs3WvZ43N3wQnQnoXagdMzpkF5cvFwittA+pl1I0Y3P1ncAp7FF7rsQ3ysvd0m7ypqXl73bg0cAOQAAA6BanxVdTcrgQxx9HiJbGOfMrqWiaVGzoqnz4yff+cC2ahdx6P6bhPNWXDx7fBfnEja2pmrKqSoncXSPOZP5LIo6fZ+seNeA5Lijp8spJB5BSdFSvqZMho0es7krKlg5FOcpycpPLZ0hjyzbDTs55Z9V9gEAZjJXXD+Gzc4C12cNIwevxJ6fmVC36j2CWNjDHwZtIHELc02uo19nz7jVucbJs3suroa7C0ELHDvaXOKVvEaktPtHyKuDGLQWC79Lh69MqwHPp3+CeMfab+o3j+a3/QzQVdLFU00jZYZWhzHtOhBVzp1tqOOwrVzQcJ55MtmFq8SxCimOUjB4CftDl5hWONi15FtNcHNJa4HMEHcp+DENWym7sxRukGgkP5jmsVTL4Gm6W/KLPNNBSxd7USNY3mePkq/c79NODFRgwx7i77Tv0UTPNPVS95USOkdzPDyUDi/E9uwzQGaqcJKl4Pc07T4nn8h1WtUnGnFymzbtrSdWahBZkzMxBebfYbe+uuMwY0eq0avkdyaOJWica4suGJqzamJho2HOGnadG9TzPX3LBxJfLjiC4urbhLtu3MYNGxt5NCx6amyG3L7B+qq9/qLreyt0fqdQ0Ho5G2xOW+fbyXh6nSyLJneSaN4DiVxBFLU1McEEZklkcGsY0aknQALmpl72TT1RoFtvsZwo2jpP7UXOMCR7T6G1+mywjV/tG7prxUHd3UbWi6s/gWqjbfqKqpU+HN/nyJbCdlosF4bfUVZaap7Q+pkG8u4Mb0G7rvVLvdyqLrcH1U536MaNzW8ApLGl8N2rzFA7Kjhd4ANzzxd+nRY9iosyKuYeEfuweJ5qK0DSK93X6ypvqT3t/4r8+yLTqWo2ugWDuKvCO5Lm3yS73z+LMuzUIpY+/mH1zhoPuj9VlyyJLIsSWRdms7Ona0lSprcvzJ+aNW1W41W6ldXDzJ+SXJLuQlkWLLJ1XEsixJpFvRiRjYlkWJLIksijLhcIKVucj/EdzRqSsu6Kywk5PCMiWTfmoW43dkebKbJ7+LuA/VR1fcp6olufdx/dHHzWDL9VTuncMmDQE8TyCjbrUowj7Lwu0k7XTpTe9ZfZ6n3PK57nSzPJPEkqNqq0uzZDoPvcSseonkmPiOQ4Abl1KqXWoyqZjDcu3mTNK3UeIREUWbIREQBERAEREAREQBERAEREAREQBERAEREAREQBERAdlPE+eojgjGb5HBjfMnJbStlHFQUMVLEPCwan7x4n3rVcUj4pWSxuLXscHNI4EKzf2zrO7A9Eg28tXZnI+z+a168JTwkXHonqthprqTucqTxh4zu5rcbkwX2i4owda6igw5U01EKiTvJpvRWSSPIGQBLwdBrkMuJ5ld9f2rdolbn32LLi3P/AGLmxf6AFouXFt2f6pgj/hj/AFJWJLiC8yetXSD+EBvyC0XpVKcnKUI5fdvJ+t0s0VTc1RcpPnsx+reTcdbirE9bn6ZiO71Of+1rZHfMqIlle9xfLI5x+852a1TJcbhJ+8rql3nK79Vjve95ze9zj1OazwsYw93C8EYH07oU91K3+aX0TNrPq6Rnr1UDfOQBdL7ta277jS+yVpWrUWX9Ku01p9P6792il8W/Q2a6+2gb6+H2HNfP9oLN/wC/x+4/otaIvv6WPaYH09veVOPz9TZYxBZj/wCPj9x/Rdsd4tchyZX0+fV4HzWr1PYKwrdMV3T0K3MDWMyM87/UiaeJ678hx95WOtTpUYOpOWEuZmtum2oV6ipwoxk3wSz6smcYXqJlGaOjma+SXRxYc8mqHtGDsU3NrJaKw10kZyLXuj2GuHQuyBXoLBmAMP4ZhY6GmbV1oyLqudoc/P8ACNzR5a8yVcYKaon/AHUL39QNFUbjpbGk3G2hldr9P5Je76O1tVq/qL+ps7sKMeXxfPt3HkmpgmpqmWmqI3RzRPLJGHe1wORCu2DLI25QsmyMdG31ncXHiP5qe7e8E11sqmYojpHMpapwjqSMsmSZaHT7wHvHVVLAN8dRTm1zyZU1Q7NhJ0a/9D+itunXS1G3hUpvG1x7nzOZ6tay0+vUpPfs8O9cmbFlfGyJtPTtDIWDIAaKu4mtxmj9Mhbm9g8YHEc/YpxFaaVtTpU+rit35vKfK4nKpts1NcqbuZO8YPq3fAq59lOMBaqltnuUuVDM76qRx0hcfk0/A681lXfC72xGvMJ9BkORHI/p1VGvVqqLZO0SNPdSaxv5j9Vms7+E6jpZ9pEjOg50lKS3M9NRjMZjULuY1al7JsdtjENgvU2TdGUlQ87uTHH5H2cle8f4oiwvaWytYJauclsEZOmeWrj0GnwUjVrxhBzlwRHUrOrVrKjBZb4HXjzF9Jhii2W7M9wlH1MGe78TuQ+fxGi7vca273GSurpnT1Ep1J4cgBwHRdddV1dyrpKurlfPUTO2nvdvJWRTQCIZnV/yVRvr+Vd7+HJHVNC0CFpHdvk+Mvsj5pqcMye/V3LkuK6XZb3bTqd/ksiRwYwuO4KNaJKicNY0vkkcA1rRmSTuAUbD2ntMstzKNCn1cOLLP2ZYYOJcQsjnafQKbKSpduzHBmfMn4ZrZvaRfWwQts1CQwloEmxoGM4N6Z/LzWRZaWkwNgZsZ2HVThtzEH95K77PkN3kCVrueWetrHyyEyTTPzJ5kqvuf+pXO0t8I8O9/m/yLHpNlG1o9ZU3Pi/zuOy2UhqqjI5iNurz+SsL3BjQ1oAA0AC6KWJtJTNjbltb3HmV8SyLrui6YrKj7Xvvj6fA4L0z6Sy1u9ew/wBqG6K7e2Xx+mDmWRYksi4lk6rBrKqKCMySyNY0cXHJTqWCncT7lkWDWVUUDC+aRrGjmVC3LEbdWUTNo/7R409gVfnmmqZduV7pHnmsFW8hDdHebdKynP3txLXG+vkzZSDZb99w19nJQ4Ek0mm097t/ElWvBHZ/fMUTB0MJp6QHx1EgyaOg5noPbkrnj6xWTBVlp7HbWd9cawd5U1Ug8fdg6NH3QXcvu65qoaj0lowqdVB7c+xcF4l30jopVrNOotiP/k/hy+Pkaxpbe1uT5zmfujcq9eq01lWdk/Ux+GMDdlz9qnsR1fo1AY2nKSXwjoOJ/rmqkofr6txLrKj8CV1mNvYxVlbLHOT5vsy/n2cAiIvRXQiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCLkAk5AZkrbfZ52RyVkUdyxQZYIXZOZRsOy9w/Gfs+Q16haV9qFCxp9ZWljs7X4G/p2mXOo1eroRz2vkvFmr7PbK673CKgt9PJPPK4NDWNJyzOWZy3AcTwXqbBOHKPC+H4LZStaXgbU8gGsshGrv06ALPs9pt1ppRR2uhhpYR9iJmWZ5niT1KsFntk0tS2SWMtjbr4uJXOdb1+WopQitmC+fidP0TQKWjKVapLam15dy8e07rTa9vKSZuZOoaeCtFBRZAANXZQUe7RWCgot2iq8pnm+v3LiyKumG6C/WOrs1zg76kq4jHK3jkeIPAg5EHgQF4h7T8F3PAeLqmxXFpc1p7ylnyyE8RPhePkRwIIX6I0VFu0VU7b+yy39o+Dn0D+7p7tSgy26qI/dyZascd+w7IA+QPBTvR3XP9Or7FR/ty49z7fXu8Ck6ts3O9e8jxtgq+i4U4oqp/wDe4m6E/wCI3n5jir9YbSakipqWkQj1Wn7f8lo+72674WxHPbrjTy0NzoJtiSN41Y4fAgjUHcQeRXonsZxBbsW0LpZTHHcaQAS0o3dHjm3pwO/hn1+ve1qlGMKPP+7u/OZT6dhRVZ1J8OzvLVabHFNTl1fC10T25NhcNCOoWuu0fBjKRr43sMtunP1T/tRu5Z8+R4+9bnWHe3W9lpqX3Z0TKFsZMzpTk0N55rFb01QSUPM3ZydR7zxzerRVWus7iUbTHfu5ANHD9ei7K2ura4xGtqpah0UYiYZHZkNG4KXxvd6W5XaWO2GX9mxSH0fvBk5w+8fy6KKoodo944aDctm7v51opS4L5lm0TR+qe017T+SO2kh7tu04eI/Bd6DU5BfFVK2nbloZTuHLqVE75Mu0Ywo0+xIxq+TxCMcNSrt2MWE1t3feZ2ZwUfhiz3OlI/Ia+ZCqGHbNc8RXqC1WundUVdQ7JoG4c3OPADeSvR2KLJbOz7stoqKnkaLk0d0JWDLvpXavd5DXLkAAoTX79UKcbKk/3Km7wXN/bz7DVsGq95GU1uzu+xrjHl29PuhpYnZ09MS0cnP4n8v/ALrAssAaDUvGu5n5lR0LO8lDS7Ib3OJ3DiV93HE1pomd1FL6Q5oyDYtR79yt3RLSadPFSXuw4d77fv4mh/UbXJWlqtOt/fqe93R//T3eCZNyydVGXG40tGzaqZ2R8gTqfIbyqdc8VXCqzbAG0rD93V3v/TJQbjLPKXOL5ZHbySSSr7O8jFeycTpWM5vD8kWS54pc7aZQxZf7x/5BV2pqKiql255XyvPM5+5Z1ustXWSiNkbi4/ZaMz+gV1smDIYQ2StcAfuMOvtd+iq+p9J7a2WJS2n2Iu2k9DLu4xKUdiPa+Pl64KTa7LW18ojiicSeAGv8vatm9nmAaN94phXtE+R23s+zkNciePAcBqpSlpoKWIRU8TImDg0K6dnVKXOqaoNJccom5e8/kue6n0lurzMYvZj2I6FadHrLS6TnGO1PtfH4dha4o4oIWxRRsiiYMmtaA1rR0HBebMdXg33FNbcA7OIv2IekbdG+/f7St+9qFX+wcA3Csc/KpmZ6PAAdzn6E+YbtH2Ly7c6j0WgmmzyIbk3zOgWLRKantVPh6mWDVKEqs+CRWL/U+k3F+R8Efgb7N/xUeiK3xWFg5dcV5XFWVWXFvIREX0whERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBEWTbaGsuVbFRUFNJU1MpyZHG3MlfJSUVl8D7GLk1GKy2bO7AMJxXCtlxJXxB8NI/YpWuGYdLlmXZfhBGXU9FvqnhdM/Zbu4lVjs2ss+H8F0Frq2MZUxtc6YNdmNpzi7fx3gexbBsdKHwMeBmXH81yHW793l3OecpPC8F68TtGj2kdM06EcYk1l9uX2+HD4HbbKBjMiG68+Kslvo92istqtsNPTMiETTp4iR6xX1DRMbUvaxuTQ7QclC1E0skRcap1rZ1W+j3aKwUFHu0X1b6PdopaNgYMgtWUit3V25PCPmKNrBkBquxEXgjm8mmvpKdjVL2iWd13s8UcGKKOP6l+jRVsH+E88/uuO46HQ6eI7dWXvCGJRPCJ7fdKGUskjkaWua4HJzHtPDgQV+oK85/TG7OcKVuHJcbur6Wz3yABg2hpceUZA1MgG5wG4ZO0Gbbx0V6QSoTjZ1suL3RfHD7PD6eBqV7Z1HmC3kFgrtMw/fsMS3arqobfPRszrYHu1Zwzbxc0ndlrmct6012n9oVfi+pNLAH0tojdnHBn4pCNzn8z03D4qhwxtjGmp4lZtLTl2T3jw8BzXSZzSRNaXpLi1KSzL6HzTQGQ7TtGfNSEbCcmtGg+C+4oSQCdGr5rallMzYZkXncOXVacpObwi6UbeFtT25vC+p81U7KVmy3J0pHuWFb6OsulwjpKSJ9RUzOya0byfyHVfVsoa673KKioYH1NVO7JjG7yfyHXgt94TwtasBWGSur5Y31rm/3ioy/9NnT4n5aGpalT06CSW1UlwX5y+pqQjU1CqlwivzzO7sworb2a0MtbcBHLNOwNqpw3xDiGM6Z8OOWfAZU3tCxfWYuu/pMze5pIc200H3GniTxcchmsLFV+qL5W7bgYqdh+qiz3dTzKq9xqg5joYJCCdHPad3QdVFabpT693dy81Zc+zw/O5FoVvb2MetUfaS3L8595EYprRLM2kidmyPV+R3u5exRcNLPL6sZA5nQK+YfwhRT0MNa+clsgJ2Wt1GuW858uSs1FZ7dR5GGlYXD7T/EfjuVpn0ot7Kn1FvFtrm+3mUKv0XrardyvL6pja5R5Lksv0Nc2nCtbWEO7p5YftO8Lffx9it9qwhSU4BqX94fuM8Lfad5+CsyKsXuv3l3ulLC7iyWGiWViv2YLPbz8zrp4IaeIRQRMjYODRkuxZVHQVNWc448mffdoFOUNop6fJ8n10g4ncPYq9Xu4U+LyyYjTb4EPQWyoq8nZd3F993HyHFbUwTb4KCxxiJvikc57nHedcvyCqivtobsWulb/ALpp94Uf+pnWlv4GrqUVCkl2s099Jm6ZyWmyMduDqqQefhYfg9eesXT5RQ04PrEuPs3fNbU7cK707tIuIBzZTBkDf8rQT/zFy03iaXvLq9vCNoaPn+a6PotDq7emu7PnvKj0grdTYNL+5pff7EYiIp052EREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREARFy0ZuAzAzO8oC2YEwDe8WZz0wZS0LXbLqmbPIniGje4/DqtlUnYjZGxAVd4uMsnF0TWMHuId81suzW+mtVqpbdSNDYKeIRsyG8Ab/M7/attWvs0tr7bHVV15e7bYHl8GyIxnyJzzHXRcu1DpTd1Kj6qWxHklx+LOo09B0rS6MXeLam/Hj3Jfc8f4q7F6qlpH1OH7g6scwEmmnaGvcPwuGhPQgea1LIx8cjo5GOY9pLXNcMiCN4IXtrEFJR0N3qKWgrRW08bsmTAZB2mvnkdMxvyXljttp6en7SLk2nAbtiOSRo4PcwE+/f7VP9GdbuLyo6Fd53ZT8tz8yG6UaHa2tCF3bLZTaTW/msp7964b0UyNj5JGxxtLnuIDQN5J4L012XYLpcKWVjpI2SXSoYHVMxAzbnke7afuj4nXllpnsbsNXdcbW+qFHLJQ0kvezTbPgYWgloJ3Z7QbpvXp2hiE1XHGdxOq1ul2oyTjawe7i/svv5G50K02ChO9qR3rdH7tfTPiZFutslUQ5xLGeWpVxtNC2KNkbG5Bo0Sy22WdwbFHnlvO4BWWmtksBb3jRkeIOaoM22sk5qGo7T2c/Ak6Oo24mgRkPy15KSt9LnkSPNdFupd2inYIxGwDitepNy4lNuayjlROY2BjcgvtEWIjgiIh8MK+XSgslnq7tdKllNRUkTpppX7mtAzPmem8nRfn7209oNf2i40nvFQXxUMWcVvpidIYgf9Tt5Ps3ALaH0vO1M3u6vwHY6km20Mv8A1jIw6TztP7vq1h3/AIh+ELQdvpTM/bdoxp95XTei2jK0pfq6y9uXDuXq/p8Sa06zlOSwt7OaSlLiHPGfIKSjiDdXalfXgjbyWDXVhALGb/krO3Koy3RhRsoZlxO2trWwjYjyLz8FiWm3196ukNBb4JKqrqH7LGN3k8+gHE7gu3D1mueIbzBarVTPqaud2TWjhzcTwA3kr0vhHCWH+yrDElyuk0ctxkYBUVAGZe7f3UQPD55ZnIDTQ1PVKenQUIraqS4L17vqRU6tW+qpcuSI/BuErP2cYdkuFymjfXPZ/eanLj/s4xvy+JOp4Aa5xjiSqxFcDI/OKljJ7mHPRo5nmV9Y1xTX4nuPf1H1VNGSIKdp8LBzPN3MrX+JL42na+mpn5PGj5B9noOqj9M0yq6juLh7VWXy8PzuRY51bbRLXrrh7+S557F39rOcR3oQNfTUz8njSSQfZ6DqonC0/eUDoiczG8+46/PNV2aSSplDGNccz4WjUlWTD9ulomPkmdk+QDwDh59VZp0406eyuJQ7LVL3VNT/AFE17KTWOUV65x3s2TgOp7y2z0pOsUm0PJ38wferCq32WWyqr7rUuaHMpWQ5SSbOY2sxkPPetoUlupKbIsj2nj7TtSqDrFxTt7mUVvfE6Dawc4EBR2yqqciGbDD9p+gUzRWimgydIO+f+Iae5SSKv1bypU3cEbsacUcAAAAaBERapkC2FRDKjgHKNo+C16tg0J2qKAjjG0/BZ6HFkTqvuxPI2Lqk1uKrtVk599WzPHkXnJazuL+8r6h/OR2XvV6leZJHSO3uJJ9q1/Ic5HHmSuwWkdlY7ChdLJYp0o97+WPU+URFuFKCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiID0R2V9odtvFop7bdKuKlukDBGe9cGicDQOaTpnzG9bF2/B63g379F469BrfQ/TPQ6j0bd33dHY/wCLLJdffTd33Xev2Pu7Ry9yp130So16rnRqbKb4Yzjw3ryL1ZdNa9vRjTr0tppbnnGfHc/M9L407RcP4cp3tZVR19fl4KaB4dr+Jw0aPj0WpsBYXuHaJiWrvV3le2jE23VSAEGRx1EbOWQy8hlzC18ASQACSdAAvWmC7LDh/DFDaomBroogZSPtSHVx9+fsyWvfUqfR+1xQealTdtPklxx+fQ2dPrVek13m5WKVPfsrm3wz28/pzJG026lt9JFb7bSRwQRjKOKNuQH9c1Z7FaJG1DZ5iMxuaPzSy0QY0PcPG7f06K0W6n3aKhVKjk2295bLy7VOPV09y4FsstG2no42AakZu8ypV0IMQBHELptpbLAxw35ajkVIxND3gDcF5qSSgUCvVbm2ztooQxueSylwAAMguVokbKW08hERDyFqH6Tnad/YHCQoLVOG3+6NcymI308e503mNzeuvArYeOsR0OEsI3LEVxkayCigMmR3vduYwdXOIA6lfnjjzFV2xpimrxDeZu8qal3haPViYPVY0cgP13lWnoxo366t11Vftw+b7PX+TctaHWPafBENBG+onDQSS45kn5qYDmQxiOIaAZLEpI+6j19Z2/8ARdNTU72RnzcunSzN4Rb7dxtKW1L3n+YPurqciWtObuJ5LLwdhm84uvsVnslI6oqZNXE6Mjbxe93Bo5+wZkgLO7N8D33HuIY7RZackDJ1RUvB7qnZ95x+Q3lesqS24L7DsElrSZaqf1nuy9IrpQPg0Z+TQeJOsRqusRscUKK2qsuC+7/PUjKlapc1VBLLfBEPhvDeFuxzB0lTWTtlrpQO/qCB3lS/LSOMcG9PaVpLHOK7jiy7mtrD3cLMxT07Tm2Jv5k8Tx8sgvnG2Kbri69PuNyk4kQQNPghb91o+Z4r6qKOLC+F6nE13YDNGz+6UzxvkOjNoeeuXAAlRNtbK0l19y9utN4+L5L1LjZWVLTKDr13vSy+5dxrnEuII4jJR0smTmktkcN4PFo/VVelo6u5yZsbsxA+sdw/UqdtWGJJ4hXV0neSS/Wd2Tvz18R5qyYZw/d8QXKO1WK2zVlS7dFCzRo5k7mt6nIK2Sr0rem96SXFvgUq40y81OsrvUnsxfux7F9u/n4EFbbdT0LfqxtSHe92/wDktldnvZndcSNZcK9slvtW8SObk+YfgB4fiOnLNbk7N+wm24fiiumKjFc7lkHNpgM6eA9c/XPnp0O9Xq6sABAAAG4Lnmr9NYyk6Vi8vnL0X3ZJ21WhBKlQWIooEdpobPbmUFup2wU8Y0aOJ4kneT1KjyMirFdW71XpBk8hVmlUlUzKTy2Wq0eYHyiIsxthcrhcoDhXyyv27TSu/wB2B7tPyVFY1znBjQS4nIAbyVd7RE+itcUNS4B7cyQOGZzyWehnJF6pjq49uTx7MwxyvjdvY4tPsWvpBlI4HgSFtTGNN6Hiy7UuyWiOslDR+HbOXwyWsrnH3VxqGcpDl5E5hdfs57Sz2ooHSuDdOlPsb+ePQxkRFulKCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAKZwRS0dbi+1UlwLfRZapjZA7c4E7j0O72qGXIJBzByIWOrBzg4p4yuPYZKM1TqRm1lJp47e49QtqqkV4pDUz9/8AtL0X9ji2H0YW/uv3/f5ZZ7WQ2c/w7PFedMZ09HSYtutLb9n0WKrkZEGnMBocdB0G5SZ7RMZm2/s832fudnZ2g1veZfx5bXtzzVWJJOZOZKhdI0qrZTlKbW9JYXPve5b/ADfeyd1nVqV7TUIbT9pvMsbs/wBqw3u8vAybQ5jbtRuky2BOwuz3ZbQzXsRmW2M92eq8+9kvZucQBl5vTXx2sH6qIHJ1QQddeDeGe88Oa9BwRPle2KFjnuOgAGaq/S28o1q8KdN5cM57N+Pxlw6FWVa3t6lWqsRnhrtws7/DfuNiYetTqvxE7Ebd7t+Z6K0RWdsbQYXuJHB3FdGE4DDZKRj8i8M8Z5nirBA3cqfsJreaF9dzdRpPcjFoIsshuU7RsybmsCJgE7h1UnBkGrSnueCFuZ7R2oiLwagRcHIb1pH6VfagMI4VOHLRUBt7u0ZaXNPip4Do5/QnVo9p4LbsbOpe140KfF/Lv+B7p03Ulso0x9LDtP8A7X4n/sxaKnbsdplIc5h8NTUDMOf1a3MtH+Y6ghaYo4gfrX6NG7NY7AC7U5DiV2TTF4DWjZYNwXZ7Oyp2dCNvS4L8z4ssVtGFFJvlw8T7qakvzYzRvE81d+xrssv3aVee5ogaO1QOHpdwkYSyP8LR9p/4c/MhWHsE7Ebr2gVMV3uwmt2GmO8U40kqiN7Ys+HAv3Dhmd3pDtBxzhbsiwzBhvD1FT+nRw7NHQRerCD/AIkp36nXU7Tj7SoTVdcdKf6OxW1VflHx7/pz7DFOrWu6ypUVtTfyF7uGCuwzA1ParZSh07wTBTBw7+qk3GWR2Xvdl0A0AXl3F2I7vi2/S3a7TGaolOyxjQdiNvBjBwA/mcyVh4nv1wvdzqb1fK99RUynakmldkAOQ4Bo4AaBRNF2g4escJqKOhnudyy8DpB3cMXlnqT7B0KwWGlzs4urh1KsuL7/ABfBd/8A/C121Kw6P0tu6qLrJc+fglxx9TYWH7DR2Wjde79LFD3TdvKQ5NhHM83dPzWnO1bG8mLro2OmD4rXTEiBjt7zxe4czwHAeZUVjDGF9xTOHXSq+pac46aIbMTPIcT1OZVfUvp2kTp1f1V09qpyS4R8Pz1KP0i6Uy1JdRQWKfPtfojbFvdt0FO/70TT8AvZ/YxabNbezqzT2q309K+sooZql8bfFLKWDac4nU65793BeKrG7astEf8A4dn+kL2t2Iy992U4fdvypi3/AIXuH5Kkf1A2lZww921v8n6Fw6RSc7ChPtx80Wi4NzjVTu7d6uFYM4iqrdm71zK1e8r2nywylXVu9VqoGUpVsuzd6q9aMpVZbZ7i8WMsxMdcrhCQBqVtkicoOAGpOi6u8L3hkTC9xOQAG9WWx2d0WU0zduc+5n81lp0XM1ri5hQjl8T7slEKQCokaDOR4c9zB+qp/aj2hw2CN9utsjKi7PGTjvbTjmebuTfaeRwO1LtJgtgls2HZmT1uRbPVtObIDxa3m7ruHnu0VX1jIWPqaqUkkklzjm5xPzKuGk6NtJVKq3cl2+JAVqu1mrVeEdtzrnvkmrq+oc+R7i+SSR2ZcT8yqPc6kVddLUBuyHEZDoBkuy63CWvmzdm2NvqMz3fzWErvRpbCOfa3rH619VT9xPzfaERFnIAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCnMCWN2IsV0Fp1EcsmcxByIjbq725AgdSFBrZv0co2PxtVvcAXMt7y3p9ZGM/65rQ1S4lb2dSrHik8EjpFtG6vqVGfBtZ8Df1BSRxRQUVJE2ONjRHGxoyDQNAFdLLQx0zAGjNx9Z3EqP7PqeGov575od3cLntB3Z5gfIlbGqaCKeI7LGtkHqkDL2FcamnLedX1W+VKao43HGHqlscYglOQzzaT8lY43Na3aJACrFppjO8tDtkNGpyUp3D6cjMgtO4hYtuSjwKndwjKo8PeScL9p5dzKkIXnLPJQ0MmWSlYpQWAtOmSwxhtveRlaBk963ivh9Q1oXRK7abocjwUVUVZaSCciF5lTcWeKdDbOnHGK7fhbDVdfrnIW01HFtuA3vO5rR1JIA81+fmN8S3HF2Ka7EF0kLqirkLtnPMRt3NY3oBkFsr6T3aK7FGIv7N22fatNrkIkc06T1AzDndQ3Vo/zHUELVFktVyvd1gtdooZ66tqHbMUMLC5zj+nEncBqV0/oxpKsbd3FXdKS58o/m9/DsJKlSVJGEASchqV6T7APo8zXE0+JcfUz4KLSSmtbs2yS8QZhva38O88chob52FdglqwXHFiPF5pq++RjvGMcQaehy1zGfrPG/aOg4bszFdtnbiX9/h/BNTk3VlRc2H1uBbCf/n93Nat/rdfUKjtNN4c5+nrxfLtMltQr6hV6m2Xi+SLL2zdr9vwdSvw1hQU8t2jZ3RdG0dzQgDIDIaFw4N3DjyPla93SSWWout2rXyyyOMk08zy5z3HiSdSVh3a409upzUVUh1Og3ueei15fLvU3Wo25TsxNP1cY3N/U9VK6RotO0hiHF8XzZP3d9ZdGKHVUvarP8y+xdi5/MyMR32a6Sd2zOOlafCzi7qVDIissYqKwjl15eVr2s61eWZP88giIvRqmzsNHasNEf8AdAL2j9H9xd2Q2Ik5+GYe6eReK8KHPD1H/AfmV7Q+jx/7HrH/APuP/wDRKuW/1CX/AAMf+tfSR13WHtaPbS/6f/Uvk4ziKrN2bvVoeM2EdFWb1JEzaBcM+QXKrbO1uK1ZPEinXZu9VS5ANfmTorPeKgnMMbl1KqNxZJI4u1PVWi0i+ZeNPkYz5gNGjPqlNBU1tQ2GBjpHu4DcP0WZabRPXy7LPUHrPO4fqrLXVVkwjZZKyuqGU8LB4nu9aR33WjiegUtRpObSism1dXkaO5b5HFrs9JaKV9VWTRhzGF0kjnZMYBv1O4dVqLtT7U5K8S2XDEr4KLVk1W3wumHEM4hvXeeg317tK7RbliyZ1JBt0dpafBAD4pddHSHiem4dd61rd7rFRNLG5STkaN4DqVddK0TYxOssy5Ls8e8gLm5hSi61xI77jXQ0MO3Kc3H1WDe5VK4Vk1bMZJXafZaNzQuqpnlqJnSzPL3niV1q306Sh4nPtW1mpfS2Y7odnb4hERZSFCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgC2d9Hq23STFb7rBFlb4Ynw1ErjkCXAENbzOYaTyHsz1tR08tXVw0sLdqWaRsbBzcTkF61wtZaWwWGktNI0bEDAHOAyMj/tOPUnVVnpPqKtrXqUsueV4Lm/QtvRHS3d3fXt4jTw/F8l6/yWrB1S+lxHRuYCRI/unAcnafDf7Ft6MgDMkALVllomU4bK8ZzHj93yV0s8dRXRu72qkETdCNrMlcw2uSLhrUYVZqaeMbiQttUyKtkcTlG8nXlropirlZ6KfEDnls5Heov9mRhv1crwfxari2Mb6Y+KYAuYN3NeMSW7tIGpGE3tp8DKZMctM12R1z4jocxyKyg8AZDIBYtx7p9PI54ALWkh3EL51TW9MwJqTw0fb7wwDxMOfQrV/btim4WnCMj7a50M9bN6P3zTrCC1xJB56ZDzVgrbgyGJ0kjw1jRmSVQsRXCS90tRRVbGOo5hl3RaDlyOe/Mc1ns6kYVoTqLMU96LBpelp1VPZ3LiearBhyoud/pLZPV01uinmbG6sqHHuogT6xyzOX9HIar3DgPBOBOxrCktwNRC2Tux6XdanLvZuIa3LcCdzG79N51Xk7EtjqLNV7Ls5Kd5+qly39D1XTc75eLnQUVBcLlVVNLQs7ulhkkJbE3kB8PIAbgFf9Soz1enDq6uKfNLn+dj+xvXXRaFaUerqNR5/x/JsXtk7YrpjJ8tptPe2+w7WRZnlLUjnIRuH4Rpzz0y0pf73TWqLZOUtQ4eGMH4nkFHYjxPHTbVNb3Nkm3Ok3tZ5cyqVNJJNK6WV7nvcc3OccySpnT9LpW9NQhHEfr4kRq3SS20ml+j01LaXF8UvV/JfI7rjXVNwqXVFVJtvOgHBo5AcljIimUklhHM6tWdWbnN5b4thERfTwEREBsnCH/dyk8nf6ivYvYHVSx9klljbsgDv9ctf38i8dYR/7u0nk7/UV7N+jqxh7I7Q4saTtz6kf7565j0/aVim/819JHXNT/wDg7bPZD/0Zby6onBGb3Z8tyibjQyHMvIaPeVa1F3OJ0ji1jSSVyijWe1iKKxbzxModxpY2Z6bR6qPjsb6p3e1OccPAcXfoFdp6CCma6oqnM8ALiXHJrAN5OfzWi+1Ttlp4jLa8IPZPLq2SvIzYz/8ATB9Y/iOnLPernpGmV7qSSWfovEsltdya2aXmWfHWN7HgqhFPk2euLfqaON2R83H7I6nU8M152xdie74ouRrbrU7eWYjibpHEOTR+e88VDXKuc+SWur6l0kj3F0ksji5zieZOpKqd3vEtXnFDnHB8Xef6LqGmaPTtllb5dvoat/qVCwjmbzJ8ub9PEzrxewzagoyHO3Ok4DyVdc5znFziS4nMk8Vwin4QUFuOfX+oVr6pt1H4LkgiIvZohERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAS+CXtjxnZJHnJjbjTud5CRq9d0gaaqEPOTdtuZ5DNeMIJHQzxzMOTmODmnqDmvZTTmAciOOvBULpnDE6Uu1NeWPU6P0EntUq9PvXzz6G07rS0kVqcY4o2GPLZIGu8D2rCszK2RxfSFzQN7s8h/NVyS7uEDIZ6lzmN3MzzyU9hvEdtjphTTztiIJIc4EA5qj4UmS9S1r0qLwtreWH/AK4azSaF56b/AJZKJfVzxVJe9zmzA6k781Im+Wlrdo3Oky6TNKqeJcR0U1VtUZMuTdnaAyBPtScDUs7arUnsuHywTdwxcaCEGaJsjzo0N0JUDcsbVFVGY2U+y08NrIe3mqtW1T6iR087xoPINC1Pfu2i0UVbPTW62TXAROLWzd6I435cRoTl1yW5Z6fc3rcaMdrHEkq1LTdNhGd00m/H5JG3a+vqa12cz/CNzRoAtUdqnabFYnfsqwSw1FyDvrpMttkAB1b1cd2XDzWusVdqeJ73E+mhljttK8ZFlNmHOHIvOvuyVEVy0nop1clUu8PH9vr6FZ1fphGVN0LBNf7uHkvu/wCS43ftKxdc4DT1FfCISQSxlMwA5HPeRn8VEXLEtyrqfuCY4WEZP7oEF3tJUKit9K0oUVinBJdywVR61qDhKDrSalx3sIiLYIsIiIAiIgCIiA2XhUZYeox+A/Mr2h9HgAdj9jyGWfpGf/8AIkXjLDYysNEP90CvbHYV6NQ9jVkqqyaOGFkEkj5JXBrGAyvOZJ0AXM+ndKVa0hCP+f2kdc1p7GjW8f8Ap/8AVl4jic/U6BVrtGxrhnA9tNVe65kcj25w00eTp5j+FvLqcgOJWqu1j6RdFQ97a8CMjrqnItfcZWHuYz/u2n1z1Ph/iC8zX+8V93r57terhNV1Up2pZ535k+07hyG4KI0LodOWKtx7K/8AJ+n1IC002pP9yt7Mfn/Bdu1LtWxBjeaSmDjbrRn4KOJ3rjPQyO+0em7pxWr7pdKehaWk95NlowH58lGXS+l2cVFm0bjIRqfJQTiXOLnEknUk8V1KzsKdvBQhHCXI19Q6QU7ePU2e99vL4dvjw8Tvrqyesl25n58mjc3yWOiKQSS3IptSpOrJzm8thERfTwEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREARFyAScgMyUBYezmwy4ixfQ0DGkwtkEtQ7LRsbTmffuHUheq1UuzHBtPhGy7DtmW41ADqqXLjwYPwj4nM+UL2pdpdPh3vLVZyyouuWT3nVlP583dOHHkeaarXqa3fKlbLKjuX3b7F+cTrGjW1Lo/p7rXbxKW9/aK7X+cC54gxDZbBTie8XGCka71WuOb3/wtGp9gUbQ4+wbWNBixDQsz/wBs/uv9eS8w3OvrLnWyVtwqZamokOb5JHZk/wAuixlMUuhtHq11lR7XdjH58SDq9O7jrW6dJbPfnPnw+R60fivC7G7TsR2cA7j6bHr8VBXrtRwdbY3bFxNdKBpHSsLs/wDMcm/FeaEWSl0OtYvM5t+SMVXpzdyjinTin8X6F97QO027YmikoKVn7OtrtHRsdm+Ufjdy6DTnmqEiKzWtpRtKfV0Y4RUry9r3tR1a8tp/nDsCy7fbLlcC4W+31dWW+t3ELn5eeQWwOyHs7GIsrzeWuba2OLY4gS01Dhv14NHMbzot+2+hgpKVlJQUrIYIm+GOJmTWgdAoDVuk1KyqOlSjtSXHsXqyy6N0Sq39JV60tiL4bst9/cjx5VU89LO6Cpglglb6zJGFrh5grqXpTtpw/RXbBlZXSRMFZQRmaGbLxADVzc+IIz055Fea1J6PqkdSodYlhp4aInXNHlpVwqTltJrKYREUqQwREQBERAEREBtOyt2LPRt5QM/0hSOI8Y4iu1ppLBVXKUWmgYIoKSM7Meh9ZwHrOz4nPpkq7b8Q2ptqifJUBj2RgOjyO1mBuHNVS632oqnvEGcEbiTofEfaoqNr1k8yjw4Z5eB1zVdbsKFpRxNTaSwlvfDHw+JM3K7U1GCwHvZvuNO7zPBVmvr6itftTP8ACNzBuCxUUjCkoHOdR1m4vXhvEexfftCIiyESEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREBsMdruKRYRbQKXvxH3fpmye9yyyz35bXXJa+ke+SR0kjnPe4kuc45kk8SvlFq21lQts9TBRzxwbd1f3N3s9fNy2eGQiIto1AiIgC7aSE1FVDThwaZXtYCeGZyXUuWktcHNJBBzBHBfHnG4+rGd57EtVDT263U1vpWiOCnjbEwcgBkrberpbaSyNsNjHeMfsurawtINQ8a7Iz1DAf64nSOC+1mw19sijv1T+z7gxobIXMJjkP3mkA5Z8jl7V94p7XcOW6mc20PddasjwhjSyNp5ucQM/Zn7FyGei38q7pum288eXjngdolq2lzowrOqlGO9LPl7PHK5L+B29YhhtmE3Whjwau5eENG9sYILne3d7TyXnhZ9/u9ffbrNc7lOZqiU6ncGjg0DgByWAulaNpq062VLOZPe/E5fruqvVLt1ksRW5Lu/kIiKVIYIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgP/Z',
    champagne: 'data:image/png;base64,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',
};
function giftIcon(type, size) {
    size = size || 64;
    if (GIFT_IMGS[type]) {
        return '<img src="' + GIFT_IMGS[type] + '" width="' + size + '" height="' + size + '" style="object-fit:contain;display:block;" alt="">';
    }
    var em = GIFT_EMOJIS[type] || "🎁";
    return '<span style="font-size:' + Math.round(size * 0.55) + 'px;line-height:1">' + em + '</span>';
}
function showGiftChoiceModal(gift, winAmount) {
    const tier = winAmount >= 2000 ? 'legendary' : winAmount >= 500 ? 'rare' : winAmount >= 100 ? 'epic' : 'common';
    currentNewGift = { ...gift, id: Date.now(), value: winAmount, tier: tier, receivedDate: new Date().toISOString(), status: 'active' };
    const emoji = GIFT_EMOJIS[gift.type] || '🎁';
    const giftCost  = gift.minValue || 0;
    const remainder = Math.max(0, winAmount - giftCost);
    const sellPrice = winAmount;

    const iconEl = document.getElementById('new-gift-icon');
    const nameEl = document.getElementById('new-gift-name');
    const tierEl = document.getElementById('new-gift-tier');
    const valEl  = document.getElementById('new-gift-value');
    const sellEl = document.getElementById('sell-amount');
    const keepEl = document.getElementById('keep-coins-label');

    if (iconEl) { iconEl.innerHTML = giftIcon(gift.type, 90); }
    if (nameEl) nameEl.textContent = gift.name;
    if (tierEl) tierEl.textContent = winAmount>=2000?'👑 Легендарный':winAmount>=500?'💜 Редкий':winAmount>=100?'🔵 Необычный':'⚪ Обычный';
    if (valEl)  valEl.textContent  = winAmount;
    if (sellEl) sellEl.textContent = sellPrice;
    if (keepEl) keepEl.textContent = remainder > 0 ? '+ '+remainder+' F остаток на баланс' : '';

    // Закрываем все другие модалы чтобы не перекрывали
    const manageModal = document.getElementById('manage-gift-modal');
    if (manageModal) manageModal.style.display = 'none';

    const modal = document.getElementById('new-gift-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.style.alignItems = 'flex-end';
        modal.style.justifyContent = 'center';
    }
}

function closeNewGiftModal() {
    const m = document.getElementById('new-gift-modal');
    if (m) m.style.display = 'none';
}
function keepGift() {
    if (!currentNewGift) { closeNewGiftModal(); return; }
    if (!userData.inventory) userData.inventory = [];
    const giftToSave = { ...currentNewGift };
    userData.inventory.push(giftToSave);
    const giftCost  = currentNewGift.minValue || 0;
    const remainder = Math.max(0, (currentNewGift.value||0) - giftCost);
    if (remainder > 0) { userData.balance.silver += remainder; updateBalance(); }
    saveUserData();
    closeNewGiftModal();
    currentNewGift = null;
    updateInventory();
    if (typeof updateProfileGifts === 'function') updateProfileGifts();
    if (typeof showNotif==='function') showNotif('🎁 Подарок в инвентаре!' + (remainder>0?' +'+remainder+' F':''), '#7b5cff');
}

function sellGift() {
    if (!currentNewGift) return;
    const sellPrice = currentNewGift.value || 0;
    userData.balance.silver += sellPrice;
    saveUserData(); updateBalance();
    closeNewGiftModal();
    currentNewGift = null;
    if (typeof showNotif==='function') showNotif('💰 Продано за '+sellPrice+' F','#22c55e');
}

function showManageGiftModal(giftId) {
    const gift = (userData.inventory||[]).find(g => g.id === giftId);
    if (!gift || gift.status === 'sold') return;
    
    const sellPrice = gift.value || 0;
    const receivedDate = new Date(gift.receivedDate || Date.now());
    const unlockDate = new Date(receivedDate.getTime() + 21*24*60*60*1000);
    const now = new Date();
    const canWithdraw = now >= unlockDate;
    const daysLeft = Math.ceil((unlockDate - now) / (24*60*60*1000));
    
    const emoji = (function() {
        const m = {bear:'🧸',heart:'❤️',rose:'🌹',gift:'🎁',cake:'🎂',champagne:'🥂',bouquet:'💐',cup:'🏆',ring:'💍',diamond:'💎',crown:'👑',rocket:'🚀'};
        return m[gift.type] || '🎁';
    })();
    
    // Create a bottom-sheet modal
    let overlay = document.getElementById('manage-gift-overlay');
    if (overlay) overlay.remove();
    
    overlay = document.createElement('div');
    overlay.id = 'manage-gift-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.8);display:flex;align-items:flex-end;justify-content:center;';
    overlay.onclick = () => overlay.remove();
    
    const sheet = document.createElement('div');
    sheet.style.cssText = 'background:#13131f;border-radius:24px 24px 0 0;padding:20px 20px 48px;width:100%;max-width:520px;';
    sheet.onclick = e => e.stopPropagation();
    
    const withdrawBtn = canWithdraw
        ? `<button onclick="withdrawGift(${giftId})" style="width:100%;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-size:0.95rem;font-weight:800;cursor:pointer;margin-bottom:10px;">📤 Вывести подарок</button>`
        : `<button disabled style="width:100%;padding:14px;border:1.5px solid #2a2a3a;border-radius:14px;background:#1a1a2a;color:#555;font-size:0.9rem;font-weight:700;cursor:not-allowed;margin-bottom:10px;">🔒 Вывод через ${daysLeft} ${daysLeft===1?'день':daysLeft<5?'дня':'дней'}</button>`;
    
    // Build HTML without nested template literals
    const handle = '<div style="width:40px;height:4px;background:#2a2a3a;border-radius:2px;margin:0 auto 20px;"></div>';
    const giftInfo = '<div style="text-align:center;margin-bottom:20px;">'
        + '<div style="font-size:3.5rem;margin-bottom:10px;">' + emoji + '</div>'
        + '<div style="font-size:1.1rem;font-weight:900;color:#fff;margin-bottom:4px;">' + (gift.name||'Подарок') + '</div>'
        + '<div style="font-size:0.78rem;color:#7b5cff;margin-bottom:12px;">Стоимость: <b style="color:#fcd34d">' + (gift.value||0) + ' F</b></div>'
        + '</div>';
    const sellBtn = '<button onclick="sellGiftFromInventory(' + giftId + ')" style="width:100%;padding:14px;border:1.5px solid #2a2a3a;border-radius:14px;background:#1a1a2a;color:#ccc;font-size:0.9rem;font-weight:700;cursor:pointer;">'
        + '💰 Продать сейчас — ' + sellPrice + ' F</button>';
    const cancelBtn = '<button onclick="document.getElementById(\'manage-gift-overlay\').remove()" style="width:100%;padding:10px;border:none;background:transparent;color:#444;font-size:0.8rem;cursor:pointer;margin-top:6px;">Отмена</button>';
    sheet.innerHTML = handle + giftInfo + withdrawBtn + sellBtn + cancelBtn;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
}

async function withdrawGift(giftId) {
    const gift = (userData.inventory||[]).find(g => g.id === giftId);
    if (!gift) return;

    const overlay = document.getElementById('manage-gift-overlay');
    if (overlay) overlay.remove();

    // Отправляем запрос в Telegram бота через inline кнопку «написать боту»
    const userId = tg?.initDataUnsafe?.user?.id;
    const username = tg?.initDataUnsafe?.user?.username || '';
    const giftName = gift.name || 'Подарок';
    const giftEmoji = ({bear:'🧸',heart:'❤️',rose:'🌹',gift:'🎁',cake:'🎂',champagne:'🥂',bouquet:'💐',cup:'🏆',ring:'💍',diamond:'💎',crown:'👑'})[gift.type] || '🎁';

    // Отправляем на сервер
    try {
        await fetch(BACKEND_URL + '/withdraw_gift', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                user_id: userId,
                username: username,
                gift_name: giftName,
                gift_emoji: giftEmoji,
                gift_value: gift.value || 0,
                gift_type: gift.type
            })
        });
    } catch(e) {}

    // Обновляем статус локально
    gift.status = 'withdrawn';
    saveUserData();

    showNotif('📤 Запрос на вывод ' + giftEmoji + ' отправлен боту!', '#22c55e');
    if (typeof updateInventory === 'function') updateInventory();
}

function sellGiftFromInventory(giftId) {
    const gift = (userData.inventory||[]).find(g => g.id === giftId);
    if (!gift) return;
    const sellPrice = gift.value || 0;
    gift.status = 'sold';
    userData.balance.silver += sellPrice;
    saveUserData();
    updateBalance();
    const overlay = document.getElementById('manage-gift-overlay');
    if (overlay) overlay.remove();
    if (typeof showNotif==='function') showNotif('💰 Продано за ' + sellPrice + ' F', '#22c55e');
    if (typeof updateInventory==='function') updateInventory();
}

// ===== ПОПОЛНЕНИЕ БАЛАНСА (TELEGRAM STARS) =====

// Промокоды: code → bonus multiplier
const PROMO_CODES = {
    'VESNA26': { type: 'bonus', value: 0.20 }   // +20% к пополнению
};

const GIFT_PROMO_CODES = {
    'X7K2M9R4': { gold: 500, silver: 500 }   // 500 золота + 500 серебра
};

let topUpCurrency = 'gold'; // Звёзды → только золотые монеты
let activePromo = null;     // { code, bonus } или null
let topUpTab = 'stars';     // 'stars' | 'usdt'
let usdtInvoice = null;     // текущий USDT инвойс { wallet, amount, coins, expires }
let usdtPollTimer = null;   // таймер ожидания оплаты

const USDT_PACKAGES = [
    { coins: 50,   usdt: 0.75  },
    { coins: 100,  usdt: 1.50  },
    { coins: 250,  usdt: 3.75  },
    { coins: 500,  usdt: 7.50  },
    { coins: 1000, usdt: 15.00 },
];

// Пакеты звёзд → золотые коины (1 звезда = 1 золотой коин)
const STAR_PACKAGES = [
    { stars: 50,   coins: 50   },
    { stars: 100,  coins: 100  },
    { stars: 250,  coins: 250  },
    { stars: 500,  coins: 500  },
    { stars: 1000, coins: 1000 },
];

function openTopUpModal() {
    const modal = document.getElementById('topup-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.style.alignItems = 'flex-end';
        modal.style.justifyContent = 'center';
    }
    activePromo = null;
    topUpTab = 'stars';
    usdtInvoice = null;
    renderStarPackages();
    updatePromoDisplay();
    renderUsdtTab();
    switchTopUpTab('stars');
    const promoInput = document.getElementById('promo-input');
    if (promoInput) promoInput.value = '';
}

function closeTopUpModal() {
    const modal = document.getElementById('topup-modal');
    if (modal) modal.style.display = 'none';
}

function renderStarPackages() {
    const container = document.getElementById('star-packages');
    if (!container) return;
    container.innerHTML = '';
    STAR_PACKAGES.forEach(pkg => {
        const bonus = activePromo ? activePromo.bonus : 0;
        const finalCoins = makeEven(Math.floor(pkg.coins * (1 + bonus)));
        const hasBonus = bonus > 0;

        const el = document.createElement('div');
        el.className = 'star-pkg-card';
        el.dataset.stars = pkg.stars;
        el.innerHTML = `
            ${hasBonus ? `<div class="star-pkg-bonus-tag">+${Math.round(bonus*100)}%</div>` : ''}
            <div class="star-pkg-emoji">⭐</div>
            <div class="star-pkg-count">${pkg.stars}</div>
            <div class="star-pkg-label">звёзд</div>
            <div class="star-pkg-coins">${finalCoins} 🟡</div>
            ${hasBonus ? `<div class="star-pkg-coins-old">${pkg.coins}</div>` : ''}
        `;
        el.onclick = () => buyStarPackage(pkg.stars, finalCoins);
        container.appendChild(el);
    });

    // Карточка "своя сумма"
    const customCard = document.createElement('div');
    customCard.className = 'star-pkg-card star-pkg-custom';
    customCard.innerHTML = `
        <div class="star-pkg-emoji">✏️</div>
        <div class="star-pkg-label" style="color:#fff;font-weight:800;font-size:0.85rem;margin:4px 0 6px;">Своя сумма</div>
        <input id="custom-stars-input" type="number" min="1" max="10000"
            placeholder="Stars"
            onclick="event.stopPropagation()"
            class="star-pkg-custom-input"
        />
    `;
    customCard.onclick = () => {
        const inp = document.getElementById('custom-stars-input');
        const val = parseInt(inp?.value);
        if (!val || val < 1) { showNotif('⚠️ Введите количество звёзд', '#f87171'); return; }
        const bonus = activePromo ? activePromo.bonus : 0;
        const coins = makeEven(Math.floor(val * (1 + bonus)));
        buyStarPackage(val, coins);
    };
    container.appendChild(customCard);
}

function makeEven(n) {
    return n % 2 === 0 ? n : n - 1;
}

function applyPromoCode() {
    const inp = document.getElementById('promo-input');
    const code = (inp?.value || '').trim().toUpperCase();
    const promoStatus = document.getElementById('promo-status');

    // Проверяем подарочные промокоды (монеты сразу)
    if (GIFT_PROMO_CODES[code]) {
        const reward = GIFT_PROMO_CODES[code];
        userData.balance.gold = (userData.balance.gold || 0) + reward.gold;
        userData.balance.silver = (userData.balance.silver || 0) + reward.silver;
        saveUserData();
        updateBalance();
        if (promoStatus) {
            promoStatus.textContent = `✅ +${reward.gold} 🟡 и +${reward.silver} ⚪ зачислены!`;
            promoStatus.style.color = '#4ade80';
        }
        if (inp) inp.value = '';
        if (typeof showNotif === 'function') showNotif(`🎉 +${reward.gold} золота и +${reward.silver} серебра!`, '#7b5cff');
        return;
    }

    // Обычные промокоды (бонус к пополнению)
    if (PROMO_CODES[code]) {
        activePromo = { code, bonus: PROMO_CODES[code].value };
        if (promoStatus) {
            promoStatus.textContent = `✅ Промокод применён: +${Math.round(PROMO_CODES[code].value*100)}% к пополнению!`;
            promoStatus.style.color = '#4ade80';
        }
        renderStarPackages();
        updatePromoDisplay();
    } else {
        activePromo = null;
        if (promoStatus) {
            promoStatus.textContent = code ? '❌ Неверный промокод' : '';
            promoStatus.style.color = '#f87171';
        }
        renderStarPackages();
        updatePromoDisplay();
    }
}

function updatePromoDisplay() {
    const badge = document.getElementById('active-promo-badge');
    if (!badge) return;
    if (activePromo) {
        badge.style.display = 'block';
        badge.textContent = `🎟 ${activePromo.code}: +${Math.round(activePromo.bonus*100)}%`;
    } else {
        badge.style.display = 'none';
    }
}


// ─── USDT ОПЛАТА ──────────────────────────────────────────────────────────────
function switchTopUpTab(tab) {
    topUpTab = tab;
    const starsTab  = document.getElementById('tab-stars');
    const usdtTab   = document.getElementById('tab-usdt');
    const starsBody = document.getElementById('topup-stars-body');
    const usdtBody  = document.getElementById('topup-usdt-body');
    if (!starsTab) return;

    if (tab === 'stars') {
        starsTab.classList.add('topup-tab-active');
        usdtTab.classList.remove('topup-tab-active');
        starsBody.style.display = 'block';
        usdtBody.style.display  = 'none';
    } else {
        usdtTab.classList.add('topup-tab-active');
        starsTab.classList.remove('topup-tab-active');
        starsBody.style.display = 'none';
        usdtBody.style.display  = 'block';
    }
}

function renderUsdtTab() {
    const container = document.getElementById('usdt-packages');
    if (!container) return;
    container.innerHTML = '';
    USDT_PACKAGES.forEach(pkg => {
        const el = document.createElement('div');
        el.className = 'star-pkg-card';
        el.innerHTML = `
            <div class="star-pkg-emoji">💵</div>
            <div class="star-pkg-count">${pkg.usdt.toFixed(2)}</div>
            <div class="star-pkg-label">USDT</div>
            <div class="star-pkg-coins">${pkg.coins} 🟡</div>
        `;
        el.onclick = () => buyUsdtPackage(pkg.coins, pkg.usdt);
        container.appendChild(el);
    });
}

async function buyUsdtPackage(coins, usdt) {
    const userId = tg?.initDataUnsafe?.user?.id;
    if (!userId) { showNotif('⚠️ Откройте игру в Telegram', '#f87171'); return; }

    showNotif('💵 Создаём счёт…', '#22c55e');

    try {
        const resp = await fetch(`${BACKEND_URL}/create_usdt_invoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, coins })
        });
        const data = await resp.json();
        if (!data.wallet) throw new Error(data.error || 'no wallet');

        // Сервер возвращает {wallet:pay_url, invoice_id, amount}
        // добавляем expires: 30 мин от сейчас
        usdtInvoice = { ...data, expires: Math.floor(Date.now()/1000) + 30*60, coins };
        showUsdtPayScreen(usdtInvoice);
        // Сразу открываем CryptoBot - без задержки
        if (data.wallet) {
            openUsdtLink(data.wallet);
        }

    } catch (e) {
        showNotif('❌ Ошибка: ' + e.message, '#f87171');
    }
}

function showUsdtPayScreen(inv) {
    const body = document.getElementById('topup-usdt-body');
    if (!body) return;

    const expiresIn = Math.round((inv.expires - Date.now() / 1000) / 60);

    body.innerHTML = `
        <div class="usdt-pay-screen">
            <div class="usdt-pay-title">💵 Оплата USDT TRC20</div>
            <div class="usdt-pay-coins">+${inv.coins} 🟡 коинов</div>
            <div class="usdt-pay-amount-label">Переведи ровно:</div>
            <div class="usdt-pay-amount" onclick="copyUsdtAmount('${inv.amount}')">${inv.amount} USDT <span class="usdt-copy-hint">📋</span></div>
            <div class="usdt-pay-wallet-label">Ссылка для оплаты:</div>
            <div class="usdt-pay-wallet" onclick="openUsdtLink('${inv.wallet}')" style="word-break:break-all;font-size:0.75rem;color:#22c55e;cursor:pointer;">${inv.wallet.substring(0,40)}… <span class="usdt-copy-hint">🔗</span></div>
            <div class="usdt-pay-warning">⚠️ Переводи ТОЧНУЮ сумму — это твой идентификатор платежа</div>
            <div class="usdt-pay-warning">⏱ Время на оплату: ${expiresIn} мин</div>
            <div class="usdt-pay-status" id="usdt-pay-status">⏳ Ожидаем оплату…</div>
            <button class="usdt-pay-cancel" onclick="cancelUsdtInvoice()">Отмена</button>
        </div>
    `;

    startUsdtWait(inv);
}

function copyUsdtAmount(val) {
    navigator.clipboard?.writeText(val);
    showNotif('📋 Сумма скопирована: ' + val, '#22c55e');
}
function openUsdtLink(url) {
    // pay_url = https://t.me/CryptoBot?start=IV... — открываем прямо в Telegram
    if (tg && url && (url.includes('t.me/') || url.includes('telegram.me/'))) {
        tg.openTelegramLink(url);
    } else if (tg?.openLink) {
        tg.openLink(url);
    } else {
        window.open(url, '_blank');
    }
    showNotif('🔗 Открываем CryptoBot...', '#22c55e');
}
function copyUsdtWallet(val) {
    navigator.clipboard?.writeText(val);
    showNotif('📋 Адрес скопирован', '#22c55e');
}

function startUsdtWait(inv) {
    if (usdtPollTimer) clearInterval(usdtPollTimer);
    const endTime = inv.expires * 1000;

    usdtPollTimer = setInterval(async () => {
        const left = Math.round((endTime - Date.now()) / 1000);
        const statusEl = document.getElementById('usdt-pay-status');

        if (left <= 0) {
            clearInterval(usdtPollTimer);
            if (statusEl) statusEl.textContent = '❌ Время вышло. Создай новый счёт.';
            return;
        }

        const mins = Math.floor(left / 60);
        const secs = left % 60;
        const timeStr = `${mins}:${secs.toString().padStart(2,'0')}`;

        try {
            const userId = tg?.initDataUnsafe?.user?.id;
            const resp = await fetch(`${BACKEND_URL}/balance?user_id=${userId}&init_data=${encodeURIComponent(tg?.initData||"")}`);
            const data = await resp.json();
            const newGold = data.gold_coins ?? 0;

            if (typeof userData?.balance?.gold === 'number' && newGold > userData.balance.gold) {
                clearInterval(usdtPollTimer);
                const gained = newGold - userData.balance.gold;
                userData.balance.gold = newGold;
                saveUserData();
                updateBalance();
                closeTopUpModal();
                showTopUpSuccess(gained, null, 'usdt');
                return;
            }
        } catch(e) {}

        if (statusEl) statusEl.textContent = `⏳ Ожидаем оплату… (${timeStr})`;

    }, 5000);
}

function cancelUsdtInvoice() {
    if (usdtPollTimer) clearInterval(usdtPollTimer);
    usdtInvoice = null;
    renderUsdtTab();
}

// ═══ ОПЛАТА ЧЕРЕЗ TELEGRAM STARS (нативный WebApp Invoice) ═══
const BACKEND_URL = 'https://web-production-42c21.up.railway.app';
async function syncGoldFromServer() {
    try {
        const userId = tg?.initDataUnsafe?.user?.id;
        if (!userId) return;
        const resp = await fetch(BACKEND_URL + '/balance?user_id=' + userId + '&init_data=' + encodeURIComponent(tg?.initData||''));
        if (!resp.ok) return;
        const data = await resp.json();
        const serverGold = parseInt(data.gold_coins) || 0;
        // Обновляем только если сервер вернул больше (никогда не обнуляем локальный баланс)
        if (serverGold > (userData.balance.gold || 0)) {
            userData.balance.gold = serverGold;
            saveUserData();
            updateBalance();
            const el = document.getElementById('cases-gold-val');
            if (el) el.textContent = serverGold;
        }
    } catch(e) { /* сервер недоступен — используем локальный баланс */ }
}


async function buyStarPackage(stars, coins) {
    if (!tg) {
        showNotif('⚠️ Откройте игру в Telegram', '#f87171');
        return;
    }

    const promo = activePromo?.code || null;
    const userId = tg?.initDataUnsafe?.user?.id || 0;
    const initData = tg?.initData || '';

    if (!userId) {
        showNotif('⚠️ Откройте игру через Telegram', '#f87171');
        return;
    }

    showNotif('⭐ Создаём счёт…', '#8b5cf6');

    try {
        const resp = await fetch(`${BACKEND_URL}/create_invoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                stars: stars,
                promo: promo,
                init_data: initData
            })
        });

        const data = await resp.json();
        if (!data.invoice_url) throw new Error(data.error || 'no invoice_url');

        // Проверяем что openInvoice доступен (Telegram WebApp 6.1+)
        if (typeof tg.openInvoice !== 'function') {
            // Старый Telegram - открываем через ссылку напрямую
            tg.openLink ? tg.openLink(data.invoice_url) : window.open(data.invoice_url, '_blank');
            showNotif('⭐ Открываем оплату…', '#8b5cf6');
            return;
        }
        tg.openInvoice(data.invoice_url, async (status) => {
            if (status === 'paid') {
                // Сервер начислил через successful_payment — синхронизируем с сервера
                showNotif('⭐ Оплата прошла! Обновляем баланс…', '#a78bfa');
                try {
                    let synced = false;
                    for (let attempt = 0; attempt < 8; attempt++) {
                        await new Promise(r => setTimeout(r, 1500));
                        const br = await fetch(BACKEND_URL + '/balance?user_id=' + userId);
                        const bd = await br.json();
                        const serverGold = bd.gold_coins ?? 0;
                        if (serverGold > userData.balance.gold) {
                            const gained = serverGold - userData.balance.gold;
                            userData.balance.gold = serverGold;
                            saveUserData(); updateBalance(); closeTopUpModal();
                            trackDeposit(gained);
                            showTopUpSuccess(gained, stars, 'stars');
                            synced = true;
                            break;
                        }
                    }
                    if (!synced) {
                        // Fallback: зачисляем локально
                        creditCoins(coins, stars);
                    }
                } catch(e) {
                    creditCoins(coins, stars);
                }
            } else if (status === 'cancelled') {
                showNotif('❌ Оплата отменена', '#f87171');
            } else if (status === 'failed') {
                showNotif('❌ Ошибка оплаты', '#f87171');
            }
        });

    } catch (e) {
        console.error('create_invoice error:', e);
        showNotif('❌ Ошибка создания счёта: ' + (e.message || 'попробуй позже'), '#f87171');
    }
}

function trackDeposit(coins){
    if(coins>100){userData.taskProgress=userData.taskProgress||{};userData.taskProgress.deposit100=1;if(typeof saveUserData==="function")saveUserData();updateTasks();}
}
function creditCoins(coins, stars) {
    // Монеты всегда чётные
    const finalCoins = makeEven(coins);
    userData.balance.gold += finalCoins;
    
    // Сохраняем транзакцию
    userData.topupHistory = userData.topupHistory || [];
    userData.topupHistory.unshift({
        timestamp: new Date().toISOString(),
        stars,
        coins: finalCoins,
        promo: activePromo?.code || null
    });
    if (userData.topupHistory.length > 50) userData.topupHistory = userData.topupHistory.slice(0, 50);
    
    saveUserData();
    updateBalance();
    closeTopUpModal();
    
    showTopUpSuccess(finalCoins, stars);
}

function showTopUpSuccess(coins, stars, method = 'stars') {
    // Показываем красивое уведомление
    const notif = document.createElement('div');
    notif.style.cssText = `
        position:fixed;top:20px;left:50%;transform:translateX(-50%);
        background:linear-gradient(135deg,#f59e0b,#fcd34d);
        color:#000;padding:14px 24px;border-radius:16px;
        font-weight:800;font-size:1rem;z-index:9999;
        box-shadow:0 8px 30px rgba(245,158,11,0.5);
        text-align:center;min-width:200px;
    `;
    const sub = method === 'usdt' ? `за ${coins / 100 * 1.5} USDT` : `за ${stars} ⭐ звёзд`;
    notif.innerHTML = `✅ +${coins} 🟡 золотых коинов<br><span style="font-size:0.75rem;opacity:0.7">${sub}</span>`;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3500);
}

// Устаревшие функции (оставлены для совместимости)
function setTopUpCurrency(type) { topUpCurrency = type; }
function setTopUpAmount(val) {}
function changeTopUpAmount(delta) {}
function confirmTopUp() {}
