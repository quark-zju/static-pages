import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import { analyzePieceState } from "../../public/cube-pattern-transformer/piece-state.mjs";
import {
  deriveWingPositionGauge,
  matchWingVisualAssignments,
} from "../../public/cube-pattern-transformer/wing-state.mjs";

const WING_CYCLE = "U R U' 2R U R' U' 2R'";
const PATTERNS = [
  "",
  WING_CYCLE,
  `F ${WING_CYCLE} F' R ${WING_CYCLE} R'`,
  "2U' R B2 2F D2 L' U F",
  "F 2R2 U' 2F' B R2 D L2",
];

function wingOrbit(model) {
  return model.pieceOrbits.find((orbit) => (
    orbit.kind === "edge" && orbit.pieceIndices.length === 24
  ));
}

function decodedWing(model, orbit, algorithm) {
  const state = model.applyAlgorithm(model.solvedColors, algorithm);
  return analyzePieceState(model, state).orbits.find((candidate) => candidate.id === orbit.id);
}

function permutationParity(permutation) {
  const visited = new Set();
  let parity = 0;
  for (let start = 0; start < permutation.length; start += 1) {
    if (visited.has(start)) continue;
    let length = 0;
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      length += 1;
      current = permutation[current];
    }
    parity ^= (length - 1) & 1;
  }
  return parity;
}

function bruteAssignmentOracle(model, orbit, gauge, fromDecoded, toDecoded) {
  const local = new Map(orbit.pieceIndices.map((pieceIndex, index) => [pieceIndex, index]));
  const groups = [...Map.groupBy(fromDecoded.positions, (position) => position.signature)]
    .map(([signature, sources]) => ({
      sources,
      targets: Map.groupBy(toDecoded.positions, (position) => position.signature).get(signature),
    }));
  const valid = [];
  for (let mask = 0; mask < 2 ** groups.length; mask += 1) {
    const relative = Array(24);
    let compatible = true;
    groups.forEach(({ sources, targets }, group) => {
      const swap = (mask >> group) & 1;
      for (let index = 0; index < 2; index += 1) {
        const sourceLocal = local.get(sources[index].pieceIndex);
        const target = targets[index ^ swap];
        const targetLocal = local.get(target.pieceIndex);
        const sourceHandedness = sources[index].candidates[0].orientation ^ gauge[sourceLocal];
        const targetHandedness = target.candidates[0].orientation ^ gauge[targetLocal];
        if (sourceHandedness !== targetHandedness) compatible = false;
        relative[sourceLocal] = targetLocal;
      }
    });
    if (compatible) valid.push({ relative, parity: permutationParity(relative) });
  }
  return valid;
}

test("24-wing orientation is a consistent position gauge for every modeled layer", () => {
  const gauges = [];
  for (const size of [4, 5]) {
    const model = createCubeModel(size);
    const orbit = wingOrbit(model);
    const gauge = deriveWingPositionGauge(model, orbit.id);
    gauges.push(gauge);
    assert.equal(gauge.length, 24);
    assert.ok(gauge.every((value) => value === 0 || value === 1));

    const orbitStickerPosition = new Map(
      orbit.stickerIndices.map((stickerIndex, local) => [stickerIndex, local]),
    );
    const localStickerPiece = Array(48);
    const localStickerSlot = Array(48);
    orbit.pieceIndices.forEach((pieceIndex, pieceLocal) => {
      model.pieces[pieceIndex].stickerIndices.forEach((stickerIndex, slot) => {
        const stickerLocal = orbitStickerPosition.get(stickerIndex);
        localStickerPiece[stickerLocal] = pieceLocal;
        localStickerSlot[stickerLocal] = slot;
      });
    });
    for (const face of ["U", "R", "F"]) {
      for (let depth = 1; depth <= size; depth += 1) {
        const token = `${depth === 1 ? "" : depth}${face}`;
        const action = model.orbitPermutation(orbit.id, token);
        orbit.pieceIndices.forEach((pieceIndex, source) => {
          const first = orbitStickerPosition.get(model.pieces[pieceIndex].stickerIndices[0]);
          const destinationSticker = action[first];
          const destination = localStickerPiece[destinationSticker];
          assert.equal(gauge[source] ^ gauge[destination], localStickerSlot[destinationSticker]);
        });
      }
    }
  }
  assert.deepEqual(gauges[0], gauges[1]);
});

test("direct handedness matching agrees with the exhaustive 2^12 assignment oracle", () => {
  for (const size of [4, 5]) {
    const model = createCubeModel(size);
    const orbit = wingOrbit(model);
    const gauge = deriveWingPositionGauge(model, orbit.id);
    const states = PATTERNS.map((algorithm) => decodedWing(model, orbit, algorithm));
    for (let fromIndex = 0; fromIndex < states.length; fromIndex += 1) {
      for (let toIndex = 0; toIndex < states.length; toIndex += 1) {
        const direct = matchWingVisualAssignments(
          model,
          orbit.id,
          gauge,
          states[fromIndex],
          states[toIndex],
        );
        const oracle = bruteAssignmentOracle(
          model,
          orbit,
          gauge,
          states[fromIndex],
          states[toIndex],
        );

        assert.ok(oracle.length > 0);
        assert.ok(oracle.some((candidate) => (
          candidate.parity === direct.parity
          && candidate.relative.every((destination, source) => (
            destination === direct.relative[source]
          ))
        )));
        assert.equal(direct.forcedPairCount + direct.freePairCount, 12);
      }
    }
  }
});
