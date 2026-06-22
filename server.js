const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Permet à n'importe quel client (Electron ou Navigateur) de se connecter
        methods: ["GET", "POST"]
    }
});

const PORT = 3000;

// Servir les fichiers statiques du jeu (HTML, CSS, JS client)
app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// ÉTAT DU SERVEUR
// =============================================

const rooms = {}; // roomId -> { players: [], gameState: {}, chat: [] }

function createGameState(p1Name, p2Name) {
    return {
        player1: { name: p1Name, health: 3, items: [], score: 0 },
        player2: { name: p2Name, health: 3, items: [], score: 0 },
        magazine: [],
        roundLiveCount: 0,
        roundBlankCount: 0,
        currentTurn: 1,
        damageMultiplier: 1,
        skipOpponentTurn: false,
        started: true
    };
}

const ITEM_KEYS = ['magnifier', 'handcuffs', 'cigarette', 'saw', 'phone'];

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function generateRound(gs) {
    const total = Math.floor(Math.random() * 5) + 3;
    let lives = Math.floor(total / 2);
    if (lives === 0) lives = 1;
    const blanks = total - lives;

    gs.roundLiveCount = lives;
    gs.roundBlankCount = blanks;

    gs.magazine = [];
    for (let i = 0; i < lives; i++) gs.magazine.push('live');
    for (let i = 0; i < blanks; i++) gs.magazine.push('blank');
    shuffle(gs.magazine);

    // Compléter inventaires à 4
    const fillItems = (player) => {
        while (player.items.length < 4) {
            player.items.push(ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)]);
        }
    };
    fillItems(gs.player1);
    fillItems(gs.player2);

    gs.damageMultiplier = 1;
    gs.skipOpponentTurn = false;
}

// =============================================
// WEBSOCKETS
// =============================================

io.on('connection', (socket) => {
    console.log(`[+] Connexion : ${socket.id}`);

    // --- LOBBY ---
    socket.on('create_room', ({ pseudo }) => {
        const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
        rooms[roomId] = {
            players: [{ id: socket.id, pseudo, playerNum: 1 }],
            gameState: null,
            chat: []
        };
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerNum = 1;
        socket.pseudo = pseudo;
        socket.emit('room_created', { roomId, playerNum: 1 });
        console.log(`[Room] ${pseudo} crée la salle ${roomId}`);
    });

    socket.on('join_room', ({ roomId, pseudo }) => {
        const room = rooms[roomId.toUpperCase()];
        if (!room) { socket.emit('error_msg', 'Salle introuvable.'); return; }
        if (room.players.length >= 2) { socket.emit('error_msg', 'Salle déjà pleine.'); return; }

        room.players.push({ id: socket.id, pseudo, playerNum: 2 });
        socket.join(roomId.toUpperCase());
        socket.roomId = roomId.toUpperCase();
        socket.playerNum = 2;
        socket.pseudo = pseudo;

        socket.emit('room_joined', { roomId: roomId.toUpperCase(), playerNum: 2, opponentName: room.players[0].pseudo });
        io.to(socket.roomId).emit('opponent_joined', { opponentName: pseudo });
        console.log(`[Room] ${pseudo} rejoint ${roomId.toUpperCase()}`);
    });

    // --- DÉBUT DE PARTIE ---
    socket.on('start_game', () => {
        const room = rooms[socket.roomId];
        if (!room || room.players.length < 2 || socket.playerNum !== 1) return;

        const p1 = room.players[0];
        const p2 = room.players[1];
        const gs = createGameState(p1.pseudo, p2.pseudo);
        generateRound(gs);
        room.gameState = gs;

        io.to(socket.roomId).emit('game_started', { gameState: sanitizeGS(gs, 1), gameStatep2: sanitizeGS(gs, 2) });
        console.log(`[Game] Partie lancée dans ${socket.roomId}`);
    });

    // --- ACTIONS DE JEU ---
    socket.on('shoot', ({ target }) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameState) return;
        const gs = room.gameState;
        if (gs.currentTurn !== socket.playerNum) return;
        if (gs.magazine.length === 0) return;

        const bullet = gs.magazine.shift();
        const isLive = bullet === 'live';

        if (isLive) gs.roundLiveCount--;
        else gs.roundBlankCount--;

        const currentPlayer = gs.currentTurn === 1 ? gs.player1 : gs.player2;
        const opponent = gs.currentTurn === 1 ? gs.player2 : gs.player1;
        const targetPlayer = target === 'self' ? currentPlayer : opponent;

        let damage = 0;
        let nextTurnAction = 'pass'; // 'pass' | 'keep'

        if (isLive) {
            damage = gs.damageMultiplier;
            targetPlayer.health -= damage;
            gs.damageMultiplier = 1;
            nextTurnAction = 'pass';
        } else {
            if (target === 'self') {
                nextTurnAction = 'keep';
            } else {
                nextTurnAction = 'pass';
            }
        }

        // Vérifier Game Over
        let stageOver = false;
        let gameOver = false;
        let winner = null;
        let stageWinner = null;
        
        if (gs.player1.health <= 0 || gs.player2.health <= 0) {
            stageOver = true;
            const winningPlayer = gs.player1.health > 0 ? gs.player1 : gs.player2;
            winningPlayer.score++;
            stageWinner = winningPlayer.name;
            
            if (gs.player1.score >= 3 || gs.player2.score >= 3) {
                gameOver = true;
                winner = gs.player1.score >= 3 ? gs.player1.name : gs.player2.name;
            } else {
                // Reset de l'étape pour le serveur (laissera le temps au client d'animer)
                gs.player1.health = 3;
                gs.player2.health = 3;
                gs.player1.items = [];
                gs.player2.items = [];
                gs.currentTurn = 1;
                gs.damageMultiplier = 1;
                gs.skipOpponentTurn = false;
                generateRound(gs);
            }
        }

        // Prochaine manche si chargeur vide et pas de fin d'étape
        let newRound = false;
        if (!stageOver && gs.magazine.length === 0) {
            generateRound(gs);
            newRound = true;
            nextTurnAction = 'pass'; // Reset du tour après nouvelle manche
        }

        // Passer le tour
        if (nextTurnAction === 'pass') {
            if (gs.skipOpponentTurn) {
                gs.skipOpponentTurn = false;
                // Garder le même joueur
            } else {
                gs.currentTurn = gs.currentTurn === 1 ? 2 : 1;
                gs.damageMultiplier = 1; // La scie se réinitialise si on passe le tour à l'adversaire
            }
        }

        const result = {
            bullet: isLive ? 'live' : 'blank',
            target,
            damage,
            shooter: currentPlayer.name,
            targetName: targetPlayer.name,
            stageOver,
            stageWinner,
            gameOver,
            winner,
            newRound,
            roundLiveCount: gs.roundLiveCount,
            roundBlankCount: gs.roundBlankCount,
            bulletsLeft: gs.magazine.length,
            currentTurn: gs.currentTurn,
            p1Health: gs.player1.health,
            p2Health: gs.player2.health,
            p1Score: gs.player1.score,
            p2Score: gs.player2.score,
            p1Items: gs.player1.items,
            p2Items: gs.player2.items,
        };

        io.to(socket.roomId).emit('shot_result', result);
    });

    socket.on('use_item', ({ itemKey, itemIndex }) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameState) return;
        const gs = room.gameState;
        if (gs.currentTurn !== socket.playerNum) return;

        const player = gs.currentTurn === 1 ? gs.player1 : gs.player2;
        const opponent = gs.currentTurn === 1 ? gs.player2 : gs.player1;

        if (player.items[itemIndex] !== itemKey) return;
        player.items.splice(itemIndex, 1);

        let effect = { itemKey, playerName: player.name };

        switch (itemKey) {
            case 'magnifier':
                const nextBullet = gs.magazine[0] === 'live' ? 'live' : 'blank';
                // Envoyer SEULEMENT au joueur qui a utilisé l'objet
                socket.emit('item_effect', { ...effect, secret: true, secretData: { nextBullet } });
                io.to(socket.roomId).emit('item_effect', { ...effect, secret: false });
                return; // Early return pour éviter le broadcast en double
            case 'handcuffs':
                gs.skipOpponentTurn = true;
                break;
            case 'cigarette':
                if (player.health < 3) player.health++;
                break;
            case 'saw':
                if (gs.damageMultiplier === 1) gs.damageMultiplier = 2;
                break;
            case 'phone':
                if (gs.magazine.length > 0) {
                    const pos = Math.floor(Math.random() * gs.magazine.length);
                    const type = gs.magazine[pos];
                    socket.emit('item_effect', { ...effect, secret: true, secretData: { pos, type } });
                    io.to(socket.roomId).emit('item_effect', { ...effect, secret: false });
                    return;
                }
                break;
        }

        const update = {
            itemKey,
            playerName: player.name,
            p1Health: gs.player1.health,
            p2Health: gs.player2.health,
            p1Items: gs.player1.items,
            p2Items: gs.player2.items,
            damageMultiplier: gs.damageMultiplier,
            skipOpponentTurn: gs.skipOpponentTurn,
            bulletsLeft: gs.magazine.length
        };

        io.to(socket.roomId).emit('item_effect', { ...effect, secret: false, update });
    });

    // --- CHAT ---
    socket.on('chat_message', ({ message }) => {
        if (!socket.roomId || !message.trim()) return;
        const payload = {
            pseudo: socket.pseudo,
            message: message.trim().slice(0, 200),
            time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        };
        io.to(socket.roomId).emit('chat_message', payload);
    });

    // =============================================
    // MODE FFA (3 à 5 Joueurs)
    // =============================================

    socket.on('ffa_create_room', ({ pseudo }) => {
        const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
        rooms[roomId] = {
            mode: 'FFA',
            players: [{ id: socket.id, pseudo, playerNum: 1 }],
            gameState: null,
            chat: []
        };
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerNum = 1;
        socket.pseudo = pseudo;
        socket.emit('ffa_room_created', { roomId, playerNum: 1 });
        console.log(`[FFA Room] ${pseudo} crée la salle FFA ${roomId}`);
    });

    socket.on('ffa_join_room', ({ roomId, pseudo }) => {
        const room = rooms[roomId.toUpperCase()];
        if (!room) { socket.emit('error_msg', 'Salle introuvable.'); return; }
        if (room.mode !== 'FFA') { socket.emit('error_msg', 'Ce n\'est pas une salle FFA.'); return; }
        if (room.players.length >= 5) { socket.emit('error_msg', 'Salle pleine (5 joueurs max).'); return; }
        if (room.gameState) { socket.emit('error_msg', 'La partie a déjà commencé.'); return; }

        const playerNum = room.players.length + 1;
        room.players.push({ id: socket.id, pseudo, playerNum });
        socket.join(roomId.toUpperCase());
        socket.roomId = roomId.toUpperCase();
        socket.playerNum = playerNum;
        socket.pseudo = pseudo;

        socket.emit('ffa_room_joined', { roomId: roomId.toUpperCase(), playerNum, players: room.players });
        io.to(socket.roomId).emit('ffa_player_joined', { players: room.players });
        console.log(`[FFA Room] ${pseudo} rejoint ${roomId.toUpperCase()} (${room.players.length}/5)`);
    });

    socket.on('ffa_start_game', () => {
        const room = rooms[socket.roomId];
        if (!room || room.mode !== 'FFA' || room.players.length < 3 || socket.playerNum !== 1) return;

        const gs = createFFAGameState(room.players);
        generateRoundFFA(gs);
        room.gameState = gs;

        io.to(socket.roomId).emit('ffa_game_started', { gameState: sanitizeGSFFA(gs) });
        console.log(`[FFA Game] Partie lancée dans ${socket.roomId} avec ${room.players.length} joueurs`);
    });

    socket.on('ffa_shoot', ({ targetId }) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameState || room.mode !== 'FFA') return;
        const gs = room.gameState;
        
        const currentPlayer = gs.players[gs.currentTurnIndex];
        if (currentPlayer.playerNum !== socket.playerNum) return;
        if (gs.magazine.length === 0) return;

        const bullet = gs.magazine.shift();
        const isLive = bullet === 'live';

        if (isLive) gs.roundLiveCount--;
        else gs.roundBlankCount--;

        const targetPlayer = gs.players.find(p => p.playerNum === targetId);
        if (!targetPlayer || targetPlayer.dead) return;

        let damage = 0;
        let nextTurnAction = 'pass';

        if (isLive) {
            damage = gs.damageMultiplier;
            targetPlayer.health -= damage;
            if (targetPlayer.health < 0) targetPlayer.health = 0;
            if (targetPlayer.health === 0) targetPlayer.dead = true;
        } else {
            if (targetPlayer.playerNum === currentPlayer.playerNum) {
                nextTurnAction = 'keep';
            }
        }

        const aliveCount = gs.players.filter(p => !p.dead).length;
        let gameOver = false;
        let winner = null;

        if (aliveCount <= 1) {
            gameOver = true;
            winner = gs.players.find(p => !p.dead)?.pseudo || "Personne";
        }

        let newRound = false;
        if (!gameOver && gs.magazine.length === 0) {
            generateRoundFFA(gs);
            newRound = true;
            nextTurnAction = 'pass';
        }

        if (nextTurnAction === 'pass') {
            gs.damageMultiplier = 1;
            do {
                gs.currentTurnIndex = (gs.currentTurnIndex + 1) % gs.players.length;
                let nextPlayer = gs.players[gs.currentTurnIndex];
                if (!nextPlayer.dead && nextPlayer.handcuffed) {
                    nextPlayer.handcuffed = false;
                    // On le saute
                } else if (!nextPlayer.dead) {
                    break;
                }
            } while (true);
        }

        io.to(socket.roomId).emit('ffa_shot_result', {
            bullet: isLive ? 'live' : 'blank',
            shooterId: currentPlayer.playerNum,
            shooterName: currentPlayer.pseudo,
            targetId: targetPlayer.playerNum,
            targetName: targetPlayer.pseudo,
            damage,
            gameOver,
            winner,
            newRound,
            gameState: sanitizeGSFFA(gs)
        });
    });

    socket.on('ffa_use_item', ({ itemKey, itemIndex, targetId }) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameState || room.mode !== 'FFA') return;
        const gs = room.gameState;
        
        const player = gs.players[gs.currentTurnIndex];
        if (player.playerNum !== socket.playerNum) return;

        if (player.items[itemIndex] !== itemKey) return;
        player.items.splice(itemIndex, 1);

        let effect = { itemKey, playerName: player.pseudo, shooterId: player.playerNum };

        switch (itemKey) {
            case 'magnifier':
                const nextBullet = gs.magazine[0] === 'live' ? 'live' : 'blank';
                socket.emit('ffa_item_effect', { ...effect, secret: true, secretData: { nextBullet }, gameState: sanitizeGSFFA(gs) });
                io.to(socket.roomId).emit('ffa_item_effect', { ...effect, secret: false, gameState: sanitizeGSFFA(gs) });
                return;
            case 'handcuffs':
                const targetPlayer = gs.players.find(p => p.playerNum === targetId);
                if (targetPlayer && !targetPlayer.dead) {
                    targetPlayer.handcuffed = true;
                    effect.targetName = targetPlayer.pseudo;
                }
                break;
            case 'cigarette':
                if (player.health < 3) player.health++;
                break;
            case 'saw':
                if (gs.damageMultiplier === 1) gs.damageMultiplier = 2;
                break;
            case 'phone':
                if (gs.magazine.length > 0) {
                    const pos = Math.floor(Math.random() * gs.magazine.length);
                    const type = gs.magazine[pos];
                    socket.emit('ffa_item_effect', { ...effect, secret: true, secretData: { pos, type }, gameState: sanitizeGSFFA(gs) });
                    io.to(socket.roomId).emit('ffa_item_effect', { ...effect, secret: false, gameState: sanitizeGSFFA(gs) });
                    return;
                }
                break;
        }

        io.to(socket.roomId).emit('ffa_item_effect', { ...effect, secret: false, gameState: sanitizeGSFFA(gs) });
    });

    // --- DÉCONNEXION ---
    socket.on('disconnect', () => {
        console.log(`[-] Déconnexion : ${socket.id}`);
        if (socket.roomId && rooms[socket.roomId]) {
            io.to(socket.roomId).emit('opponent_disconnected');
            delete rooms[socket.roomId];
        }
    });
});

// Helper : masquer la composition du chargeur pour chaque joueur
function sanitizeGS(gs, playerNum) {
    return {
        player1: { name: gs.player1.name, health: gs.player1.health, items: gs.player1.items, score: gs.player1.score },
        player2: { name: gs.player2.name, health: gs.player2.health, items: gs.player2.items, score: gs.player2.score },
        roundLiveCount: gs.roundLiveCount,
        roundBlankCount: gs.roundBlankCount,
        bulletsLeft: gs.magazine.length,
        currentTurn: gs.currentTurn,
        damageMultiplier: gs.damageMultiplier,
        skipOpponentTurn: gs.skipOpponentTurn,
    };
}

// =============================================
// HELPER FONCTIONS FFA
// =============================================

function createFFAGameState(playersList) {
    const players = playersList.map(p => ({
        id: p.id,
        pseudo: p.pseudo,
        playerNum: p.playerNum,
        health: 3,
        items: [],
        score: 0,
        dead: false,
        handcuffed: false
    }));
    return {
        players,
        magazine: [],
        roundLiveCount: 0,
        roundBlankCount: 0,
        currentTurnIndex: 0,
        damageMultiplier: 1,
        started: true
    };
}

function generateRoundFFA(gs) {
    const aliveCount = gs.players.filter(p => !p.dead).length;
    const total = Math.floor(Math.random() * 4) + 2 + aliveCount; // Plus de joueurs = plus de balles (ex: 3 joueurs = 5 à 8 balles)
    let lives = Math.floor(total / 2);
    if (lives === 0) lives = 1;
    const blanks = total - lives;

    gs.roundLiveCount = lives;
    gs.roundBlankCount = blanks;

    gs.magazine = [];
    for (let i = 0; i < lives; i++) gs.magazine.push('live');
    for (let i = 0; i < blanks; i++) gs.magazine.push('blank');
    shuffle(gs.magazine);

    const fillItems = (player) => {
        while (player.items.length < 4) {
            player.items.push(ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)]);
        }
    };
    gs.players.forEach(p => {
        if (!p.dead) {
            fillItems(p);
            p.handcuffed = false; // Reset menottes
        }
    });

    gs.damageMultiplier = 1;
}

function sanitizeGSFFA(gs) {
    return {
        ...gs,
        magazine: [], // Masquer les balles
        bulletsLeft: gs.magazine.length
    };
}

server.listen(PORT, () => {
    console.log(`\n🔫 Serveur Buckshot Roulette lancé sur http://localhost:${PORT}`);
    console.log(`   Pour jouer en LAN, donnez votre IP locale à votre ami !\n`);
});
