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
const BOT_PLANET_ID = 4; // Center planet for bot
const PLAYER_COLORS = ['#00d2ff', '#ff0055', '#00ff66', '#ffcc00'];
const BOT_COLOR = '#ff6600'; // Orange for bot
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
    if (p.owner) return; // Planet already taken

    players[BOT_ID] = {
        id: BOT_ID,
        color: BOT_COLOR,
        titanium: 100,
        isReady: true,
        isBot: true
    };
    p.owner = BOT_ID;
    p.ships[BOT_ID] = 10;
    p.isHome = BOT_ID;
    botSpawned = true;
    io.emit('playerJoined', players[BOT_ID]);
    io.emit('playersUpdate', players);
    console.log('Bot spawned on planet', BOT_PLANET_ID);
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
    console.log('Bot removed');
}

function checkGameStart() {
    const playerIds = Object.keys(players);
    if (playerIds.length > 0 && playerIds.every(id => players[id].isReady)) {
        gameStarted = true;
        io.emit('gameStarted');
    }
}

function botSendFleet(fromPlanetId, toPlanetId) {
    const fromPlanet = planets[fromPlanetId];
    const shipCount = fromPlanet.ships[BOT_ID] || 0;
    if (shipCount <= 0) return;

    const sentShips = Math.floor(shipCount / 2) || 1;
    fromPlanet.ships[BOT_ID] -= sentShips;

    fleets.push({
        id: fleetIdCounter++,
        owner: BOT_ID,
        from: fromPlanetId,
        to: toPlanetId,
        count: sentShips,
        progress: 0
    });
}

function botBuyShips(targetPlanetId) {
    const player = players[BOT_ID];
    const planet = planets[targetPlanetId];
    const COST = 50;
    const SHIPS_REWARD = 20;

    if (player && planet && planet.owner === BOT_ID && player.titanium >= COST) {
        player.titanium -= COST;
        planet.ships[BOT_ID] = (planet.ships[BOT_ID] || 0) + SHIPS_REWARD;
    }
}

function runBotAI() {
    if (!players[BOT_ID] || !gameStarted) return;

    const bot = players[BOT_ID];
    const botPlanets = planets.filter(p => p.owner === BOT_ID);

    // 1. Buy reinforcements if we have 50+ titanium
    if (bot.titanium >= 50 && botPlanets.length > 0) {
        const bestPlanet = botPlanets.reduce((a, b) =>
            (a.ships[BOT_ID] || 0) > (b.ships[BOT_ID] || 0) ? a : b
        );
        botBuyShips(bestPlanet.id);
    }

    // 2. Attack: find a planet with enough ships and a good target
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
            break; // One action per tick
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
    const playerIndex = humanCount;
    players[socket.id] = {
        id: socket.id,
        color: PLAYER_COLORS[playerIndex],
        titanium: 100,
        isReady: false
    };

    planets[playerIndex].owner = socket.id;
    planets[playerIndex].ships[socket.id] = 10;
    planets[playerIndex].isHome = socket.id;

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
                id: fleetIdCounter++,
                owner: socket.id,
                from: fromPlanetId,
                to: toPlanetId,
                count: sentShips,
                progress: 0
            });
        }
    });

    socket.on('buyShips', (targetPlanetId) => {
        if (!gameStarted) return;

        const player = players[socket.id];
        const planet = planets[targetPlanetId];
        const COST = 50;
        const SHIPS_REWARD = 20;

        if (player && planet && planet.owner === socket.id && player.titanium >= COST) {
            player.titanium -= COST;
            planet.ships[socket.id] = (planet.ships[socket.id] || 0) + SHIPS_REWARD;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
        io.emit('playersUpdate', players);

        if (getHumanPlayerCount() === 0) {
            removeBot();
            gameStarted = false;
            fleets = [];
            fleetIdCounter = 0;
            planets.forEach(p => {
                p.owner = null;
                p.ships = {};
                delete p.isHome;
            });
        }

        if (!gameStarted) {
            checkGameStart();
        }
    });
});

// Server Game Loop
let tickCount = 0;
setInterval(() => {
    if (!gameStarted) return;

    tickCount++;

    // 1. Generate ships and Titanium (halved speed)
    planets.forEach(p => {
        if (p.owner && players[p.owner]) {
            p.ships[p.owner] = (p.ships[p.owner] || 0) + 0.05;
            players[p.owner].titanium += 0.1;
        }
    });

    // 2. Bot AI (every ~2 seconds)
    if (tickCount % 20 === 0) {
        runBotAI();
    }

    // 3. Move fleets (halved speed)
    for (let i = fleets.length - 1; i >= 0; i--) {
        let f = fleets[i];
        f.progress += 0.01;

        if (f.progress >= 1) {
            const targetPlanet = planets[f.to];
            targetPlanet.ships[f.owner] = (targetPlanet.ships[f.owner] || 0) + f.count;
            fleets.splice(i, 1);
        }
    }

    // 4. Combat & Conquest
    planets.forEach(p => {
        const playersPresent = Object.keys(p.ships).filter(playerId => p.ships[playerId] >= 1);

        if (playersPresent.length > 1) {
            playersPresent.forEach(playerId => {
                p.ships[playerId] -= 0.25;
                if (p.ships[playerId] < 0) p.ships[playerId] = 0;
            });
        } else if (playersPresent.length === 1) {
            const dominantPlayer = playersPresent[0];
            if (p.owner !== dominantPlayer) {
                p.owner = dominantPlayer;
            }
        }

        Object.keys(p.ships).forEach(playerId => {
            if (p.ships[playerId] < 1 && playersPresent.length > 1) {
                p.ships[playerId] = 0;
            }
        });
    });

    io.emit('stateUpdate', { planets, fleets, players });
}, 100);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Swarm Server running on http://localhost:${PORT}`);
});
