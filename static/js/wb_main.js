// wb_main.js — Workbench entry point only
// Each function is exported in the file where it is DEFINED.
// This file only owns: wbResize

function wbResize() {
  const wrap   = document.getElementById('wb-canvas-wrap');
  const canvas = document.getElementById('wb-canvas');
  WB.dpr  = window.devicePixelRatio || 1;
  WB.cssW = wrap.clientWidth;
  WB.cssH = wrap.clientHeight;
  canvas.style.width  = WB.cssW + 'px';
  canvas.style.height = WB.cssH + 'px';
  canvas.width  = Math.round(WB.cssW * WB.dpr);
  canvas.height = Math.round(WB.cssH * WB.dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(WB.dpr, WB.dpr);
  wbDraw();
}

window.addEventListener('resize', wbResize);

window.onload = () => {
  wbResize();
  wbInitMouse();

  const restored = wbRestore();
  wbRenderList();
  wbRenderParams();
  wbRenderLibrary();
  wbRenderDatasheet();

  if (!restored) {
    wbAddMirror('parabolic');
  } else {
    if (WB.mirrors.length > 0) {
      wbSelect(WB.mirrors[0].id);
      wbRenderList();
      wbRenderParams();
    }
    wbDraw();
  }
if (typeof wbPushState === 'function') wbPushState();
};

document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) { if (typeof wbRedo === 'function') wbRedo(); } 
      else { if (typeof wbUndo === 'function') wbUndo(); }
    }
  });

window.wbResize = wbResize;