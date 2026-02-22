const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Game Constants & State
const MAX_PLAYERS = 4;
const BOT_ID = 'BOT';
const BOT_PLANET_ID = 4;
const PLAYER_COLORS = ['#00d2ff', '#ff0055', '#00ff66', '#ffcc00'];
const BOT_COLOR = '#ff6600';
let players = {};
let fleets = [];
let fleetIdCounter = 0;
let gameStarted = false;
let botSpawned = false;

// Expanded map: 15 planets
let planets = [
    { id: 0, x: 200, y: 200, radius: 40, owner: null, ships: {} },
    { id: 1, x: 1000, y: 600, radius: 40, owner: null, ships: {} },
    { id: 2, x: 1000, y: 200, radius: 40, owner: null, ships: {} },
    { id: 3, x: 200, y: 600, radius: 40, owner: null, ships: {} },
    { id: 4, x: 600, y: 400, radius: 70, owner: null, ships: {} }, // center - bot home
    { id: 5, x: 600, y: 150, radius: 30, owner: null, ships: {} },
    { id: 6, x: 600, y: 650, radius: 30, owner: null, ships: {} },
    { id: 7, x: 400, y: 300, radius: 25, owner: null, ships: {} },
    { id: 8, x: 800, y: 300, radius: 25, owner: null, ships: {} },
    { id: 9, x: 400, y: 500, radius: 25, owner: null, ships: {} },
    { id: 10, x: 800, y: 500, radius: 25, owner: null, ships: {} },
    { id: 11, x: 150, y: 400, radius: 35, owner: null, ships: {} },
    { id: 12, x: 1050, y: 400, radius: 35, owner: null, ships: {} },
    { id: 13, x: 400, y: 100, radius: 20, owner: null, ships: {} },
    { id: 14, x: 800, y: 700, radius: 20, owner: null, ships: {} }
];

function getHumanPlayerCount() {
    return Object.values(players).filter(p => !p.isBot).length;
}

function spawnBot() {
    if (botSpawned || getHumanPlayerCount() !== 1) return;
    const p = planets[BOT_PLANET_ID];
    if (p.owner) return;

    players[BOT_ID] = { id: BOT_ID, color: BOT_COLOR, titanium: 100, isReady: true, isBot: true };
    p.owner = BOT_ID;
    p.ships[BOT_ID] = 10;
    p.isHome = BOT_ID;
    botSpawned = true;
    io.emit('playerJoined', players[BOT_ID]);
    io.emit('playersUpdate', players);
}

function removeBot() {
    if (!players[BOT_ID]) return;
    delete players[BOT_ID];
    const p = planets[BOT_PLANET_ID];
    if (p.owner === BOT_ID) {
        p.owner = null;
        p.ships = {};
        delete p.isHome;
    }
    botSpawned = false;
    io.emit('playerLeft', BOT_ID);
    io.emit('playersUpdate', players);
}

function checkGameStart() {
    const playerIds = Object.keys(players);
    if (playerIds.length > 0 && playerIds.every(id => players[id].isReady)) {
        gameStarted = true;
        tickCount = 0; // reset tick on start
        io.emit('gameStarted');
    }
}

function resetGame(winnerId) {
    gameStarted = false;
    io.emit('gameOver', winnerId);

    fleets = [];
    fleetIdCounter = 0;
    
    // Reset Planets
    planets.forEach(p => {
        p.owner = null;
        p.ships = {};
        delete p.isHome;
    });

    // Reset Players & re-assign homes
    let pIndex = 0;
    Object.keys(players).forEach(id => {
        players[id].isReady = false;
        players[id].titanium = 100;
        
        if (players[id].isBot) {
            planets[BOT_PLANET_ID].owner = id;
            planets[BOT_PLANET_ID].ships[id] = 10;
            planets[BOT_PLANET_ID].isHome = id;
        } else {
            if (pIndex === BOT_PLANET_ID) pIndex++; // skip bot home
            if (planets[pIndex]) {
                planets[pIndex].owner = id;
                planets[pIndex].ships[id] = 10;
                planets[pIndex].isHome = id;
            }
            pIndex++;
        }
    });

    io.emit('stateUpdate', { planets, fleets, players });
    io.emit('playersUpdate', players);
}

function botSendFleet(fromPlanetId, toPlanetId) {
    const fromPlanet = planets[fromPlanetId];
    const shipCount = fromPlanet.ships[BOT_ID] || 0;
    if (shipCount <= 0) return;

    const sentShips = Math.floor(shipCount / 2) || 1;
    fromPlanet.ships[BOT_ID] -= sentShips;

    fleets.push({
        id: fleetIdCounter++, owner: BOT_ID, from: fromPlanetId,
        to: toPlanetId, count: sentShips, progress: 0
    });
}

function botBuyShips(targetPlanetId) {
    const player = players[BOT_ID];
    const planet = planets[targetPlanetId];
    const isUnderAttack = planet ? Object.keys(planet.ships).filter(id => planet.ships[id] >= 1).length > 1 : false;

    if (player && planet && planet.owner === BOT_ID && player.titanium >= 50 && !isUnderAttack) {
        player.titanium -= 50;
        planet.ships[BOT_ID] = (planet.ships[BOT_ID] || 0) + 20;
    }
}

function runBotAI() {
    if (!players[BOT_ID] || !gameStarted) return;
    const bot = players[BOT_ID];
    const botPlanets = planets.filter(p => p.owner === BOT_ID);

    if (bot.titanium >= 50 && botPlanets.length > 0) {
        const bestPlanet = botPlanets.reduce((a, b) => (a.ships[BOT_ID] || 0) > (b.ships[BOT_ID] || 0) ? a : b);
        botBuyShips(bestPlanet.id);
    }

    for (const p of botPlanets) {
        const ships = Math.floor(p.ships[BOT_ID] || 0);
        if (ships < 8) continue;

        const targets = planets.filter(t => t.id !== p.id && t.owner !== BOT_ID);
        if (targets.length === 0) continue;

        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const sorted = targets.sort((a, b) => dist(p, a) - dist(p, b));
        const target = sorted[0];

        const enemyShips = Object.entries(target.ships)
            .filter(([id]) => id !== BOT_ID)
            .reduce((sum, [, c]) => sum + c, 0);

        if (ships > enemyShips + 2) {
            botSendFleet(p.id, target.id);
            break; 
        }
    }
}

io.on('connection', (socket) => {
    if (Object.keys(players).filter(id => !players[id]?.isBot).length >= MAX_PLAYERS) {
        socket.emit('errorMsg', 'Server is full!');
        socket.disconnect();
        return;
    }

    const humanCount = Object.values(players).filter(p => !p.isBot).length;
    let playerIndex = 0;
    while(planets[playerIndex] && planets[playerIndex].owner !== null && playerIndex !== BOT_PLANET_ID) {
        playerIndex++;
    }

    players[socket.id] = { id: socket.id, color: PLAYER_COLORS[humanCount % 4], titanium: 100, isReady: false };
    
    if (planets[playerIndex]) {
        planets[playerIndex].owner = socket.id;
        planets[playerIndex].ships[socket.id] = 10;
        planets[playerIndex].isHome = socket.id;
    }

    spawnBot();

    socket.emit('init', { players, planets, fleets, playerId: socket.id, gameStarted });
    socket.broadcast.emit('playerJoined', players[socket.id]);
    io.emit('playersUpdate', players);

    socket.on('toggleReady', () => {
        if (players[socket.id] && !gameStarted && !players[socket.id].isBot) {
            players[socket.id].isReady = !players[socket.id].isReady;
            io.emit('playersUpdate', players);
            checkGameStart();
        }
    });

    socket.on('kickPlayer', (targetId) => {
        if (gameStarted) return;
        if (targetId === BOT_ID) {
            removeBot();
        } else {
            const targetSocket = io.sockets.sockets.get(targetId);
            if (targetSocket) {
                targetSocket.emit('errorMsg', 'You were kicked.');
                targetSocket.disconnect();
            }
        }
    });

    socket.on('sendFleet', (data) => {
        if (!gameStarted) return;
        const { fromPlanetId, toPlanetId, percentage } = data;
        const fromPlanet = planets[fromPlanetId];

        const shipCount = fromPlanet.ships[socket.id] || 0;
        if (shipCount > 0) {
            const pct = percentage !== undefined ? percentage : 0.5;
            const sentShips = Math.floor(shipCount * pct) || (shipCount >= 1 ? 1 : 0);
            if (sentShips <= 0) return;

            fromPlanet.ships[socket.id] -= sentShips;
            fleets.push({
                id: fleetIdCounter++, owner: socket.id, from: fromPlanetId,
                to: toPlanetId, count: sentShips, progress: 0
            });
        }
    });

    socket.on('buyShips', (targetPlanetId) => {
        if (!gameStarted) return;
        const player = players[socket.id];
        const planet = planets[targetPlanetId];
        const isUnderAttack = planet ? Object.keys(planet.ships).filter(id => planet.ships[id] >= 1).length > 1 : false;

        if (player && planet && planet.owner === socket.id && player.titanium >= 50 && !isUnderAttack) {
            player.titanium -= 50;
            planet.ships[socket.id] = (planet.ships[socket.id] || 0) + 20;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        
        // Remove ownership if game hasn't started
        if (!gameStarted) {
            planets.forEach(p => {
                if(p.owner === socket.id) {
                    p.owner = null; p.ships = {}; delete p.isHome;
                }
            });
        }

        io.emit('playerLeft', socket.id);
        io.emit('playersUpdate', players);

        if (getHumanPlayerCount() === 0) {
            removeBot();
            gameStarted = false;
            fleets = [];
            fleetIdCounter = 0;
            planets.forEach(p => {
                p.owner = null; p.ships = {}; delete p.isHome;
            });
        }

        if (!gameStarted) checkGameStart();
    });
});

let tickCount = 0;
setInterval(() => {
    if (!gameStarted) return;
    tickCount++;

    planets.forEach(p => {
        if (p.owner && players[p.owner]) {
            const isHomeworld = p.isHome === p.owner;
            p.ships[p.owner] = (p.ships[p.owner] || 0) + (isHomeworld ? 0.15 : 0.05);
            players[p.owner].titanium += 0.1 * (p.radius / 30);
        }
    });

    if (tickCount % 20 === 0) runBotAI();

    for (let i = fleets.length - 1; i >= 0; i--) {
        let f = fleets[i];
        f.progress += 0.01;
        if (f.progress >= 1) {
            const targetPlanet = planets[f.to];
            targetPlanet.ships[f.owner] = (targetPlanet.ships[f.owner] || 0) + f.count;
            fleets.splice(i, 1);
        }
    }

    // Combat & Conquest
    planets.forEach(p => {
        const playersPresent = Object.keys(p.ships).filter(playerId => p.ships[playerId] >= 1);
        if (playersPresent.length > 1) {
            playersPresent.forEach(playerId => {
                p.ships[playerId] -= 0.25;
                if (p.ships[playerId] < 0) p.ships[playerId] = 0;
            });
        } else if (playersPresent.length === 1) {
            const dominantPlayer = playersPresent[0];
            if (p.owner !== dominantPlayer) p.owner = dominantPlayer;
        }

        Object.keys(p.ships).forEach(playerId => {
            if (p.ships[playerId] < 1 && playersPresent.length > 1) p.ships[playerId] = 0;
        });
    });

    // Check Win Condition
    if (tickCount > 30) { 
        const activeFactions = new Set();
        planets.forEach(p => {
            if (p.owner) activeFactions.add(p.owner);
            Object.keys(p.ships).forEach(owner => { if (p.ships[owner] >= 1) activeFactions.add(owner); });
        });
        fleets.forEach(f => activeFactions.add(f.owner));

        if (activeFactions.size === 1) {
            resetGame(Array.from(activeFactions)[0]);
            return;
        }
    }

    io.emit('stateUpdate', { planets, fleets, players });
}, 100);

server.listen(process.env.PORT || 3000, () => {
    console.log(`Swarm Server running on http://localhost:${process.env.PORT || 3000}`);
});
