import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const Blockchain3DVisualizer = ({ chain, isValid, brokenFromIndex, onTamper }) => {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const animationFrameRef = useRef(null);
  const cubesRef = useRef([]);

  const [selectedBlockIdx, setSelectedBlockIdx] = useState(null); // array index in `chain`

  const selectedBlock = useMemo(() => {
    if (selectedBlockIdx === null) return null;
    return chain?.[selectedBlockIdx] || null;
  }, [selectedBlockIdx, chain]);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, width / Math.max(1, height), 0.1, 1000);
    camera.position.set(0, 5, 14);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    rendererRef.current = renderer;

    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(renderer.domElement);

    const lightA = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(lightA);
    const lightB = new THREE.DirectionalLight(0xffffff, 0.6);
    lightB.position.set(3, 10, 5);
    scene.add(lightB);

    const onPointerDown = (event) => {
      const r = containerRef.current.getBoundingClientRect();
      const x = ((event.clientX - r.left) / r.width) * 2 - 1;
      const y = -(((event.clientY - r.top) / r.height) * 2 - 1);

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);
      const intersects = raycaster.intersectObjects(cubesRef.current, false);
      if (!intersects.length) return;

      const obj = intersects[0].object;
      const blockIdx = obj?.userData?.blockArrayIndex;
      if (typeof blockIdx === "number") setSelectedBlockIdx(blockIdx);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (renderer?.domElement) renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      renderer?.dispose?.();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const cubes = cubesRef.current;
    if (!scene) return;

    // Clean previous cubes
    for (const mesh of cubes) {
      scene.remove(mesh);
      mesh.geometry?.dispose?.();
      // materials can be reused but we keep it safe
      mesh.material?.dispose?.();
    }
    cubes.length = 0;

    const count = chain?.length || 0;
    const cubeGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);

    const primary = new THREE.Color("#4f46e5");
    const danger = new THREE.Color("#ef4444");

    for (let idx = 0; idx < count; idx++) {
      const block = chain[idx];
      const shouldMarkBroken =
        !isValid &&
        brokenFromIndex !== null &&
        typeof brokenFromIndex === "number" &&
        idx >= brokenFromIndex;

      const material = new THREE.MeshStandardMaterial({
        color: shouldMarkBroken ? danger : primary,
        roughness: 0.55,
        metalness: 0.15,
      });

      const cube = new THREE.Mesh(cubeGeo, material);
      cube.position.set((idx - (count - 1) / 2) * 1.8, 0, 0);
      cube.userData = { blockArrayIndex: idx, blockIndex: block?.index };
      scene.add(cube);
      cubes.push(cube);
    }

    // Place selected block to front visually
    if (selectedBlockIdx !== null && cubes[selectedBlockIdx]) {
      // noop; kept simple to avoid animation complexity
    }
  }, [chain, isValid, brokenFromIndex, selectedBlockIdx]);

  const txs = selectedBlock?.transactions || [];

  return (
    <div className="h-full flex gap-6">
      <div className="flex-1 glass-panel p-4">
        <div ref={containerRef} className="w-full h-[420px]" />
        <div className="mt-3 text-xs text-gray-400">
          Click a cube to inspect its transactions.
        </div>
      </div>

      <div className="w-96 glass-panel p-4">
        <div className="text-sm font-bold text-accent mb-2">Block Details</div>
        {selectedBlock === null ? (
          <div className="text-xs text-gray-500">Select a block cube.</div>
        ) : (
          <>
            <div className="text-xs text-gray-400 mb-2">
              Block #{selectedBlock.index} • {txs.length} transaction(s)
            </div>
            <div className="text-xs font-mono text-gray-500 mb-3">
              hash: ...{(selectedBlock.hash || "").slice(-12)}
              <div>prev: ...{(selectedBlock.previous_hash || "").slice(-12)}</div>
            </div>

            <div className="max-h-[340px] overflow-y-auto custom-scrollbar pr-2">
              {txs.length === 0 ? (
                <div className="text-xs text-gray-500">Genesis (no transactions)</div>
              ) : (
                txs.map((txWrapper, txIdx) => {
                  const tx = txWrapper.tx_data || {};
                  const txUuid = typeof tx.id === "string" ? tx.id : "";
                  return (
                    <div
                      key={txUuid || txIdx}
                      className="bg-black/40 p-3 rounded border border-white/10 mb-2"
                    >
                      <div className="flex justify-between items-center gap-3 mb-1">
                        <div className="text-[11px] text-gray-300 font-mono truncate">
                          UUID: {txUuid ? `${txUuid.slice(0, 10)}...` : "unknown"}
                        </div>
                        <div className="text-[11px] text-primary font-bold">
                          {typeof tx.amount === "number" ? tx.amount.toFixed(2) : tx.amount} coin
                        </div>
                      </div>
                      <div className="text-[10px] text-gray-500 mb-2">
                        From User {tx.sender_id} → To User {tx.recipient_id}
                      </div>
                      <button
                        onClick={() => onTamper(selectedBlockIdx, txIdx)}
                        className="w-full text-[10px] py-2 px-2 rounded bg-danger/20 hover:bg-danger/30 border border-danger/50 text-danger transition-colors disabled:opacity-50"
                      >
                        Simulate Tamper
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Blockchain3DVisualizer;

