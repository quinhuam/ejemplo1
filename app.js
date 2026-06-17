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
    this.synthInterval = null;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.mainGain = this.ctx.createGain();
      this.mainGain.gain.value = 0.2;
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
    
    this.ambientOsc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const ambientGain = this.ctx.createGain();

    this.ambientOsc.type = 'triangle';
    this.ambientOsc.frequency.setValueAtTime(55, this.ctx.currentTime); // La1 grave

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(100, this.ctx.currentTime);

    ambientGain.gain.setValueAtTime(0.04, this.ctx.currentTime);

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

  // Genera un pitido morse/sintetizado militar de fondo si no hay audio mp3
  startSynthVoice() {
    this.stopSynthVoice();
    if (!this.ctx || !this.enabled) return;
    
    this.synthInterval = setInterval(() => {
      if (Math.random() > 0.4) {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gainNode = this.ctx.createGain();
        
        osc.type = 'sawtooth';
        // Frecuencia robótica modulada
        const freq = 120 + Math.random() * 80;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(350, this.ctx.currentTime);
        filter.Q.setValueAtTime(3, this.ctx.currentTime);

        gainNode.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.mainGain);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.16);
      }
    }, 180);
  }

  stopSynthVoice() {
    if (this.synthInterval) {
      clearInterval(this.synthInterval);
      this.synthInterval = null;
    }
  }
}

const sounds = new SoundGenerator();

// --- VARIABLES PRINCIPALES ---
let scene, camera, renderer, controls;
let mapGroup, pinsGroup, orgPinsGroup;
let departmentsData = {};
let schoolsData = [];
let orgData = null;
let jurisdiccionData = null;
let currentMode = 'org'; // 'org', 'schools', 'history', 'cms'
let hoveredDepartment = null;
let selectedSchool = null;
let selectedOrgUnit = null; // { type: 'division'|'brigade'|'battalion', id: string, data: object }
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

// AUDIO PLAYER DOM
const hudAudioPlayer = document.getElementById('hud-audio-player');
const playerPlayBtn = document.getElementById('player-play-btn');
const playerTrackStatus = document.getElementById('player-track-status');
const playerWaveAnim = document.getElementById('player-wave-anim');
const hudAudioElement = document.getElementById('hud-audio-element');

// --- EVENTOS DE INTERFAZ DE MODOS ---
const navOrg = document.getElementById('nav-org');
const navSchools = document.getElementById('nav-schools');
const navHistory = document.getElementById('nav-history');
const navCms = document.getElementById('nav-cms');

const panelLeft = document.getElementById('panel-left');
const schoolsControls = document.getElementById('schools-controls');
const orgControls = document.getElementById('org-controls');
const historyModule = document.getElementById('history-module');
const cmsModule = document.getElementById('cms-module');

// LÍNEA DE TIEMPO HISTÓRICA
const historyEvents = [
  {
    year: "1200",
    title: "Época Incaica",
    subtitle: "El Ejército del Inca",
    desc: "El Tawantinsuyu estructuró un poderoso ejército basado en la disciplina militar, entrenamiento constante y una infraestructura de tambos y caminos (Qhapaq Ñan) que garantizaba la logística. Sus tácticas de cerco consolidaron el mayor imperio de América del Sur.",
    image: "assets/images/special_ops.jpg"
  },
  {
    year: "1821",
    title: "Independencia",
    subtitle: "Nacimiento de la Legión Peruana",
    desc: "Tras la proclamación de la independencia nacional por el general Don José de San Martín, se expide el decreto de creación del primer Ejército del Perú y de la Guardia Cívica, forjando el brazo militar de la nueva República.",
    image: "assets/images/infantry.jpg"
  },
  {
    year: "1824",
    title: "Consolidación",
    subtitle: "Batallas de Junín y Ayacucho",
    desc: "El contingente patriota peruano y aliado, al mando del Mariscal Antonio José de Sucre, derrota de forma inapelable al virreinato realista. Se sella definitivamente la independencia del Perú y del continente sudamericano.",
    image: "assets/images/cavalry.jpg"
  },
  {
    year: "1879",
    title: "Guerra del Pacífico",
    subtitle: "Resistencia e Inmolación",
    desc: "El Ejército combate con heroísmo. Francisco Bolognesi inmola su vida en Arica defendiendo el honor nacional hasta quemar el último cartucho, y Andrés Avelino Cáceres 'El Brujo de los Andes' organiza la legendaria resistencia en la Campaña de la Breña.",
    image: "assets/images/mountain.jpg"
  },
  {
    year: "1941",
    title: "Campaña del Norte",
    subtitle: "Despliegue y Primer Salto de Combate",
    desc: "Conflicto armado que demostró la excelente preparación y modernización táctica del Ejército del Perú. Se realizó con éxito la primera operación aérea de asalto paracaidista militar en América del Sur en Puerto Bolívar.",
    image: "assets/images/artillery.jpg"
  },
  {
    year: "1995",
    title: "Conflicto del Cenepa",
    subtitle: "Defensa e Infiltración de Selva",
    desc: "Operaciones de combate en la cordillera del Cóndor. Tropas peruanas detienen y rechazan las incursiones en selva densa, valiéndose de lealtad, conocimiento del terreno y patrullaje de comandos. Sienta las bases para el tratado definitivo de paz.",
    image: "assets/images/jungle.jpg"
  },
  {
    year: "1997",
    title: "Chavín de Huántar",
    subtitle: "Rescate de Rehenes de la Residencia de Japón",
    desc: "Considerada una de las misiones de rescate militar más exitosas a nivel global. Comandos construyen túneles subterráneos y penetran por asalto coordinado, neutralizando a terroristas del MRTA y rescatando a 72 rehenes a salvo.",
    image: "assets/images/special_ops.jpg"
  },
  {
    year: "2026",
    title: "Pacificación y Desarrollo",
    subtitle: "Garante Operativo en el VRAEM y Apoyo Civil",
    desc: "En la actualidad, las fuerzas militares del Ejército combaten las amenazas en el VRAEM, resguardan las fronteras soberanas, y despliegan Batallones de Ingeniería y Apoyo para auxiliar a la ciudadanía ante emergencias climatológicas y desastres naturales.",
    image: "assets/images/engineering.jpg"
  }
];

// --- ETIQUETAS HTML PROYECTADAS ---
let labelsContainer = null;

// --- INICIALIZACIÓN ---
async function init() {
  setupThreeJS();
  createLabelsContainer();
  setupEventListeners();
  startHUDClock();
  
  addConsoleLog("ESTABLECIENDO ENLACE CON REPOSITORIOS GEOGRÁFICOS...", "cyan");
  
  try {
    // Carga de GeoJSON, Escuelas, Jurisdicciones y Estructura en paralelo
    const [geoRes, schoolsRes, jurisRes, orgRes] = await Promise.all([
      fetch('data/peru_departamentos.geojson'),
      fetch('data/schools.json'),
      fetch('jurisdiccion.json'),
      fetch('data/estructura_organica.json')
    ]);
    
    const geoData = await geoRes.json();
    
    // Cargar desde localStorage si ya fue editado por el CMS, si no, del archivo
    const savedSchools = localStorage.getItem('ejercito_mvp_schools_data');
    if (savedSchools) {
      schoolsData = JSON.parse(savedSchools);
      addConsoleLog("CARGADOS DATOS DE ESCUELAS DESDE LOCALSTORAGE.", "cyan");
    } else {
      schoolsData = await schoolsRes.json();
      localStorage.setItem('ejercito_mvp_schools_data', JSON.stringify(schoolsData));
    }

    const savedOrg = localStorage.getItem('ejercito_mvp_org_data');
    if (savedOrg) {
      orgData = JSON.parse(savedOrg);
      addConsoleLog("CARGADOS DATOS DE ESTRUCTURA ORGÁNICA DESDE LOCALSTORAGE.", "cyan");
    } else {
      orgData = await orgRes.json();
      localStorage.setItem('ejercito_mvp_org_data', JSON.stringify(orgData));
    }
    
    jurisdiccionData = await jurisRes.json();
    
    addConsoleLog("CONEXIÓN DE DATOS ESTABLECIDA Y BASE DE DATOS LOCAL SINCRONIZADA.", "green");
    
    renderPeruMap(geoData);
    createSchoolPins();
    createOrganicPins();
    
    if (departmentList) populateDepartmentSidebar();
    populateOrganicTree();
    populateCmsUnitSelector();
    
    // Modo inicial
    switchMode('org');
    
    addConsoleLog("NÚCLEO 3D EN LÍNEA: SISTEMA INTERACTIVO LISTO.", "green");
  } catch (error) {
    console.error("Error cargando archivos de datos", error);
    addConsoleLog("ERROR CRÍTICO: FALLÓ LA CARGA DE BASE DE DATOS LOCAL.", "red");
  }
  
  resetInactivityTimer();
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
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minDistance = 3;
  controls.maxDistance = 35;
  controls.target.copy(currentCameraLookAt);
  
  // Grupos
  mapGroup = new THREE.Group();
  pinsGroup = new THREE.Group();     // Pines Escuelas
  orgPinsGroup = new THREE.Group();  // Pines Orgánicos (Batallones y Divisiones)
  
  scene.add(mapGroup);
  scene.add(pinsGroup);
  scene.add(orgPinsGroup);
  
  // Iluminación Táctica
  const ambientLight = new THREE.AmbientLight(0x0c1e36, 1.2);
  scene.add(ambientLight);
  
  const dirLight = new THREE.DirectionalLight(0x10b981, 1.0);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);
  
  const pointLight1 = new THREE.PointLight(0x06b6d4, 1.5, 30);
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
  const colors = [
    0x0a1424, 0x0b1a2e, 0x0d1f38, 0x102542,
    0x08152b, 0x0a1d37, 0x092240, 0x071b32
  ];
  
  geoJson.features.forEach((feature, index) => {
    const deptName = feature.properties.NOMBDEP || feature.properties.name || "DEPARTAMENTO";
    const deptColor = colors[index % colors.length];
    
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
  
  mapGroup.rotation.x = -Math.PI / 2;
  pinsGroup.rotation.x = -Math.PI / 2;
  orgPinsGroup.rotation.x = -Math.PI / 2;
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
    
    const poleGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8);
    poleGeom.translate(0, 0.35, 0);
    poleGeom.rotateX(Math.PI / 2);
    const poleMat = new THREE.MeshBasicMaterial({ color: 0x64748b });
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pinGroup.add(pole);
    
    const headGeom = new THREE.ConeGeometry(0.12, 0.35, 4);
    headGeom.translate(0, 0.7, 0);
    headGeom.rotateX(Math.PI / 2);
    const headMat = new THREE.MeshPhongMaterial({
      color: school.color,
      emissive: school.color,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.9
    });
    const head = new THREE.Mesh(headGeom, headMat);
    pinGroup.add(head);

    const sensorGeom = new THREE.BoxGeometry(0.5, 0.5, 1.2);
    sensorGeom.translate(0, 0, 0.5);
    const sensorMat = new THREE.MeshBasicMaterial({ visible: false });
    const sensorMesh = new THREE.Mesh(sensorGeom, sensorMat);
    sensorMesh.userData = { isPin: true, isSchool: true, schoolId: school.id, parentGroup: pinGroup };
    pinGroup.add(sensorMesh);
    pinInteractionMeshes.push(sensorMesh);

    const pulseRingGeom = new THREE.RingGeometry(0.05, 0.28, 16);
    const pulseRingMat = new THREE.MeshBasicMaterial({
      color: school.color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const pulseRing = new THREE.Mesh(pulseRingGeom, pulseRingMat);
    pinGroup.add(pulseRing);
    
    pinGroup.userData = { 
      schoolId: school.id, 
      school, 
      pulseRing,
      head
    };
    
    pinsGroup.add(pinGroup);
    createFloatingLabel(school.id, school.specialty, school.color, pinProj, pinsGroup);
  });
}

// --- CREACIÓN DE PINES ORGÁNICOS (DIVISIONES Y BATALLONES) ---
function createOrganicPins() {
  if (!orgData) return;
  
  // Limpiar pins orgánicos anteriores si existen en la escena
  while (orgPinsGroup.children.length > 0) {
    const child = orgPinsGroup.children[0];
    orgPinsGroup.remove(child);
  }

  orgData.divisiones.forEach(div => {
    // 1. Pin para el Cuartel General de la División (Cian)
    const divProj = project(div.coords.lng, div.coords.lat);
    const divColor = "#06b6d4"; // Cian
    
    const divPinGroup = new THREE.Group();
    divPinGroup.position.set(divProj.x, divProj.y, extrudeDepth + 0.01);
    
    const poleGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8);
    poleGeom.translate(0, 0.45, 0);
    poleGeom.rotateX(Math.PI / 2);
    const poleMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
    const pole = new THREE.Mesh(poleGeom, poleMat);
    divPinGroup.add(pole);
    
    // Cabeza de pirámide doble más grande
    const headGeom = new THREE.OctahedronGeometry(0.2);
    headGeom.translate(0, 0.9, 0);
    headGeom.rotateX(Math.PI / 4);
    const headMat = new THREE.MeshPhongMaterial({
      color: divColor,
      emissive: divColor,
      emissiveIntensity: 1.8,
      transparent: true,
      opacity: 0.95
    });
    const head = new THREE.Mesh(headGeom, headMat);
    divPinGroup.add(head);

    const sensorGeom = new THREE.BoxGeometry(0.7, 0.7, 1.4);
    sensorGeom.translate(0, 0, 0.6);
    const sensorMat = new THREE.MeshBasicMaterial({ visible: false });
    const sensorMesh = new THREE.Mesh(sensorGeom, sensorMat);
    sensorMesh.userData = { 
      isPin: true, 
      isOrg: true, 
      orgType: 'division', 
      unitId: div.id, 
      parentGroup: divPinGroup 
    };
    divPinGroup.add(sensorMesh);
    pinInteractionMeshes.push(sensorMesh);

    const pulseRingGeom = new THREE.RingGeometry(0.08, 0.4, 16);
    const pulseRingMat = new THREE.MeshBasicMaterial({
      color: divColor,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const pulseRing = new THREE.Mesh(pulseRingGeom, pulseRingMat);
    divPinGroup.add(pulseRing);
    
    divPinGroup.userData = { 
      unitId: div.id, 
      unitType: 'division',
      unitData: div,
      pulseRing,
      head
    };
    
    orgPinsGroup.add(divPinGroup);
    createFloatingLabel(div.id, div.nombre, divColor, divProj, orgPinsGroup);

    // 2. Pines para los Batallones de cada Brigada (Rojo)
    div.brigadas.forEach(brig => {
      brig.batallones.forEach(bat => {
        const batProj = project(bat.coords.lng, bat.coords.lat);
        const batColor = "#ef4444"; // Rojo

        const batPinGroup = new THREE.Group();
        batPinGroup.position.set(batProj.x, batProj.y, extrudeDepth + 0.01);
        
        const bPoleGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8);
        bPoleGeom.translate(0, 0.3, 0);
        bPoleGeom.rotateX(Math.PI / 2);
        const bPole = new THREE.Mesh(bPoleGeom, poleMat);
        batPinGroup.add(bPole);
        
        const bHeadGeom = new THREE.ConeGeometry(0.09, 0.28, 4);
        bHeadGeom.translate(0, 0.6, 0);
        bHeadGeom.rotateX(Math.PI / 2);
        const bHeadMat = new THREE.MeshPhongMaterial({
          color: batColor,
          emissive: batColor,
          emissiveIntensity: 1.2,
          transparent: true,
          opacity: 0.85
        });
        const bHead = new THREE.Mesh(bHeadGeom, bHeadMat);
        batPinGroup.add(bHead);

        const bSensorGeom = new THREE.BoxGeometry(0.4, 0.4, 1.0);
        bSensorGeom.translate(0, 0, 0.4);
        const bSensorMesh = new THREE.Mesh(bSensorGeom, sensorMat);
        bSensorMesh.userData = { 
          isPin: true, 
          isOrg: true, 
          orgType: 'battalion', 
          unitId: bat.id,
          parentGroup: batPinGroup 
        };
        batPinGroup.add(bSensorMesh);
        pinInteractionMeshes.push(bSensorMesh);

        const bPulseRingGeom = new THREE.RingGeometry(0.04, 0.22, 16);
        const bPulseRingMat = new THREE.MeshBasicMaterial({
          color: batColor,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide
        });
        const bPulseRing = new THREE.Mesh(bPulseRingGeom, bPulseRingMat);
        batPinGroup.add(bPulseRing);
        
        batPinGroup.userData = { 
          unitId: bat.id, 
          unitType: 'battalion',
          unitData: bat,
          parentBrigade: brig,
          parentDivision: div,
          pulseRing: bPulseRing,
          head: bHead
        };
        
        orgPinsGroup.add(batPinGroup);
        // Mostrar siglas cortas
        const sigla = bat.nombre.split("(")[1] ? bat.nombre.split("(")[1].replace(")", "") : bat.nombre;
        createFloatingLabel(bat.id, sigla, batColor, batProj, orgPinsGroup);
      });
    });
  });
}

function createFloatingLabel(id, text, color, pinProj, group) {
  const labelDiv = document.createElement('div');
  labelDiv.className = 'tactical-label';
  labelDiv.id = `label-${id}`;
  labelDiv.style.position = 'absolute';
  labelDiv.style.padding = '3px 6px';
  labelDiv.style.border = `1px solid ${color}`;
  labelDiv.style.borderLeft = `3px solid ${color}`;
  labelDiv.style.background = 'rgba(4, 8, 16, 0.88)';
  labelDiv.style.fontSize = '9px';
  labelDiv.style.color = '#fff';
  labelDiv.style.fontFamily = 'var(--font-mono)';
  labelDiv.style.whiteSpace = 'nowrap';
  labelDiv.style.pointerEvents = 'none';
  labelDiv.style.transform = 'translate(-50%, -100%)';
  labelDiv.innerHTML = `<span class="blink" style="color:${color}">•</span> ${text.toUpperCase()}`;
  
  labelsContainer.appendChild(labelDiv);
  
  const pin = group.children.find(p => p.userData.unitId === id || p.userData.schoolId === id);
  if (pin) {
    pin.userData.labelDiv = labelDiv;
  }
}

// --- ACTUALIZAR ETIQUETAS Y ANIMAR BEACONS ---
const labelTempV = new THREE.Vector3();
function updateLabels() {
  const currentGroup = (currentMode === 'schools') ? pinsGroup : orgPinsGroup;
  
  // Ocultar etiquetas del grupo inactivo
  const inactiveGroup = (currentMode === 'schools') ? orgPinsGroup : pinsGroup;
  inactiveGroup.children.forEach(pin => {
    if (pin.userData.labelDiv) {
      pin.userData.labelDiv.style.display = 'none';
    }
  });

  currentGroup.children.forEach(pin => {
    const labelDiv = pin.userData.labelDiv;
    if (!labelDiv) return;
    
    labelTempV.copy(pin.position);
    labelTempV.applyEuler(currentGroup.rotation);
    labelTempV.y += 0.8;
    
    labelTempV.project(camera);
    
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
  const activeGroup = (currentMode === 'schools') ? pinsGroup : orgPinsGroup;
  activeGroup.children.forEach(pin => {
    const ring = pin.userData.pulseRing;
    if (ring) {
      ring.scale.addScalar(0.015);
      ring.material.opacity = 1.0 - (ring.scale.x - 1.0) / 2.5;
      if (ring.scale.x > 3.5) {
        ring.scale.set(1, 1, 1);
        ring.material.opacity = 0.8;
      }
    }
    
    const head = pin.userData.head;
    if (head) {
      head.rotation.y += 0.02;
    }
  });
}

// --- POPULAR ACORDEÓN DE ESTRUCTURA ORGÁNICA (MENÚ IZQUIERDO) ---
function populateOrganicTree() {
  const treeContainer = document.getElementById('org-tree');
  if (!treeContainer || !orgData) return;
  treeContainer.innerHTML = "";
  
  orgData.divisiones.forEach(div => {
    // Nodo División
    const divNode = document.createElement('div');
    divNode.className = 'tree-node';
    divNode.dataset.type = 'division';
    divNode.dataset.id = div.id;
    
    const divTitle = document.createElement('div');
    divTitle.className = 'tree-node-title';
    divTitle.innerHTML = `
      <span>🛡️ ${div.nombre}</span>
      <span class="node-toggle-icon">▶</span>
    `;
    
    const divChildren = document.createElement('ul');
    divChildren.className = 'tree-children';
    
    // Añadir Brigadas
    div.brigadas.forEach(brig => {
      const brigNode = document.createElement('li');
      brigNode.className = 'tree-node';
      brigNode.dataset.type = 'brigade';
      brigNode.dataset.id = brig.id;
      
      const brigTitle = document.createElement('div');
      brigTitle.className = 'tree-node-title';
      brigTitle.innerHTML = `
        <span>📂 ${brig.nombre}</span>
        <span class="node-toggle-icon">▶</span>
      `;
      
      const brigChildren = document.createElement('ul');
      brigChildren.className = 'tree-children';
      
      // Añadir Batallones
      brig.batallones.forEach(bat => {
        const batNode = document.createElement('li');
        batNode.className = 'tree-subnode';
        batNode.dataset.id = bat.id;
        batNode.textContent = `• ${bat.nombre}`;
        
        batNode.addEventListener('click', (e) => {
          e.stopPropagation();
          sounds.playClick();
          
          // Desmarcar otros subnodos
          treeContainer.querySelectorAll('.tree-subnode.active').forEach(n => n.classList.remove('active'));
          batNode.classList.add('active');
          
          selectOrganicUnit('battalion', bat.id);
        });
        
        brigChildren.appendChild(batNode);
      });
      
      brigTitle.addEventListener('click', (e) => {
        e.stopPropagation();
        sounds.playClick();
        
        const expanded = brigNode.classList.toggle('expanded');
        selectOrganicUnit('brigade', brig.id);
      });
      
      brigNode.appendChild(brigTitle);
      brigNode.appendChild(brigChildren);
      divChildren.appendChild(brigNode);
    });
    
    divTitle.addEventListener('click', () => {
      sounds.playClick();
      const expanded = divNode.classList.toggle('expanded');
      
      // Resaltar en árbol
      treeContainer.querySelectorAll('.tree-node.active').forEach(n => n.classList.remove('active'));
      divNode.classList.add('active');
      
      selectOrganicUnit('division', div.id);
    });
    
    divNode.appendChild(divTitle);
    divNode.appendChild(divChildren);
    treeContainer.appendChild(divNode);
  });
}

// --- POPULAR SIDEBAR IZQUIERDO DE ESCUELAS ---
function populateDepartmentSidebar() {
  if (!departmentList) return;
  departmentList.innerHTML = "";
  
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

// --- GESTIÓN DE SELECCIÓN DE UNIDADES DE LA ESTRUCTURA ORGÁNICA ---
function selectOrganicUnit(type, id) {
  let unit = null;
  let parentDivision = null;
  let parentBrigade = null;

  if (type === 'division') {
    unit = orgData.divisiones.find(d => d.id === id);
    parentDivision = unit;
  } else if (type === 'brigade') {
    orgData.divisiones.forEach(d => {
      const b = d.brigadas.find(br => br.id === id);
      if (b) {
        unit = b;
        parentDivision = d;
      }
    });
  } else if (type === 'battalion') {
    orgData.divisiones.forEach(d => {
      d.brigadas.forEach(br => {
        const bat = br.batallones.find(bt => bt.id === id);
        if (bat) {
          unit = bat;
          parentDivision = d;
          parentBrigade = br;
        }
      });
    });
  }

  if (!unit) return;

  selectedOrgUnit = { type, id, data: unit, parentDivision, parentBrigade };
  addConsoleLog(`[ACCESO] SOLICITANDO DATOS ORGANIZACIONALES: ${unit.nombre.toUpperCase()}`, "cyan");

  // Ajustar cámara e iluminación en base a la división
  if (parentDivision) {
    // 1. Iluminar jurisdicción completa de la división
    highlightDivisionJurisdiction(parentDivision.id);
    
    // 2. Enfocar cámara
    if (type === 'battalion') {
      const proj = project(unit.coords.lng, unit.coords.lat);
      const pinPos = new THREE.Vector3(proj.x, 0.8, -proj.y);
      targetCameraLookAt.copy(pinPos);
      targetCameraPos.set(pinPos.x, pinPos.y + 4.0, pinPos.z + 5.0);
    } else {
      // Enfocar en Cuartel General de División
      const proj = project(parentDivision.coords.lng, parentDivision.coords.lat);
      const divPos = new THREE.Vector3(proj.x, 1.2, -proj.y);
      targetCameraLookAt.copy(divPos);
      targetCameraPos.set(divPos.x, divPos.y + 6.0, divPos.z + 7.5);
    }
  }

  // Animación del Pin Activo
  orgPinsGroup.children.forEach(p => {
    if (p.userData.unitId === id) {
      p.userData.head.scale.set(1.4, 1.4, 1.4);
    } else {
      p.userData.head.scale.set(1, 1, 1);
    }
  });

  // Mostrar datos en Panel Derecho
  document.getElementById('detail-title').textContent = unit.nombre.toUpperCase();
  document.getElementById('school-logo').classList.add('hidden'); // Escudos genéricos o específicos
  
  // Ocultar video de escuelas
  const videoEl = document.getElementById('school-video');
  videoEl.classList.add('hidden');
  videoEl.pause();
  
  // Colocar imagen por defecto militar
  const imgEl = document.getElementById('school-img');
  imgEl.src = "assets/images/infantry.jpg"; // Placeholder general
  imgEl.classList.remove('hidden');

  document.getElementById('school-motto').textContent = unit.lema ? `"${unit.lema}"` : '"Patria o Muerte"';
  
  // Campos del Grid de datos
  const labelField1 = document.getElementById('label-field-1');
  const labelField2 = document.getElementById('label-field-2');
  const labelField3 = document.getElementById('label-field-3');
  
  const specialtyValue = document.getElementById('school-specialty');
  const deptValue = document.getElementById('school-dept');
  const foundedValue = document.getElementById('school-founded');
  const descValue = document.getElementById('school-desc');

  if (type === 'division') {
    labelField1.textContent = "MACROREGIÓN:";
    specialtyValue.textContent = parentDivision.macroregion.toUpperCase();
    specialtyValue.style.color = "var(--neon-cyan)";
    
    labelField2.textContent = "CUARTEL GENERAL:";
    deptValue.textContent = parentDivision.cuartel_general.toUpperCase();
    
    labelField3.textContent = "COMANDO GENERAL:";
    foundedValue.textContent = "GENERAL DE DIVISIÓN EP";
    
    descValue.textContent = unit.reseña;
  } else if (type === 'brigade') {
    labelField1.textContent = "TIPO:";
    specialtyValue.textContent = "BRIGADA OPERATIVA";
    specialtyValue.style.color = "var(--neon-green)";
    
    labelField2.textContent = "DIVISIÓN MADRE:";
    deptValue.textContent = parentDivision.nombre.toUpperCase();
    
    labelField3.textContent = "COMANDANTE:";
    foundedValue.textContent = unit.comandante.toUpperCase();
    
    descValue.textContent = unit.reseña;
  } else if (type === 'battalion') {
    labelField1.textContent = "ARMA/ESPECIALIDAD:";
    specialtyValue.textContent = unit.nombre.includes("Infantería") ? "INFANTERÍA" : "CABALLERÍA/BLINDADOS";
    specialtyValue.style.color = "var(--neon-red)";
    
    labelField2.textContent = "BRIGADA DE APOYO:";
    deptValue.textContent = parentBrigade.nombre.toUpperCase();
    
    labelField3.textContent = "JURISDICCIÓN SECTOR:";
    foundedValue.textContent = parentDivision.cuartel_general.toUpperCase();
    
    descValue.textContent = unit.reseña;
    
    // Cargar escudo de batallón si existe
    if (unit.escudo) {
      const logoEl = document.getElementById('school-logo');
      logoEl.src = unit.escudo;
      logoEl.classList.remove('hidden');
    }
  }

  // Configurar Audio Narración de la Unidad
  setupUnitAudio(unit.audio);

  // Mostrar Panel Derecho
  panelDetails.classList.remove('hidden');

  // Actualizar coordenadas FLIR
  const targetCoords = unit.coords ? unit.coords : parentDivision.coords;
  document.getElementById('telemetry-lat').textContent = targetCoords.lat.toFixed(4);
  document.getElementById('telemetry-lng').textContent = targetCoords.lng.toFixed(4);
  
  // Ocultar pestañas no aplicables
  document.getElementById('tab-btn-hero').style.display = 'none'; // Sin héroes en brigadas
  document.getElementById('tab-btn-tactics').style.display = 'none'; // Sin radar táctico en brigadas
  
  // Forzar cambio a pestaña de detalles
  document.getElementById('tab-btn-main').click();

  initMonitorSimulation(unit);
}

// Resalta todos los departamentos de una división y resetea el resto
function highlightDivisionJurisdiction(divId) {
  // Resetear todos
  Object.keys(departmentsData).forEach(deptName => {
    departmentsData[deptName].meshes.forEach(mesh => {
      mesh.material.emissive.setHex(0x021626);
      mesh.material.opacity = 0.82;
    });
  });

  // Resaltar los de la división
  const division = jurisdiccionData.ejercito_peru_jurisdicciones.divisiones.find(d => d.id_division === divId);
  if (division) {
    division.departamentos_abarcados.forEach(dept => {
      const normDept = normalizeString(dept);
      const data = departmentsData[normDept];
      if (data) {
        data.meshes.forEach(mesh => {
          mesh.material.emissive.setHex(0x064e3b); // Verde oliva brillante
          mesh.material.opacity = 0.95;
        });
      }
    });
  }
}

// Configurar Reproductor de Audio HUD
function setupUnitAudio(audioSrc) {
  // Detener audio anterior
  hudAudioElement.pause();
  hudAudioElement.src = "";
  sounds.stopSynthVoice();
  
  isAudioPlaying = false;
  playerPlayBtn.textContent = "▶ PLAY";
  playerTrackStatus.textContent = "DETENIDO";
  hudAudioPlayer.classList.remove('playing');

  if (audioSrc) {
    hudAudioElement.src = audioSrc;
  }
}

// Alternar reproducción de Audio Narración
function toggleUnitAudio() {
  if (!hudAudioElement.src || hudAudioElement.src.includes('null') || hudAudioElement.src.slice(-1) === '/') {
    // FALLBACK SINTETIZADO SI NO EXISTE MP3 REAL
    if (!isAudioPlaying) {
      isAudioPlaying = true;
      playerPlayBtn.textContent = "⏸ PAUSA";
      playerTrackStatus.textContent = "SINTETIZANDO AUDIO TÁCTICO...";
      hudAudioPlayer.classList.add('playing');
      sounds.startSynthVoice();
      addConsoleLog("[SINTETIZADOR] GENERANDO VOZ SINTÉTICA SOBRE CANAL TÁCTICO.", "yellow");
    } else {
      isAudioPlaying = false;
      playerPlayBtn.textContent = "▶ PLAY";
      playerTrackStatus.textContent = "DETENIDO";
      hudAudioPlayer.classList.remove('playing');
      sounds.stopSynthVoice();
    }
    return;
  }

  if (hudAudioElement.paused) {
    hudAudioElement.play()
      .then(() => {
        isAudioPlaying = true;
        playerPlayBtn.textContent = "⏸ PAUSA";
        playerTrackStatus.textContent = "REPRODUCIENDO...";
        hudAudioPlayer.classList.add('playing');
        addConsoleLog("[CANAL NARRACIÓN] ENLACE DE VOZ ACTIVO.", "green");
      })
      .catch(e => {
        console.warn("Error reproduciendo archivo de audio, activando sintetizador fallback", e);
        // Fallback
        isAudioPlaying = true;
        playerPlayBtn.textContent = "⏸ PAUSA";
        playerTrackStatus.textContent = "MODO RADAR AUDIO (FALLBACK)...";
        hudAudioPlayer.classList.add('playing');
        sounds.startSynthVoice();
      });
  } else {
    hudAudioElement.pause();
    isAudioPlaying = false;
    playerPlayBtn.textContent = "▶ PLAY";
    playerTrackStatus.textContent = "PAUSADO";
    hudAudioPlayer.classList.remove('playing');
    sounds.stopSynthVoice();
  }
}

// --- SELECCIONAR UN DEPARTAMENTO EN MODO ESCUELAS ---
function selectDepartment(deptName) {
  const normName = normalizeString(deptName);
  
  if (hoveredDepartment) resetDepartmentHighlight(hoveredDepartment);
  
  const data = departmentsData[normName];
  if (!data) return;
  
  data.meshes.forEach(mesh => {
    mesh.material.emissive.setHex(0x064e3b);
    mesh.material.opacity = 0.95;
  });
  hoveredDepartment = normName;
  
  if (departmentList) {
    const activeLi = departmentList.querySelector('li.active');
    if (activeLi) activeLi.classList.remove('active');
    
    const newLi = Array.from(departmentList.children).find(li => li.dataset.dept === normName);
    if (newLi) {
      newLi.classList.add('active');
      newLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  
  const box = new THREE.Box3();
  data.meshes.forEach(mesh => box.expandByObject(mesh));
  const center = new THREE.Vector3();
  box.getCenter(center);
  
  center.applyEuler(mapGroup.rotation);
  
  targetCameraLookAt.copy(center);
  targetCameraPos.set(center.x, center.y + 7.5, center.z + 8.5);
  
  // Buscar si hay escuela en este departamento y enfocarla
  const school = schoolsData.find(s => normalizeString(s.department) === normName);
  if (school) {
    selectSchool(school.id);
  } else {
    panelDetails.classList.add('hidden');
    selectedSchool = null;
    pinsGroup.children.forEach(p => {
      p.userData.head.scale.set(1, 1, 1);
    });
    addConsoleLog(`[SECTOR] ENFOQUE: ${normName} (SIN ACADEMIAS COEDE)`, "yellow");
  }
}

// Seleccionar una Escuela (COEDE)
function selectSchool(schoolId) {
  const school = schoolsData.find(s => s.id === schoolId);
  if (!school) return;
  
  selectedSchool = school;
  addConsoleLog(`[ACCESO] SOLICITANDO DATOS ACADEMIA: ${school.name.toUpperCase()}...`, "cyan");
  
  pinsGroup.children.forEach(p => {
    if (p.userData.schoolId === schoolId) {
      p.userData.head.scale.set(1.4, 1.4, 1.4);
    } else {
      p.userData.head.scale.set(1, 1, 1);
    }
  });
  
  document.getElementById('detail-title').textContent = school.name.toUpperCase();
  
  const logoEl = document.getElementById('school-logo');
  if (school.logo) {
    logoEl.src = school.logo;
    logoEl.classList.remove('hidden');
  } else {
    logoEl.classList.add('hidden');
    logoEl.src = '';
  }

  const imgEl = document.getElementById('school-img');
  const videoEl = document.getElementById('school-video');
  if (school.video) {
    videoEl.src = school.video;
    videoEl.classList.remove('hidden');
    imgEl.classList.add('hidden');
    videoEl.play().catch(e => console.log('Autoplay prevent:', e));
  } else {
    videoEl.classList.add('hidden');
    videoEl.pause();
    videoEl.src = '';
    imgEl.src = school.image;
    imgEl.classList.remove('hidden');
  }
  
  document.getElementById('school-motto').textContent = `"${school.motto}"`;
  
  document.getElementById('label-field-1').textContent = "ESPECIALIDAD:";
  document.getElementById('school-specialty').textContent = school.specialty.toUpperCase();
  document.getElementById('school-specialty').style.color = school.color;
  
  document.getElementById('label-field-2').textContent = "SECTOR:";
  document.getElementById('school-dept').textContent = school.department.toUpperCase();
  
  document.getElementById('label-field-3').textContent = "FUNDADA:";
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
  
  // Configurar audio de escuela (si está en la estructura de escuelas o usar sintetizador)
  setupUnitAudio(null); // Las escuelas usan la bio en texto, cargamos reproductor vacío

  // Mostrar Panel Derecho
  panelDetails.classList.remove('hidden');
  
  // Telemetría
  document.getElementById('telemetry-lat').textContent = school.coords.lat.toFixed(4);
  document.getElementById('telemetry-lng').textContent = school.coords.lng.toFixed(4);
  
  const proj = project(school.coords.lng, school.coords.lat);
  const pinPos3D = new THREE.Vector3(proj.x, 0.8, -proj.y);
  
  targetCameraLookAt.copy(pinPos3D);
  targetCameraPos.set(pinPos3D.x, pinPos3D.y + 4.5, pinPos3D.z + 5.5);
  
  if (departmentList) {
    const activeLi = departmentList.querySelector('li.active');
    if (activeLi) activeLi.classList.remove('active');
    
    const newLi = Array.from(departmentList.children).find(li => li.dataset.dept === normalizeString(school.department));
    if (newLi) {
      newLi.classList.add('active');
      newLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  
  // Mostrar pestañas completas
  document.getElementById('tab-btn-hero').style.display = 'block';
  document.getElementById('tab-btn-tactics').style.display = 'block';

  // Reactivar radar y monitor
  initRadarAnimation(school);
  initMonitorSimulation(school);
}

function resetDepartmentHighlight(deptName) {
  const data = departmentsData[normalizeString(deptName)];
  if (!data) return;
  data.meshes.forEach(mesh => {
    mesh.material.emissive.setHex(0x021626);
    mesh.material.opacity = 0.82;
  });
}

// --- CONTROLADOR DE SWITCH DE MODOS ---
function switchMode(mode) {
  currentMode = mode;
  
  // Cerrar paneles y módulos abiertos
  panelDetails.classList.add('hidden');
  historyModule.classList.add('hidden');
  cmsModule.classList.add('hidden');
  hudAudioElement.pause();
  sounds.stopSynthVoice();

  // Actualizar botones de navegación
  [navOrg, navSchools, navHistory, navCms].forEach(btn => btn.classList.remove('active'));
  
  if (mode === 'org') {
    navOrg.classList.add('active');
    panelLeft.classList.remove('hidden');
    orgControls.classList.remove('hidden');
    schoolsControls.classList.add('hidden');
    
    // Visibilidad de pines 3d
    pinsGroup.visible = false;
    orgPinsGroup.visible = true;
    
    // Resetear cámara
    btnReset.click();
    addConsoleLog("MODO ACTIVO: ESTRUCTURA ORGÁNICA E INFRAESTRUCTURA TÁCTICA.", "cyan");
  } 
  else if (mode === 'schools') {
    navSchools.classList.add('active');
    panelLeft.classList.remove('hidden');
    schoolsControls.classList.remove('hidden');
    orgControls.classList.add('hidden');
    
    pinsGroup.visible = true;
    orgPinsGroup.visible = false;
    
    btnReset.click();
    addConsoleLog("MODO ACTIVO: ESCUELAS DE CAPACITACIÓN Y DOCTRINA (COEDE).", "cyan");
  } 
  else if (mode === 'history') {
    navHistory.classList.add('active');
    panelLeft.classList.add('hidden'); // Ocultar left sidebar
    historyModule.classList.remove('hidden');
    
    addConsoleLog("MODO ACTIVO: HISTORIA Y LÍNEA DE TIEMPO DEL EJÉRCITO.", "cyan");
    initHistoryTimeline();
  } 
  else if (mode === 'cms') {
    navCms.classList.add('active');
    panelLeft.classList.add('hidden');
    cmsModule.classList.remove('hidden');
    
    addConsoleLog("MODO ACTIVO: CONFIGURADOR DE CONTENIDOS TÁCTICOS.", "yellow");
  }
}

// --- RENDERIZACIÓN DE GRÁFICO DE RADAR ---
let radarInterval = null;
let radarProgress = 0;

function initRadarAnimation(school) {
  if (radarInterval) clearInterval(radarInterval);
  radarProgress = 0;
  
  const canvas = document.getElementById('radar-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const statsKeys = school.stats ? Object.keys(school.stats) : ["Táctica", "Combate", "Tecnología", "Movilidad", "Supervivencia"];
  const statsValues = school.stats ? Object.values(school.stats) : [80, 80, 80, 80, 80];
  
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = 90;
    const totalAxes = statsKeys.length;
    
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
    
    // Ejes
    ctx.beginPath();
    for (let i = 0; i < totalAxes; i++) {
      const angle = (i * 2 * Math.PI) / totalAxes - Math.PI / 2;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
    }
    ctx.stroke();
    
    // Textos de Etiquetas
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
    
    // Polígono de estadísticas
    ctx.fillStyle = `${school.color || '#10b981'}25`;
    ctx.strokeStyle = school.color || '#10b981';
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
    
    // Nodos
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

let altVal = 4200;
let spdVal = 120;

function initMonitorSimulation(unit) {
  if (monitorAnimId) cancelAnimationFrame(monitorAnimId);
  
  monitorCanvas = document.getElementById('monitor-canvas');
  if (!monitorCanvas) return;
  monitorCtx = monitorCanvas.getContext('2d');
  
  const w = monitorCanvas.width;
  const h = monitorCanvas.height;
  
  const heatBlobs = Array.from({ length: 5 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 15 + Math.random() * 25,
    color: Math.random() > 0.5 ? 'rgba(239, 68, 68, 0.45)' : 'rgba(245, 158, 11, 0.45)',
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4
  }));

  const drawMonitor = () => {
    if (thermalMode) {
      monitorCtx.fillStyle = '#020617';
      monitorCtx.fillRect(0, 0, w, h);
      monitorCtx.fillStyle = 'rgba(16, 185, 129, 0.03)';
      monitorCtx.fillRect(0, 0, w, h);
    } else {
      monitorCtx.fillStyle = '#022c22';
      monitorCtx.fillRect(0, 0, w, h);
    }

    monitorCtx.strokeStyle = thermalMode ? 'rgba(6, 182, 212, 0.15)' : 'rgba(16, 185, 129, 0.2)';
    monitorCtx.lineWidth = 0.5;
    
    for (let x = 0; x < w; x += 20) {
      monitorCtx.beginPath();
      monitorCtx.moveTo(x, 0);
      monitorCtx.lineTo(x, h);
      monitorCtx.stroke();
    }
    for (let y = 0; y < h; y += 20) {
      monitorCtx.beginPath();
      monitorCtx.moveTo(0, y);
      monitorCtx.lineTo(w, y);
      monitorCtx.stroke();
    }

    if (thermalMode) {
      heatBlobs.forEach(blob => {
        blob.x += blob.vx;
        blob.y += blob.vy;
        
        if (blob.x - blob.r < 0 || blob.x + blob.r > w) blob.vx *= -1;
        if (blob.y - blob.r < 0 || blob.y + blob.r > h) blob.vy *= -1;
        
        const grad = monitorCtx.createRadialGradient(blob.x, blob.y, 2, blob.x, blob.y, blob.r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.2, '#f59e0b');
        grad.addColorStop(0.5, '#ef4444');
        grad.addColorStop(0.9, 'rgba(59, 130, 246, 0.15)');
        grad.addColorStop(1, 'transparent');
        
        monitorCtx.fillStyle = grad;
        monitorCtx.beginPath();
        monitorCtx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
        monitorCtx.fill();
      });
    } else {
      monitorCtx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
      monitorCtx.lineWidth = 1.5;
      
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

    if (Math.random() < 0.02) {
      targetX = w/2 + (Math.random() - 0.5) * 60;
      targetY = h/2 + (Math.random() - 0.5) * 40;
    }
    curTargetX += (targetX - curTargetX) * 0.05;
    curTargetY += (targetY - curTargetY) * 0.05;

    monitorCtx.strokeStyle = thermalMode ? '#0ea5e9' : '#10b981';
    monitorCtx.lineWidth = 1;
    
    monitorCtx.beginPath();
    monitorCtx.arc(curTargetX, curTargetY, 15, 0, Math.PI * 2);
    monitorCtx.stroke();
    
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
    
    monitorCtx.strokeRect(20, 20, w - 40, h - 40);

    monitorCtx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let i = 0; i < 400; i++) {
      const rx = Math.random() * w;
      const ry = Math.random() * h;
      monitorCtx.fillRect(rx, ry, 1, 1);
    }
    
    const scanBarY = (Date.now() * 0.08) % h;
    monitorCtx.fillStyle = 'rgba(16, 185, 129, 0.07)';
    monitorCtx.fillRect(0, scanBarY, w, 2);

    monitorCtx.fillStyle = thermalMode ? '#0ea5e9' : '#10b981';
    monitorCtx.font = '8px "Share Tech Mono"';
    monitorCtx.textAlign = 'left';
    monitorCtx.fillText("SYS: SECURE FEED", 25, 32);
    monitorCtx.fillText("TRACKING TARGET [X]", 25, 42);
    
    monitorCtx.textAlign = 'right';
    monitorCtx.fillText(`ZOOM: 16.2X`, w - 25, 32);
    monitorCtx.fillText(`FRM: 60FPS`, w - 25, 42);
    
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
  
  while (consoleLogs.children.length > 20) {
    consoleLogs.removeChild(consoleLogs.firstChild);
  }
  
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// --- INTERFAZ LÍNEA DE TIEMPO HISTÓRICA ---
let activeHistoryIndex = 0;

function initHistoryTimeline() {
  const container = document.getElementById('timeline-events-container');
  if (!container) return;
  container.innerHTML = "";
  
  historyEvents.forEach((ev, idx) => {
    const node = document.createElement('div');
    node.className = `timeline-event-node ${idx === activeHistoryIndex ? 'active' : ''}`;
    node.innerHTML = `
      <div class="event-year">${ev.year}</div>
      <div class="event-dot"></div>
      <div class="event-title-short">${ev.title.toUpperCase()}</div>
    `;
    
    node.addEventListener('click', () => {
      sounds.playClick();
      selectHistoryEvent(idx);
    });
    
    container.appendChild(node);
  });
  
  selectHistoryEvent(activeHistoryIndex);
}

function selectHistoryEvent(idx) {
  activeHistoryIndex = idx;
  
  // Actualizar nodos activos
  const nodes = document.querySelectorAll('.timeline-event-node');
  nodes.forEach((n, i) => {
    if (i === idx) n.classList.add('active');
    else n.classList.remove('active');
  });

  const ev = historyEvents[idx];
  const detailPanel = document.getElementById('timeline-detail');
  if (!detailPanel) return;
  
  detailPanel.innerHTML = `
    <img src="${ev.image}" class="timeline-detail-img" alt="${ev.title}" onerror="this.src='assets/images/infantry.jpg'">
    <div class="timeline-detail-text">
      <h3>${ev.year} • ${ev.title.toUpperCase()}</h3>
      <h4>${ev.subtitle.toUpperCase()}</h4>
      <p>${ev.desc}</p>
    </div>
  `;

  // Desplazar contenedor horizontal
  const container = document.getElementById('timeline-events-container');
  const activeNode = nodes[idx];
  if (container && activeNode) {
    const wrapper = container.parentElement;
    const scrollPos = activeNode.offsetLeft - wrapper.offsetWidth / 2 + activeNode.offsetWidth / 2;
    container.style.transform = `translateX(${-scrollPos}px)`;
  }
}

// --- INTERFAZ CMS (ADMINISTRADOR) ---
function populateCmsUnitSelector() {
  const selector = document.getElementById('cms-unit-selector');
  if (!selector) return;
  selector.innerHTML = "";
  
  // 1. Añadir Divisiones
  const optGroupDiv = document.createElement('optgroup');
  optGroupDiv.label = "DIVISIONES DE EJÉRCITO";
  orgData.divisiones.forEach(div => {
    const opt = document.createElement('option');
    opt.value = `division|${div.id}`;
    opt.textContent = div.nombre;
    optGroupDiv.appendChild(opt);
  });
  selector.appendChild(optGroupDiv);

  // 2. Añadir Brigadas
  const optGroupBrig = document.createElement('optgroup');
  optGroupBrig.label = "BRIGADAS TÁCTICAS";
  orgData.divisiones.forEach(div => {
    div.brigadas.forEach(brig => {
      const opt = document.createElement('option');
      opt.value = `brigade|${brig.id}`;
      opt.textContent = `${div.nombre.split(" ")[0]} - ${brig.nombre}`;
      optGroupBrig.appendChild(opt);
    });
  });
  selector.appendChild(optGroupBrig);

  // 3. Añadir Batallones
  const optGroupBat = document.createElement('optgroup');
  optGroupBat.label = "BATALLONES";
  orgData.divisiones.forEach(div => {
    div.brigadas.forEach(brig => {
      brig.batallones.forEach(bat => {
        const opt = document.createElement('option');
        opt.value = `battalion|${bat.id}`;
        opt.textContent = `${brig.nombre.split(" ")[0]} - ${bat.nombre}`;
        optGroupBat.appendChild(opt);
      });
    });
  });
  selector.appendChild(optGroupBat);

  // 4. Añadir Escuelas (COEDE)
  const optGroupSchool = document.createElement('optgroup');
  optGroupSchool.label = "ACADEMIAS MILITARES (COEDE)";
  schoolsData.forEach(sch => {
    const opt = document.createElement('option');
    opt.value = `school|${sch.id}`;
    opt.textContent = sch.name;
    optGroupSchool.appendChild(opt);
  });
  selector.appendChild(optGroupSchool);

  // Evento al cambiar de unidad en selector CMS
  selector.addEventListener('change', loadUnitIntoCmsForm);
  loadUnitIntoCmsForm();
}

function loadUnitIntoCmsForm() {
  const selector = document.getElementById('cms-unit-selector');
  if (!selector) return;
  const [type, id] = selector.value.split('|');
  
  const form = document.getElementById('cms-edit-form');
  const comGroup = document.getElementById('cms-commander-group');
  
  let unit = null;
  
  if (type === 'division') {
    unit = orgData.divisiones.find(d => d.id === id);
    comGroup.style.display = 'none';
  } else if (type === 'brigade') {
    orgData.divisiones.forEach(d => {
      const b = d.brigadas.find(br => br.id === id);
      if (b) unit = b;
    });
    comGroup.style.display = 'flex';
    document.querySelector('label[for="cms-commander"]').textContent = "Comandante General:";
  } else if (type === 'battalion') {
    orgData.divisiones.forEach(d => {
      d.brigadas.forEach(br => {
        const bat = br.batallones.find(bt => bt.id === id);
        if (bat) unit = bat;
      });
    });
    comGroup.style.display = 'none';
  } else if (type === 'school') {
    unit = schoolsData.find(s => s.id === id);
    comGroup.style.display = 'flex';
    document.querySelector('label[for="cms-commander"]').textContent = "Fundación (Año):";
  }

  if (unit) {
    document.getElementById('cms-name').value = unit.nombre || unit.name || "";
    document.getElementById('cms-motto').value = unit.lema || unit.motto || "";
    document.getElementById('cms-commander').value = unit.comandante || unit.founded || "";
    document.getElementById('cms-lat').value = unit.coords ? unit.coords.lat : "";
    document.getElementById('cms-lng').value = unit.coords ? unit.coords.lng : "";
    document.getElementById('cms-description').value = unit.reseña || unit.description || "";
    document.getElementById('cms-audio').value = unit.audio || "";
  }
}

function saveCmsChanges(e) {
  e.preventDefault();
  sounds.playSweep();

  const selector = document.getElementById('cms-unit-selector');
  const [type, id] = selector.value.split('|');
  
  const nameVal = document.getElementById('cms-name').value;
  const mottoVal = document.getElementById('cms-motto').value;
  const comVal = document.getElementById('cms-commander').value;
  const latVal = parseFloat(document.getElementById('cms-lat').value);
  const lngVal = parseFloat(document.getElementById('cms-lng').value);
  const descVal = document.getElementById('cms-description').value;
  const audioVal = document.getElementById('cms-audio').value;

  if (type === 'school') {
    const idx = schoolsData.findIndex(s => s.id === id);
    if (idx !== -1) {
      schoolsData[idx].name = nameVal;
      schoolsData[idx].motto = mottoVal;
      schoolsData[idx].founded = parseInt(comVal) || schoolsData[idx].founded;
      if (schoolsData[idx].coords) {
        schoolsData[idx].coords.lat = latVal;
        schoolsData[idx].coords.lng = lngVal;
      }
      schoolsData[idx].description = descVal;
      schoolsData[idx].audio = audioVal;
      
      localStorage.setItem('ejercito_mvp_schools_data', JSON.stringify(schoolsData));
      
      // Recrear pines
      createSchoolPins();
    }
  } else {
    // Buscar en estructura orgánica
    if (type === 'division') {
      const idx = orgData.divisiones.findIndex(d => d.id === id);
      if (idx !== -1) {
        orgData.divisiones[idx].nombre = nameVal;
        orgData.divisiones[idx].lema = mottoVal;
        if (orgData.divisiones[idx].coords) {
          orgData.divisiones[idx].coords.lat = latVal;
          orgData.divisiones[idx].coords.lng = lngVal;
        }
        orgData.divisiones[idx].reseña = descVal;
        orgData.divisiones[idx].audio = audioVal;
      }
    } else if (type === 'brigade') {
      orgData.divisiones.forEach((d, dIdx) => {
        const bIdx = d.brigadas.findIndex(br => br.id === id);
        if (bIdx !== -1) {
          orgData.divisiones[dIdx].brigadas[bIdx].nombre = nameVal;
          orgData.divisiones[dIdx].brigadas[bIdx].lema = mottoVal;
          orgData.divisiones[dIdx].brigadas[bIdx].comandante = comVal;
          orgData.divisiones[dIdx].brigadas[bIdx].reseña = descVal;
          orgData.divisiones[dIdx].brigadas[bIdx].audio = audioVal;
        }
      });
    } else if (type === 'battalion') {
      orgData.divisiones.forEach((d, dIdx) => {
        d.brigadas.forEach((br, bIdx) => {
          const batIdx = br.batallones.findIndex(bt => bt.id === id);
          if (batIdx !== -1) {
            orgData.divisiones[dIdx].brigadas[bIdx].batallones[batIdx].nombre = nameVal;
            orgData.divisiones[dIdx].brigadas[bIdx].batallones[batIdx].lema = mottoVal;
            if (orgData.divisiones[dIdx].brigadas[bIdx].batallones[batIdx].coords) {
              orgData.divisiones[dIdx].brigadas[bIdx].batallones[batIdx].coords.lat = latVal;
              orgData.divisiones[dIdx].brigadas[bIdx].batallones[batIdx].coords.lng = lngVal;
            }
            orgData.divisiones[dIdx].brigadas[bIdx].batallones[batIdx].reseña = descVal;
            orgData.divisiones[dIdx].brigadas[bIdx].batallones[batIdx].audio = audioVal;
          }
        });
      });
    }
    
    localStorage.setItem('ejercito_mvp_org_data', JSON.stringify(orgData));
    
    // Recrear pines orgánicos y repoblar árbol
    createOrganicPins();
    populateOrganicTree();
  }

  addConsoleLog(`[CMS] CAMBIOS REGISTRADOS Y APLICADOS EN ${nameVal.toUpperCase()}`, "green");
  
  // Switch back to the modified mode to see changes
  if (type === 'school') {
    switchMode('schools');
    selectSchool(id);
  } else {
    switchMode('org');
    selectOrganicUnit(type, id);
  }
}

// --- EVENTOS Y BINDINGS ---
function setupEventListeners() {
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('click', onClick);
  
  // Navigation Tabs Switcher
  navOrg.addEventListener('click', () => { sounds.playClick(); switchMode('org'); });
  navSchools.addEventListener('click', () => { sounds.playClick(); switchMode('schools'); });
  navHistory.addEventListener('click', () => { sounds.playClick(); switchMode('history'); });
  navCms.addEventListener('click', () => { sounds.playClick(); switchMode('cms'); });

  // Close full modules
  document.getElementById('btn-close-history').addEventListener('click', () => {
    sounds.playClick();
    switchMode('org');
  });
  
  document.getElementById('btn-close-cms').addEventListener('click', () => {
    sounds.playClick();
    switchMode('org');
  });

  // CMS Form Submit
  document.getElementById('cms-edit-form').addEventListener('submit', saveCmsChanges);
  
  // CMS Reset DB
  document.getElementById('cms-btn-reset-db').addEventListener('click', () => {
    sounds.playSweep();
    localStorage.removeItem('ejercito_mvp_schools_data');
    localStorage.removeItem('ejercito_mvp_org_data');
    addConsoleLog("[SISTEMA] RESTABLECIENDO BASE DE DATOS DE FÁBRICA. REINICIANDO...", "yellow");
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  });

  // Play Button en Reproductor HUD
  playerPlayBtn.addEventListener('click', () => {
    sounds.playClick();
    toggleUnitAudio();
  });

  // Resetear Vista General
  btnReset.addEventListener('click', () => {
    sounds.playClick();
    addConsoleLog("CÁMARA RESTABLECIDA A VISTA TÁCTICA GLOBAL PERÚ.", "cyan");
    
    targetCameraPos.set(0, 18, 14);
    targetCameraLookAt.set(0, -1, 0);
    
    panelDetails.classList.add('hidden');
    hudAudioElement.pause();
    sounds.stopSynthVoice();
    
    selectedSchool = null;
    selectedOrgUnit = null;
    
    // Quitar active de lista escuelas
    if (departmentList) {
      const activeLi = departmentList.querySelector('li.active');
      if (activeLi) activeLi.classList.remove('active');
    }
    
    // Quitar active de árbol orgánico
    const treeContainer = document.getElementById('org-tree');
    if (treeContainer) {
      treeContainer.querySelectorAll('.tree-node.active, .tree-subnode.active').forEach(n => {
        n.classList.remove('active');
      });
    }
    
    // Resetear highlights del mapa
    if (hoveredDepartment) {
      resetDepartmentHighlight(hoveredDepartment);
      hoveredDepartment = null;
    } else {
      // Apagar todos los emisivos
      Object.keys(departmentsData).forEach(deptName => {
        departmentsData[deptName].meshes.forEach(mesh => {
          mesh.material.emissive.setHex(0x021626);
          mesh.material.opacity = 0.82;
        });
      });
    }

    pinsGroup.children.forEach(p => p.userData.head.scale.set(1, 1, 1));
    orgPinsGroup.children.forEach(p => p.userData.head.scale.set(1, 1, 1));
  });
  
  // Alternar Audio General
  btnAudio.addEventListener('click', () => {
    const isEnabled = btnAudio.classList.contains('active');
    if (isEnabled) {
      btnAudio.classList.remove('active');
      document.getElementById('audio-status').textContent = "OFF";
      sounds.toggle(false);
      hudAudioElement.muted = true;
    } else {
      sounds.init();
      btnAudio.classList.add('active');
      document.getElementById('audio-status').textContent = "ON";
      sounds.toggle(true);
      sounds.playClick();
      hudAudioElement.muted = false;
    }
  });

  document.body.addEventListener('click', () => {
    if (!sounds.ctx && btnAudio.classList.contains('active')) {
      sounds.init();
      btnAudio.classList.add('active');
      document.getElementById('audio-status').textContent = "ON";
    }
  }, { once: true });
  
  btnAudio.classList.add('active');

  // Filtros de Especialidad para escuelas
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sounds.playClick();
      
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const specialty = btn.dataset.specialty;
      filterPinsBySpecialty(specialty);
      addConsoleLog(`[FILTRO COEDE] APLICADO: ${specialty.toUpperCase()}`, "yellow");
    });
  });
  
  // Buscador de Escuelas y Departamentos
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const value = e.target.value.toLowerCase().trim();
      
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
    hudAudioElement.pause();
    sounds.stopSynthVoice();
    
    const videoEl = document.getElementById('school-video');
    videoEl.pause();
    
    selectedSchool = null;
    selectedOrgUnit = null;
    pinsGroup.children.forEach(p => p.userData.head.scale.set(1, 1, 1));
    orgPinsGroup.children.forEach(p => p.userData.head.scale.set(1, 1, 1));
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

  // Conmutador térmico del monitor FLIR
  document.getElementById('btn-thermal-toggle').addEventListener('click', () => {
    sounds.playClick();
    thermalMode = !thermalMode;
    addConsoleLog(`[MONITOR FLIR] CONMUTANDO FILTRO: MODO ${thermalMode ? 'TERMOGRÁFICO' : 'CRT VISIÓN NOCTURNA'}.`, "cyan");
  });
  
  // Recalibrar monitor
  document.getElementById('btn-monitor-reset').addEventListener('click', () => {
    sounds.playSweep();
    addConsoleLog("[MONITOR FLIR] INICIANDO CALIBRACIÓN DEL SENSOR...", "yellow");
    altVal = 4200 + Math.floor(Math.random() * 200);
    spdVal = 110 + Math.floor(Math.random() * 20);
  });

  // Línea de Tiempo Evento Prev y Next
  document.getElementById('btn-timeline-prev').addEventListener('click', () => {
    if (activeHistoryIndex > 0) {
      sounds.playClick();
      selectHistoryEvent(activeHistoryIndex - 1);
    }
  });

  document.getElementById('btn-timeline-next').addEventListener('click', () => {
    if (activeHistoryIndex < historyEvents.length - 1) {
      sounds.playClick();
      selectHistoryEvent(activeHistoryIndex + 1);
    }
  });
}

function filterPinsBySpecialty(specialty) {
  pinsGroup.children.forEach(pin => {
    const school = pin.userData.school;
    const isVisible = (specialty === 'all' || school.specialty_key === specialty);
    pin.visible = isVisible;
    const label = pin.userData.labelDiv;
    if (label) {
      label.style.opacity = isVisible ? "1" : "0";
    }
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Raycasting e Interacción del Ratón
function onMouseMove(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  
  const mapLat = (mouse.y * 10 - 9.19).toFixed(5);
  const mapLng = (mouse.x * 10 - 74.87).toFixed(5);
  if (mouseCoordsEl) mouseCoordsEl.textContent = `LAT: ${mapLat} | LNG: ${mapLng}`;
  
  raycaster.setFromCamera(mouse, camera);
  
  // Realizar Raycast sobre pines activos
  const activePinsGroup = (currentMode === 'schools') ? pinsGroup : orgPinsGroup;
  const activeInteractionMeshes = pinInteractionMeshes.filter(mesh => {
    if (currentMode === 'schools') return mesh.userData.isSchool === true;
    return mesh.userData.isOrg === true;
  });

  const pinIntersects = raycaster.intersectObjects(activeInteractionMeshes);
  
  if (pinIntersects.length > 0) {
    const clickedSensor = pinIntersects[0].object;
    
    if (currentMode === 'schools') {
      const schoolId = clickedSensor.userData.schoolId;
      const school = schoolsData.find(s => s.id === schoolId);
      if (school) {
        tooltip.classList.remove('hidden');
        tooltip.style.left = `${event.clientX}px`;
        tooltip.style.top = `${event.clientY}px`;
        tooltip.innerHTML = `
          <div style="font-weight:bold;color:${school.color}">${school.name}</div>
          <div style="font-size:11px;color:#94a3b8">${school.specialty} - ${school.department}</div>
        `;
        
        clickedSensor.userData.parentGroup.userData.head.scale.set(1.2, 1.2, 1.2);
        
        if (window.lastHoveredItem !== schoolId) {
          sounds.playHover();
          window.lastHoveredItem = schoolId;
        }
        document.body.style.cursor = 'pointer';
        return;
      }
    } else {
      // Modo Orgánico
      const unitId = clickedSensor.userData.unitId;
      const unitType = clickedSensor.userData.orgType;
      
      let unitName = "";
      let unitDesc = "";
      
      if (unitType === 'division') {
        const div = orgData.divisiones.find(d => d.id === unitId);
        if (div) {
          unitName = div.nombre;
          unitDesc = `Sede: C.G. ${div.cuartel_general}`;
        }
      } else {
        orgData.divisiones.forEach(d => {
          d.brigadas.forEach(br => {
            const bat = br.batallones.find(bt => bt.id === unitId);
            if (bat) {
              unitName = bat.nombre;
              unitDesc = `Batallón de Combate - ${d.cuartel_general}`;
            }
          });
        });
      }

      if (unitName) {
        tooltip.classList.remove('hidden');
        tooltip.style.left = `${event.clientX}px`;
        tooltip.style.top = `${event.clientY}px`;
        tooltip.innerHTML = `
          <div style="font-weight:bold;color:var(--neon-cyan)">${unitName}</div>
          <div style="font-size:11px;color:#94a3b8">${unitDesc}</div>
        `;
        
        clickedSensor.userData.parentGroup.userData.head.scale.set(1.2, 1.2, 1.2);
        
        if (window.lastHoveredItem !== unitId) {
          sounds.playHover();
          window.lastHoveredItem = unitId;
        }
        document.body.style.cursor = 'pointer';
        return;
      }
    }
  }

  // Desescalar pines no hovered
  activePinsGroup.children.forEach(p => {
    const isSelected = (currentMode === 'schools') 
      ? (selectedSchool && p.userData.schoolId === selectedSchool.id)
      : (selectedOrgUnit && p.userData.unitId === selectedOrgUnit.id);
      
    if (!isSelected) {
      p.userData.head.scale.set(1, 1, 1);
    }
  });
  
  // Raycast sobre mallas del mapa (Departamentos)
  const mapIntersects = raycaster.intersectObjects(departmentMeshes);
  
  if (mapIntersects.length > 0) {
    const mesh = mapIntersects[0].object;
    const deptName = mesh.userData.deptName;
    const normName = normalizeString(deptName);
    
    document.body.style.cursor = 'pointer';
    
    if (currentMode === 'schools') {
      // Modo Escuelas: Resaltar departamento individual
      if (hoveredDepartment !== normName) {
        if (hoveredDepartment) resetDepartmentHighlight(hoveredDepartment);
        
        const data = departmentsData[normName];
        if (data) {
          data.meshes.forEach(m => m.material.emissive.setHex(0x0c3a2f));
        }
        
        hoveredDepartment = normName;
        addConsoleLog(`APUNTANDO ESCANER TÁCTICO A SECTOR: ${normName}`, "yellow");
        sounds.playHover();
        window.lastHoveredItem = deptName;
      }
      
      const count = departmentsData[normName] ? departmentsData[normName].count : 0;
      tooltip.classList.remove('hidden');
      tooltip.style.left = `${event.clientX}px`;
      tooltip.style.top = `${event.clientY}px`;
      tooltip.innerHTML = `
        <div style="font-weight:bold;color:var(--neon-green)">SECTOR: ${normName}</div>
        <div style="font-size:11px;color:#94a3b8">${count} Escuela(s) Detectada(s)</div>
      `;
    } else {
      // Modo Orgánico: Resaltar jurisdicción de división agrupada
      // Buscar a qué división pertenece este departamento
      let divId = null;
      let divName = "";
      if (jurisdiccionData) {
        const division = jurisdiccionData.ejercito_peru_jurisdicciones.divisiones.find(d => 
          d.departamentos_abarcados.map(dep => normalizeString(dep)).includes(normName)
        );
        if (division) {
          divId = division.id_division;
          divName = division.nombre;
        }
      }

      if (divId) {
        if (hoveredDepartment !== divId) {
          highlightDivisionJurisdiction(divId);
          hoveredDepartment = divId; // Guardamos el ID de la división como hovered
          addConsoleLog(`SECTOR SOBRE JURISDICCIÓN: ${divName.toUpperCase()}`, "yellow");
          sounds.playHover();
          window.lastHoveredItem = divId;
        }

        tooltip.classList.remove('hidden');
        tooltip.style.left = `${event.clientX}px`;
        tooltip.style.top = `${event.clientY}px`;
        tooltip.innerHTML = `
          <div style="font-weight:bold;color:var(--neon-cyan)">JURISDICCIÓN SECTOR</div>
          <div style="font-size:11px;color:#94a3b8">${divName}</div>
          <div style="font-size:10px;color:rgba(16, 185, 129, 0.7)">Clic para desplegar brigadas</div>
        `;
      }
    }
  } else {
    document.body.style.cursor = 'default';
    tooltip.classList.add('hidden');
    
    if (hoveredDepartment) {
      if (currentMode === 'schools') {
        resetDepartmentHighlight(hoveredDepartment);
      } else {
        // En modo orgánico apagar emisivos si no hay unidad seleccionada
        if (!selectedOrgUnit) {
          Object.keys(departmentsData).forEach(deptName => {
            departmentsData[deptName].meshes.forEach(mesh => {
              mesh.material.emissive.setHex(0x021626);
              mesh.material.opacity = 0.82;
            });
          });
        } else {
          // Mantener resaltado de la unidad seleccionada
          highlightDivisionJurisdiction(selectedOrgUnit.parentDivision.id);
        }
      }
      hoveredDepartment = null;
      window.lastHoveredItem = null;
    }
  }
}

// Clics del Ratón
function onClick(event) {
  if (event.target.tagName !== 'CANVAS' || event.target.id !== 'canvas-container' && event.target.parentNode.id !== 'canvas-container') {
    return;
  }
  
  raycaster.setFromCamera(mouse, camera);
  
  const activeInteractionMeshes = pinInteractionMeshes.filter(mesh => {
    if (currentMode === 'schools') return mesh.userData.isSchool === true;
    return mesh.userData.isOrg === true;
  });

  const pinIntersects = raycaster.intersectObjects(activeInteractionMeshes);
  if (pinIntersects.length > 0) {
    sounds.playClick();
    tooltip.classList.add('hidden');
    const sensor = pinIntersects[0].object;
    
    if (currentMode === 'schools') {
      selectSchool(sensor.userData.schoolId);
    } else {
      selectOrganicUnit(sensor.userData.orgType, sensor.userData.unitId);
    }
    return;
  }
  
  const mapIntersects = raycaster.intersectObjects(departmentMeshes);
  if (mapIntersects.length > 0) {
    sounds.playClick();
    tooltip.classList.add('hidden');
    const deptName = mapIntersects[0].object.userData.deptName;
    const normName = normalizeString(deptName);

    if (currentMode === 'schools') {
      selectDepartment(deptName);
    } else {
      // Clic en departamento en modo orgánico: Seleccionar su división respectiva
      let divId = null;
      if (jurisdiccionData) {
        const division = jurisdiccionData.ejercito_peru_jurisdicciones.divisiones.find(d => 
          d.departamentos_abarcados.map(dep => normalizeString(dep)).includes(normName)
        );
        if (division) divId = division.id_division;
      }
      if (divId) {
        // Buscar el nodo en el árbol orgánico y activarlo
        const node = document.querySelector(`.tree-node[data-id="${divId}"]`);
        if (node) {
          node.classList.add('expanded');
          node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        selectOrganicUnit('division', divId);
      }
    }
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
    const ms = pad(Math.floor(now.getMilliseconds() / 10));
    
    clockDisplay.textContent = `${hrs}:${mins}:${secs}:${ms}`;
  }, 35);
}

// --- KIOSK MODE: INACTIVITY TIMEOUT ---
let inactivityTimer = null;
const INACTIVITY_LIMIT = 60000;

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    if (selectedSchool || selectedOrgUnit || hoveredDepartment) {
      addConsoleLog("SISTEMA RESTABLECIDO POR INACTIVIDAD (MODO KIOSCO).", "yellow");
      btnReset.click();
    }
    
    if (searchInput && document.activeElement === searchInput) {
      searchInput.blur();
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
    }
  }, INACTIVITY_LIMIT);
}

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
  controls.update();
  
  camera.position.lerp(targetCameraPos, 0.06);
  currentCameraLookAt.lerp(targetCameraLookAt, 0.06);
  controls.target.copy(currentCameraLookAt);
  
  animatePins(delta);
  updateLabels();
  
  renderer.render(scene, camera);
}

window.addEventListener('DOMContentLoaded', init);
