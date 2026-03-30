// globe.js — Unlit Vector 3D Earth Gizmo

let globeScene, globeCamera, globeRenderer, globeControls;
let oceanMesh, landMesh, pinMesh, globeGroup;
const globeRaycaster = new THREE.Raycaster();
const globeMouse = new THREE.Vector2();

function initGlobe() {
  const container = document.getElementById('globe-container');
  const w = container.clientWidth;
  const h = container.clientHeight;

  // 1. Setup Scene, Camera, Renderer
  globeScene = new THREE.Scene();
  globeCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  globeCamera.position.z = 3.5;

  globeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  globeRenderer.setSize(w, h);
  globeRenderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(globeRenderer.domElement);

  // 2. Orbit Controls
  globeControls = new THREE.OrbitControls(globeCamera, globeRenderer.domElement);
  globeControls.minDistance = 1.5;
  globeControls.maxDistance = 5.0;
  globeControls.enableDamping = true;
  globeControls.dampingFactor = 0.05;
  globeControls.enablePan = false; // Prevent dragging globe off-screen

  // Group to hold the layers together
  globeGroup = new THREE.Group();
  globeScene.add(globeGroup);

  // 3. Inner Sphere (The "Ocean" Background)
  // High segment count (64, 64) prevents geometric pinching at the poles
  const oceanGeo = new THREE.SphereGeometry(0.99, 64, 64);
  const oceanMat = new THREE.MeshBasicMaterial({ color: 0xDDFDFF }); // Light grey oceans
  oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  globeGroup.add(oceanMesh);

  // 4. Outer Sphere (The "Land" Map)
  const landGeo = new THREE.SphereGeometry(1.0, 64, 64);
  const textureLoader = new THREE.TextureLoader();
  
  // MeshBasicMaterial = No lighting, pure flat color (vector style)
  const landMat = new THREE.MeshBasicMaterial({ 
      transparent: true,
      opacity: 1.0,
      color: 0x000000 // In case the PNG is white, we force it dark. If it's already black, it stays black.
  });

  textureLoader.load('/static/textures/960px-BlankMap-Equirectangular.svg.png', function(tex) {
      // These two lines prevent the blurry texture stretching at the poles!
      tex.anisotropy = globeRenderer.capabilities.getMaxAnisotropy();
      tex.minFilter = THREE.LinearFilter;
      
      landMat.map = tex;
      landMat.needsUpdate = true;
  });

  landMesh = new THREE.Mesh(landGeo, landMat);
  globeGroup.add(landMesh);

  // 5. Create the Red Pin
  const pinGeo = new THREE.SphereGeometry(0.06, 16, 16);
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xff4444 }); // Pure flat red
  pinMesh = new THREE.Mesh(pinGeo, pinMat);
  globeGroup.add(pinMesh);

  // 6. Place the initial pin based on the HTML slider
  const initialLat = parseFloat(document.getElementById('lat').value);
  updatePinPosition(initialLat, 0); // Default long to 0

  // 7. Start Animation Loop
  animateGlobe();

  // 8. Add click listener to pick new latitude
  container.addEventListener('mousedown', onGlobeClick);
}

function animateGlobe() {
  requestAnimationFrame(animateGlobe);
  globeControls.update(); // Handle mouse dragging
  globeRenderer.render(globeScene, globeCamera);
}

// Math: Convert Lat/Lon to 3D Sphere Surface
function updatePinPosition(latDeg, lonDeg) {
  const phi = (90 - latDeg) * (Math.PI / 180);
  const theta = (lonDeg + 180) * (Math.PI / 180);
  const radius = 1.0; 

  pinMesh.position.x = -(radius * Math.sin(phi) * Math.cos(theta));
  pinMesh.position.y = (radius * Math.cos(phi));
  pinMesh.position.z = (radius * Math.sin(phi) * Math.sin(theta));
}

function onGlobeClick(event) {
  const container = document.getElementById('globe-container');
  const rect = container.getBoundingClientRect();
  
  globeMouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
  globeMouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

  globeRaycaster.setFromCamera(globeMouse, globeCamera);
  
  // Check if we clicked the Land or the Ocean
  const intersects = globeRaycaster.intersectObjects([landMesh, oceanMesh]);

  if (intersects.length > 0) {
    const pt = intersects[0].point.normalize(); // Ensure exact radius of 1.0

    // Reverse-engineer Latitude and Longitude strictly from the 3D hit point
    const phi = Math.acos(pt.y); 
    const theta = Math.atan2(pt.z, -pt.x);

    const latDeg = 90 - (phi * (180 / Math.PI));
    const lonDeg = (theta * (180 / Math.PI)) - 180;
    
    // 1. Move Pin
    updatePinPosition(latDeg, lonDeg);

    // 2. Update HTML Slider & Text
    const latSlider = document.getElementById('lat');
    latSlider.value = latDeg.toFixed(1);
    document.getElementById('latv').textContent = latSlider.value + '°';

    const label = document.getElementById('globe-label');
    label.textContent = `${Math.abs(latDeg).toFixed(1)}° ${latDeg >= 0 ? 'N' : 'S'}`;
    label.style.color = '#000000'; // Flash bright white
    
    // Reset back to normal after 2 seconds
    setTimeout(() => {
      label.textContent = 'SET LOCATION';
      label.style.color = '#357cff';
    }, 2000);

    // 3. Redraw the 2D Raytracer Scene
    if(window.draw) window.draw();
  }
}

// ── GLOBAL EXPORTS ──
window.initGlobe = initGlobe;
window.updatePinPosition = updatePinPosition;