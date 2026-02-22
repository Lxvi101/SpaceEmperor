import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const socket = io();

// --- Three.js Setup (Minimalist 2D Projection) ---
const scene = new THREE.Scene();

// Top-Down Camera
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 10, 5000);
camera.position.set(0, 1600, 0);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ReinhardToneMapping;
document.body.appendChild(renderer.domElement);

// --- Post-Processing (Subtle Bloom) ---
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.2;
bloomPass.strength = 0.5;
bloomPass.radius = 0.2;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- Controls (Panning Only) ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableRotate = false;
controls.enablePan = true;
controls.enableZoom = true;
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
};

// --- Game Assets & Caches ---
const planetMeshes = {};
const labelsContainer = document.getElementById('labels-container');
const planetLabels = {}; 
const activeFleetObjects = {}; 
const particles = [];

// Geometries (Minimalist styling)
const shipGeometry = new THREE.ConeGeometry(0.15, 0.5, 3);
shipGeometry.rotateX(Math.PI / 2);
const particleGeo = new THREE.OctahedronGeometry(1.0, 0);

const materialsCache = {};
function getPlayerMaterial(colorHex) {
    if (!materialsCache[colorHex]) {
        materialsCache[colorHex] = new THREE.MeshBasicMaterial({ color: colorHex });
    }
    return materialsCache[colorHex];
}

// Game State
let myId = null;
let players = {};
let planets = [];
let fleets = [];
let selectedPlanets = new Set();
let isGameStarted = false;
let sendPercentage = 0.5;
let globalTime = 0;

// Drag and drop state
let isDragging = false;
let dragLines = [];
const dragMaterial = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 5, gapSize: 3, transparent: true, opacity: 0.5 });
const mousePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const offsetX = -600;
const offsetZ = -400;

function map2Dto3D(x, y) {
    return new THREE.Vector3(x + offsetX, 0, y + offsetZ);
}

// --- UI Logic ---
function setActivePercentageUI(pct) {
    sendPercentage = pct;
    document.querySelectorAll('.pct-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.pct-btn[data-pct="${pct}"]`).classList.add('active');
}

document.querySelectorAll('.pct-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        setActivePercentageUI(parseFloat(e.target.dataset.pct));
    });
});

window.addEventListener('keydown', (e) => {
    if (!isGameStarted) return;
    if (e.key === ' ') {
        e.preventDefault();
        if (selectedPlanets.size === 1) socket.emit('buyShips', Array.from(selectedPlanets)[0]);
        return;
    }
    const keyMap = { '1': 0.25, '2': 0.5, '3': 0.7, '4': 1.0 };
    if (keyMap[e.key]) setActivePercentageUI(keyMap[e.key]);
});

const readyBtn = document.getElementById('ready-btn');
readyBtn.addEventListener('click', () => socket.emit('toggleReady'));

function updateLobbyUI() {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    
    Object.values(players).forEach((p, index) => {
        const label = p.isBot ? 'Bot Faction' : `Commander ${index + 1}`;
        const row = document.createElement('div');
        row.className = 'player-row';
        row.style.borderLeftColor = p.color;

        const isMe = p.id === myId;
        
        row.innerHTML = `
            <div class="player-info">
                <span class="status-dot" style="background-color: ${p.color}; box-shadow: 0 0 10px ${p.color};"></span>
                <span>${label} ${isMe ? '(You)' : ''}</span>
                <span style="color:${p.isReady ? '#00ff66' : '#8892b0'}; font-size: 0.85rem; margin-left: 10px;">
                    ${p.isReady ? 'READY' : 'WAITING'}
                </span>
            </div>
            ${!isMe ? `<button class="kick-btn" data-id="${p.id}">KICK</button>` : ''}
        `;
        list.appendChild(row);
    });

    // Bind kick buttons
    document.querySelectorAll('.kick-btn').forEach(btn => {
        btn.addEventListener('click', (e) => socket.emit('kickPlayer', e.target.dataset.id));
    });

    if (players[myId]?.isReady) {
        readyBtn.classList.add('is-ready');
        readyBtn.innerText = "WAITING FOR OTHERS...";
    } else {
        readyBtn.classList.remove('is-ready');
        readyBtn.innerText = "READY";
    }
}

// --- Networking ---
socket.on('init', (data) => {
    myId = data.playerId;
    players = data.players;
    planets = data.planets;
    isGameStarted = data.gameStarted;

    if (isGameStarted) document.getElementById('ready-screen').style.display = 'none';
    else updateLobbyUI();

    init3DPlanets();
    updateUI();
});

socket.on('playersUpdate', (updatedPlayers) => { players = updatedPlayers; if (!isGameStarted) updateLobbyUI(); });
socket.on('gameStarted', () => { 
    isGameStarted = true; 
    document.getElementById('ready-screen').style.display = 'none'; 
    document.getElementById('winner-text').innerText = ''; 
});
socket.on('playerJoined', (player) => { players[player.id] = player; if (!isGameStarted) updateLobbyUI(); });
socket.on('playerLeft', (id) => { delete players[id]; if (!isGameStarted) updateLobbyUI(); });
socket.on('errorMsg', (msg) => alert(msg));

// --- Game Over Logic ---
socket.on('gameOver', (winnerId) => {
    isGameStarted = false;
    
    const winnerName = players[winnerId]?.isBot ? 'The Bot' : (winnerId === myId ? 'You' : 'A Commander');
    document.getElementById('winner-text').innerText = `${winnerName} Conquered the System!`;
    document.getElementById('ready-screen').style.display = 'flex';

    // Visual Cleanup
    selectedPlanets.clear();
    dragLines.forEach(l => scene.remove(l)); dragLines = [];
    particles.forEach(p => scene.remove(p)); particles.length = 0;
    Object.values(activeFleetObjects).forEach(f => {
        scene.remove(f.mesh); scene.remove(f.line); 
        if(f.label.parentNode) f.label.parentNode.removeChild(f.label);
    });
    for (let key in activeFleetObjects) delete activeFleetObjects[key];
});

socket.on('stateUpdate', (data) => {
    // Combat Detection for Particles
    data.planets.forEach(newPlanet => {
        const oldPlanet = planets.find(p => p.id === newPlanet.id);
        if (oldPlanet) {
            const activeFactions = Object.values(newPlanet.ships).filter(count => count >= 1).length;
            Object.keys(oldPlanet.ships).forEach(playerId => {
                const oldShips = oldPlanet.ships[playerId];
                const newShips = newPlanet.ships[playerId] || 0;

                if (activeFactions > 1 && oldShips > newShips && (oldShips - newShips) > 0.05) {
                    if (players[playerId]) {
                        spawnParticles3D(newPlanet, players[playerId].color, 3);
                    }
                }
            });
        }
    });

    planets = data.planets;
    fleets = data.fleets;
    players = data.players;
    update3DPlanets();
    updateUI();
});

// --- 3D Scene Management ---
function init3DPlanets() {
    const geometry = new THREE.SphereGeometry(1, 32, 32);

    planets.forEach(p => {
        const material = new THREE.MeshBasicMaterial({ color: 0x1c1e24 });
        const sphere = new THREE.Mesh(geometry, material);

        sphere.scale.set(p.radius, p.radius, p.radius);
        const pos = map2Dto3D(p.x, p.y);
        sphere.position.copy(pos);

        if (p.isHome) {
            const ringGeo = new THREE.RingGeometry(p.radius + 6, p.radius + 8, 64);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = -Math.PI / 2;
            sphere.add(ring);
            sphere.userData.homeRing = ring;
        }

        // REDUCED & NON-ROTATING HUD Selection Ring
        const hudGeo = new THREE.EdgesGeometry(new THREE.CylinderGeometry(p.radius + 1.5, p.radius + 1.5, 0.5, 32));
        const hudMat = new THREE.LineDashedMaterial({ color: 0x00d2ff, dashSize: 2, gapSize: 2 });
        const selRing = new THREE.LineSegments(hudGeo, hudMat);
        selRing.computeLineDistances();
        selRing.visible = false;
        sphere.add(selRing);
        sphere.userData.selRing = selRing;

        sphere.userData.shipGroup = new THREE.Group();
        sphere.add(sphere.userData.shipGroup);
        sphere.userData.shipPool = [];

        scene.add(sphere);
        planetMeshes[p.id] = sphere;

        const labelDiv = document.createElement('div');
        labelDiv.className = 'floating-label';
        labelsContainer.appendChild(labelDiv);
        planetLabels[p.id] = labelDiv;
    });
}

function update3DPlanets() {
    planets.forEach(p => {
        const mesh = planetMeshes[p.id];
        if (!mesh) return;

        if (p.owner && players[p.owner]) {
            const color = new THREE.Color(players[p.owner].color);
            mesh.material.color.lerp(color, 0.1);
            if (mesh.userData.homeRing && p.isHome) {
                mesh.userData.homeRing.material.color.lerp(color, 0.1);
                mesh.userData.homeRing.material.opacity = 0.8;
            }
        } else {
            mesh.material.color.lerp(new THREE.Color(0x1c1e24), 0.1);
            if (mesh.userData.homeRing) mesh.userData.homeRing.material.opacity = 0.2;
        }

        // Selection HUD Visibility
        if (mesh.userData.selRing) {
            mesh.userData.selRing.visible = selectedPlanets.has(p.id);
            if (players[myId] && selectedPlanets.has(p.id)) {
                mesh.userData.selRing.material.color.setHex(players[myId].color.replace('#', '0x'));
            }
        }

        mesh.scale.setScalar(selectedPlanets.has(p.id) ? p.radius * 1.05 : p.radius);

        const shipGroup = mesh.userData.shipGroup;
        const pool = mesh.userData.shipPool;
        let activeShipIndex = 0;

        Object.entries(p.ships).forEach(([ownerId, count]) => {
            const intCount = Math.floor(count);
            if (intCount <= 0 || !players[ownerId]) return;

            const pColor = players[ownerId].color;
            const mat = getPlayerMaterial(pColor);
            const drawnCount = Math.min(intCount, 30); 

            for (let i = 0; i < drawnCount; i++) {
                let shipMesh;
                if (activeShipIndex < pool.length) {
                    shipMesh = pool[activeShipIndex];
                    shipMesh.visible = true;
                } else {
                    shipMesh = new THREE.Mesh(shipGeometry, mat);
                    pool.push(shipMesh);
                    shipGroup.add(shipMesh);
                }
                
                shipMesh.material = mat; 
                shipMesh.userData.angleOffset = (Math.PI * 2 / drawnCount) * i;
                activeShipIndex++;
            }
        });

        for (let i = activeShipIndex; i < pool.length; i++) {
            pool[i].visible = false;
        }
    });
}

function spawnParticles3D(planet, colorHex, amount) {
    const mat = new THREE.MeshBasicMaterial({ 
        color: colorHex, 
        transparent: true, 
        opacity: 1 
    });
    const pos = map2Dto3D(planet.x, planet.y);
    const orbitRadius = planet.radius + 20;

    for (let i = 0; i < amount; i++) {
        const p = new THREE.Mesh(particleGeo, mat);
        const angle = Math.random() * Math.PI * 2;
        
        p.position.set(
            pos.x + Math.cos(angle) * orbitRadius,
            (Math.random() - 0.5) * 20,
            pos.z + Math.sin(angle) * orbitRadius
        );
        
        p.userData = { vx: (Math.random() - 0.5) * 4, vy: 0, vz: (Math.random() - 0.5) * 4, life: 1.0 };
        
        scene.add(p);
        particles.push(p);
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.position.x += p.userData.vx;
        p.position.z += p.userData.vz;
        p.userData.life -= 0.03;
        
        // Shrink and fade out
        p.scale.setScalar(p.userData.life);
        p.material.opacity = p.userData.life;

        if (p.userData.life <= 0) {
            scene.remove(p);
            particles.splice(i, 1);
        }
    }
}

function toScreenPosition(vector3, camera) {
    const vector = vector3.clone();
    vector.project(camera);
    const x = (vector.x * .5 + .5) * window.innerWidth;
    const y = (-(vector.y * .5) + .5) * window.innerHeight;
    return { x, y, z: vector.z };
}

// --- Update Loops (Runs every frame) ---
function processOrbitsAndLabels() {
    planets.forEach(p => {
        const mesh = planetMeshes[p.id];
        const labelDiv = planetLabels[p.id];
        if (!mesh || !labelDiv) return;

        // NOTE: Rotation code removed per request

        const orbitRadius = p.radius + 15;
        const pool = mesh.userData.shipPool;

        pool.forEach(ship => {
            if (!ship.visible) return;
            const angle = ship.userData.angleOffset + globalTime;
            const relativeRadius = orbitRadius / p.radius;
            ship.position.set(Math.cos(angle) * relativeRadius, 0, Math.sin(angle) * relativeRadius);
            ship.rotation.y = -angle; 
        });

        const screenPos = toScreenPosition(mesh.position, camera);
        
        if (screenPos.z > 1) {
            labelDiv.style.display = 'none';
        } else {
            labelDiv.style.display = 'block';
            labelDiv.style.left = `${screenPos.x}px`;
            
            let labelHtml = '';
            Object.entries(p.ships).forEach(([ownerId, count]) => {
                const intCount = Math.floor(count);
                if (intCount > 0 && players[ownerId]) {
                    labelHtml += `<div style="color: ${players[ownerId].color}">${intCount}</div>`;
                }
            });
            
            labelDiv.innerHTML = labelHtml;
            labelDiv.style.top = `${screenPos.y + (p.radius * 1.5)}px`; 
        }
    });
}

function processFleets() {
    const aliveFleetIds = new Set(fleets.map(f => f.id));

    // Cleanup arrived fleets
    Object.keys(activeFleetObjects).forEach(id => {
        if (!aliveFleetIds.has(Number(id))) {
            const fleetObj = activeFleetObjects[id];
            scene.remove(fleetObj.mesh);
            scene.remove(fleetObj.line);
            if(fleetObj.label && fleetObj.label.parentNode) {
                fleetObj.label.parentNode.removeChild(fleetObj.label);
            }
            delete activeFleetObjects[id];
        }
    });

    fleets.forEach(f => {
        const p1 = planets[f.from];
        const p2 = planets[f.to];
        if (!players[f.owner]) return;
        
        const color = players[f.owner].color;
        let fleetObj = activeFleetObjects[f.id];
        const startPos = map2Dto3D(p1.x, p1.y);
        const endPos = map2Dto3D(p2.x, p2.y);

        if (!fleetObj) {
            const mesh = new THREE.Mesh(shipGeometry, getPlayerMaterial(color));
            mesh.scale.set(0.6, 0.6, 0.6);
            scene.add(mesh);

            const lineMat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.2 });
            const lineGeo = new THREE.BufferGeometry().setFromPoints([startPos, startPos]);
            const line = new THREE.Line(lineGeo, lineMat);
            scene.add(line);

            const label = document.createElement('div');
            label.className = 'floating-label fleet-label';
            label.style.color = color;
            labelsContainer.appendChild(label);

            fleetObj = { mesh, label, line, localProgress: f.progress };
            activeFleetObjects[f.id] = fleetObj;
        }

        fleetObj.localProgress += 0.0016;
        fleetObj.localProgress = THREE.MathUtils.lerp(fleetObj.localProgress, f.progress, 0.1);

        const currentPos = new THREE.Vector3().lerpVectors(startPos, endPos, fleetObj.localProgress);

        fleetObj.mesh.position.copy(currentPos);
        fleetObj.mesh.lookAt(endPos);
        fleetObj.line.geometry.setFromPoints([startPos, currentPos]);

        const screenPos = toScreenPosition(currentPos, camera);
        if (screenPos.z > 1) {
            fleetObj.label.style.display = 'none';
        } else {
            fleetObj.label.style.display = 'block';
            fleetObj.label.style.left = `${screenPos.x}px`;
            fleetObj.label.style.top = `${screenPos.y - 20}px`;
            fleetObj.label.innerText = f.count;
        }
    });
}

// --- Interactions (Raycasting & Drag/Drop) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('mousedown', (e) => {
    if (!isGameStarted || e.target.closest('#ui-layer') || e.target.closest('#ready-screen')) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(Object.values(planetMeshes), true);

    if (intersects.length > 0) {
        let obj = intersects[0].object;
        let clickedPlanetId = null;
        while (obj) {
            const key = Object.keys(planetMeshes).find(k => planetMeshes[k] === obj);
            if (key !== undefined) {
                clickedPlanetId = Number(key);
                break;
            }
            obj = obj.parent;
        }

        const clickedPlanet = clickedPlanetId !== null ? planets.find(p => p.id === clickedPlanetId) : null;

        if (clickedPlanet && clickedPlanet.owner === myId) {
            if (e.shiftKey) {
                // Toggle selection
                if (selectedPlanets.has(clickedPlanetId)) selectedPlanets.delete(clickedPlanetId);
                else selectedPlanets.add(clickedPlanetId);
            } else {
                // If clicking an unselected planet without shift, select ONLY it
                if (!selectedPlanets.has(clickedPlanetId)) {
                    selectedPlanets.clear();
                    selectedPlanets.add(clickedPlanetId);
                }
            }
            // Always prepare to drag if we have ships
            let hasShips = Array.from(selectedPlanets).some(id => planets.find(p => p.id === id).ships[myId] >= 1);
            if (hasShips) {
                isDragging = true;
                controls.enablePan = false;
            }
        } else {
            // Clicked enemy or empty planet - Clear selection
            if (!isDragging) selectedPlanets.clear();
        }
    } else {
        selectedPlanets.clear();
    }
    updateUI();
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(mousePlane, intersectPoint);

    // Update lines from all selected planets
    selectedPlanets.forEach(id => {
        const p = planets.find(pl => pl.id === id);
        if (!p) return;
        const startPos = map2Dto3D(p.x, p.y);

        let line = dragLines.find(l => l.userData.fromId === id);
        if (!line) {
            const geo = new THREE.BufferGeometry().setFromPoints([startPos, startPos]);
            line = new THREE.Line(geo, dragMaterial);
            line.userData.fromId = id;
            if (players[myId]) line.material.color.setHex(players[myId].color.replace('#', '0x'));
            scene.add(line);
            dragLines.push(line);
        }
        line.geometry.setFromPoints([startPos, intersectPoint]);
        line.computeLineDistances(); // Required for LineDashedMaterial
    });
});

window.addEventListener('mouseup', (e) => {
    if (isDragging) {
        isDragging = false;
        controls.enablePan = true;

        // Clean up visual drag lines
        dragLines.forEach(l => scene.remove(l));
        dragLines = [];

        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(Object.values(planetMeshes), true);

        if (intersects.length > 0) {
            let obj = intersects[0].object;
            let targetId = null;
            while (obj) {
                const key = Object.keys(planetMeshes).find(k => planetMeshes[k] === obj);
                if (key !== undefined) {
                    targetId = Number(key);
                    break;
                }
                obj = obj.parent;
            }

            if (targetId !== null) {
                selectedPlanets.forEach(fromId => {
                    if (fromId !== targetId) {
                        socket.emit('sendFleet', { fromPlanetId: fromId, toPlanetId: targetId, percentage: sendPercentage });
                    }
                });
            }
        }
    }
});

document.getElementById('buy-btn').addEventListener('click', () => {
    if (selectedPlanets.size === 1) {
        socket.emit('buyShips', Array.from(selectedPlanets)[0]);
    }
});

function updateUI() {
    if (players[myId]) {
        const ti = Math.floor(players[myId].titanium);
        document.getElementById('titanium-display').innerText = `Titanium: ${ti}`;
        const buyBtn = document.getElementById('buy-btn');

        // Only allow buying if exactly 1 planet is selected
        if (selectedPlanets.size === 1) {
            const selectedP = planets.find(p => p.id === Array.from(selectedPlanets)[0]);

            if (selectedP && selectedP.owner === myId) {
                buyBtn.style.display = 'block';
                const myColor = players[myId].color;

                // Combat Check
                const isUnderAttack = Object.keys(selectedP.ships).filter(id => selectedP.ships[id] >= 1).length > 1;

                if (isUnderAttack) {
                    buyBtn.innerText = "UNDER ATTACK!";
                    buyBtn.disabled = true;
                    buyBtn.style.boxShadow = 'none';
                    buyBtn.style.color = '#ff3333';
                    buyBtn.style.borderColor = '#ff3333';
                } else if (ti >= 50) {
                    buyBtn.innerText = "REINFORCE (50 Ti)";
                    buyBtn.style.color = myColor;
                    buyBtn.style.borderColor = myColor;
                    buyBtn.disabled = false;
                    buyBtn.style.boxShadow = `0 0 10px ${myColor}`;
                } else {
                    buyBtn.innerText = "REINFORCE (50 Ti)";
                    buyBtn.disabled = true;
                    buyBtn.style.boxShadow = 'none';
                    buyBtn.style.color = '#555';
                    buyBtn.style.borderColor = '#555';
                }
            } else {
                buyBtn.style.display = 'none';
            }
        } else {
            buyBtn.style.display = 'none';
        }
    }
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    
    if (isGameStarted) {
        globalTime += 0.02; 
        processOrbitsAndLabels();
        processFleets();
        updateParticles();
    }

    controls.update(); 
    // Replaced renderer.render with composer.render for Post-Processing
    composer.render();
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
