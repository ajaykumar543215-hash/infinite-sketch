import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { 
  Layers, 
  Plus, 
  Trash2, 
  Eye, 
  EyeOff, 
  Move, 
  PenTool, 
  Eraser, 
  Grid, 
  Settings, 
  Lock,
  Unlock,
  Hand,
  Lasso,
  Edit3,
  Check
} from 'lucide-react';

// --- Constants & Types ---
const TOOLS = {
  PEN: 'pen',
  HARD_PENCIL: 'hard_pencil',
  SOFT_PENCIL: 'soft_pencil',
  MARKER: 'marker',
  ERASER: 'eraser',
  LASSO: 'lasso',
  PAN: 'pan',
  MOVE_LAYER: 'move_layer',
};

const BRUSH_PRESETS = {
  [TOOLS.PEN]: { size: 3, opacity: 1, smoothing: 0.5, texture: false },
  [TOOLS.HARD_PENCIL]: { size: 2, opacity: 0.9, smoothing: 0.1, texture: true },
  [TOOLS.SOFT_PENCIL]: { size: 6, opacity: 0.5, smoothing: 0.2, texture: true },
  [TOOLS.MARKER]: { size: 15, opacity: 0.4, smoothing: 0.6, texture: false },
  [TOOLS.ERASER]: { size: 20, opacity: 1, smoothing: 0.5, texture: false },
  [TOOLS.LASSO]: { size: 1, opacity: 1, smoothing: 0, texture: false },
};

const GRID_TYPES = {
  NONE: 'none',
  DOT: 'dot',
  LINE: 'line',
  ISOMETRIC: 'isometric'
};

const generateId = () => Math.random().toString(36).substr(2, 9);

// Helper: Point in Polygon (Ray casting algorithm)
const isPointInPolygon = (point, vs) => {
    let x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i].x, yi = vs[i].y;
        let xj = vs[j].x, yj = vs[j].y;
        let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

// Helper: Check if stroke is inside lasso
const isStrokeInLasso = (stroke, lassoPoints, layerOffset) => {
    if (!lassoPoints || lassoPoints.length < 3) return false;
    // Check if any point of the stroke is inside the lasso polygon
    return stroke.points.some(p => isPointInPolygon(p, lassoPoints));
};

// Helper: Noise Texture
const createNoisePattern = () => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  
  const imgData = ctx.createImageData(64, 64);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const val = Math.random() * 255;
    data[i] = val; 
    data[i + 1] = val; 
    data[i + 2] = val; 
    data[i + 3] = 100; 
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
};

export default function InfiniteSketch() {
  // --- State ---
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const [layers, setLayers] = useState([
    { id: 'layer-1', name: 'Ink Layer', visible: true, locked: false, strokes: [], offset: { x: 0, y: 0 } }
  ]);
  const [activeLayerId, setActiveLayerId] = useState('layer-1');

  // Tools
  const [activeTool, setActiveTool] = useState(TOOLS.PEN);
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(3);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushSmoothing, setBrushSmoothing] = useState(0.5);
  const [usePressure, setUsePressure] = useState(true);
  
  // Environment
  const [bgColor, setBgColor] = useState('#ffffff');
  const [gridConfig, setGridConfig] = useState({ type: GRID_TYPES.DOT, size: 40, opacity: 0.15, color: '#000000' });
  
  // Selection / Lasso
  const [lassoPoly, setLassoPoly] = useState([]); // Points for the current lasso loop
  const [selectedIndices, setSelectedIndices] = useState([]); // Indices of strokes in active layer
  const [selectionTransform, setSelectionTransform] = useState({ x: 0, y: 0 }); // Temporary move offset
  const [isMovingSelection, setIsMovingSelection] = useState(false);

  // UI State
  const [showLayers, setShowLayers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Refs
  const canvasRef = useRef(null);
  const tempCanvasRef = useRef(null); // Offscreen buffer for layer composition
  const isDrawing = useRef(false);
  const currentStroke = useRef([]); 
  const lastPos = useRef({ x: 0, y: 0 }); 
  const lastDrawPos = useRef({ x: 0, y: 0 }); 
  const noisePattern = useRef(null);

  // --- Initialization ---
  useEffect(() => {
    // Create temp canvas for layer rendering
    const tc = document.createElement('canvas');
    tc.width = window.innerWidth;
    tc.height = window.innerHeight;
    tempCanvasRef.current = tc;

    const patternCanvas = createNoisePattern();
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && patternCanvas) {
      noisePattern.current = ctx.createPattern(patternCanvas, 'repeat');
    }

    const handleResize = () => {
      setWindowSize({ w: window.innerWidth, h: window.innerHeight });
      if(tempCanvasRef.current) {
        tempCanvasRef.current.width = window.innerWidth;
        tempCanvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Rendering Helpers ---

  const getPressureFactor = (p) => {
     if (!usePressure) return 1;
     // simple curve: low pressure = thinner/lighter
     return p === undefined ? 0.5 : p; 
  };

  const drawGrid = (ctx, width, height) => {
    if (gridConfig.type === GRID_TYPES.NONE) return;
    ctx.save();
    ctx.strokeStyle = gridConfig.color;
    ctx.fillStyle = gridConfig.color;
    ctx.globalAlpha = gridConfig.opacity;
    ctx.lineWidth = 1 / transform.k; 

    const step = gridConfig.size * transform.k;
    const startX = (transform.x % step) - step;
    const startY = (transform.y % step) - step;

    if (gridConfig.type === GRID_TYPES.DOT) {
      for (let x = startX; x < width; x += step) {
        for (let y = startY; y < height; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (gridConfig.type === GRID_TYPES.LINE) {
      ctx.beginPath();
      for (let x = startX; x < width; x += step) ctx.moveTo(x, 0), ctx.lineTo(x, height);
      for (let y = startY; y < height; y += step) ctx.moveTo(0, y), ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawStroke = (ctx, stroke, layerOffset, isSelected = false, moveOffset = {x:0, y:0}) => {
    if (stroke.points.length < 2) return;

    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Base style
    let baseSize = stroke.size;
    let baseAlpha = stroke.opacity;

    if (stroke.tool === TOOLS.ERASER) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = baseSize; // Eraser usually doesn't need complex pressure width, or simpler
    } else {
      ctx.globalCompositeOperation = 'source-over';
      
      if (isSelected) {
         ctx.strokeStyle = '#3b82f6'; // Blue selection
         ctx.shadowColor = '#3b82f6';
         ctx.shadowBlur = 5;
      } else if (stroke.texture && noisePattern.current) {
         ctx.strokeStyle = noisePattern.current;
         if (stroke.color !== '#000000') {
             ctx.shadowColor = stroke.color;
             ctx.shadowBlur = 1;
         }
      } else {
         ctx.strokeStyle = stroke.color;
      }
      ctx.globalAlpha = baseAlpha;
    }

    const offsetX = layerOffset.x + moveOffset.x;
    const offsetY = layerOffset.y + moveOffset.y;

    if (usePressure && stroke.tool !== TOOLS.ERASER && stroke.tool !== TOOLS.MARKER) {
        // Variable Width Rendering
        for (let i = 0; i < stroke.points.length - 1; i++) {
            const p1 = stroke.points[i];
            const p2 = stroke.points[i + 1];
            
            ctx.beginPath();
            ctx.moveTo(p1.x + offsetX, p1.y + offsetY);
            
            const midX = (p1.x + p2.x) / 2 + offsetX;
            const midY = (p1.y + p2.y) / 2 + offsetY;
            ctx.quadraticCurveTo(midX, midY, p2.x + offsetX, p2.y + offsetY); // simplified curve

            // Average pressure for segment
            const press = (p1.p + p2.p) / 2;
            ctx.lineWidth = Math.max(0.5, baseSize * press * 2); // Scaling pressure
            ctx.globalAlpha = Math.min(1, baseAlpha * (0.5 + press * 0.5)); // Opacity pressure
            ctx.stroke();
        }
    } else {
        // Standard Constant Width
        ctx.lineWidth = baseSize;
        ctx.beginPath();
        const p0 = stroke.points[0];
        ctx.moveTo(p0.x + offsetX, p0.y + offsetY);

        for (let i = 1; i < stroke.points.length - 1; i++) {
            const p1 = stroke.points[i];
            const p2 = stroke.points[i + 1];
            const cpX = (p1.x + p2.x) / 2;
            const cpY = (p1.y + p2.y) / 2;
            ctx.quadraticCurveTo(
                p1.x + offsetX, 
                p1.y + offsetY, 
                cpX + offsetX, 
                cpY + offsetY
            );
        }
        const last = stroke.points[stroke.points.length - 1];
        ctx.lineTo(last.x + offsetX, last.y + offsetY);
        ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalCompositeOperation = 'source-over';
  };

  const render = () => {
    const canvas = canvasRef.current;
    const tempCanvas = tempCanvasRef.current;
    if (!canvas || !tempCanvas) return;
    
    const ctx = canvas.getContext('2d');
    const tCtx = tempCanvas.getContext('2d');

    // 1. Clear Main
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 2. Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 3. Grid
    drawGrid(ctx, canvas.width, canvas.height);

    // 4. Layers
    // We render each layer to tCtx first to handle Eraser blending correctly
    [...layers].reverse().forEach(layer => {
      if (!layer.visible) return;

      // Clear Temp
      tCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
      
      tCtx.save();
      // Apply Global Transform to Temp
      tCtx.translate(transform.x, transform.y);
      tCtx.scale(transform.k, transform.k);

      // Draw stored strokes
      layer.strokes.forEach((stroke, idx) => {
        // Check selection
        const isSelected = (layer.id === activeLayerId) && selectedIndices.includes(idx);
        const moveOffset = isSelected ? selectionTransform : {x:0, y:0};
        drawStroke(tCtx, stroke, layer.offset, isSelected, moveOffset);
      });

      // Draw Current Stroke (Live) if on this layer
      if (isDrawing.current && currentStroke.current.length > 0 && activeLayerId === layer.id && activeTool !== TOOLS.LASSO) {
         drawStroke(tCtx, {
            points: currentStroke.current,
            color: brushColor,
            size: brushSize,
            opacity: brushOpacity,
            tool: activeTool,
            texture: BRUSH_PRESETS[activeTool]?.texture
         }, layer.offset);
      }

      tCtx.restore();

      // Composite Temp to Main
      ctx.drawImage(tempCanvas, 0, 0);
    });

    // 5. Lasso UI (Global Overlay)
    if (activeTool === TOOLS.LASSO && lassoPoly.length > 0) {
        ctx.save();
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.k, transform.k);
        
        ctx.beginPath();
        const start = lassoPoly[0];
        ctx.moveTo(start.x, start.y);
        for(let i=1; i<lassoPoly.length; i++) ctx.lineTo(lassoPoly[i].x, lassoPoly[i].y);
        ctx.closePath();
        
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1 / transform.k;
        ctx.setLineDash([5 / transform.k, 5 / transform.k]);
        ctx.stroke();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        ctx.fill();
        ctx.restore();
    }
  };

  useLayoutEffect(() => {
    let frame;
    const loop = () => {
      render();
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [layers, transform, gridConfig, bgColor, activeTool, brushColor, brushSize, activeLayerId, lassoPoly, selectedIndices, selectionTransform]);


  // --- Interactions ---

  const handlePointerDown = (e) => {
    // Middle mouse or Spacebar (handled via tool)
    if (e.button === 1 || activeTool === TOOLS.PAN) {
      lastPos.current = { x: e.clientX, y: e.clientY };
      isDrawing.current = true; 
      return;
    }

    if (e.button !== 0) return;

    const layer = layers.find(l => l.id === activeLayerId);
    if (!layer || layer.locked || !layer.visible) return;

    const worldPos = {
        x: (e.clientX - transform.x) / transform.k,
        y: (e.clientY - transform.y) / transform.k
    };

    // LASSO LOGIC
    if (activeTool === TOOLS.LASSO) {
        // If clicking inside existing selection, start Move
        if (selectedIndices.length > 0) {
            setSelectedIndices([]);
            setLassoPoly([{ x: worldPos.x - layer.offset.x, y: worldPos.y - layer.offset.y }]);
            isDrawing.current = true;
            return;
        }
        
        setLassoPoly([{ x: worldPos.x - layer.offset.x, y: worldPos.y - layer.offset.y }]);
        isDrawing.current = true;
        return;
    }

    // MOVE LOGIC
    if (activeTool === TOOLS.MOVE_LAYER) {
      lastPos.current = { x: e.clientX, y: e.clientY };
      if (selectedIndices.length > 0) {
          setIsMovingSelection(true);
      } else {
          isDrawing.current = true; // reusing for layer move
      }
      return;
    }

    // DRAWING LOGIC
    isDrawing.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    lastDrawPos.current = { x: worldPos.x, y: worldPos.y };
    
    // Clear selection if drawing
    if (selectedIndices.length > 0) setSelectedIndices([]);

    const relativeX = worldPos.x - layer.offset.x;
    const relativeY = worldPos.y - layer.offset.y;
    
    // Initial point with pressure
    const p = e.pressure !== undefined ? e.pressure : 0.5;
    currentStroke.current = [{ x: relativeX, y: relativeY, p }];
  };

  const handlePointerMove = (e) => {
    // Pan
    if (activeTool === TOOLS.PAN || (e.buttons === 4)) {
      if (!isDrawing.current) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      lastPos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (activeTool === TOOLS.LASSO && isDrawing.current) {
        const worldPos = {
            x: (e.clientX - transform.x) / transform.k,
            y: (e.clientY - transform.y) / transform.k
        };
        const layer = layers.find(l => l.id === activeLayerId);
        if (layer) {
            setLassoPoly(prev => [...prev, { x: worldPos.x - layer.offset.x, y: worldPos.y - layer.offset.y }]);
        }
        return;
    }

    if (activeTool === TOOLS.MOVE_LAYER) {
       if (isMovingSelection) {
            const dx = (e.clientX - lastPos.current.x) / transform.k;
            const dy = (e.clientY - lastPos.current.y) / transform.k;
            setSelectionTransform(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            lastPos.current = { x: e.clientX, y: e.clientY };
       } else if (isDrawing.current) {
            // Moving entire layer
            const dx = (e.clientX - lastPos.current.x) / transform.k;
            const dy = (e.clientY - lastPos.current.y) / transform.k;
            setLayers(prev => prev.map(l => {
                if (l.id === activeLayerId) {
                return { ...l, offset: { x: l.offset.x + dx, y: l.offset.y + dy } };
                }
                return l;
            }));
            lastPos.current = { x: e.clientX, y: e.clientY };
       }
       return;
    }

    if (!isDrawing.current) return;

    // Normal Drawing
    const rawWorldPos = {
        x: (e.clientX - transform.x) / transform.k,
        y: (e.clientY - transform.y) / transform.k
    };

    const factor = activeTool === TOOLS.ERASER ? 1 : (1 - brushSmoothing); 
    const newX = lastDrawPos.current.x + (rawWorldPos.x - lastDrawPos.current.x) * factor;
    const newY = lastDrawPos.current.y + (rawWorldPos.y - lastDrawPos.current.y) * factor;
    lastDrawPos.current = { x: newX, y: newY };
    lastPos.current = { x: e.clientX, y: e.clientY };

    const layer = layers.find(l => l.id === activeLayerId);
    if(layer) {
       const relativeX = newX - layer.offset.x;
       const relativeY = newY - layer.offset.y;
       const p = e.pressure !== undefined ? e.pressure : 0.5;
       currentStroke.current.push({ x: relativeX, y: relativeY, p });
    }
  };

  const handlePointerUp = () => {
    const layer = layers.find(l => l.id === activeLayerId);

    // End Lasso
    if (activeTool === TOOLS.LASSO && isDrawing.current) {
        isDrawing.current = false;
        // Close the loop
        if (lassoPoly.length > 2 && layer) {
            // Find strokes inside
            const indices = [];
            layer.strokes.forEach((st, idx) => {
                if (isStrokeInLasso(st, lassoPoly, layer.offset)) {
                    indices.push(idx);
                }
            });
            setSelectedIndices(indices);
            setLassoPoly([]);
            
            if (indices.length > 0) setActiveTool(TOOLS.MOVE_LAYER);
        } else {
            setLassoPoly([]);
            setSelectedIndices([]);
        }
        return;
    }

    // End Move Selection
    if (isMovingSelection) {
        setIsMovingSelection(false);
        // Bake transform into points
        if (layer) {
            const newStrokes = [...layer.strokes];
            selectedIndices.forEach(idx => {
                const s = newStrokes[idx];
                const movedPoints = s.points.map(p => ({
                    ...p,
                    x: p.x + selectionTransform.x,
                    y: p.y + selectionTransform.y
                }));
                newStrokes[idx] = { ...s, points: movedPoints };
            });
            setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, strokes: newStrokes } : l));
            setSelectionTransform({ x: 0, y: 0 });
        }
        return;
    }

    if (!isDrawing.current) return;
    isDrawing.current = false;

    if (activeTool === TOOLS.PAN || activeTool === TOOLS.MOVE_LAYER) return;

    if (currentStroke.current.length > 0) {
      const newStroke = {
        points: [...currentStroke.current],
        color: brushColor,
        size: brushSize,
        opacity: brushOpacity,
        tool: activeTool,
        texture: BRUSH_PRESETS[activeTool]?.texture || false
      };

      setLayers(prev => prev.map(l => {
        if (l.id === activeLayerId) {
          return { ...l, strokes: [...l.strokes, newStroke] };
        }
        return l;
      }));
    }
    currentStroke.current = [];
  };

  const handleWheel = (e) => {
    if (e.ctrlKey) e.preventDefault();
    const scaleFactor = 1.1;
    const direction = e.deltaY < 0 ? 1 : -1;
    const factor = direction > 0 ? scaleFactor : 1 / scaleFactor;
    const nextScale = transform.k * factor;
    if (nextScale < 0.1 || nextScale > 10) return;
    const wx = (e.clientX - transform.x) / transform.k;
    const wy = (e.clientY - transform.y) / transform.k;
    const newX = e.clientX - wx * nextScale;
    const newY = e.clientY - wy * nextScale;
    setTransform({ x: newX, y: newY, k: nextScale });
  };

  // --- UI ---

  const selectTool = (tool) => {
    setActiveTool(tool);
    // Reset selection if switching away from move/lasso
    if (tool !== TOOLS.LASSO && tool !== TOOLS.MOVE_LAYER) {
        setSelectedIndices([]);
    }
    
    if (BRUSH_PRESETS[tool]) {
      const preset = BRUSH_PRESETS[tool];
      setBrushSize(preset.size);
      setBrushOpacity(preset.opacity);
      setBrushSmoothing(preset.smoothing);
    }
  };

  const toggleLayerVis = (id) => setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  const toggleLayerLock = (id) => setLayers(prev => prev.map(l => l.id === id ? { ...l, locked: !l.locked } : l));
  const deleteLayer = (id) => {
    if (layers.length <= 1) return;
    setLayers(prev => prev.filter(l => l.id !== id));
    if (activeLayerId === id) setActiveLayerId(layers[0].id);
  };
  const addLayer = () => {
    const newId = generateId();
    setLayers(prev => [{ id: newId, name: `Layer ${prev.length + 1}`, visible: true, locked: false, strokes: [], offset: { x: 0, y: 0 } }, ...prev]);
    setActiveLayerId(newId);
  };
  const clearCanvas = () => {
    if(window.confirm("Clear all layers?")) {
      setLayers([{ id: 'layer-1', name: 'Background Ink', visible: true, locked: false, strokes: [], offset: {x:0, y:0} }]);
      setActiveLayerId('layer-1');
      setSelectedIndices([]);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-black font-sans text-white select-none">
      
      {/* Top Bar */}
      <div className="absolute top-0 left-0 w-full h-14 bg-black border-b border-gray-800 flex items-center justify-between px-4 z-20 shadow-xl">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/30">
            IS
          </div>
          <span className="font-bold text-lg hidden sm:block tracking-tight">InfiniteSketch</span>
        </div>

        {/* Toolbar */}
        <div className="flex items-center space-x-1 sm:space-x-3 bg-gray-900 rounded-full px-4 py-2 border border-gray-800">
            <button 
                onClick={() => selectTool(TOOLS.PAN)} 
                className={`p-2 rounded-full transition-colors ${activeTool === TOOLS.PAN ? 'bg-blue-500 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                title="Pan (Hand)"
            >
                <Hand size={18} />
            </button>
            <button 
                onClick={() => selectTool(TOOLS.MOVE_LAYER)} 
                className={`p-2 rounded-full transition-colors ${activeTool === TOOLS.MOVE_LAYER ? 'bg-blue-500 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                title="Move Layer / Selection"
            >
                <Move size={18} />
            </button>
            <button 
                onClick={() => selectTool(TOOLS.LASSO)} 
                className={`p-2 rounded-full transition-colors ${activeTool === TOOLS.LASSO ? 'bg-blue-500 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                title="Lasso Select"
            >
                <Lasso size={18} />
            </button>
            
            <div className="w-px h-5 bg-gray-700 mx-2"></div>
            
            {[
              { id: TOOLS.PEN, icon: PenTool, label: 'Pen' },
              { id: TOOLS.HARD_PENCIL, icon: Edit3, label: 'H' },
              { id: TOOLS.SOFT_PENCIL, icon: Edit3, label: 'S' },
              { id: TOOLS.MARKER, icon: PenTool, label: 'M' },
              { id: TOOLS.ERASER, icon: Eraser, label: 'E' },
            ].map(t => (
                <button 
                    key={t.id}
                    onClick={() => selectTool(t.id)} 
                    className={`p-2 rounded-full transition-colors relative ${activeTool === t.id ? 'bg-blue-500 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                    title={t.label}
                >
                    <t.icon size={18} />
                    {t.label.length === 1 && <span className="absolute -bottom-1 -right-1 text-[8px] font-bold bg-gray-900 border border-gray-700 px-0.5 rounded">{t.label}</span>}
                </button>
            ))}
        </div>

        <div className="flex items-center space-x-3">
             <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-gray-800 text-blue-400' : 'hover:bg-gray-800 text-gray-400'}`}
             >
                <Settings size={20} />
             </button>
             <button 
                onClick={() => setShowLayers(!showLayers)}
                className={`p-2 rounded-lg flex items-center space-x-2 transition-colors ${showLayers ? 'bg-gray-800 text-blue-400' : 'hover:bg-gray-800 text-gray-400'} ${layers.length > 1 ? 'text-blue-400' : ''}`}
             >
                <Layers size={20} />
                <span className="text-xs font-bold bg-gray-800 px-1.5 rounded-full border border-gray-700 text-white">{layers.length}</span>
             </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 relative cursor-crosshair overflow-hidden bg-[#1a1a1a]">
        <canvas
            ref={canvasRef}
            width={windowSize.w}
            height={windowSize.h}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={handleWheel}
            className="absolute top-0 left-0 touch-none"
        />

        {/* Brush Settings (Floating Left) */}
        <div className="absolute left-4 top-20 bg-black/90 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-gray-800 w-16 sm:w-64 flex flex-col space-y-5">
             {/* Color */}
             <div>
                <label className="text-[10px] text-gray-500 font-bold uppercase mb-2 block tracking-wider">Color</label>
                <div className="flex items-center space-x-2">
                    <input 
                        type="color" 
                        value={brushColor} 
                        onChange={(e) => setBrushColor(e.target.value)}
                        className="w-full h-8 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                </div>
             </div>
             
             {/* Sliders */}
             {['Size', 'Opacity', 'Smoothing'].map(prop => {
                 const isSize = prop === 'Size';
                 const isOp = prop === 'Opacity';
                 const val = isSize ? brushSize : isOp ? Math.round(brushOpacity * 100) : Math.round(brushSmoothing * 100);
                 const max = isSize ? 100 : isOp ? 100 : 95;
                 const setter = isSize ? setBrushSize : isOp ? (v) => setBrushOpacity(v/100) : (v) => setBrushSmoothing(v/100);

                 return (
                    <div key={prop} className="hidden sm:block">
                        <div className="flex justify-between text-[10px] text-gray-500 mb-1 font-bold uppercase tracking-wider">
                            <span>{prop}</span>
                            <span>{val}{!isSize && '%'}</span>
                        </div>
                        <input 
                            type="range" min={isSize ? 1 : 0} max={max} 
                            value={val} 
                            onChange={(e) => setter(parseInt(e.target.value))}
                            className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                    </div>
                 );
             })}
             
             {/* Pressure Toggle */}
             <div className="hidden sm:flex items-center justify-between pt-2 border-t border-gray-800">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Pressure</span>
                <button 
                    onClick={() => setUsePressure(!usePressure)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${usePressure ? 'bg-blue-600' : 'bg-gray-700'}`}
                >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${usePressure ? 'left-6' : 'left-1'}`} />
                </button>
             </div>
        </div>

        {/* Layers Panel (Right) */}
        {showLayers && (
            <div className="absolute right-4 top-20 w-64 max-h-[70vh] flex flex-col bg-black/90 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-800 overflow-hidden">
                <div className="p-3 border-b border-gray-800 flex justify-between items-center">
                    <h3 className="font-bold text-xs uppercase tracking-wider text-gray-400">Layers</h3>
                    <button onClick={addLayer} className="p-1 hover:bg-gray-800 rounded text-blue-400">
                        <Plus size={16} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {layers.map((layer) => (
                        <div 
                            key={layer.id}
                            onClick={() => setActiveLayerId(layer.id)}
                            className={`group flex items-center p-2 rounded-lg cursor-pointer border transition-all ${
                                activeLayerId === layer.id 
                                ? 'bg-blue-900/20 border-blue-500/50' 
                                : 'hover:bg-gray-800 border-transparent'
                            }`}
                        >
                            <button 
                                onClick={(e) => { e.stopPropagation(); toggleLayerVis(layer.id); }}
                                className="text-gray-500 hover:text-white mr-3"
                            >
                                {layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                            
                            <div className="flex-1 min-w-0">
                                <div className={`text-sm font-medium truncate ${activeLayerId === layer.id ? 'text-white' : 'text-gray-400'}`}>
                                    {layer.name}
                                </div>
                            </div>

                            <div className="flex space-x-2">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id); }}
                                    className={`p-1 hover:bg-gray-700 rounded transition-colors ${layer.locked ? 'text-blue-400' : 'text-gray-600 opacity-0 group-hover:opacity-100'}`}
                                >
                                    {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }}
                                    className="p-1 hover:bg-red-900/30 hover:text-red-400 rounded text-gray-600 opacity-0 group-hover:opacity-100 transition-colors"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
            <div className="absolute right-16 top-20 w-64 bg-black/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-800 p-4">
                 <h3 className="font-bold text-xs uppercase tracking-wider text-gray-500 mb-4 border-b border-gray-800 pb-2">Canvas</h3>
                 
                 {/* Grid Settings */}
                 <div className="mb-4">
                    <label className="text-[10px] text-gray-500 font-bold uppercase mb-2 block">Grid Type</label>
                    <div className="grid grid-cols-4 gap-2">
                        {Object.values(GRID_TYPES).map(type => (
                            <button
                                key={type}
                                onClick={() => setGridConfig(prev => ({ ...prev, type }))}
                                className={`h-8 rounded-md flex items-center justify-center border transition-all ${gridConfig.type === type ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 hover:border-gray-600 text-gray-400'}`}
                            >
                                {type === GRID_TYPES.NONE && 'Off'}
                                {type === GRID_TYPES.DOT && <Grid size={14}/>}
                                {type === GRID_TYPES.LINE && <Grid size={14} className="rotate-45" />} 
                                {type === GRID_TYPES.ISOMETRIC && <span className="text-[9px]">ISO</span>} 
                            </button>
                        ))}
                    </div>
                 </div>

                 <div className="mb-4">
                     <label className="text-[10px] text-gray-500 font-bold uppercase mb-2 block">Background</label>
                     <div className="flex space-x-2">
                        {['#ffffff', '#f3f4f6', '#1f2937', '#000000'].map(c => (
                            <button 
                                key={c}
                                onClick={() => setBgColor(c)}
                                className={`w-6 h-6 rounded-full border border-gray-600 ${bgColor === c ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-black' : ''}`}
                                style={{backgroundColor: c}}
                            />
                        ))}
                     </div>
                 </div>

                 <button 
                    onClick={clearCanvas}
                    className="w-full py-2 bg-red-900/20 hover:bg-red-900/40 text-red-500 rounded-lg text-xs font-bold uppercase tracking-wider border border-red-900/50 transition-colors"
                 >
                    Reset Canvas
                 </button>
            </div>
        )}

        {/* Info */}
        <div className="absolute bottom-4 left-4 px-3 py-1 rounded-full bg-black/50 border border-gray-800 text-[10px] text-gray-500 pointer-events-none select-none backdrop-blur-sm">
            Zoom: {Math.round(transform.k * 100)}%
        </div>
      </div>
    </div>
  );
}