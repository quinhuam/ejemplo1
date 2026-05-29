import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- CONFIGURACIÓN GEOGRÁFICA ---
const centerLng = -74.87;
const centerLat = -9.19;
const scale = 1.25;
const extrudeDepth = 0.4;

function project(lng, lat) {
  return {
    x: (lng - centerLng) * scale,
    y: (lat - centerLat) * scale
  };
}

// Helper para normalizar textos en español (quitar acentos/diacríticos y pasar a mayúsculas)
function normalizeString(str) {
  if (!str) return "";
  return str
    .toString()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// --- CLASE DE SÍNTESIS DE AUDIO (WEB AUDIO API) ---
class SoundGenerator {
  constructor() {
    this.ctx = null;
    this.mainGain = null;
    this.ambientOsc = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.mainGain = this.ctx.createGain();
      this.mainGain.gain.value = 0.2; // Volumen general bajo por defecto
      this.mainGain.connect(this.ctx.destination);
      this.startAmbientHum();
    } catch (e) {
      console.warn("Audio Context no soportado en este navegador.", e);
    }
  }

  toggle(state) {
    this.enabled = state;
    if (!this.ctx) this.init();
    if (this.mainGain) {
      this.mainGain.gain.value = this.enabled ? 0.2 : 0;
    }
  }

  startAmbientHum() {
    if (!this.ctx || !this.enabled) return;
    
    // Zumbido de fondo (Tactical Hum)
    this.ambientOsc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const ambientGain = this.ctx.createGain();

    this.ambientOsc.type = 'triangle';
    this.ambientOsc.frequency.setValueAtTime(55, this.ctx.currentTime); // Nota La (A1) muy grave

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(100, this.ctx.currentTime);

    ambientGain.gain.setValueAtTime(0.04, this.ctx.currentTime); // Muy sutil

    this.ambientOsc.connect(filter);
    filter.connect(ambientGain);
    ambientGain.connect(this.mainGain);

    this.ambientOsc.start();
  }

  playClick() {
    if (!this.ctx || !this.enabled) return;
    this.ctx.resume();

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'sine';
    // Clic digital agudo
    osc.frequency.setValueAtTime(900, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

    osc.connect(gainNode);
    gainNode.connect(this.mainGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.12);
  }

  playHover() {
    if (!this.ctx || !this.enabled) return;
    
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, this.ctx.currentTime);

    gainNode.gain.setValueAtTime(0.03, this.ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.03);

    osc.connect(gainNode);
    gainNode.connect(this.mainGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.03);
  }

  playSweep() {
    if (!this.ctx || !this.enabled) return;
    this.ctx.resume();

    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gainNode = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1400, this.ctx.currentTime + 0.5);

    filter.type = 'peaking';
    filter.Q.value = 10;
    filter.frequency.setValueAtTime(300, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.5);

    gainNode.gain.setValueAtTime(0.07, this.ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);

    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.mainGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.5);
  }
}

const sounds = new SoundGenerator();

// --- VARIABLES PRINCIPALES ---
let scene, camera, renderer, controls;
let mapGroup, pinsGroup;
let departmentsData = {};
let schoolsData = [];
let hoveredDepartment = null;
let selectedSchool = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Listas para Raycasting
const departmentMeshes = [];
const pinInteractionMeshes = [];

// Animación de Cámara Interpolada
const targetCameraPos = new THREE.Vector3(0, 18, 14);
const targetCameraLookAt = new THREE.Vector3(0, -1, 0);
const currentCameraLookAt = new THREE.Vector3(0, -1, 0);

// Elementos del DOM
const tooltip = document.getElementById('tooltip');
const panelDetails = document.getElementById('panel-details');
const searchInput = document.getElementById('search-input');
const departmentList = document.getElementById('department-list');
const btnReset = document.getElementById('btn-reset');
const btnAudio = document.getElementById('btn-audio');
const consoleLogs = document.getElementById('console-logs');
const mouseCoordsEl = document.getElementById('console-mouse-coords');
const clockDisplay = document.getElementById('hud-clock');

// --- ETIQUETAS HTML PROYECTADAS ---
let labelsContainer = null;

// --- INICIALIZACIÓN ---
async function init() {
  setupThreeJS();
  createLabelsContainer();
  setupEventListeners();
  startHUDClock();
  
  // Agregar logs iniciales
  addConsoleLog("ESTABLECIENDO ENLACE CON REPOSITORIOS GEOGRÁFICOS...", "cyan");
  
  try {
    // Carga de GeoJSON y JSON de escuelas en paralelo
    const [geoRes, schoolsRes] = await Promise.all([
      fetch('data/peru_departamentos.geojson'),
      fetch('data/schools.json')
    ]);
    
    const geoData = await geoRes.json();
    schoolsData = await schoolsRes.json();
    
    addConsoleLog("CONEXIÓN DE DATOS ESTABLECIDA EXPENDIENDO 8 ACADEMIAS MILITARES.", "green");
    
    renderPeruMap(geoData);
    createSchoolPins();
    if (departmentList) populateDepartmentSidebar();
    
    // Animación de entrada de cámara
    addConsoleLog("NÚCLEO 3D EN LÍNEA: ESCANEO CARTOGRÁFICO LISTO.", "green");
  } catch (error) {
    console.error("Error cargando archivos de datos", error);
    addConsoleLog("ERROR CRÍTICO: FALLÓ LA CARGA DE BASE DE DATOS LOCAL.", "red");
  }
  
  resetInactivityTimer(); // Kiosk Mode: Iniciar temporizador
  animate();
}

// Configuración de la Escena 3D
function setupThreeJS() {
  const container = document.getElementById('canvas-container');
  
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x040810, 0.025);
  
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 22, 18);
  
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x040810, 1);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);
  
  // Controles de Órbita
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // No ver por debajo del mapa
  controls.minDistance = 3;
  controls.maxDistance = 35;
  controls.target.copy(currentCameraLookAt);
  
  // Grupos
  mapGroup = new THREE.Group();
  pinsGroup = new THREE.Group();
  scene.add(mapGroup);
  scene.add(pinsGroup);
  
  // Iluminación Táctica
  const ambientLight = new THREE.AmbientLight(0x0c1e36, 1.2);
  scene.add(ambientLight);
  
  const dirLight = new THREE.DirectionalLight(0x10b981, 1.0); // Luz de acento verde
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);
  
  const pointLight1 = new THREE.PointLight(0x06b6d4, 1.5, 30); // Luz azul de acento
  pointLight1.position.set(-10, 5, -5);
  scene.add(pointLight1);
  
  // Rejilla de Fondo en 3D
  const gridHelper = new THREE.GridHelper(60, 60, 0x10b981, 0x064e3b);
  gridHelper.position.y = -0.5;
  gridHelper.material.opacity = 0.15;
  gridHelper.material.transparent = true;
  scene.add(gridHelper);
}

// Crear el contenedor de etiquetas flotantes HTML
function createLabelsContainer() {
  labelsContainer = document.createElement('div');
  labelsContainer.id = 'labels-container';
  labelsContainer.style.position = 'absolute';
  labelsContainer.style.top = '0';
  labelsContainer.style.left = '0';
  labelsContainer.style.width = '100%';
  labelsContainer.style.height = '100%';
  labelsContainer.style.pointerEvents = 'none';
  labelsContainer.style.zIndex = '3';
  labelsContainer.style.overflow = 'hidden';
  document.body.appendChild(labelsContainer);
}

// --- DIBUJADO DEL MAPA ---
function renderPeruMap(geoJson) {
  // Colores alternados para dar textura y volumen de sectores
  const colors = [
    0x0a1424, 0x0b1a2e, 0x0d1f38, 0x102542,
    0x08152b, 0x0a1d37, 0x092240, 0x071b32
  ];
  
  geoJson.features.forEach((feature, index) => {
    const deptName = feature.properties.NOMBDEP || feature.properties.name || "DEPARTAMENTO";
    const deptColor = colors[index % colors.length];
    
    // Contar cuántas escuelas hay en este departamento
    const normalizedName = normalizeString(deptName);
    const count = schoolsData.filter(s => normalizeString(s.department) === normalizedName).length;
    departmentsData[normalizedName] = { count, meshes: [] };
    
    const { geomGroup, meshes } = createDepartment3D(feature, deptColor);
    
    geomGroup.userData = { deptName: normalizedName, count };
    mapGroup.add(geomGroup);
    
    meshes.forEach(mesh => {
      mesh.userData = { deptName: normalizedName, parentGroup: geomGroup };
      departmentMeshes.push(mesh);
      departmentsData[normalizedName].meshes.push(mesh);
    });
  });
  
  // Rotar el mapa completo para colocarlo horizontalmente en el plano XZ
  mapGroup.rotation.x = -Math.PI / 2;
  pinsGroup.rotation.x = -Math.PI / 2;
}

function createDepartment3D(feature, color) {
  const geomGroup = new THREE.Group();
  const meshes = [];
  const { type, coordinates } = feature.geometry;
  const shapes = [];
  
  const drawPoly = (coords, shape) => {
    const p0 = project(coords[0][0], coords[0][1]);
    shape.moveTo(p0.x, p0.y);
    for (let i = 1; i < coords.length; i++) {
      const p = project(coords[i][0], coords[i][1]);
      shape.lineTo(p.x, p.y);
    }
    shape.closePath();
  };
  
  if (type === "Polygon") {
    const shape = new THREE.Shape();
    drawPoly(coordinates[0], shape);
    // Agujeros
    for (let i = 1; i < coordinates.length; i++) {
      const hole = new THREE.Path();
      drawPoly(coordinates[i], hole);
      shape.holes.push(hole);
    }
    shapes.push(shape);
  } else if (type === "MultiPolygon") {
    coordinates.forEach(polyCoords => {
      const shape = new THREE.Shape();
      drawPoly(polyCoords[0], shape);
      for (let i = 1; i < polyCoords.length; i++) {
        const hole = new THREE.Path();
        drawPoly(polyCoords[i], hole);
        shape.holes.push(hole);
      }
      shapes.push(shape);
    });
  }
  
  const extrudeSettings = {
    depth: extrudeDepth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.015,
    bevelThickness: 0.015
  };
  
  const material = new THREE.MeshPhongMaterial({
    color: color,
    transparent: true,
    opacity: 0.82,
    shininess: 30,
    emissive: new THREE.Color(0x021626),
    specular: new THREE.Color(0x10b981)
  });
  
  shapes.forEach(shape => {
    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    // Bordes vectoriales brillantes (estilo HUD wireframe)
    const edgesGeom = new THREE.EdgesGeometry(geom);
    const edgesLine = new THREE.LineSegments(
      edgesGeom,
      new THREE.LineBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.35
      })
    );
    
    geomGroup.add(mesh);
    geomGroup.add(edgesLine);
    meshes.push(mesh);
  });
  
  return { geomGroup, meshes };
}

// --- CREACIÓN DE PINES DE ESCUELAS ---
function createSchoolPins() {
  schoolsData.forEach(school => {
    const pinProj = project(school.coords.lng, school.coords.lat);
    
    const pinGroup = new THREE.Group();
    pinGroup.position.set(pinProj.x, pinProj.y, extrudeDepth + 0.01);
    
    // 1. Asta vertical fina del pin
    const poleGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8);
    // Desplazar el pivote para que comience en la base
    poleGeom.translate(0, 0.35, 0);
    poleGeom.rotateX(Math.PI / 2); // alinear con el eje Z local (que apunta hacia arriba antes de rotar el grupo)
    const poleMat = new THREE.MeshBasicMaterial({ color: 0x64748b });
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pinGroup.add(pole);
    
    // 2. Cabezal flotante del pin (Antena / Holograma)
    const headGeom = new THREE.ConeGeometry(0.12, 0.35, 4);
    headGeom.translate(0, 0.7, 0);
    headGeom.rotateX(Math.PI / 2); // alinear con eje Z
    const headMat = new THREE.MeshPhongMaterial({
      color: school.color,
      emissive: school.color,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.9
    });
    const head = new THREE.Mesh(headGeom, headMat);
    pinGroup.add(head);

    // 3. Sensor de interacción invisible (para facilitar el Raycasting)
    const sensorGeom = new THREE.BoxGeometry(0.5, 0.5, 1.2);
    sensorGeom.translate(0, 0, 0.5);
    const sensorMat = new THREE.MeshBasicMaterial({
      visible: false // invisible
    });
    const sensorMesh = new THREE.Mesh(sensorGeom, sensorMat);
    sensorMesh.userData = { isPin: true, schoolId: school.id, parentGroup: pinGroup };
    pinGroup.add(sensorMesh);
    pinInteractionMeshes.push(sensorMesh);

    // 4. Anillo de pulso (Beacon effect) en la base del pin
    const pulseRingGeom = new THREE.RingGeometry(0.05, 0.28, 16);
    const pulseRingMat = new THREE.MeshBasicMaterial({
      color: school.color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const pulseRing = new THREE.Mesh(pulseRingGeom, pulseRingMat);
    pinGroup.add(pulseRing);
    
    // Guardar referencia en el grupo
    pinGroup.userData = { 
      schoolId: school.id, 
      school, 
      pulseRing,
      head
    };
    
    pinsGroup.add(pinGroup);

    // Crear etiqueta HTML flotante
    createFloatingLabel(school, pinProj);
  });
}

// Crear la etiqueta flotante HTML en 2D vinculada a un pin
function createFloatingLabel(school, pinProj) {
  const labelDiv = document.createElement('div');
  labelDiv.className = 'tactical-label';
  labelDiv.id = `label-${school.id}`;
  labelDiv.style.position = 'absolute';
  labelDiv.style.padding = '3px 6px';
  labelDiv.style.border = `1px solid ${school.color}`;
  labelDiv.style.borderLeft = `3px solid ${school.color}`;
  labelDiv.style.background = 'rgba(4, 8, 16, 0.88)';
  labelDiv.style.fontSize = '9px';
  labelDiv.style.color = '#fff';
  labelDiv.style.fontFamily = 'var(--font-mono)';
  labelDiv.style.whiteSpace = 'nowrap';
  labelDiv.style.pointerEvents = 'none';
  labelDiv.style.transform = 'translate(-50%, -100%)';
  labelDiv.innerHTML = `<span class="blink" style="color:${school.color}">•</span> ${school.specialty.toUpperCase()}`;
  
  labelsContainer.appendChild(labelDiv);
  
  // Guardar en la estructura del pin
  const pin = pinsGroup.children.find(p => p.userData.schoolId === school.id);
  if (pin) {
    pin.userData.labelDiv = labelDiv;
  }
}

// --- ACTUALIZAR ETIQUETAS Y ANIMAR BEACONS ---
const labelTempV = new THREE.Vector3();
function updateLabels() {
  pinsGroup.children.forEach(pin => {
    const labelDiv = pin.userData.labelDiv;
    if (!labelDiv) return;
    
    // Calcular posición de pantalla 2D
    // El pin está en pinsGroup que tiene rotación en X (-PI/2)
    // Así que su posición 3D real en la escena es (x, -z, y) en relación a los valores globales
    labelTempV.copy(pin.position);
    // Aplicar la rotación del grupo de pines
    labelTempV.applyEuler(pinsGroup.rotation);
    labelTempV.y += 0.8; // desplazar hacia arriba
    
    // Proyectar
    labelTempV.project(camera);
    
    // Determinar si está detrás de la cámara
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    
    const worldPos = new THREE.Vector3();
    pin.getWorldPosition(worldPos);
    const pinDir = worldPos.sub(camera.position).normalize();
    const isBehind = dir.dot(pinDir) < 0;
    
    if (isBehind) {
      labelDiv.style.display = 'none';
      return;
    }
    
    const x = (labelTempV.x * 0.5 + 0.5) * window.innerWidth;
    const y = (labelTempV.y * -0.5 + 0.5) * window.innerHeight;
    
    labelDiv.style.display = 'block';
    labelDiv.style.left = `${x}px`;
    labelDiv.style.top = `${y}px`;
  });
}

function animatePins(delta) {
  pinsGroup.children.forEach(pin => {
    // 1. Pulso del anillo
    const ring = pin.userData.pulseRing;
    if (ring) {
      ring.scale.addScalar(0.015);
      ring.material.opacity = 1.0 - (ring.scale.x - 1.0) / 2.5;
      if (ring.scale.x > 3.5) {
        ring.scale.set(1, 1, 1);
        ring.material.opacity = 0.8;
      }
    }
    
    // 2. Rotación del cabezal piramidal
    const head = pin.userData.head;
    if (head) {
      head.rotation.y += 0.02;
    }
  });
}

// --- POPULAR SIDEBAR IZQUIERDO ---
function populateDepartmentSidebar() {
  if (!departmentList) return;
  departmentList.innerHTML = "";
  
  // Obtener lista ordenada de departamentos
  const sortedDepts = Object.keys(departmentsData).sort();
  
  sortedDepts.forEach(dept => {
    const data = departmentsData[dept];
    const li = document.createElement('li');
    li.dataset.dept = dept;
    li.innerHTML = `
      <span class="dept-name">${dept}</span>
      ${data.count > 0 ? `<span class="dept-count">${data.count}</span>` : `<span class="dept-count" style="opacity: 0.3; background: transparent; border-color: transparent">0</span>`}
    `;
    
    li.addEventListener('click', () => {
      sounds.playClick();
      selectDepartment(dept);
    });
    
    departmentList.appendChild(li);
  });
}

// --- GESTIÓN DE SELECCIONES ---

// Seleccionar un Departamento
function selectDepartment(deptName) {
  const normName = normalizeString(deptName);
  
  // Limpiar anterior
  if (hoveredDepartment) resetDepartmentHighlight(hoveredDepartment);
  
  // Buscar departamento
  const data = departmentsData[normName];
  if (!data) return;
  
  // Resaltar
  data.meshes.forEach(mesh => {
    mesh.material.emissive.setHex(0x064e3b);
    mesh.material.opacity = 0.95;
  });
  hoveredDepartment = normName;
  
  // Marcar en la lista lateral
  if (departmentList) {
    const activeLi = departmentList.querySelector('li.active');
    if (activeLi) activeLi.classList.remove('active');
    
    const newLi = Array.from(departmentList.children).find(li => li.dataset.dept === normName);
    if (newLi) {
      newLi.classList.add('active');
      newLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  
  // Enfocar cámara al centro del departamento
  // Calcular caja delimitadora
  const box = new THREE.Box3();
  data.meshes.forEach(mesh => box.expandByObject(mesh));
  const center = new THREE.Vector3();
  box.getCenter(center);
  
  // Rotar el centro adecuadamente (debido al mapa rotado)
  center.applyEuler(mapGroup.rotation);
  
  targetCameraLookAt.copy(center);
  targetCameraPos.set(center.x, center.y + 7.5, center.z + 8.5);
  
  // Buscar si hay escuela en este departamento y enfocarla
  const school = schoolsData.find(s => normalizeString(s.department) === normName);
  if (school) {
    selectSchool(school.id);
  } else {
    // Cerrar panel de detalles
    panelDetails.classList.add('hidden');
    selectedSchool = null;
    // Quitar active de pines
    pinsGroup.children.forEach(p => {
      p.userData.head.scale.set(1, 1, 1);
    });
    addConsoleLog(`[SECTOR] ENFOQUE: ${normName} (SIN BASES DOCENTES ACTIVAS)`, "yellow");
  }
}

// Seleccionar una Escuela
function selectSchool(schoolId) {
  const school = schoolsData.find(s => s.id === schoolId);
  if (!school) return;
  
  selectedSchool = school;
  addConsoleLog(`[ACCESO] SOLICITANDO DATOS: ${school.name.toUpperCase()}... ENLACE EXITOSO.`, "cyan");
  
  // Animación del Pin
  pinsGroup.children.forEach(p => {
    if (p.userData.schoolId === schoolId) {
      p.userData.head.scale.set(1.4, 1.4, 1.4);
    } else {
      p.userData.head.scale.set(1, 1, 1);
    }
  });
  
  // Cargar Info en Sidebar
  document.getElementById('detail-title').textContent = school.name.toUpperCase();
  
  // Manejar Logo
  const logoEl = document.getElementById('school-logo');
  if (school.logo) {
    logoEl.src = school.logo;
    logoEl.classList.remove('hidden');
  } else {
    logoEl.classList.add('hidden');
    logoEl.src = '';
  }

  // Manejar Video / Imagen Principal
  const imgEl = document.getElementById('school-img');
  const videoEl = document.getElementById('school-video');
  if (school.video) {
    videoEl.src = school.video;
    videoEl.classList.remove('hidden');
    imgEl.classList.add('hidden');
    // Forzar autoplay si no arranca
    videoEl.play().catch(e => console.log('Autoplay prevent error:', e));
  } else {
    videoEl.classList.add('hidden');
    videoEl.pause();
    videoEl.src = '';
    imgEl.src = school.image;
    imgEl.classList.remove('hidden');
  }
  
  document.getElementById('school-motto').textContent = `"${school.motto}"`;
  document.getElementById('school-specialty').textContent = school.specialty.toUpperCase();
  document.getElementById('school-specialty').style.color = school.color;
  document.getElementById('school-dept').textContent = school.department.toUpperCase();
  document.getElementById('school-founded').textContent = school.founded;
  document.getElementById('school-desc').textContent = school.description;
  
  // Cargar Info de Héroe
  const heroImgEl = document.getElementById('hero-img');
  if (school.hero.image) {
    heroImgEl.src = school.hero.image;
    heroImgEl.classList.remove('hidden');
  } else {
    heroImgEl.classList.add('hidden');
    heroImgEl.src = '';
  }
  
  document.getElementById('hero-name').textContent = school.hero.name.toUpperCase();
  document.getElementById('hero-title').textContent = school.hero.title.toUpperCase();
  document.getElementById('hero-bio').textContent = school.hero.bio;
  
  // Mostrar Sidebar
  panelDetails.classList.remove('hidden');
  
  // Actualizar Telemetría del Dron
  document.getElementById('telemetry-lat').textContent = school.coords.lat.toFixed(4);
  document.getElementById('telemetry-lng').textContent = school.coords.lng.toFixed(4);
  
  // Enfocar Cámara al Pin de la Escuela
  const proj = project(school.coords.lng, school.coords.lat);
  const pinPos3D = new THREE.Vector3(proj.x, 0.8, -proj.y);
  
  targetCameraLookAt.copy(pinPos3D);
  targetCameraPos.set(pinPos3D.x, pinPos3D.y + 4.5, pinPos3D.z + 5.5);
  
  // Asegurarnos de marcar el departamento activo en la lista lateral
  if (departmentList) {
    const activeLi = departmentList.querySelector('li.active');
    if (activeLi) activeLi.classList.remove('active');
    
    const newLi = Array.from(departmentList.children).find(li => li.dataset.dept === normalizeString(school.department));
    if (newLi) {
      newLi.classList.add('active');
      newLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  
  // Reiniciar y animar gráfico de radar
  initRadarAnimation(school);
  
  // Reiniciar y calibrar monitor
  initMonitorSimulation(school);
}

// Resetear Iluminación del Departamento
function resetDepartmentHighlight(deptName) {
  const data = departmentsData[normalizeString(deptName)];
  if (!data) return;
  data.meshes.forEach(mesh => {
    mesh.material.emissive.setHex(0x021626);
    mesh.material.opacity = 0.82;
  });
}

// --- RENDERIZACIÓN DE GRÁFICO DE RADAR ---
let radarInterval = null;
let radarProgress = 0;

function initRadarAnimation(school) {
  if (radarInterval) clearInterval(radarInterval);
  radarProgress = 0;
  
  const canvas = document.getElementById('radar-canvas');
  const ctx = canvas.getContext('2d');
  const statsKeys = Object.keys(school.stats);
  const statsValues = Object.values(school.stats);
  
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = 90;
    const totalAxes = statsKeys.length;
    
    // Dibujar rejilla concéntrica del radar (5 niveles)
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.lineWidth = 1;
    
    for (let level = 1; level <= 5; level++) {
      const r = radius * (level / 5);
      ctx.beginPath();
      for (let i = 0; i < totalAxes; i++) {
        const angle = (i * 2 * Math.PI) / totalAxes - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    
    // Dibujar Ejes
    ctx.beginPath();
    for (let i = 0; i < totalAxes; i++) {
      const angle = (i * 2 * Math.PI) / totalAxes - Math.PI / 2;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
    }
    ctx.stroke();
    
    // Dibujar los Textos de las Etiquetas
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "Share Tech Mono"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (let i = 0; i < totalAxes; i++) {
      const angle = (i * 2 * Math.PI) / totalAxes - Math.PI / 2;
      const x = cx + (radius + 20) * Math.cos(angle);
      const y = cy + (radius + 10) * Math.sin(angle);
      ctx.fillText(statsKeys[i].toUpperCase(), x, y);
    }
    
    // Dibujar el polígono de estadísticas (escalado por el progreso)
    ctx.fillStyle = `${school.color}25`; // Transparente
    ctx.strokeStyle = school.color;
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    for (let i = 0; i < totalAxes; i++) {
      const angle = (i * 2 * Math.PI) / totalAxes - Math.PI / 2;
      const statVal = statsValues[i] * radarProgress;
      const r = radius * (statVal / 100);
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Dibujar pequeños nodos en las puntas del polígono
    ctx.fillStyle = '#fff';
    for (let i = 0; i < totalAxes; i++) {
      const angle = (i * 2 * Math.PI) / totalAxes - Math.PI / 2;
      const statVal = statsValues[i] * radarProgress;
      const r = radius * (statVal / 100);
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  };
  
  // Lanzar bucle de animación para la gráfica
  radarInterval = setInterval(() => {
    radarProgress += 0.05;
    if (radarProgress >= 1.0) {
      radarProgress = 1.0;
      clearInterval(radarInterval);
    }
    draw();
  }, 30);
}

// --- SIMULADOR DE VIDEO MONITOR (CAMARA TERMICA) ---
let monitorCanvas = null;
let monitorCtx = null;
let monitorAnimId = null;
let thermalMode = true;
let targetX = 150, targetY = 90;
let curTargetX = 150, curTargetY = 90;

// Elementos de telemetría cambiantes
let altVal = 4200;
let spdVal = 120;

function initMonitorSimulation(school) {
  if (monitorAnimId) cancelAnimationFrame(monitorAnimId);
  
  monitorCanvas = document.getElementById('monitor-canvas');
  monitorCtx = monitorCanvas.getContext('2d');
  
  const w = monitorCanvas.width;
  const h = monitorCanvas.height;
  
  // Inicialización de manchas térmicas flotantes (heat maps)
  const heatBlobs = Array.from({ length: 5 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 15 + Math.random() * 25,
    color: Math.random() > 0.5 ? 'rgba(239, 68, 68, 0.45)' : 'rgba(245, 158, 11, 0.45)', // rojo o naranja
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4
  }));

  const drawMonitor = () => {
    // Fondo dependiente del modo térmico (verde militar vs escala de grises/térmico)
    if (thermalMode) {
      // Modo Térmico: Azul oscuro, verde, rojo
      monitorCtx.fillStyle = '#020617';
      monitorCtx.fillRect(0, 0, w, h);
      
      // Fondo de radiación verde
      monitorCtx.fillStyle = 'rgba(16, 185, 129, 0.03)';
      monitorCtx.fillRect(0, 0, w, h);
    } else {
      // Modo CRT Nocturno Verde
      monitorCtx.fillStyle = '#022c22';
      monitorCtx.fillRect(0, 0, w, h);
    }

    // Dibujar la rejilla HUD
    monitorCtx.strokeStyle = thermalMode ? 'rgba(6, 182, 212, 0.15)' : 'rgba(16, 185, 129, 0.2)';
    monitorCtx.lineWidth = 0.5;
    
    // Líneas verticales
    for (let x = 0; x < w; x += 20) {
      monitorCtx.beginPath();
      monitorCtx.moveTo(x, 0);
      monitorCtx.lineTo(x, h);
      monitorCtx.stroke();
    }
    // Líneas horizontales
    for (let y = 0; y < h; y += 20) {
      monitorCtx.beginPath();
      monitorCtx.moveTo(0, y);
      monitorCtx.lineTo(w, y);
      monitorCtx.stroke();
    }

    // Actualizar y dibujar las manchas de calor (sólo en modo térmico)
    if (thermalMode) {
      heatBlobs.forEach(blob => {
        blob.x += blob.vx;
        blob.y += blob.vy;
        
        // Rebote en bordes
        if (blob.x - blob.r < 0 || blob.x + blob.r > w) blob.vx *= -1;
        if (blob.y - blob.r < 0 || blob.y + blob.r > h) blob.vy *= -1;
        
        const grad = monitorCtx.createRadialGradient(blob.x, blob.y, 2, blob.x, blob.y, blob.r);
        grad.addColorStop(0, '#ffffff'); // Núcleo caliente blanco
        grad.addColorStop(0.2, '#f59e0b'); // Amarillo caliente
        grad.addColorStop(0.5, '#ef4444'); // Rojo medio
        grad.addColorStop(0.9, 'rgba(59, 130, 246, 0.15)'); // Azul frío
        grad.addColorStop(1, 'transparent');
        
        monitorCtx.fillStyle = grad;
        monitorCtx.beginPath();
        monitorCtx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
        monitorCtx.fill();
      });
    } else {
      // Dibujar contornos simulados en verde nocturno
      monitorCtx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
      monitorCtx.lineWidth = 1.5;
      
      // Montañas de fondo simuladas con líneas sinusoidales
      monitorCtx.beginPath();
      monitorCtx.moveTo(0, h - 30);
      for (let x = 0; x < w; x += 10) {
        monitorCtx.lineTo(x, h - 30 + Math.sin(x * 0.05) * 12);
      }
      monitorCtx.lineTo(w, h);
      monitorCtx.lineTo(0, h);
      monitorCtx.closePath();
      monitorCtx.fillStyle = '#011e15';
      monitorCtx.fill();
      monitorCtx.stroke();
    }

    // Deriva del objetivo (Crosshair)
    if (Math.random() < 0.02) {
      targetX = w/2 + (Math.random() - 0.5) * 60;
      targetY = h/2 + (Math.random() - 0.5) * 40;
    }
    // Interpolación suave del visor
    curTargetX += (targetX - curTargetX) * 0.05;
    curTargetY += (targetY - curTargetY) * 0.05;

    // Dibujar la Mira de Bloqueo
    monitorCtx.strokeStyle = thermalMode ? '#0ea5e9' : '#10b981';
    monitorCtx.lineWidth = 1;
    
    // Círculo Central
    monitorCtx.beginPath();
    monitorCtx.arc(curTargetX, curTargetY, 15, 0, Math.PI * 2);
    monitorCtx.stroke();
    
    // Cruz
    monitorCtx.beginPath();
    monitorCtx.moveTo(curTargetX - 25, curTargetY);
    monitorCtx.lineTo(curTargetX - 5, curTargetY);
    monitorCtx.moveTo(curTargetX + 5, curTargetY);
    monitorCtx.lineTo(curTargetX + 25, curTargetY);
    monitorCtx.moveTo(curTargetX, curTargetY - 25);
    monitorCtx.lineTo(curTargetX, curTargetY - 5);
    monitorCtx.moveTo(curTargetX, curTargetY + 5);
    monitorCtx.lineTo(curTargetX, curTargetY + 25);
    monitorCtx.stroke();
    
    // Cuadros esquinas del visor
    monitorCtx.strokeRect(20, 20, w - 40, h - 40);

    // Ruido y Estática de Señal (Noise overlay)
    monitorCtx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let i = 0; i < 400; i++) {
      const rx = Math.random() * w;
      const ry = Math.random() * h;
      monitorCtx.fillRect(rx, ry, 1, 1);
    }
    
    // Línea de barrido vertical CRT (Scan bar)
    const scanBarY = (Date.now() * 0.08) % h;
    monitorCtx.fillStyle = 'rgba(16, 185, 129, 0.07)';
    monitorCtx.fillRect(0, scanBarY, w, 2);

    // Texto HUD interno en monitor
    monitorCtx.fillStyle = thermalMode ? '#0ea5e9' : '#10b981';
    monitorCtx.font = '8px "Share Tech Mono"';
    monitorCtx.textAlign = 'left';
    monitorCtx.fillText("SYS: SECURE FEED", 25, 32);
    monitorCtx.fillText("TRACKING TARGET [X]", 25, 42);
    
    monitorCtx.textAlign = 'right';
    monitorCtx.fillText(`ZOOM: 16.2X`, w - 25, 32);
    monitorCtx.fillText(`FRM: 60FPS`, w - 25, 42);
    
    // Variar telemetría
    if (Math.random() < 0.05) {
      altVal += Math.floor((Math.random() - 0.5) * 5);
      spdVal += Math.floor((Math.random() - 0.5) * 3);
      document.getElementById('telemetry-alt').textContent = `${altVal.toLocaleString()}m`;
      document.getElementById('telemetry-spd').textContent = `${spdVal} km/h`;
    }

    monitorAnimId = requestAnimationFrame(drawMonitor);
  };
  
  drawMonitor();
}

// --- CONSOLA DE DIAGNÓSTICO ---
function addConsoleLog(text, colorClass = "") {
  if (!consoleLogs) return;
  const line = document.createElement('div');
  line.className = `log-line ${colorClass ? `text-${colorClass}` : ""}`;
  
  const time = new Date();
  const timeStr = `[${time.toLocaleTimeString()}]`;
  line.innerHTML = `<span class="text-secondary">${timeStr}</span> ${text}`;
  
  consoleLogs.appendChild(line);
  
  // Limitar logs a 15 líneas para evitar saturación de memoria DOM
  while (consoleLogs.children.length > 20) {
    consoleLogs.removeChild(consoleLogs.firstChild);
  }
  
  // Autoscroll
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// --- EVENTOS Y BINDINGS ---
function setupEventListeners() {
  // Ajuste de Ventana
  window.addEventListener('resize', onWindowResize);
  
  // Evento mousemove sobre canvas para Raycasting
  window.addEventListener('mousemove', onMouseMove);
  
  // Clic sobre el lienzo 3D
  window.addEventListener('click', onClick);
  
  // Reiniciar Vista
  btnReset.addEventListener('click', () => {
    sounds.playClick();
    addConsoleLog("SISTEMA DE CÁMARA RESTABLECIDO A VISTA GLOBAL PERÚ.", "cyan");
    
    // Resetear posición de cámara
    targetCameraPos.set(0, 18, 14);
    targetCameraLookAt.set(0, -1, 0);
    
    // Cerrar panel lateral de detalles
    panelDetails.classList.add('hidden');
    
    // Detener video si hay
    const videoEl = document.getElementById('school-video');
    if (videoEl) {
      videoEl.pause();
      videoEl.src = '';
    }
    
    selectedSchool = null;
    
    // Quitar active de la lista lateral
    if (departmentList) {
      const activeLi = departmentList.querySelector('li.active');
      if (activeLi) activeLi.classList.remove('active');
    }
    
    // Resetear todos los highlights y escalas
    if (hoveredDepartment) {
      resetDepartmentHighlight(hoveredDepartment);
      hoveredDepartment = null;
    }
    pinsGroup.children.forEach(p => {
      p.userData.head.scale.set(1, 1, 1);
    });
  });
  
  // Alternar Audio
  btnAudio.addEventListener('click', () => {
    const isEnabled = btnAudio.classList.contains('active');
    if (isEnabled) {
      btnAudio.classList.remove('active');
      document.getElementById('audio-status').textContent = "OFF";
      sounds.toggle(false);
    } else {
      sounds.init();
      btnAudio.classList.add('active');
      document.getElementById('audio-status').textContent = "ON";
      sounds.toggle(true);
      sounds.playClick();
    }
  });
  // Autoactivar audio con primer clic en la pantalla (debido a políticas de navegadores)
  document.body.addEventListener('click', () => {
    if (!sounds.ctx && btnAudio.classList.contains('active')) {
      sounds.init();
      btnAudio.classList.add('active');
      document.getElementById('audio-status').textContent = "ON";
    }
  }, { once: true });
  // Marcar botón activo al inicio
  btnAudio.classList.add('active');

  // Filtros de Especialidad
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      sounds.playClick();
      
      // Cambiar clases activas
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const specialty = btn.dataset.specialty;
      filterPinsBySpecialty(specialty);
      addConsoleLog(`[FILTRO] APLICADO: ESPECIALIDAD - ${specialty.toUpperCase()}`, "yellow");
    });
  });
  
  // Buscador de Escuelas y Departamentos
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const value = e.target.value.toLowerCase().trim();
      
      // Filtrar la lista de la barra lateral
      if (departmentList) {
        Array.from(departmentList.children).forEach(li => {
          const deptName = li.dataset.dept.toLowerCase();
          const hasSchools = schoolsData.some(s => 
            s.department.toLowerCase() === deptName && 
            (s.name.toLowerCase().includes(value) || s.specialty.toLowerCase().includes(value))
          );
          
          if (deptName.includes(value) || hasSchools) {
            li.style.display = 'flex';
          } else {
            li.style.display = 'none';
          }
        });
      }

      // Ocultar/Mostrar pines en 3D
      pinsGroup.children.forEach(pin => {
        const school = pin.userData.school;
        const matchesSearch = school.name.toLowerCase().includes(value) || 
                              school.department.toLowerCase().includes(value) ||
                              school.specialty.toLowerCase().includes(value);
                              
        pin.visible = matchesSearch;
        const label = pin.userData.labelDiv;
        if (label) label.style.opacity = matchesSearch ? "1" : "0";
      });
    });
  }
  
  // Cerrar panel de detalles
  document.getElementById('btn-close-details').addEventListener('click', () => {
    sounds.playClick();
    panelDetails.classList.add('hidden');
    
    // Detener video si hay
    const videoEl = document.getElementById('school-video');
    if (videoEl) {
      videoEl.pause();
      videoEl.src = '';
    }
    
    selectedSchool = null;
    pinsGroup.children.forEach(p => {
      p.userData.head.scale.set(1, 1, 1);
    });
  });
  
  // Pestañas de Detalle
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sounds.playClick();
      
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const targetTab = btn.dataset.tab;
      document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
      });
      document.getElementById(`tab-${targetTab}`).classList.add('active');
      
      if (targetTab === 'tactica' && selectedSchool) {
        initRadarAnimation(selectedSchool);
      }
    });
  });

  // Conmutador de modo térmico del monitor
  document.getElementById('btn-thermal-toggle').addEventListener('click', () => {
    sounds.playClick();
    thermalMode = !thermalMode;
    addConsoleLog(`[MONITOR] CONMUTANDO MODO DE VIDEO TÁCTICO... MODO ${thermalMode ? 'TERMOGRÁFICO' : 'CRT VERDE'}.`, "cyan");
  });
  
  // Recalibrar monitor
  document.getElementById('btn-monitor-reset').addEventListener('click', () => {
    sounds.playSweep();
    addConsoleLog("[MONITOR] INICIANDO CALIBRACIÓN DEL SENSOR FLIR...", "yellow");
    altVal = 4200 + Math.floor(Math.random() * 200);
    spdVal = 110 + Math.floor(Math.random() * 20);
  });

  // Botón Ejecutar Reconocimiento Geográfico
  document.getElementById('btn-geo-recon')?.addEventListener('click', () => {
    if (selectedSchool) {
      sounds.playSweep();
      addConsoleLog(`[RECONOCIMIENTO] DISPARANDO BARRIDO DE TELEMETRÍA EN ${selectedSchool.department.toUpperCase()}`, "green");
      // Animación sacudida de cámara sutil para simular escaneo
      setTimeout(() => {
        addConsoleLog(`[RECONOCIMIENTO] OBJETIVO FIJADO EN ALTURA DEL DISTRITO DE FORMACIÓN.`, "green");
      }, 600);
    }
  });
}

function filterPinsBySpecialty(specialty) {
  pinsGroup.children.forEach(pin => {
    const school = pin.userData.school;
    const isVisible = (specialty === 'all' || school.specialty_key === specialty);
    pin.visible = isVisible;
    
    // Ocultar/mostrar etiqueta flotante
    const label = pin.userData.labelDiv;
    if (label) {
      label.style.opacity = isVisible ? "1" : "0";
    }
  });
}

// Redimensionamiento de Ventana
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Movimiento del Mouse (Raycasting & Coordenadas)
function onMouseMove(event) {
  // Coordenadas normalizadas del ratón
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  
  // Actualizar coordenadas en el HUD (conversión simulada en el Perú)
  const mapLat = (mouse.y * 10 - 9.19).toFixed(5);
  const mapLng = (mouse.x * 10 - 74.87).toFixed(5);
  if (mouseCoordsEl) mouseCoordsEl.textContent = `LAT: ${mapLat} | LNG: ${mapLng}`;
  
  // Realizar Raycasting
  raycaster.setFromCamera(mouse, camera);
  
  // 1. Raycast para pines (prioridad)
  const pinIntersects = raycaster.intersectObjects(pinInteractionMeshes);
  
  if (pinIntersects.length > 0) {
    const clickedSensor = pinIntersects[0].object;
    const schoolId = clickedSensor.userData.schoolId;
    const school = schoolsData.find(s => s.id === schoolId);
    
    if (school) {
      // Activar tooltip
      tooltip.classList.remove('hidden');
      tooltip.style.left = `${event.clientX}px`;
      tooltip.style.top = `${event.clientY}px`;
      tooltip.innerHTML = `
        <div style="font-weight:bold;color:${school.color}">${school.name}</div>
        <div style="font-size:11px;color:#94a3b8">${school.specialty} - ${school.department}</div>
      `;
      
      // Resaltar pin
      const parent = clickedSensor.userData.parentGroup;
      if (parent) {
        parent.userData.head.scale.set(1.2, 1.2, 1.2);
      }
      
      if (hoveredDepartment) {
        resetDepartmentHighlight(hoveredDepartment);
        hoveredDepartment = null;
      }
      
      // Reproducir sonido hover (una sola vez)
      if (window.lastHoveredItem !== schoolId) {
        sounds.playHover();
        window.lastHoveredItem = schoolId;
      }
      
      // Cambiar cursor táctico
      document.body.style.cursor = 'pointer';
      return;
    }
  }

  // Quitar escala aumentada de los pines no seleccionados/hovered
  pinsGroup.children.forEach(p => {
    if (!selectedSchool || p.userData.schoolId !== selectedSchool.id) {
      p.userData.head.scale.set(1, 1, 1);
    }
  });
  
  // 2. Raycast para departamentos del mapa
  const mapIntersects = raycaster.intersectObjects(departmentMeshes);
  
  if (mapIntersects.length > 0) {
    const mesh = mapIntersects[0].object;
    const deptName = mesh.userData.deptName;
    const normName = normalizeString(deptName);
    
    document.body.style.cursor = 'pointer';
    
    if (hoveredDepartment !== normName) {
      // Limpiar anterior
      if (hoveredDepartment) resetDepartmentHighlight(hoveredDepartment);
      
      // Resaltar actual
      const data = departmentsData[normName];
      if (data) {
        data.meshes.forEach(m => {
          m.material.emissive.setHex(0x0c3a2f); // verde oscuro sutil
        });
      }
      
      hoveredDepartment = normName;
      
      // Loggear en consola
      addConsoleLog(`APUNTANDO SENSOR GEO-ESPACIAL A SECTOR: ${normName}`, "yellow");
      sounds.playHover();
      window.lastHoveredItem = deptName;
    }
    
    // Activar tooltip
    const count = departmentsData[normName] ? departmentsData[normName].count : 0;
    tooltip.classList.remove('hidden');
    tooltip.style.left = `${event.clientX}px`;
    tooltip.style.top = `${event.clientY}px`;
    tooltip.innerHTML = `
      <div style="font-weight:bold;color:var(--neon-green)">SECTOR: ${normName}</div>
      <div style="font-size:11px;color:#94a3b8">${count} Escuela(s) Detectada(s)</div>
    `;
  } else {
    // Si no toca nada
    document.body.style.cursor = 'default';
    tooltip.classList.add('hidden');
    if (hoveredDepartment) {
      resetDepartmentHighlight(hoveredDepartment);
      hoveredDepartment = null;
      window.lastHoveredItem = null;
    }
  }
}

// Clics del Mouse
function onClick(event) {
  // Descartar clics si se hacen sobre elementos HTML del HUD
  if (event.target.tagName !== 'CANVAS' || event.target.id !== 'canvas-container' && event.target.parentNode.id !== 'canvas-container') {
    return;
  }
  
  raycaster.setFromCamera(mouse, camera);
  
  // 1. Verificar clic en pin
  const pinIntersects = raycaster.intersectObjects(pinInteractionMeshes);
  if (pinIntersects.length > 0) {
    sounds.playClick();
    tooltip.classList.add('hidden'); // Kiosk Mode: Ocultar tooltip al tocar
    const schoolId = pinIntersects[0].object.userData.schoolId;
    selectSchool(schoolId);
    return;
  }
  
  // 2. Verificar clic en departamento
  const mapIntersects = raycaster.intersectObjects(departmentMeshes);
  if (mapIntersects.length > 0) {
    sounds.playClick();
    tooltip.classList.add('hidden'); // Kiosk Mode: Ocultar tooltip al tocar
    const deptName = mapIntersects[0].object.userData.deptName;
    selectDepartment(deptName);
  }
}

// --- RELOJ TÁCTICO HUD ---
function startHUDClock() {
  const pad = (val) => String(val).padStart(2, '0');
  
  setInterval(() => {
    const now = new Date();
    const hrs = pad(now.getHours());
    const mins = pad(now.getMinutes());
    const secs = pad(now.getSeconds());
    
    // Centésimas de segundo (milisegundos / 10)
    const ms = pad(Math.floor(now.getMilliseconds() / 10));
    
    clockDisplay.textContent = `${hrs}:${mins}:${secs}:${ms}`;
  }, 35);
}

// --- KIOSK MODE: INACTIVITY TIMEOUT ---
let inactivityTimer = null;
const INACTIVITY_LIMIT = 60000; // 60 segundos de inactividad para resetear

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    // Si han pasado 60 segundos, reiniciar a vista global
    if (selectedSchool || hoveredDepartment) {
      addConsoleLog("SISTEMA RESETEADO POR INACTIVIDAD (MODO KIOSCO).", "yellow");
      btnReset.click();
    }
    
    // Ocultar buscador si estuviera activo para ocultar el teclado virtual
    if (searchInput && document.activeElement === searchInput) {
      searchInput.blur();
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input')); // Limpiar filtro
    }
  }, INACTIVITY_LIMIT);
}

// Escuchar eventos globales para resetear el temporizador de inactividad
window.addEventListener('mousemove', resetInactivityTimer, { passive: true });
window.addEventListener('mousedown', resetInactivityTimer, { passive: true });
window.addEventListener('touchstart', resetInactivityTimer, { passive: true });
window.addEventListener('keydown', resetInactivityTimer, { passive: true });
window.addEventListener('click', resetInactivityTimer, { passive: true });
window.addEventListener('scroll', resetInactivityTimer, { passive: true });

// --- BUCLE DE RENDERIZACIÓN ANIMADO (60 FPS) ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  
  const delta = clock.getDelta();
  
  // Actualizar controles 3D
  controls.update();
  
  // Animar cámara e interpolaciones suavemente
  camera.position.lerp(targetCameraPos, 0.06);
  currentCameraLookAt.lerp(targetCameraLookAt, 0.06);
  controls.target.copy(currentCameraLookAt);
  
  // Animar elementos visuales de los pines
  animatePins(delta);
  
  // Actualizar posiciones 2D de las etiquetas HTML flotantes
  updateLabels();
  
  // Render de la escena
  renderer.render(scene, camera);
}

// Ejecutar inicialización
window.addEventListener('DOMContentLoaded', init);
