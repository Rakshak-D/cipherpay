import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { AlertTriangle, Box, Fingerprint, GitBranch, Move3D, Sparkles } from 'lucide-react';
import { getIntegrityStatusMeta } from '../lib/forensics';

function branchKeyForEpoch(epochId, branchType) {
  return `${branchType}-${epochId}`;
}

const ThreeChainVisualizer = ({
  activeChain,
  archivedEpochs,
  activeEpochId,
  activeEpochParentId,
  activeEpochForkFromBlock,
  onTamper,
  isValid,
  brokenFromIndex,
}) => {
  const mountRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [renderIssue, setRenderIssue] = useState('');

  const branches = useMemo(() => {
    const archived = (archivedEpochs || []).map((epoch, index) => {
      const laneDirection = index % 2 === 0 ? -1 : 1;
      const laneRank = Math.floor(index / 2) + 1;
      return {
        branchKey: branchKeyForEpoch(epoch.epoch_id, 'archived'),
        branchType: 'archived',
        epochId: epoch.epoch_id,
        label: `Archived epoch ${epoch.epoch_id}`,
        laneOffset: laneDirection * laneRank * 4.8,
        blocks: epoch.chain || [],
        reason: epoch.reason,
        invalidFromIndex: epoch.invalid_from_index,
        forkFromBlock: epoch.fork_from_block,
        continuedToEpoch: epoch.continued_to_epoch,
        parentEpochId: epoch.parent_epoch_id,
        displayStartIndex: epoch.parent_epoch_id ? Math.max(epoch.fork_from_block ?? 0, 0) : 0,
      };
    });

    return [
      {
        branchKey: branchKeyForEpoch(activeEpochId, 'active'),
        branchType: 'active',
        epochId: activeEpochId,
        label: `Active epoch ${activeEpochId}`,
        laneOffset: 0,
        blocks: activeChain || [],
        parentEpochId: activeEpochParentId,
        forkFromBlock: activeEpochForkFromBlock,
        invalidFromIndex: brokenFromIndex,
        displayStartIndex: activeEpochParentId ? Math.max(activeEpochForkFromBlock ?? 0, 0) : 0,
      },
      ...archived,
    ];
  }, [activeChain, activeEpochForkFromBlock, activeEpochId, activeEpochParentId, archivedEpochs, brokenFromIndex]);

  const branchByKey = useMemo(
    () => Object.fromEntries(branches.map((branch) => [branch.branchKey, branch])),
    [branches]
  );

  const selectedBranch = selectedNode ? branchByKey[selectedNode.branchKey] : null;
  const selectedBlock = selectedBranch?.blocks?.find((block) => block.index === selectedNode?.blockIndex) || null;
  const hoveredBranch = hoveredNode ? branchByKey[hoveredNode.branchKey] : null;
  const hoveredBlock = hoveredBranch?.blocks?.find((block) => block.index === hoveredNode?.blockIndex) || null;
  const selectedBlockStatus = getIntegrityStatusMeta(selectedBlock?.integrity_status);
  const hoveredBlockStatus = getIntegrityStatusMeta(hoveredBlock?.integrity_status);

  useEffect(() => {
    if (!mountRef.current) return undefined;

    const mount = mountRef.current;
    let renderer;
    let controls;
    let scene;
    let frameId = 0;
    let clearIssueFrame = 0;
    let onPointerMove;
    let onClick;
    let handleResize;
    let nextRenderIssue = '';

    try {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x07111f);
      scene.fog = new THREE.Fog(0x07111f, 14, 46);

      const camera = new THREE.PerspectiveCamera(56, mount.clientWidth / mount.clientHeight, 0.1, 120);
      camera.position.set(0, 7.2, 16.5);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.maxPolarAngle = Math.PI / 2.02;
      controls.minDistance = 8;
      controls.maxDistance = 34;

      scene.add(new THREE.AmbientLight(0xffffff, 0.7));

      const primaryLight = new THREE.PointLight(0x60a5fa, 16, 60, 1.5);
      primaryLight.position.set(-10, 10, 12);
      scene.add(primaryLight);

      const accentLight = new THREE.PointLight(0x14b8a6, 12, 48, 1.7);
      accentLight.position.set(10, 5, 10);
      scene.add(accentLight);

      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(120, 70),
        new THREE.MeshPhongMaterial({ color: 0x08101c, transparent: true, opacity: 0.84 })
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = -2.8;
      scene.add(plane);

      const grid = new THREE.GridHelper(80, 24, 0x14304f, 0x102036);
      grid.position.y = -2.79;
      grid.material.transparent = true;
      grid.material.opacity = 0.22;
      scene.add(grid);

      const starPositions = new Float32Array(450 * 3);
      for (let i = 0; i < 450; i += 1) {
        starPositions[i * 3] = (Math.random() - 0.5) * 80;
        starPositions[i * 3 + 1] = Math.random() * 28 + 1;
        starPositions[i * 3 + 2] = (Math.random() - 0.5) * 70;
      }
      const starGeometry = new THREE.BufferGeometry();
      starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
      const starField = new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({ color: 0xa5f3fc, size: 0.12, transparent: true, opacity: 0.42 })
      );
      scene.add(starField);

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const interactiveBlocks = [];
      const animatedParticles = [];
      const animatedMeshes = [];
      const branchPositions = new Map();

      const paletteForBranch = (branch, block) => {
        if (block.integrity_status === 'tampered') {
          return { color: 0xef4444, emissive: 0x491616, ring: 0xfda4af };
        }

        if (block.integrity_status === 'downstream_invalid') {
          return { color: 0xf59e0b, emissive: 0x38220a, ring: 0xfcd34d };
        }

        const isBrokenSegment =
          branch.branchType === 'active' &&
          !isValid &&
          typeof brokenFromIndex === 'number' &&
          block.index >= brokenFromIndex;

        if (isBrokenSegment) {
          return { color: 0xef4444, emissive: 0x491616, ring: 0xfda4af };
        }

        if (branch.branchType === 'archived') {
          return { color: 0xfbbf24, emissive: 0x33220b, ring: 0xfde68a };
        }

        return { color: 0x38bdf8, emissive: 0x05293f, ring: 0xa5f3fc };
      };

      const positionForBlock = (branch, block, branchLength) => {
        const centerOffset = ((branchLength - 1) * 3.3) / 2;
        return new THREE.Vector3(block.index * 3.3 - centerOffset, 0, branch.laneOffset);
      };

      branches.forEach((branch) => {
        const positionsForBranch = new Map();
        const renderedBlocks = (branch.blocks || []).filter(
          (block) => block.index >= (branch.displayStartIndex ?? 0)
        );
        const branchLength = Math.max(renderedBlocks.length, 1);

        renderedBlocks.forEach((block, blockSequenceIndex) => {
          const palette = paletteForBranch(branch, block);
          const radius = Math.max(0.72, 0.92 + (block.transactions?.length || 0) * 0.12);
          const material = new THREE.MeshStandardMaterial({
            color: palette.color,
            emissive: palette.emissive,
            metalness: 0.45,
            roughness: 0.25,
          });
          const geometry =
            branch.branchType === 'archived'
              ? new THREE.OctahedronGeometry(radius, 1)
              : new THREE.IcosahedronGeometry(radius, 2);
          const mesh = new THREE.Mesh(geometry, material);
          const position = positionForBlock(branch, block, branchLength);
          position.y = Math.sin(blockSequenceIndex * 0.6) * 0.25;
          mesh.position.copy(position);
          mesh.userData = { branchKey: branch.branchKey, blockIndex: block.index };
          scene.add(mesh);
          interactiveBlocks.push(mesh);
          animatedMeshes.push({ mesh, baseY: position.y, seed: blockSequenceIndex + Math.abs(branch.laneOffset) });
          positionsForBranch.set(block.index, position.clone());

          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(radius + 0.4, 0.055, 14, 60),
            new THREE.MeshBasicMaterial({
              color: palette.ring,
              transparent: true,
              opacity: branch.branchType === 'archived' ? 0.42 : 0.5,
            })
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.copy(position);
          ring.position.y = -1.22;
          scene.add(ring);

          if (blockSequenceIndex > 0) {
            const previousBlock = renderedBlocks[blockSequenceIndex - 1];
            const previousPosition = positionsForBranch.get(previousBlock.index);
            if (!previousPosition) {
              return;
            }

            const geometryLine = new THREE.BufferGeometry().setFromPoints([previousPosition.clone(), position.clone()]);
            const line = new THREE.Line(
              geometryLine,
              new THREE.LineBasicMaterial({
                color: branch.branchType === 'archived' ? 0xfcd34d : 0x67e8f9,
                transparent: true,
                opacity: 0.75,
              })
            );
            scene.add(line);

            const particle = new THREE.Mesh(
              new THREE.SphereGeometry(0.1, 16, 16),
              new THREE.MeshBasicMaterial({ color: branch.branchType === 'archived' ? 0xfbbf24 : 0xffffff })
            );
            particle.userData = {
              from: previousPosition.clone(),
              to: position.clone(),
              offset: blockSequenceIndex * 0.18 + Math.abs(branch.laneOffset) * 0.03,
            };
            scene.add(particle);
            animatedParticles.push(particle);
          }
        });

        branchPositions.set(branch.branchKey, positionsForBranch);
      });

      branches
        .filter((branch) => branch.parentEpochId)
        .forEach((branch) => {
          const parentBranch = branches.find((candidate) => candidate.epochId === branch.parentEpochId);
          const parentPositions = parentBranch ? branchPositions.get(parentBranch.branchKey) : null;
          const childPositions = branchPositions.get(branch.branchKey);
          const parentPosition =
            parentBranch && parentPositions
              ? parentPositions.get(branch.forkFromBlock ?? Math.max((parentBranch.blocks?.length || 1) - 1, 0))
              : null;
          const childEntry = childPositions?.entries().next().value;
          const childPosition = childEntry?.[1];

          if (!parentPosition || !childPosition) {
            return;
          }

          const curve = new THREE.CatmullRomCurve3([
            parentPosition.clone(),
            new THREE.Vector3((parentPosition.x + childPosition.x) / 2, 1.9, (parentPosition.z + childPosition.z) / 2),
            childPosition.clone(),
          ]);
          const curveGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(32));
          const curveLine = new THREE.Line(
            curveGeometry,
            new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.82 })
          );
          scene.add(curveLine);

          const bridgeParticle = new THREE.Mesh(
            new THREE.SphereGeometry(0.13, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0x6ee7b7 })
          );
          bridgeParticle.userData = { curve, offset: 0.12 };
          scene.add(bridgeParticle);
          animatedParticles.push(bridgeParticle);
        });

      const updatePointer = (event) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      };

      const pickNode = (event, setter) => {
        updatePointer(event);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(interactiveBlocks)[0];
        setter(hit ? hit.object.userData : null);
      };

      onPointerMove = (event) => pickNode(event, setHoveredNode);
      onClick = (event) => pickNode(event, setSelectedNode);

      renderer.domElement.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('click', onClick);

      const clock = new THREE.Clock();
      const animate = () => {
        const elapsed = clock.getElapsedTime();

        animatedMeshes.forEach(({ mesh, baseY, seed }) => {
          mesh.rotation.y += 0.008;
          mesh.rotation.x += 0.004;
          mesh.position.y = baseY + Math.sin(elapsed * 1.2 + seed * 0.35) * 0.22;
        });

        animatedParticles.forEach((particle) => {
          if (particle.userData.curve) {
            const progress = (elapsed * 0.15 + particle.userData.offset) % 1;
            particle.position.copy(particle.userData.curve.getPointAt(progress));
            return;
          }
          const progress = (elapsed * 0.24 + particle.userData.offset) % 1;
          particle.position.lerpVectors(particle.userData.from, particle.userData.to, progress);
          particle.position.y += 0.28 + Math.sin(elapsed * 3.2) * 0.05;
        });

        controls.update();
        renderer.render(scene, camera);
        frameId = requestAnimationFrame(animate);
      };
      animate();

      handleResize = () => {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      };

      window.addEventListener('resize', handleResize);
    } catch (error) {
      nextRenderIssue = error?.message || 'The 3D ledger view could not be rendered.';
    }

    clearIssueFrame = window.requestAnimationFrame(() => setRenderIssue(nextRenderIssue));

    return () => {
      cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(clearIssueFrame);
      if (handleResize) {
        window.removeEventListener('resize', handleResize);
      }
      if (renderer?.domElement && onPointerMove) {
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
      }
      if (renderer?.domElement && onClick) {
        renderer.domElement.removeEventListener('click', onClick);
      }
      controls?.dispose();
      renderer?.dispose();
      scene?.traverse((object) => {
        if (object.geometry) object.geometry.dispose?.();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose?.());
          } else {
            object.material.dispose?.();
          }
        }
      });
      if (renderer?.domElement && mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [activeEpochForkFromBlock, activeEpochId, activeEpochParentId, archivedEpochs, branches, brokenFromIndex, isValid]);

  return (
    <div className="space-y-5">
      <div className="rounded-[28px] border border-white/8 bg-slate-950/40 p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="eyebrow">3D blockchain simulator</p>
            <h3 className="mt-1 text-xl font-semibold text-white">
              Explore the active ledger, archived epochs, and continuity branch in one map
            </h3>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-cyan-100">
              <Sparkles size={14} />
              Active epoch
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-amber-100">
              <GitBranch size={14} />
              Archived epoch
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-emerald-100">
              <GitBranch size={14} />
              Continuity bridge
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-slate-200">
              <Move3D size={14} />
              Drag to orbit
            </span>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {branches.map((branch) => (
            <span
              key={branch.branchKey}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
                branch.branchType === 'active'
                  ? 'border border-cyan-400/25 bg-cyan-400/10 text-cyan-100'
                  : 'border border-amber-400/25 bg-amber-400/10 text-amber-100'
              }`}
            >
              <GitBranch size={14} />
              {branch.label}
            </span>
          ))}
        </div>

        <div className="relative aspect-[16/9] overflow-hidden rounded-[24px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.22),transparent_28%),linear-gradient(180deg,#08101d,#04070f)]">
          <div ref={mountRef} className="absolute inset-0" />

          {!branches.some((branch) => branch.blocks.length > 0) ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-slate-500">
                <Box size={44} className="mx-auto mb-4 opacity-40" />
                <p className="text-lg font-medium">No blockchain blocks yet</p>
                <p className="mt-1 text-sm">Send a blockchain transfer to create the first settlement block.</p>
              </div>
            </div>
          ) : null}

          {hoveredBlock ? (
            <div className="absolute left-4 top-4 rounded-2xl border border-white/10 bg-black/65 px-4 py-3 backdrop-blur-xl">
              <div className="text-sm font-semibold text-white">
                {hoveredBranch?.label} · block {hoveredBlock.index}
              </div>
              <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                {hoveredBlock.transactions.length} transaction(s)
              </div>
              <div className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] ${hoveredBlockStatus.tone}`}>
                {hoveredBlockStatus.label}
              </div>
              <div className="mt-2 max-w-[320px] truncate font-mono text-xs text-cyan-200">{hoveredBlock.hash}</div>
            </div>
          ) : null}

          {renderIssue ? (
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-danger/30 bg-black/70 px-4 py-3 text-sm text-rose-100 backdrop-blur-xl">
              <div className="flex items-start gap-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">3D view fell back safely</div>
                  <div className="mt-1 text-slate-300">{renderIssue}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.65fr)_minmax(0,0.35fr)]">
        <div className="rounded-[26px] border border-white/8 bg-slate-950/35 p-5">
          <p className="eyebrow">Read The Map</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4 text-sm text-slate-300">
              Blue shapes show the active branch where new signed transfers are still accepted.
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4 text-sm text-slate-300">
              Amber branches preserve archived history so operators can review the compromised epochs without deleting evidence.
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4 text-sm text-slate-300">
              Green bridges show exactly where continuity restarted from the last trusted state.
            </div>
          </div>
        </div>

        <div className="rounded-[26px] border border-white/8 bg-slate-950/35 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Fingerprint size={16} className="text-accent" />
            <p className="text-sm font-semibold text-white">Selected block details</p>
          </div>

          {!selectedBlock || !selectedBranch ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500">
              Click any block, including archived epochs, to inspect its transactions and lineage.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                <div className="text-lg font-semibold text-white">
                  {selectedBranch.label} · block {selectedBlock.index}
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                  {selectedBlock.transactions.length} transaction(s) · nonce {selectedBlock.nonce}
                </div>
                <div className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] ${selectedBlockStatus.tone}`}>
                  {selectedBlockStatus.label}
                </div>
                <div className="mt-2 text-sm text-slate-300">{selectedBlockStatus.description}</div>
                <div className="mt-3 truncate font-mono text-xs text-cyan-200">{selectedBlock.hash}</div>
              </div>

              {selectedBlock.transactions.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-5 text-sm text-slate-400">
                  This is the genesis block for the selected epoch.
                </div>
              ) : (
                selectedBlock.transactions.map((wrapper, txIndex) => {
                  const transaction = wrapper.tx_data || {};
                  return (
                    <div key={`${selectedBranch.branchKey}-${selectedBlock.index}-${txIndex}`} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            {transaction.sender_id} to {transaction.recipient_id}
                          </div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                            {transaction.payment_template_id || 'ad hoc flow'} · {transaction.id}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-white">
                          {Number(transaction.amount || 0).toFixed(2)}
                        </div>
                      </div>

                      {selectedBlock.integrity_status !== 'trusted' ? (
                        <div className="mt-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5 text-sm text-slate-300">
                          {selectedBlockStatus.description}
                        </div>
                      ) : null}

                      {selectedBranch.branchType === 'active' ? (
                        <button
                          type="button"
                          onClick={() => onTamper(selectedBlock.index, txIndex)}
                          className="mt-3 w-full rounded-2xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm font-semibold text-rose-100 transition hover:bg-danger/20"
                        >
                          Tamper this transaction
                        </button>
                      ) : (
                        <div className="mt-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5 text-sm text-slate-300">
                          Archived blocks are read-only and preserved for forensic review.
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThreeChainVisualizer;
