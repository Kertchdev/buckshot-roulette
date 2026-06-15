const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

server.listen(PORT, () => {
    console.log(`\n🔫 Serveur Buckshot Roulette lancé sur http://localhost:${PORT}`);
    console.log(`   Pour jouer en LAN, donnez votre IP locale à votre ami !\n`);
});
