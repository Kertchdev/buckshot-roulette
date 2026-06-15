// =============================================
// CONFIGURATION & CONSTANTES
// =============================================
const MAX_HEALTH = 3;
const MAX_ITEMS = 4;

const ITEM_TYPES = {
    magnifier: { icon: "🔍", name: "Loupe", desc: "Voir la prochaine balle dans le chargeur." },
    handcuffs: { icon: "🔗", name: "Menottes", desc: "L'adversaire passe son prochain tour." },
    cigarette: { icon: "🚬", name: "Cigarette", desc: "Récupère 1 point de vie (max 3)." },
    saw:        { icon: "🪚", name: "Scie",     desc: "Double les dégâts de la prochaine balle." },
    phone:      { icon: "📱", name: "Téléphone",desc: "Révèle secrètement une balle du chargeur." }
};

let gameState = {
    player1: { name: "Joueur 1", health: MAX_HEALTH, items: [], score: 0 },
    player2: { name: "Joueur 2", health: MAX_HEALTH, items: [], score: 0 },
    magazine: [],
    currentTurn: 1,
    roundLiveCount: 0,
    roundBlankCount: 0,
    damageMultiplier: 1,
    skipOpponentTurn: false,
    isAIMode: false,
    isOnlineMode: false,
    aiDifficulty: "medium"
};

// =============================================
// ÉLÉMENTS DOM
// =============================================
const screens = {
    menu:        document.getElementById('main-menu'),
    setup:       document.getElementById('setup-screen'),
    onlineLobby: document.getElementById('online-lobby'),
    waitingRoom: document.getElementById('waiting-room'),
    game:        document.getElementById('game-screen'),
    gameOver:    document.getElementById('game-over-screen')
};

// =============================================
// SOCKET.IO (Mode En Ligne)
// =============================================
let socket = null;
let myPlayerNum = null;

function initSocket() {
    if (socket) return true;
    
    // On récupère l'adresse entrée par le joueur
    const serverUrl = document.getElementById('server-url').value.trim();
    if (!serverUrl) { showToast("Veuillez entrer une adresse de serveur"); return false; }
    
    // Connexion via CDN Socket.io (plus fiable que le chargement dynamique)
    socket = io(serverUrl);
    
    socket.on('connect_error', () => {
        showToast("Impossible de se connecter à " + serverUrl);
    });

    socket.on('room_created', ({ roomId, playerNum }) => {
        myPlayerNum = playerNum;
        document.getElementById('room-code-big').innerText = roomId;
        document.getElementById('waiting-status').innerText = "En attente d'un adversaire...";
        document.getElementById('btn-start-online').classList.add('hidden');
        switchScreen(screens.waitingRoom);
    });

    socket.on('room_joined', ({ roomId, playerNum, opponentName }) => {
        myPlayerNum = playerNum;
        document.getElementById('room-code-big').innerText = roomId;
        document.getElementById('waiting-status').innerText = `Adversaire trouvé : ${opponentName} !`;
        document.getElementById('btn-start-online').classList.add('hidden');
        switchScreen(screens.waitingRoom);
    });

    socket.on('opponent_joined', ({ opponentName }) => {
        document.getElementById('waiting-status').innerText = `${opponentName} a rejoint la salle !`;
        document.getElementById('btn-start-online').classList.remove('hidden');
    });

    socket.on('game_started', ({ gameState: gs1, gameStatep2: gs2 }) => {
        const gs = myPlayerNum === 1 ? gs1 : gs2;
        applyServerState(gs);
        gameState.isOnlineMode = true;
        document.querySelector('#action-log ul').innerHTML = '';
        document.getElementById('chat-panel').classList.remove('hidden');
        switchScreen(screens.game);
        logAction("Partie en ligne démarrée !");
    });

    socket.on('shot_result', (r) => {
        const isLive = r.bullet === 'live';
        playShootEffect(isLive);
        setTimeout(() => {
            if (isLive) {
                logAction(`${r.shooter} tire sur ${r.targetName}... BOOM! (-${r.damage} PV)`, 'log-damage');
            } else {
                logAction(`${r.shooter} tire sur ${r.targetName}... *Clic* (À Blanc)`, 'log-blank');
                if (r.target === 'self') logAction(`${r.shooter} garde son tour.`);
            }
            gameState.player1.health = r.p1Health;
            gameState.player2.health = r.p2Health;
            gameState.player1.items  = r.p1Items;
            gameState.player2.items  = r.p2Items;
            gameState.currentTurn    = r.currentTurn;
            gameState.roundLiveCount = r.roundLiveCount;
            gameState.roundBlankCount= r.roundBlankCount;
            gameState.player1.score  = r.p1Score;
            gameState.player2.score  = r.p2Score;
            updateScoreUI();
            
            if (r.newRound && !r.stageOver) logAction("Nouvelle manche !");
            updateHealthUI(); updateTableUI(r.bulletsLeft); updateTurnUI(); updateInventoryUI();
            
            if (r.stageOver && !r.gameOver) {
                logAction(`*** ${r.stageWinner} gagne cette étape ! ***`, "log-damage");
                setActionButtonsEnabled(false);
                setTimeout(() => {
                    logAction(`Début de la prochaine étape...`);
                    // L'état serveur arrivera via le prochain shot ou item
                }, 3000);
            }
            
            if (r.gameOver) {
                setTimeout(() => {
                    document.getElementById('winner-name').innerText = `${r.winner} a remporté la partie !`;
                    switchScreen(screens.gameOver);
                }, 1200);
            }
        }, 800);
    });

    socket.on('item_effect', (data) => {
        if (!data.secret) {
            logAction(`${data.playerName} utilise ${ITEM_TYPES[data.itemKey]?.name || data.itemKey}.`, 'log-blank');
            if (data.update) {
                gameState.player1.health = data.update.p1Health;
                gameState.player2.health = data.update.p2Health;
                gameState.player1.items  = data.update.p1Items;
                gameState.player2.items  = data.update.p2Items;
                gameState.damageMultiplier   = data.update.damageMultiplier;
                gameState.skipOpponentTurn   = data.update.skipOpponentTurn;
                updateHealthUI(); updateInventoryUI(); updateTableUI(gameState.magazine.length);
            }
        } else {
            // Info secrète — seulement le joueur qui a utilisé l'objet la reçoit
            if (data.itemKey === 'magnifier') {
                const txt = data.secretData.nextBullet === 'live' ? '🔴 Réelle' : '⚪️ À Blanc';
                openPhoneModal(`La prochaine balle est : ${txt}`);
            } else if (data.itemKey === 'phone') {
                const txt = data.secretData.type === 'live' ? '🔴 Réelle' : '⚪️ À Blanc';
                openPhoneModal(`Balle n°${data.secretData.pos + 1} = ${txt}`);
            }
        }
    });

    socket.on('chat_message', ({ pseudo, message, time }) => {
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = `<span class="chat-time">${time}</span><span class="chat-pseudo">${pseudo}</span> : ${message}`;
        const box = document.getElementById('chat-messages');
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    });

    socket.on('error_msg', (msg) => showToast(msg));
    socket.on('opponent_disconnected', () => {
        showToast("Votre adversaire s'est déconnecté.");
        switchScreen(screens.menu);
    });
}

// =============================================
// NAVIGATION MENU
// =============================================
document.getElementById('btn-local').addEventListener('click', () => {
    gameState.isAIMode = false; gameState.isOnlineMode = false;
    document.getElementById('setup-title').innerText = "Multijoueur Local";
    document.getElementById('p2-input-group').classList.remove('hidden');
    document.getElementById('ai-difficulty-group').classList.add('hidden');
    switchScreen(screens.setup);
});

document.getElementById('btn-ai-setup').addEventListener('click', () => {
    gameState.isAIMode = true; gameState.isOnlineMode = false;
    document.getElementById('setup-title').innerText = "Contre l'IA";
    document.getElementById('p2-input-group').classList.add('hidden');
    document.getElementById('ai-difficulty-group').classList.remove('hidden');
    document.getElementById('player2-name').value = "Le Croupier (IA)";
    switchScreen(screens.setup);
});

document.getElementById('btn-online-lobby').addEventListener('click', () => {
    switchScreen(screens.onlineLobby);
});

document.getElementById('btn-back-menu').addEventListener('click', () => switchScreen(screens.menu));
document.getElementById('btn-back-from-lobby').addEventListener('click', () => switchScreen(screens.menu));
document.getElementById('btn-leave-room').addEventListener('click', () => { location.reload(); });
document.getElementById('btn-quit').addEventListener('click', () => switchScreen(screens.menu));

// --- Lobby En Ligne ---
document.getElementById('btn-create-room').addEventListener('click', () => {
    if (!initSocket()) return;
    const pseudo = document.getElementById('online-pseudo').value.trim() || 'Joueur';
    socket.emit('create_room', { pseudo });
});

document.getElementById('btn-join-room').addEventListener('click', () => {
    if (!initSocket()) return;
    const pseudo = document.getElementById('online-pseudo').value.trim() || 'Joueur';
    const code   = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!code) { showToast("Entrez un code de salle !"); return; }
    socket.emit('join_room', { roomId: code, pseudo });
});

document.getElementById('btn-start-online').addEventListener('click', () => {
    socket.emit('start_game');
});

// --- Lancement Partie Locale / IA ---
document.getElementById('btn-start-game').addEventListener('click', () => {
    gameState.player1.name = document.getElementById('player1-name').value || "Joueur 1";
    gameState.player2.name = document.getElementById('player2-name').value || "Joueur 2";
    if (gameState.isAIMode) gameState.aiDifficulty = document.getElementById('ai-difficulty').value;
    
    gameState.player1.score = 0;
    gameState.player2.score = 0;
    resetStage();
    
    document.getElementById('p1-name').innerText = gameState.player1.name;
    document.getElementById('p2-name').innerText = gameState.player2.name;
    document.querySelector('#action-log ul').innerHTML = '';
    document.getElementById('chat-panel').classList.add('hidden');
    switchScreen(screens.game);
});

// --- Actions Tir ---
document.getElementById('btn-shoot-self').addEventListener('click', () => {
    if (gameState.isOnlineMode) { socket.emit('shoot', { target: 'self' }); setActionButtonsEnabled(false); }
    else handleShoot('self');
});
document.getElementById('btn-shoot-opponent').addEventListener('click', () => {
    if (gameState.isOnlineMode) { socket.emit('shoot', { target: 'opponent' }); setActionButtonsEnabled(false); }
    else handleShoot('opponent');
});

// --- Chat ---
document.getElementById('chat-send-btn').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
    const msg = document.getElementById('chat-input').value.trim();
    if (!msg || !socket) return;
    socket.emit('chat_message', { message: msg });
    document.getElementById('chat-input').value = '';
}

// --- Rejouer ---
document.getElementById('btn-rematch').addEventListener('click', () => {
    document.getElementById('btn-start-game').click();
});

// =============================================
// LOGIQUE LOCALE (inchangée)
// =============================================
function switchScreen(target) {
    Object.values(screens).forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
    target.classList.remove('hidden');
    setTimeout(() => target.classList.add('active'), 10);
}

function resetStage() {
    gameState.player1.health = MAX_HEALTH; 
    gameState.player2.health = MAX_HEALTH;
    gameState.player1.items  = []; 
    gameState.player2.items  = [];
    gameState.currentTurn = 1; 
    gameState.damageMultiplier = 1; 
    gameState.skipOpponentTurn = false;
    updateHealthUI();
    updateScoreUI();
    startNewRound();
}

function startNewRound() {
    const total = Math.floor(Math.random() * 5) + 3;
    let lives = Math.floor(total / 2); if (lives === 0) lives = 1;
    const blanks = total - lives;
    gameState.roundLiveCount = lives; gameState.roundBlankCount = blanks;
    gameState.magazine = [];
    for (let i = 0; i < lives; i++) gameState.magazine.push("live");
    for (let i = 0; i < blanks; i++) gameState.magazine.push("blank");
    for (let i = gameState.magazine.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameState.magazine[i], gameState.magazine[j]] = [gameState.magazine[j], gameState.magazine[i]];
    }
    fillItemsToMax(gameState.player1); fillItemsToMax(gameState.player2);
    gameState.damageMultiplier = 1; gameState.skipOpponentTurn = false;
    logAction(`Nouvelle manche : ${lives} vraies, ${blanks} à blanc.`);
    updateTableUI(gameState.magazine.length); updateTurnUI(); updateInventoryUI();
    if (gameState.isAIMode && gameState.currentTurn === 2 && gameState.player1.health > 0 && gameState.player2.health > 0) {
        setTimeout(playAITurn, 1500);
    }
}

function fillItemsToMax(player) {
    const keys = Object.keys(ITEM_TYPES);
    while (player.items.length < MAX_ITEMS) player.items.push(keys[Math.floor(Math.random() * keys.length)]);
}

function handleShoot(targetType) {
    if (gameState.magazine.length === 0) return;
    const bullet = gameState.magazine.shift();
    const isLive = bullet === "live";
    if (isLive) gameState.roundLiveCount--; else gameState.roundBlankCount--;
    const current  = gameState.currentTurn === 1 ? gameState.player1 : gameState.player2;
    const opponent = gameState.currentTurn === 1 ? gameState.player2 : gameState.player1;
    const target   = targetType === 'self' ? current : opponent;
    playShootEffect(isLive);
    setTimeout(() => {
        if (isLive) {
            const dmg = gameState.damageMultiplier;
            target.health -= dmg;
            logAction(`${current.name} tire sur ${target.name}... BOOM! (-${dmg} PV)`, "log-damage");
            gameState.damageMultiplier = 1;
            if (!checkStageOver()) passTurn();
        } else {
            logAction(`${current.name} tire sur ${target.name}... *Clic* (À Blanc)`, "log-blank");
            if (targetType === 'self') {
                logAction(`${current.name} garde son tour.`);
                if (gameState.isAIMode && gameState.currentTurn === 2) setTimeout(playAITurn, 1500);
            } else { passTurn(); }
        }
        updateHealthUI(); updateTableUI(gameState.magazine.length);
        if (gameState.magazine.length === 0 && gameState.player1.health > 0 && gameState.player2.health > 0)
            setTimeout(startNewRound, 2000);
    }, 800);
}

function passTurn() {
    if (gameState.skipOpponentTurn) {
        const cur = gameState.currentTurn === 1 ? gameState.player1.name : gameState.player2.name;
        logAction(`L'adversaire est menotté, ${cur} garde son tour !`, "log-damage");
        gameState.skipOpponentTurn = false;
        updateTurnUI(); updateInventoryUI();
        if (gameState.isAIMode && gameState.currentTurn === 2) setTimeout(playAITurn, 1500);
        return;
    }
    gameState.currentTurn = gameState.currentTurn === 1 ? 2 : 1;
    gameState.damageMultiplier = 1; // La scie se réinitialise si on passe le tour à l'adversaire
    updateTableUI(gameState.magazine.length); // Pour enlever l'effet rouge du pistolet
    updateTurnUI(); updateInventoryUI();
    setActionButtonsEnabled(!gameState.isAIMode || gameState.currentTurn === 1);
    // On ne lance l'IA que si le round n'est pas terminé (les PVs > 0)
    if (gameState.isAIMode && gameState.currentTurn === 2 && gameState.player1.health > 0 && gameState.player2.health > 0) {
        setTimeout(playAITurn, 1500);
    }
}

function setActionButtonsEnabled(enabled) {
    const noAmmo = gameState.magazine.length === 0;
    document.getElementById('btn-shoot-self').disabled     = !enabled || noAmmo;
    document.getElementById('btn-shoot-opponent').disabled = !enabled || noAmmo;
}

function checkStageOver() {
    if (gameState.player1.health <= 0 || gameState.player2.health <= 0) {
        setActionButtonsEnabled(false);
        const winner = gameState.player1.health > 0 ? gameState.player1 : gameState.player2;
        winner.score++;
        
        logAction(`*** ${winner.name} gagne cette étape ! ***`, "log-damage");
        updateScoreUI();

        setTimeout(() => {
            if (gameState.player1.score >= 3 || gameState.player2.score >= 3) {
                const grandWinner = gameState.player1.score >= 3 ? gameState.player1 : gameState.player2;
                document.getElementById('winner-name').innerText = `${grandWinner.name} a remporté la partie !`;
                switchScreen(screens.gameOver);
            } else {
                logAction(`Début de la prochaine étape...`);
                resetStage();
            }
        }, 3000);
        return true;
    }
    return false;
}

// =============================================
// UI UPDATES
// =============================================
function updateTurnUI() {
    const p1z = document.getElementById('player1-ui');
    const p2z = document.getElementById('player2-ui');
    const ann = document.getElementById('round-announcement');
    if (gameState.currentTurn === 1) {
        p1z.classList.add('active-turn'); p2z.classList.remove('active-turn');
        ann.innerText = `C'est au tour de ${gameState.player1.name}`;
    } else {
        p2z.classList.add('active-turn'); p1z.classList.remove('active-turn');
        ann.innerText = `C'est au tour de ${gameState.player2.name}`;
    }
    // En ligne : autoriser les boutons seulement si c'est notre tour
    if (gameState.isOnlineMode) {
        setActionButtonsEnabled(gameState.currentTurn === myPlayerNum);
    }
}

function updateScoreUI() {
    document.getElementById('p1-name').innerText = `${gameState.player1.name} (Score: ${gameState.player1.score}/3)`;
    document.getElementById('p2-name').innerText = `${gameState.player2.name} (Score: ${gameState.player2.score}/3)`;
}

function updateHealthUI() {
    const p1h = document.querySelectorAll('#p1-health .heart');
    const p2h = document.querySelectorAll('#p2-health .heart');
    for (let i = 0; i < MAX_HEALTH; i++) {
        p1h[i]?.classList.toggle('active', i < gameState.player1.health);
        p2h[i]?.classList.toggle('active', i < gameState.player2.health);
    }
}

function updateTableUI(bulletsLeft) {
    document.getElementById('count-live').innerText  = gameState.roundLiveCount;
    document.getElementById('count-blank').innerText = gameState.roundBlankCount;
    document.getElementById('bullets-left').innerText = bulletsLeft ?? gameState.magazine.length;
    const gun = document.querySelector('.gun');
    gun.style.filter = gameState.damageMultiplier > 1
        ? "drop-shadow(0 0 20px rgba(192,57,43,0.9))"
        : "drop-shadow(0 10px 10px rgba(0,0,0,0.8))";
    if (!gameState.isOnlineMode) {
        const canAct = (bulletsLeft ?? gameState.magazine.length) > 0 && (!gameState.isAIMode || gameState.currentTurn === 1);
        setActionButtonsEnabled(canAct);
    }
}

function updateInventoryUI() {
    const p1Inv = document.getElementById('p1-inventory');
    const p2Inv = document.getElementById('p2-inventory');
    p1Inv.innerHTML = ''; p2Inv.innerHTML = '';
    gameState.player1.items.forEach((k, i) => p1Inv.appendChild(createItemEl(k, 1, i)));
    gameState.player2.items.forEach((k, i) => p2Inv.appendChild(createItemEl(k, 2, i)));
}

function createItemEl(key, pNum, idx) {
    const d = ITEM_TYPES[key];
    const el = document.createElement('div');
    el.className = 'item';
    el.innerText = d.icon;
    el.setAttribute('data-tooltip', `${d.name} :\n${d.desc}`);
    
    // Si c'est l'IA, les objets ne sont JAMAIS cliquables par le joueur humain
    if (gameState.isAIMode && pNum === 2) {
        el.classList.add('disabled');
        return el;
    }
    
    const isMyTurn = gameState.isOnlineMode ? (gameState.currentTurn === myPlayerNum && pNum === myPlayerNum)
                                            : (gameState.currentTurn === pNum);
    if (!isMyTurn) { el.classList.add('disabled'); }
    else { el.addEventListener('click', () => useItem(pNum, idx, key)); }
    return el;
}

function logAction(msg, cls = '') {
    const ul = document.querySelector('#action-log ul');
    const li = document.createElement('li');
    li.innerText = msg; if (cls) li.className = cls;
    ul.appendChild(li);
    const log = document.getElementById('action-log');
    log.scrollTop = log.scrollHeight;
}

function playShootEffect(isLive) {
    const gun   = document.querySelector('.gun');
    const flash = document.getElementById('screen-flash');
    const blood = document.getElementById('screen-blood');
    gun.style.transform = "translateY(20px) rotate(-10deg)";
    setTimeout(() => { gun.style.transform = ''; }, 200);
    if (isLive) {
        flash.classList.remove('hidden'); flash.style.opacity = '1';
        setTimeout(() => { flash.style.opacity = '0'; setTimeout(() => flash.classList.add('hidden'), 100); }, 50);
        blood.classList.remove('hidden'); blood.style.opacity = '1';
        setTimeout(() => { blood.style.opacity = '0'; setTimeout(() => blood.classList.add('hidden'), 500); }, 300);
    }
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg; t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3500);
}

function applyServerState(gs) {
    gameState.player1.name   = gs.player1.name;   gameState.player2.name   = gs.player2.name;
    gameState.player1.health = gs.player1.health;  gameState.player2.health = gs.player2.health;
    gameState.player1.items  = gs.player1.items;   gameState.player2.items  = gs.player2.items;
    gameState.player1.score  = gs.player1.score || 0; gameState.player2.score = gs.player2.score || 0;
    gameState.roundLiveCount  = gs.roundLiveCount;  gameState.roundBlankCount = gs.roundBlankCount;
    gameState.currentTurn     = gs.currentTurn;     gameState.damageMultiplier = gs.damageMultiplier;
    gameState.magazine = []; // Le magazine est géré côté serveur
    document.getElementById('p1-name').innerText = gs.player1.name;
    document.getElementById('p2-name').innerText = gs.player2.name;
    updateHealthUI(); updateScoreUI(); updateTableUI(gs.bulletsLeft); updateTurnUI(); updateInventoryUI();
}

// =============================================
// OBJETS — LOGIQUE LOCALE
// =============================================
function useItem(pNum, idx, key) {
    if (gameState.isOnlineMode) { socket.emit('use_item', { itemKey: key, itemIndex: idx }); return; }
    if (gameState.currentTurn !== pNum) return;
    const player   = pNum === 1 ? gameState.player1 : gameState.player2;
    const opponent = pNum === 1 ? gameState.player2 : gameState.player1;
    player.items.splice(idx, 1);
    logAction(`${player.name} utilise ${ITEM_TYPES[key].name}.`, 'log-blank');
    switch (key) {
        case 'magnifier': {
            const nb = gameState.magazine[0] === 'live' ? '🔴 Réelle' : '⚪️ À Blanc';
            openPhoneModal(`La prochaine balle est : ${nb}`); break;
        }
        case 'handcuffs':
            if (!gameState.skipOpponentTurn) { gameState.skipOpponentTurn = true; logAction(`[Menottes] ${opponent.name} passera son prochain tour.`); }
            else logAction(`Déjà menotté ! (Objet gâché)`); break;
        case 'cigarette':
            if (player.health < MAX_HEALTH) { player.health++; logAction(`[Cigarette] ${player.name} regagne 1 PV.`); updateHealthUI(); }
            else logAction(`[Cigarette] PV déjà au max.`); break;
        case 'saw':
            if (gameState.damageMultiplier === 1) { gameState.damageMultiplier = 2; logAction(`[Scie] Dégâts doublés !`, 'log-damage'); updateTableUI(gameState.magazine.length); }
            else logAction(`[Scie] Déjà scié ! (Objet gâché)`); break;
        case 'phone': {
            if (gameState.magazine.length > 0) {
                const pos = Math.floor(Math.random() * gameState.magazine.length);
                const txt = gameState.magazine[pos] === 'live' ? '🔴 Réelle' : '⚪️ À Blanc';
                logAction(`${player.name} consulte le Téléphone secrètement...`, 'log-blank');
                openPhoneModal(`Balle n°${pos + 1} dans le chargeur : ${txt}`);
            } else logAction(`[Téléphone] Chargeur vide.`); break;
        }
    }
    updateInventoryUI();
}

// =============================================
// MODAL TÉLÉPHONE SECRET
// =============================================
function openPhoneModal(secret) {
    const modal     = document.getElementById('phone-modal');
    const secretDiv = document.getElementById('phone-secret-text');
    const revealBtn = document.getElementById('phone-reveal-btn');
    const closeBtn  = document.getElementById('phone-close-btn');
    const warning   = document.getElementById('phone-modal-warning');
    secretDiv.classList.add('hidden'); secretDiv.innerText = '';
    closeBtn.classList.add('hidden'); revealBtn.classList.remove('hidden');
    warning.style.display = 'block';
    modal.classList.remove('hidden');
    revealBtn.onclick = () => {
        revealBtn.classList.add('hidden');
        secretDiv.innerText = secret; secretDiv.classList.remove('hidden');
        closeBtn.classList.remove('hidden'); warning.style.display = 'none';
    };
    closeBtn.onclick = () => modal.classList.add('hidden');
}

// =============================================
// IA — CERVEAU DU CROUPIER
// =============================================
function playAITurn() {
    if (gameState.currentTurn !== 2 || !gameState.isAIMode) return;
    if (gameState.player1.health <= 0 || gameState.player2.health <= 0) return;
    if (gameState.magazine.length === 0) return;
    setActionButtonsEnabled(false);
    const lives = gameState.roundLiveCount, blanks = gameState.roundBlankCount;
    const prob  = (lives + blanks) > 0 ? lives / (lives + blanks) : 0;
    if (gameState.aiDifficulty === 'easy') aiEasy();
    else if (gameState.aiDifficulty === 'medium') aiMedium(prob);
    else aiHard(prob);
}

function aiEasy() {
    logAction(`[IA] Le Croupier réfléchit...`);
    handleShoot(Math.random() < 0.5 ? 'self' : 'opponent');
}

function aiMedium(prob) {
    const ai = gameState.player2;
    const cigIdx = ai.items.indexOf('cigarette');
    if (ai.health === 1 && cigIdx !== -1) {
        useItem(2, cigIdx, 'cigarette');
        setTimeout(() => { if (prob > 0.5) handleShoot('opponent'); else handleShoot('self'); }, 1200);
        return;
    }
    logAction(`[IA - Moyen] Le Croupier calcule...`);
    if (prob > 0.5) handleShoot('opponent'); else handleShoot('self');
}

function aiHard(prob) {
    const ai = gameState.player2, player = gameState.player1;
    const magIdx  = ai.items.indexOf('magnifier');
    const cigIdx  = ai.items.indexOf('cigarette');
    const cuffIdx = ai.items.indexOf('handcuffs');
    if (magIdx !== -1) {
        useItem(2, magIdx, 'magnifier');
        const nextLive = gameState.magazine[0] === 'live';
        setTimeout(() => {
            if (nextLive) {
                const sawIdx = gameState.player2.items.indexOf('saw');
                if (sawIdx !== -1 && gameState.damageMultiplier === 1) {
                    useItem(2, sawIdx, 'saw');
                    setTimeout(() => handleShoot('opponent'), 1200);
                } else handleShoot('opponent');
            } else handleShoot('self');
        }, 1200); return;
    }
    if (ai.health <= 1 && cigIdx !== -1) { useItem(2, cigIdx, 'cigarette'); setTimeout(() => aiHard(prob), 1200); return; }
    if (cuffIdx !== -1 && !gameState.skipOpponentTurn && player.health >= 2 && ai.health <= 2) {
        useItem(2, cuffIdx, 'handcuffs'); setTimeout(() => aiHard(prob), 1200); return;
    }
    logAction(`[IA - Difficile] Le Croupier décide...`);
    if (prob >= 0.6) handleShoot('opponent'); else handleShoot('self');
}
