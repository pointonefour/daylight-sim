// main.js — Startup and Initialization for the Simulator

window.onload = () => {
  // 1. Setup canvas and first draw
  initCanvas();

  // 2. Attach mouse listeners
  initMouseEvents();

  // 3. Resize on window change
  window.addEventListener('resize', initCanvas);

  // 4. Restore last session from localStorage
  const restored = simRestore();

  // 5. If nothing restored, add a default mirror
  if (!restored) {
    addComp('parabolic');
  } else {
    // Redraw with restored state
    renderList();
    draw();
  }
  if (typeof pushState === 'function') pushState();

  // 6. Start 3D Globe
  if (typeof initGlobe === 'function') {
    initGlobe();
  }

  // 7. Start listening for Drag-and-Drop .dlsim files!
  if (typeof initProjectDragDrop === 'function') {
    initProjectDragDrop();
  }

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) { if (typeof redo === 'function') redo(); } 
      else { if (typeof undo === 'function') undo(); }
    }
  });
  
};