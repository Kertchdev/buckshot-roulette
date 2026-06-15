// Configuration du Jeu
const MAX_HEALTH = 3;
const MAX_ITEMS = 4;

const ITEM_TYPES = {
    magnifier: { icon: "🔍", name: "Loupe", desc: "Permet de voir la prochaine balle dans le chargeur." },
    handcuffs: { icon: "🔗", name: "Menottes", desc: "L'adversaire passe son prochain tour." },
    cigarette: { icon: "🚬", name: "Cigarette", desc: "Récupère 1 point de vie (maximum 3)." },
    saw: { icon: "🪚", name: "Scie", desc: "Double les dégâts de la prochaine balle." },
    phone: { icon: "📱", name: "Téléphone", desc: "Révèle secrètement une balle aléatoire du chargeur." }
};

let gameState = {
    player1: { name: "Joueur 1", health: MAX_HEALTH, items: [] },
    player2: { name: "Joueur 2", health: MAX_HEALTH, items: [] },
    magazine: [],
    currentTurn: 1, // 1 ou 2
    roundLiveCount: 0,
    roundBlankCount: 0,
    damageMultiplier: 1,
    skipOpponentTurn: false,
    isAIMode: false,
    aiDifficulty: "medium"
};

// Éléments du DOM
const screens = {
    menu: document.getElementById('main-menu'),
    setup: document.getElementById('setup-screen'),
    game: document.getElementById('game-screen'),
    gameOver: document.getElementById('game-over-screen')
};

// Boutons Menu
document.getElementById('btn-local').addEventListener('click', () => {
    gameState.isAIMode = false;
    document.getElementById('setup-title').innerText = "Multijoueur Local";
    document.getElementById('p2-input-group').classList.remove('hidden');
    document.getElementById('ai-difficulty-group').classList.add('hidden');
    switchScreen(screens.setup);
});

document.getElementById('btn-ai-setup').addEventListener('click', () => {
    gameState.isAIMode = true;
    document.getElementById('setup-title').innerText = "Contre l'IA";
    document.getElementById('p2-input-group').classList.add('hidden');
    document.getElementById('ai-difficulty-group').classList.remove('hidden');
    document.getElementById('player2-name').value = "Le Croupier (IA)";
    switchScreen(screens.setup);
});

document.getElementById('btn-back-menu').addEventListener('click', () => switchScreen(screens.menu));
document.getElementById('btn-quit').addEventListener('click', () => switchScreen(screens.menu));

// Lancement du jeu
document.getElementById('btn-start-game').addEventListener('click', () => {
    gameState.player1.name = document.getElementById('player1-name').value || "Joueur 1";
    gameState.player2.name = document.getElementById('player2-name').value || "Joueur 2";
    if (gameState.isAIMode) {
        gameState.aiDifficulty = document.getElementById('ai-difficulty').value;
    }
    
    gameState.player1.health = MAX_HEALTH;
    gameState.player2.health = MAX_HEALTH;
    gameState.player1.items = [];
    gameState.player2.items = [];
    gameState.currentTurn = 1;
    gameState.damageMultiplier = 1;
    gameState.skipOpponentTurn = false;
    
    document.getElementById('p1-name').innerText = gameState.player1.name;
    document.getElementById('p2-name').innerText = gameState.player2.name;
    
    document.querySelector('#action-log ul').innerHTML = ""; // Clear logs
    
    updateHealthUI();
    startNewRound();
    switchScreen(screens.game);
});

// Actions de Tir
document.getElementById('btn-shoot-self').addEventListener('click', () => handleShoot('self'));
document.getElementById('btn-shoot-opponent').addEventListener('click', () => handleShoot('opponent'));

// --- Logique Core ---

function switchScreen(targetScreen) {
    Object.values(screens).forEach(s => s.classList.add('hidden', 'active'));
    Object.values(screens).forEach(s => s.classList.remove('active'));
    targetScreen.classList.remove('hidden');
    
    // Petit hack pour relancer l'animation CSS si nécessaire
    setTimeout(() => {
        targetScreen.classList.add('active');
    }, 10);
}

function startNewRound() {
    // Génération du chargeur (entre 2 et 8 balles)
    const totalBullets = Math.floor(Math.random() * 5) + 3; // 3 à 7
    let lives = Math.floor(totalBullets / 2);
    if (lives === 0) lives = 1;
    const blanks = totalBullets - lives;
    
    gameState.roundLiveCount = lives;
    gameState.roundBlankCount = blanks;
    
    gameState.magazine = [];
    for(let i=0; i<lives; i++) gameState.magazine.push("live");
    for(let i=0; i<blanks; i++) gameState.magazine.push("blank");
    
    // Mélange (Shuffle de Fisher-Yates)
    for (let i = gameState.magazine.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameState.magazine[i], gameState.magazine[j]] = [gameState.magazine[j], gameState.magazine[i]];
    }
    
    // Remplissage des objets jusqu'à MAX_ITEMS (4)
    fillItemsToMax(gameState.player1);
    fillItemsToMax(gameState.player2);
    
    // Réinitialisation des modificateurs
    gameState.damageMultiplier = 1;
    gameState.skipOpponentTurn = false;
    
    logAction(`Nouvelle manche : ${lives} vraies, ${blanks} à blanc.`);
    updateTableUI();
    updateTurnUI();
    updateInventoryUI();
}

function fillItemsToMax(player) {
    const itemKeys = Object.keys(ITEM_TYPES);
    while (player.items.length < MAX_ITEMS) {
        const randomItem = itemKeys[Math.floor(Math.random() * itemKeys.length)];
        player.items.push(randomItem);
    }
}

function handleShoot(targetType) {
    if (gameState.magazine.length === 0) return;
    
    const bullet = gameState.magazine.shift();
    const isLive = bullet === "live";
    
    if (isLive) {
        gameState.roundLiveCount--;
    } else {
        gameState.roundBlankCount--;
    }
    
    const currentPlayer = gameState.currentTurn === 1 ? gameState.player1 : gameState.player2;
    const opponent = gameState.currentTurn === 1 ? gameState.player2 : gameState.player1;
    
    let targetPlayer;
    if (targetType === 'self') {
        targetPlayer = currentPlayer;
    } else {
        targetPlayer = opponent;
    }

    // Effets visuels et sonores
    playShootEffect(isLive, targetPlayer);

    setTimeout(() => {
        if (isLive) {
            const damage = 1 * gameState.damageMultiplier;
            targetPlayer.health -= damage;
            logAction(`${currentPlayer.name} tire sur ${targetPlayer.name}... BOOM! (-${damage} PV)`, "log-damage");
            gameState.damageMultiplier = 1; // Reset multiplicateur uniquement sur balle réelle
            if(!checkGameOver()) {
                passTurn();
            }
        } else {
            logAction(`${currentPlayer.name} tire sur ${targetPlayer.name}... *Clic* (À Blanc)`, "log-blank");
            // NE PAS reset le multiplicateur ici : la Scie reste active jusqu'au prochain tir réel
            
            if (targetType === 'self') {
                logAction(`${currentPlayer.name} garde son tour.`);
                // En mode IA, si c'est l'IA qui se tire dessus et garde le tour
                if (gameState.isAIMode && gameState.currentTurn === 2) {
                    setTimeout(playAITurn, 1500);
                }
            } else {
                passTurn();
            }
        }
        
        updateHealthUI();
        updateTableUI();
        
        if (gameState.magazine.length === 0 && gameState.player1.health > 0 && gameState.player2.health > 0) {
            setTimeout(startNewRound, 2000);
        }
    }, 1000); // Délai pour l'animation
}

function passTurn() {
    if (gameState.skipOpponentTurn) {
        const current = gameState.currentTurn === 1 ? gameState.player1.name : gameState.player2.name;
        logAction(`L'adversaire est menotté, ${current} garde son tour !`, "log-damage");
        gameState.skipOpponentTurn = false;
        updateTurnUI();
        updateInventoryUI();
        // Si c'est le tour de l'IA et qu'elle est menottée, le joueur rejoue
        // Si c'est le joueur et que l'IA est menottée, le joueur rejoue
        if (gameState.isAIMode && gameState.currentTurn === 2) {
            setTimeout(playAITurn, 1500);
        }
        return;
    }
    gameState.currentTurn = gameState.currentTurn === 1 ? 2 : 1;
    gameState.damageMultiplier = 1; // La scie se réinitialise si on passe le tour à l'adversaire
    updateTableUI(); // Pour enlever l'effet visuel rouge du pistolet
    updateTurnUI();
    updateInventoryUI();
    setActionButtonsEnabled(gameState.currentTurn === 1 || !gameState.isAIMode);
    
    // Si c'est au tour de l'IA, on lance la réflexion
    if (gameState.isAIMode && gameState.currentTurn === 2 && !checkGameOver()) {
        setTimeout(playAITurn, 1500);
    }
}

function setActionButtonsEnabled(enabled) {
    document.getElementById('btn-shoot-self').disabled = !enabled || gameState.magazine.length === 0;
    document.getElementById('btn-shoot-opponent').disabled = !enabled || gameState.magazine.length === 0;
}

// --- Mises à jour de l'UI ---

function updateTurnUI() {
    const p1Zone = document.getElementById('player1-ui');
    const p2Zone = document.getElementById('player2-ui');
    const actionPanel = document.getElementById('action-panel');
    const roundAnnouncement = document.getElementById('round-announcement');
    
    if (gameState.currentTurn === 1) {
        p1Zone.classList.add('active-turn');
        p2Zone.classList.remove('active-turn');
        roundAnnouncement.innerText = `C'est au tour de ${gameState.player1.name}`;
    } else {
        p2Zone.classList.add('active-turn');
        p1Zone.classList.remove('active-turn');
        roundAnnouncement.innerText = `C'est au tour de ${gameState.player2.name}`;
    }
}

function updateHealthUI() {
    const p1Hearts = document.querySelectorAll('#p1-health .heart');
    const p2Hearts = document.querySelectorAll('#p2-health .heart');
    
    for(let i=0; i<MAX_HEALTH; i++) {
        if (i < gameState.player1.health) p1Hearts[i].classList.add('active');
        else p1Hearts[i].classList.remove('active');
        
        if (i < gameState.player2.health) p2Hearts[i].classList.add('active');
        else p2Hearts[i].classList.remove('active');
    }
}

function updateTableUI() {
    document.getElementById('count-live').innerText = gameState.roundLiveCount;
    document.getElementById('count-blank').innerText = gameState.roundBlankCount;
    document.getElementById('bullets-left').innerText = gameState.magazine.length;
    
    // Désactiver les boutons si on ne peut pas tirer ou si c'est le tour de l'IA
    const playerCanAct = gameState.magazine.length > 0 && (!gameState.isAIMode || gameState.currentTurn === 1);
    document.getElementById('btn-shoot-self').disabled = !playerCanAct;
    document.getElementById('btn-shoot-opponent').disabled = !playerCanAct;
    
    // Effet visuel si la scie est active
    const gun = document.querySelector('.gun');
    if (gameState.damageMultiplier > 1) {
        gun.style.filter = "drop-shadow(0 0 20px rgba(192, 57, 43, 0.8))";
    } else {
        gun.style.filter = "drop-shadow(0 10px 10px rgba(0,0,0,0.8))";
    }
}

function updateInventoryUI() {
    const p1Inv = document.getElementById('p1-inventory');
    const p2Inv = document.getElementById('p2-inventory');
    
    p1Inv.innerHTML = "";
    p2Inv.innerHTML = "";
    
    gameState.player1.items.forEach((itemKey, index) => {
        const item = createItemElement(itemKey, 1, index);
        p1Inv.appendChild(item);
    });
    
    gameState.player2.items.forEach((itemKey, index) => {
        const item = createItemElement(itemKey, 2, index);
        p2Inv.appendChild(item);
    });
}

function createItemElement(itemKey, playerNum, index) {
    const itemData = ITEM_TYPES[itemKey];
    const div = document.createElement('div');
    div.className = "item";
    div.innerText = itemData.icon;
    div.setAttribute('data-tooltip', `${itemData.name} : \n${itemData.desc}`);
    
    if (gameState.currentTurn !== playerNum) {
        div.classList.add('disabled');
    } else {
        div.addEventListener('click', () => useItem(playerNum, index, itemKey));
    }
    
    return div;
}

function useItem(playerNum, itemIndex, itemKey) {
    if (gameState.currentTurn !== playerNum) return;
    
    const player = playerNum === 1 ? gameState.player1 : gameState.player2;
    const opponent = playerNum === 1 ? gameState.player2 : gameState.player1;
    
    // Retirer l'objet de l'inventaire
    player.items.splice(itemIndex, 1);
    
    logAction(`${player.name} utilise ${ITEM_TYPES[itemKey].name}.`, "log-blank");
    
    // Effet de l'objet
    switch(itemKey) {
        case 'magnifier':
            const nextBullet = gameState.magazine[0] === "live" ? "Réelle" : "À Blanc";
            logAction(`[Loupe] La prochaine balle est : ${nextBullet}.`, "log-damage");
            break;
        case 'handcuffs':
            if (gameState.skipOpponentTurn) {
                logAction(`L'adversaire est déjà menotté ! (Objet gâché)`);
            } else {
                gameState.skipOpponentTurn = true;
                logAction(`[Menottes] ${opponent.name} passera son prochain tour.`);
            }
            break;
        case 'cigarette':
            if (player.health < MAX_HEALTH) {
                player.health++;
                logAction(`[Cigarette] ${player.name} regagne 1 PV.`);
                updateHealthUI();
            } else {
                logAction(`[Cigarette] PV déjà au max. (Objet gâché)`);
            }
            break;
        case 'saw':
            if (gameState.damageMultiplier > 1) {
                logAction(`[Scie] Le canon est déjà scié ! (Objet gâché)`);
            } else {
                gameState.damageMultiplier = 2;
                logAction(`[Scie] Dégâts du prochain tir doublés !`, "log-damage");
                updateTableUI(); // Pour l'effet visuel de l'arme
            }
            break;
        case 'phone':
            if (gameState.magazine.length > 0) {
                const randomPos = Math.floor(Math.random() * gameState.magazine.length);
                const bulletType = gameState.magazine[randomPos] === "live" ? "🔴 Réelle" : "⚪️ À Blanc";
                const secretMsg = `Balle n°${randomPos + 1} dans le chargeur : ${bulletType}`;
                logAction(`${player.name} consulte le Téléphone secrètement...`, "log-blank");
                openPhoneModal(secretMsg);
            } else {
                logAction(`[Téléphone] Chargeur vide.`);
            }
            break;
    }
    
    updateInventoryUI();
    // Si l'IA vient d'utiliser un objet, elle planifie sa prochaine action
}

// === Modal Téléphone Secret ===

function openPhoneModal(secretMsg) {
    const modal = document.getElementById('phone-modal');
    const secretDiv = document.getElementById('phone-secret-text');
    const revealBtn = document.getElementById('phone-reveal-btn');
    const closeBtn = document.getElementById('phone-close-btn');

    // Réinit
    secretDiv.classList.add('hidden');
    secretDiv.innerText = '';
    closeBtn.classList.add('hidden');
    revealBtn.classList.remove('hidden');
    document.getElementById('phone-modal-warning').style.display = 'block';

    modal.classList.remove('hidden');

    // Bouton Voir
    revealBtn.onclick = () => {
        revealBtn.classList.add('hidden');
        secretDiv.innerText = secretMsg;
        secretDiv.classList.remove('hidden');
        closeBtn.classList.remove('hidden');
        document.getElementById('phone-modal-warning').style.display = 'none';
    };

    // Bouton Fermer
    closeBtn.onclick = () => {
        modal.classList.add('hidden');
    };
}

// =============================================
// IA : Cerveau du Croupier
// =============================================

function playAITurn() {
    if (gameState.currentTurn !== 2 || !gameState.isAIMode) return;
    if (checkGameOver()) return;
    if (gameState.magazine.length === 0) return;

    const ai = gameState.player2;
    const player = gameState.player1;
    const lives = gameState.roundLiveCount;
    const blanks = gameState.roundBlankCount;
    const total = lives + blanks;
    const probLive = total > 0 ? lives / total : 0;
    const items = [...ai.items]; // copie pour itérer sans risque

    setActionButtonsEnabled(false);

    const difficulty = gameState.aiDifficulty;

    if (difficulty === 'easy') {
        aiEasy();
    } else if (difficulty === 'medium') {
        aiMedium(probLive, lives, blanks);
    } else {
        aiHard(probLive, lives, blanks, items);
    }
}

function aiEasy() {
    // Facile : totalement aléatoire, n'utilise jamais d'objets
    const target = Math.random() < 0.5 ? 'self' : 'opponent';
    logAction(`[IA - Facile] Le Croupier réfléchit...`);
    handleShoot(target);
}

function aiMedium(probLive, lives, blanks) {
    // Moyen : décision basée sur les probabilités
    // Utilise la cigarette si critique, sinon joue selon les probas
    const ai = gameState.player2;

    // Essaie d'utiliser la cigarette en urgence
    const cigIdx = ai.items.indexOf('cigarette');
    if (ai.health === 1 && cigIdx !== -1) {
        logAction(`[IA - Moyen] Le Croupier utilise une Cigarette...`);
        useItem(2, cigIdx, 'cigarette');
        // useItem ne relance pas l'IA, on schedule la suite
        setTimeout(() => aiMediumShoot(probLive), 1200);
        return;
    }
    aiMediumShoot(probLive);
}

function aiMediumShoot(probLive) {
    if (probLive > 0.5) {
        // Plus probable d'être réelle → tire sur le joueur
        logAction(`[IA - Moyen] Forte probabilité de balle réelle, le Croupier vise le joueur !`);
        handleShoot('opponent');
    } else if (probLive === 0) {
        // Chargeur vide de balles réelles → se tire dessus pour garder le tour
        logAction(`[IA - Moyen] Aucune balle réelle, le Croupier se tire dessus.`);
        handleShoot('self');
    } else {
        // 50/50 ou plus de blanches → se tire dessus pour tenter de garder le tour
        logAction(`[IA - Moyen] Le Croupier tente sa chance sur lui-même.`);
        handleShoot('self');
    }
}

function aiHard(probLive, lives, blanks, items) {
    // Difficile : comptage de cartes, utilisation optimale des objets
    const ai = gameState.player2;
    const player = gameState.player1;

    // 1. Si on a une Loupe, on l'utilise pour savoir la prochaine balle
    const magIdx = ai.items.indexOf('magnifier');
    if (magIdx !== -1 && gameState.magazine.length > 0) {
        logAction(`[IA - Difficile] Le Croupier utilise la Loupe...`);
        useItem(2, magIdx, 'magnifier');
        const nextIsLive = gameState.magazine[0] === 'live';
        setTimeout(() => aiHardPostLoupe(nextIsLive, items), 1200);
        return;
    }

    // 2. Cigarette si PV bas
    const cigIdx = ai.items.indexOf('cigarette');
    if (ai.health <= 1 && cigIdx !== -1) {
        logAction(`[IA - Difficile] Le Croupier soigne ses blessures...`);
        useItem(2, cigIdx, 'cigarette');
        setTimeout(() => aiHard(probLive, lives, blanks, [...ai.items]), 1200);
        return;
    }

    // 3. Menottes si joueur a beaucoup de PV et on a peu
    const cuffIdx = ai.items.indexOf('handcuffs');
    if (cuffIdx !== -1 && !gameState.skipOpponentTurn && player.health >= 2 && ai.health <= 2) {
        logAction(`[IA - Difficile] Le Croupier menotte le joueur...`);
        useItem(2, cuffIdx, 'handcuffs');
        setTimeout(() => aiHard(probLive, lives, blanks, [...ai.items]), 1200);
        return;
    }

    // 4. Décision de tir basée sur les probabilités
    aiHardShoot(probLive);
}

function aiHardPostLoupe(nextIsLive, prevItems) {
    const ai = gameState.player2;
    if (nextIsLive) {
        // Balle réelle : utiliser la Scie si disponible, puis tirer sur joueur
        const sawIdx = ai.items.indexOf('saw');
        if (sawIdx !== -1 && gameState.damageMultiplier === 1) {
            logAction(`[IA - Difficile] Balle réelle détectée ! Le Croupier sort la Scie...`);
            useItem(2, sawIdx, 'saw');
            setTimeout(() => { logAction(`[IA - Difficile] Le Croupier vise le joueur !`); handleShoot('opponent'); }, 1200);
        } else {
            logAction(`[IA - Difficile] Balle réelle ! Le Croupier vise le joueur !`);
            handleShoot('opponent');
        }
    } else {
        // Balle à blanc : se tire dessus pour garder le tour
        logAction(`[IA - Difficile] Balle à blanc. Le Croupier se tire dessus pour garder le tour.`);
        handleShoot('self');
    }
}

function aiHardShoot(probLive) {
    if (probLive >= 0.6) {
        logAction(`[IA - Difficile] Statistiques défavorables au joueur, le Croupier tire !`);
        handleShoot('opponent');
    } else if (probLive === 0) {
        logAction(`[IA - Difficile] Chargeur vide de balles réelles, le Croupier se tire dessus.`);
        handleShoot('self');
    } else {
        logAction(`[IA - Difficile] Situation incertaine, le Croupier joue prudemment.`);
        handleShoot('self');
    }
}

function logAction(message, typeClass = "") {
    const logList = document.querySelector('#action-log ul');
    const li = document.createElement('li');
    li.innerText = message;
    if (typeClass) li.className = typeClass;
    logList.appendChild(li);
    
    // Scroll en bas
    const logContainer = document.getElementById('action-log');
    logContainer.scrollTop = logContainer.scrollHeight;
}

// --- Effets ---

function playShootEffect(isLive, target) {
    const gun = document.querySelector('.gun');
    const flash = document.getElementById('screen-flash');
    const blood = document.getElementById('screen-blood');
    
    // Petit recul de l'arme
    gun.style.transform = "translateY(20px) rotate(-10deg)";
    setTimeout(() => { gun.style.transform = ""; }, 200);
    
    if (isLive) {
        // Flash d'écran
        flash.classList.remove('hidden');
        flash.style.opacity = '1';
        setTimeout(() => { 
            flash.style.opacity = '0'; 
            setTimeout(() => flash.classList.add('hidden'), 100);
        }, 50);
        
        // Effet sang si c'est nous qui sommes touchés (Optionnel, on met sur l'écran global pour le moment)
        blood.classList.remove('hidden');
        blood.style.opacity = '1';
        setTimeout(() => { 
            blood.style.opacity = '0'; 
            setTimeout(() => blood.classList.add('hidden'), 500);
        }, 300);
    }
}

function checkGameOver() {
    if (gameState.player1.health <= 0 || gameState.player2.health <= 0) {
        let winner = gameState.player1.health > 0 ? gameState.player1 : gameState.player2;
        setTimeout(() => {
            document.getElementById('winner-name').innerText = `${winner.name} a survécu.`;
            switchScreen(screens.gameOver);
        }, 1500); // Attendre la fin de l'animation de tir
        return true;
    }
    return false;
}

document.getElementById('btn-rematch').addEventListener('click', () => {
    document.getElementById('btn-start-game').click(); // Relance avec les mêmes paramètres
});
