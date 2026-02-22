import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const socket = io();

// --- Three.js Setup ---
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050505, 0.001);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 800, 400); 

const renderer = new THREE.WebGLRenderer({ antialias: false }); // Disable antialias for post-processing performance
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ReinhardToneMapping;
document.body.appendChild(renderer.domElement);

// --- Post-Processing (Bloom) ---
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.1;
bloomPass.strength = 1.2; // The intensity of the neon glow
bloomPass.radius = 0.5;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2.2;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(100, 500, 200);
scene.add(dirLight);

// --- Game Assets & Caches ---
const planetMeshes = {};
const labelsContainer = document.getElementById('labels-container');
const planetLabels = {}; 
const activeFleetObjects = {}; 
const particles = [];

// Geometries
const shipGeometry = new THREE.ConeGeometry(0.4, 1, 4);
shipGeometry.rotateX(Math.PI / 2); 
const particleGeo = new THREE.OctahedronGeometry(1.5, 0);

const materialsCache = {};
function getPlayerMaterial(colorHex) {
    if (!materialsCache[colorHex]) {
        materialsCache[colorHex] = new THREE.MeshStandardMaterial({ 
            color: colorHex, roughness: 0.3, metalness: 0.8,
            emissive: colorHex, emissiveIntensity: 0.5 // Boosted for bloom
        });
    }
    return materialsCache[colorHex];
}

// Game State
let myId = null;
let players = {};
let planets = [];
let fleets = [];
let selectedPlanet = null;
let isGameStarted = false;
let sendPercentage = 0.5;
let globalTime = 0;

const offsetX = -600;
const offsetZ = -400;

function map2Dto3D(x, y) {
    return new THREE.Vector3(x + offsetX, 0, y + offsetZ);
}

// --- UI Logic ---
document.querySelectorAll('.pct-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.pct-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        sendPercentage = parseFloat(e.target.dataset.pct);
    });
});

const readyBtn = document.getElementById('ready-btn');
readyBtn.addEventListener('click', () => socket.emit('toggleReady'));

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
socket.on('gameStarted', () => { isGameStarted = true; document.getElementById('ready-screen').style.display = 'none'; });
socket.on('playerJoined', (player) => { players[player.id] = player; if (!isGameStarted) updateLobbyUI(); });
socket.on('playerLeft', (id) => { delete players[id]; if (!isGameStarted) updateLobbyUI(); });

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
        const material = new THREE.MeshStandardMaterial({ color: 0x454a59, roughness: 0.4 });
        const sphere = new THREE.Mesh(geometry, material);
        
        sphere.scale.set(p.radius, p.radius, p.radius);
        const pos = map2Dto3D(p.x, p.y);
        sphere.position.copy(pos);
        
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
            mesh.material.emissive.copy(color);
            mesh.material.emissiveIntensity = 0.2;
        } else {
            mesh.material.color.lerp(new THREE.Color(0x454a59), 0.1);
            mesh.material.emissiveIntensity = 0;
        }

        mesh.scale.setScalar(selectedPlanet === p.id ? p.radius * 1.1 : p.radius);

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
        
        p.userData = {
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            vz: (Math.random() - 0.5) * 4,
            life: 1.0
        };
        
        scene.add(p);
        particles.push(p);
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.position.x += p.userData.vx;
        p.position.y += p.userData.vy;
        p.position.z += p.userData.vz;
        p.userData.life -= 0.02;
        
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

        const orbitRadius = p.radius + 20; 
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
            mesh.scale.set(0.8, 0.8, 0.8); 
            scene.add(mesh);

            // Create Fleet Trail Line
            const lineMat = new THREE.LineBasicMaterial({ 
                color: color, transparent: true, opacity: 0.4 
            });
            const lineGeo = new THREE.BufferGeometry().setFromPoints([startPos, startPos]);
            const line = new THREE.Line(lineGeo, lineMat);
            scene.add(line);

            const label = document.createElement('div');
            label.className = 'floating-label fleet-label';
            label.style.color = color;
            labelsContainer.appendChild(label);

            fleetObj = { mesh, label, line };
            activeFleetObjects[f.id] = fleetObj;
        }

        const currentPos = new THREE.Vector3().lerpVectors(startPos, endPos, f.progress);
        
        fleetObj.mesh.position.copy(currentPos);
        fleetObj.mesh.lookAt(endPos); 
        
        // Update line geometry to connect start position to current position
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

// --- Interactions (Raycasting) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('mousedown', (e) => {
    if (!isGameStarted || e.target.closest('#ui-layer') || e.target.closest('#ready-screen')) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(Object.values(planetMeshes));

    if (intersects.length > 0) {
        const clickedMesh = intersects[0].object;
        const clickedPlanetId = Number(Object.keys(planetMeshes).find(key => planetMeshes[key] === clickedMesh));
        const clickedPlanet = planets.find(p => p.id === clickedPlanetId);

        if (selectedPlanet === null) {
            if (clickedPlanet.ships[myId] >= 1) selectedPlanet = clickedPlanetId;
        } else {
            if (selectedPlanet !== clickedPlanetId) {
                socket.emit('sendFleet', { fromPlanetId: selectedPlanet, toPlanetId: clickedPlanetId, percentage: sendPercentage });
            }
            selectedPlanet = null;
        }
    } else {
        selectedPlanet = null;
    }
    updateUI();
});

document.getElementById('buy-btn').addEventListener('click', () => {
    if (selectedPlanet !== null) socket.emit('buyShips', selectedPlanet);
});

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
