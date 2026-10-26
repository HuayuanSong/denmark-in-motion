/** Continuous SVG navigation. Coordinates stay in the untransformed SVG frame. */
export function createMapNavigation(svg, content, {onChange = () => {}} = {}) {
  const width = 900, height = 720, minZoom = 1, maxZoom = 32;
  const pointers = new Map();
  let view = {x: 0, y: 0, k: 1}, target = {...view};
  let frame = 0, lastFrame = 0, gesture = null, moved = false, ignoreClickUntil = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a, b) => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});

  function svgPoint(clientX, clientY) {
    return new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
  }
  function bounded(next) {
    const k = clamp(next.k, minZoom, maxZoom);
    // Allow movement even at the country view, while keeping the map recoverable.
    return {k, x: clamp(next.x, width * (1 - k) - width * .35, width * .35),
      y: clamp(next.y, height * (1 - k) - height * .35, height * .35)};
  }
  function paint() {
    content.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
    const scale = view.k * svg.getScreenCTM().a;
    content.style.setProperty('--map-scale', scale);
    svg.dataset.zoom = view.k.toFixed(4);
    onChange({...view, scale});
  }
  function stopAnimation() {
    cancelAnimationFrame(frame); frame = 0; lastFrame = 0; target = {...view};
  }
  function tick(now) {
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    const amount = 1 - Math.exp(-dt / 65);
    for (const key of ['x', 'y', 'k']) view[key] += (target[key] - view[key]) * amount;
    if (Math.abs(target.x - view.x) + Math.abs(target.y - view.y) < .02 && Math.abs(target.k - view.k) < .0001) {
      view = {...target}; frame = 0; lastFrame = 0;
    } else frame = requestAnimationFrame(tick);
    paint();
  }
  function setView(next, animate = false) {
    target = bounded(next);
    if (animate && !reducedMotion.matches) {
      if (!frame) frame = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(frame); frame = 0; lastFrame = 0;
      view = {...target}; paint();
    }
  }
  function zoom(factor, point = {x: width / 2, y: height / 2}, animate = true) {
    const base = animate ? target : view;
    const k = clamp(base.k * factor, minZoom, maxZoom), ratio = k / base.k;
    setView({k, x: point.x - (point.x - base.x) * ratio,
      y: point.y - (point.y - base.y) * ratio}, animate);
  }
  function rebase() {
    const values = [...pointers.values()].slice(0, 2);
    if (!values.length) { gesture = null; return; }
    const points = values.map(p => svgPoint(p.x, p.y));
    gesture = {view: {...view}, midpoint: points.length === 2 ? midpoint(...points) : points[0],
      distance: points.length === 2 ? Math.max(1, distance(...values)) : null,
      start: values[0]};
  }
  function capturePointers() {
    for (const id of pointers.keys()) if (!svg.hasPointerCapture(id)) svg.setPointerCapture(id);
  }
  function setDragging(value) { svg.classList.toggle('is-dragging', value); }

  svg.addEventListener('wheel', event => {
    if (pointers.size) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1;
    const exponent = clamp(-event.deltaY * unit * (event.ctrlKey ? .01 : .002), -.5, .5);
    zoom(Math.exp(exponent), svgPoint(event.clientX, event.clientY));
  }, {passive: false});
  svg.addEventListener('dblclick', event => {
    if (ignoreClickUntil > performance.now()) return;
    event.preventDefault();
    zoom(event.shiftKey ? .5 : 2, svgPoint(event.clientX, event.clientY));
  });
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointers.size >= 2) return;
    stopAnimation();
    if (!pointers.size) { moved = false; ignoreClickUntil = 0; }
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (pointers.size > 1) { moved = true; capturePointers(); setDragging(true); }
    rebase();
    // Mouse focus enables keyboard navigation without changing page scroll.
    if (event.pointerType === 'mouse') svg.focus({preventScroll: true});
  });
  window.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    const values = [...pointers.values()].slice(0, 2);
    if (!moved && distance(values[0], gesture.start) < 5) return;
    moved = true; capturePointers(); setDragging(true);
    const points = values.map(p => svgPoint(p.x, p.y));
    const centre = points.length === 2 ? midpoint(...points) : points[0];
    const k = gesture.distance === null ? gesture.view.k
      : clamp(gesture.view.k * distance(...values) / gesture.distance, minZoom, maxZoom);
    const ratio = k / gesture.view.k;
    setView({k, x: centre.x - (gesture.midpoint.x - gesture.view.x) * ratio,
      y: centre.y - (gesture.midpoint.y - gesture.view.y) * ratio});
  });
  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (moved || event.type !== 'pointerup') ignoreClickUntil = performance.now() + 400;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    rebase();
    if (!pointers.size) setDragging(false);
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  svg.addEventListener('lostpointercapture', event => {
    // Touch starts with implicit capture on a path. Moving that capture to the
    // SVG is part of a drag, not a cancelled pointer.
    if (event.target === svg && !svg.hasPointerCapture(event.pointerId)) endPointer(event);
  });
  window.addEventListener('blur', () => {
    pointers.clear(); gesture = null; moved = false; ignoreClickUntil = performance.now() + 400;
    setDragging(false);
  });
  // A drag or pinch must never become a municipality selection on release.
  svg.addEventListener('click', event => {
    if (ignoreClickUntil > performance.now()) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  svg.addEventListener('dragstart', event => event.preventDefault());
  svg.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 100 : 45;
    const directions = {ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step]};
    if (directions[event.key]) {
      const [x, y] = directions[event.key];
      setView({...target, x: target.x + x, y: target.y + y}, true);
    } else if (event.key === '+' || event.key === '=') zoom(1.5);
    else if (event.key === '-' || event.key === '_') zoom(1 / 1.5);
    else if (event.key === 'Home' || event.key === '0') setView({x: 0, y: 0, k: 1}, true);
    else return;
    event.preventDefault();
  });

  new ResizeObserver(paint).observe(svg);
  paint();
  return {
    zoom,
    reset: (animate = true) => setView({x: 0, y: 0, k: 1}, animate),
    focus: (point, k = Math.max(view.k, 4)) => setView({k, x: width / 2 - point.x * k, y: height / 2 - point.y * k}, true),
    refresh: paint,
    get interacting() { return pointers.size > 0; },
    get scale() { return view.k; }
  };
}
