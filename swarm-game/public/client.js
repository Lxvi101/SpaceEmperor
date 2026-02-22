const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let myId = null;
let players = {};
let planets = [];
let fleets = [];
let particles = [];
let selectedPlanet = null;
let globalTime = 0;
let isGameStarted = false;
let sendPercentage = 0.5; // Default to 50%

// Fleet percentage UI logic
document.querySelectorAll('.pct-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.pct-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        sendPercentage = parseFloat(e.target.dataset.pct);
    });
});

// --- Ready Screen Logic ---
const readyBtn = document.getElementById('ready-btn');
readyBtn.addEventListener('click', () => {
    socket.emit('toggleReady');
});

function updateLobbyUI() {
    const list = document.getElementById('players-list');
    list.innerHTML = '';

    Object.values(players).forEach((p, index) => {
        const div = document.createElement('div');
        div.className = 'player-status';
        const label = p.isBot ? 'Bot' : `Player ${index + 1}`;
        div.innerHTML = `
            <span class="status-dot" style="background-color: ${p.color}; box-shadow: 0 0 10px ${p.color};"></span>
            ${label} ${p.id === myId ? '(You)' : ''}
            - ${p.isReady ? '<span style="color:#00ff66;">READY</span>' : '<span style="color:#ffcc00;">WAITING</span>'}
        `;
        list.appendChild(div);
    });

    if (players[myId]?.isReady) {
        readyBtn.classList.add('is-ready');
        readyBtn.innerText = "WAITING FOR OTHERS...";
    } else {
        readyBtn.classList.remove('is-ready');
        readyBtn.innerText = "READY";
    }
}

socket.on('playersUpdate', (updatedPlayers) => {
    players = updatedPlayers;
    if (!isGameStarted) updateLobbyUI();
});

socket.on('gameStarted', () => {
    isGameStarted = true;
    document.getElementById('ready-screen').style.display = 'none';
});
// --------------------------

socket.on('init', (data) => {
    myId = data.playerId;
    players = data.players;
    planets = data.planets;
    fleets = data.fleets;
    isGameStarted = data.gameStarted;

    if (isGameStarted) {
        document.getElementById('ready-screen').style.display = 'none';
    } else {
        updateLobbyUI();
    }

    updateUI();
    requestAnimationFrame(gameLoop);
});

socket.on('playerJoined', (player) => {
    players[player.id] = player;
    if (!isGameStarted) updateLobbyUI();
});

socket.on('playerLeft', (id) => {
    delete players[id];
    if (!isGameStarted) updateLobbyUI();
});

socket.on('stateUpdate', (data) => {
    data.planets.forEach(newPlanet => {
        const oldPlanet = planets.find(p => p.id === newPlanet.id);
        if (oldPlanet) {
            const activeFactions = Object.values(newPlanet.ships).filter(count => count >= 1).length;

            Object.keys(oldPlanet.ships).forEach(playerId => {
                const oldShips = oldPlanet.ships[playerId];
                const newShips = newPlanet.ships[playerId] || 0;

                if (activeFactions > 1 && oldShips > newShips && (oldShips - newShips) > 0.05) {
                    if (players[playerId]) {
                        spawnParticles(newPlanet, players[playerId].color, 2);
                    }
                }
            });
        }
    });

    planets = data.planets;
    fleets = data.fleets;
    players = data.players;
    updateUI();
});

// Controls
canvas.addEventListener('mousedown', (e) => {
    if (!isGameStarted) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let clickedPlanet = planets.find(p => {
        const dx = mouseX - p.x;
        const dy = mouseY - p.y;
        return Math.sqrt(dx * dx + dy * dy) < p.radius + 20;
    });

    if (clickedPlanet) {
        if (selectedPlanet === null) {
            if (clickedPlanet.ships[myId] >= 1) selectedPlanet = clickedPlanet.id;
        } else {
            if (selectedPlanet !== clickedPlanet.id) {
                socket.emit('sendFleet', { fromPlanetId: selectedPlanet, toPlanetId: clickedPlanet.id, percentage: sendPercentage });
            }
            selectedPlanet = null;
        }
    } else {
        selectedPlanet = null;
    }
});

document.getElementById('buy-btn').addEventListener('click', () => {
    if (selectedPlanet !== null) {
        socket.emit('buyShips', selectedPlanet);
    }
});

function spawnParticles(planet, color, amount) {
    const orbitRadius = planet.radius + 20;
    for (let i = 0; i < amount; i++) {
        const angle = Math.random() * Math.PI * 2;
        particles.push({
            x: planet.x + Math.cos(angle) * orbitRadius,
            y: planet.y + Math.sin(angle) * orbitRadius,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: 1.0,
            color: color
        });
    }
}

function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;

        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }

        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;

        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;
}

function drawShip(x, y, angle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-4, 5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, -5);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

function drawPlanet(planet) {
    const color = planet.owner && players[planet.owner] ? players[planet.owner].color : '#454a59';

    const gradient = ctx.createRadialGradient(
        planet.x - planet.radius * 0.3, planet.y - planet.radius * 0.3, planet.radius * 0.1,
        planet.x, planet.y, planet.radius
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.2, color);
    gradient.addColorStop(1, '#000000');

    ctx.beginPath();
    ctx.arc(planet.x, planet.y, planet.radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    if (planet.isHome && players[planet.isHome]) {
        ctx.save();
        ctx.translate(planet.x, planet.y);

        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
            const r = planet.radius * 0.4;
            ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#ffffff';
        ctx.fill();
        ctx.restore();
    }

    if (selectedPlanet === planet.id) {
        ctx.beginPath();
        ctx.arc(planet.x, planet.y, planet.radius + 35, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ffffff';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
    }

    const orbitRadius = planet.radius + 20;
    ctx.beginPath();
    ctx.arc(planet.x, planet.y, orbitRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, 0.05)`;
    ctx.stroke();

    let textYOffset = planet.radius + 35;

    Object.entries(planet.ships).forEach(([ownerId, count]) => {
        const intCount = Math.floor(count);
        if (intCount <= 0 || !players[ownerId]) return;

        const pColor = players[ownerId].color;

        const drawnCount = Math.min(intCount, 30);
        const angleStep = (Math.PI * 2) / drawnCount;

        for (let i = 0; i < drawnCount; i++) {
            const angle = (i * angleStep) + globalTime;
            const shipX = planet.x + orbitRadius * Math.cos(angle);
            const shipY = planet.y + orbitRadius * Math.sin(angle);
            drawShip(shipX, shipY, angle + Math.PI / 2, pColor);
        }

        ctx.fillStyle = pColor;
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(intCount, planet.x, planet.y + textYOffset);
        textYOffset += 15;
    });
}

function drawFleets() {
    fleets.forEach(f => {
        const p1 = planets[f.from];
        const p2 = planets[f.to];
        if (!players[f.owner]) return;
        const color = players[f.owner].color;

        const currentX = p1.x + (p2.x - p1.x) * f.progress;
        const currentY = p1.y + (p2.y - p1.y) * f.progress;
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(currentX, currentY);

        const trailGrad = ctx.createLinearGradient(p1.x, p1.y, currentX, currentY);
        trailGrad.addColorStop(0, 'rgba(0,0,0,0)');
        trailGrad.addColorStop(1, color);

        ctx.strokeStyle = trailGrad;
        ctx.lineWidth = 2;
        ctx.stroke();

        drawShip(currentX, currentY, angle, color);

        ctx.fillStyle = 'white';
        ctx.font = '12px Courier New';
        ctx.shadowBlur = 5;
        ctx.shadowColor = 'black';
        ctx.fillText(f.count, currentX + 15, currentY - 15);
        ctx.shadowBlur = 0;
    });
}

function updateUI() {
    if (players[myId]) {
        const ti = Math.floor(players[myId].titanium);
        document.getElementById('titanium-display').innerText = `Titanium: ${ti}`;

        const buyBtn = document.getElementById('buy-btn');
        const selectedP = planets.find(p => p.id === selectedPlanet);

        if (selectedP && selectedP.owner === myId) {
            buyBtn.style.display = 'block';
            const myColor = players[myId].color;
            buyBtn.style.borderColor = myColor;

            if (ti >= 50) {
                buyBtn.style.color = myColor;
                buyBtn.disabled = false;
                buyBtn.style.boxShadow = `0 0 10px ${myColor}`;
            } else {
                buyBtn.disabled = true;
                buyBtn.style.boxShadow = 'none';
            }
        } else {
            buyBtn.style.display = 'none';
        }
    }
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (isGameStarted) globalTime += 0.005;

    drawFleets();
    drawParticles();
    planets.forEach(drawPlanet);

    requestAnimationFrame(gameLoop);
}

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});
