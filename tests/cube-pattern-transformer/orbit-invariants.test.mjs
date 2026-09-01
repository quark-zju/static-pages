import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import { analyzePieceState } from "../../public/cube-pattern-transformer/piece-state.mjs";

const CASE_A = "2U R' B2 2F D2 L U' F";
const CASE_B = "F 2R2 U 2F' B R2 D' L2";

function piecePermutation(model, orbit, algorithm) {
  const stickerAction = model.orbitPermutation(orbit.id, algorithm);
  const stickerLocal = new Map(
    orbit.stickerIndices.map((stickerIndex, local) => [stickerIndex, local]),
  );
  const stickerPiece = Array(orbit.stickerIndices.length);
  orbit.pieceIndices.forEach((pieceIndex, pieceLocal) => {
    model.pieces[pieceIndex].stickerIndices.forEach((stickerIndex) => {
      stickerPiece[stickerLocal.get(stickerIndex)] = pieceLocal;
    });
  });
  return orbit.pieceIndices.map((pieceIndex) => {
    const sourceSticker = model.pieces[pieceIndex].stickerIndices[0];
    return stickerPiece[stickerAction[stickerLocal.get(sourceSticker)]];
  });
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

function orbitParities(model, algorithm) {
  return Object.fromEntries(model.pieceOrbits.map((orbit) => [
    orbit.id,
    permutationParity(piecePermutation(model, orbit, algorithm)),
  ]));
}

function invariantMasks(model) {
  const generatorParities = ["U", "R", "F"].flatMap((face) => (
    Array.from({ length: model.size }, (_unused, depthIndex) => {
      const token = `${depthIndex === 0 ? "" : depthIndex + 1}${face}`;
      return model.pieceOrbits.reduce((bits, orbit, orbitIndex) => (
        bits | (orbitParities(model, token)[orbit.id] << orbitIndex)
      ), 0);
    })
  ));
  return Array.from({ length: 2 ** model.pieceOrbits.length - 1 }, (_unused, index) => index + 1)
    .filter((mask) => generatorParities.every((generator) => {
      let overlap = mask & generator;
      let parity = 0;
      while (overlap !== 0) {
        parity ^= overlap & 1;
        overlap >>= 1;
      }
      return parity === 0;
    }));
}

function maskFor(model, orbitIds) {
  return orbitIds.reduce((mask, orbitId) => {
    const index = model.pieceOrbits.findIndex((orbit) => orbit.id === orbitId);
    assert.notEqual(index, -1);
    return mask | (1 << index);
  }, 0);
}

test("quarter-turn generators give the exact 4x4 and 5x5 parity invariant spaces", () => {
  const model4 = createCubeModel(4);
  assert.deepEqual(invariantMasks(model4), [
    maskFor(model4, ["center-0", "corner-0"]),
  ]);

  const model5 = createCubeModel(5);
  const basis = [
    maskFor(model5, ["center-1", "corner-0"]),
    maskFor(model5, ["center-0", "center-1", "edge-0"]),
    maskFor(model5, ["center-1", "center-2", "edge-1"]),
  ];
  const span = new Set();
  for (let coefficients = 1; coefficients < 8; coefficients += 1) {
    let mask = 0;
    basis.forEach((vector, index) => {
      if (coefficients & (1 << index)) mask ^= vector;
    });
    span.add(mask);
  }
  assert.deepEqual(new Set(invariantMasks(model5)), span);
});

test("the known other-coset cases retain their exact physical parity diagnosis", () => {
  const expectedWingA = [
    14, 15, 7, 17, 1, 16, 5, 3, 18, 13, 23, 0,
    10, 8, 11, 19, 21, 20, 6, 12, 2, 4, 22, 9,
  ];
  const expectedWingB = [
    16, 2, 15, 7, 14, 6, 11, 9, 19, 0, 4, 1,
    17, 5, 10, 18, 23, 22, 3, 21, 8, 20, 13, 12,
  ];
  const expectedRelativeWing = [
    1, 14, 8, 9, 20, 11, 3, 15, 5, 12, 17, 10,
    21, 0, 16, 2, 6, 7, 19, 18, 22, 23, 13, 4,
  ];

  for (const size of [4, 5]) {
    const model = createCubeModel(size);
    const wing = model.pieceOrbits.find((orbit) => (
      orbit.kind === "edge" && orbit.pieceIndices.length === 24
    ));
    const relative = [...model.invertAlgorithm(CASE_A), ...CASE_B.split(" ")];
    assert.deepEqual(piecePermutation(model, wing, CASE_A), expectedWingA);
    assert.deepEqual(piecePermutation(model, wing, CASE_B), expectedWingB);
    assert.deepEqual(piecePermutation(model, wing, relative), expectedRelativeWing);
  }

  const model4 = createCubeModel(4);
  assert.deepEqual(orbitParities(model4, CASE_A), {
    "center-0": 0,
    "corner-0": 0,
    "edge-0": 0,
  });
  assert.deepEqual(orbitParities(model4, CASE_B), {
    "center-0": 0,
    "corner-0": 0,
    "edge-0": 1,
  });

  const model5 = createCubeModel(5);
  assert.deepEqual(orbitParities(model5, CASE_B), {
    "center-0": 0,
    "center-1": 0,
    "center-2": 1,
    "corner-0": 0,
    "edge-0": 0,
    "edge-1": 1,
  });
});

test("legal random sequences preserve all certified parity and orientation invariants", () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = ((1664525 * seed) + 1013904223) >>> 0;
    return seed;
  };

  for (const size of [4, 5]) {
    const model = createCubeModel(size);
    const moves = ["U", "R", "F", "D", "L", "B"].flatMap((face) => (
      Array.from({ length: size }, (_unused, depthIndex) => (
        ["", "'", "2"].map((suffix) => (
          `${depthIndex === 0 ? "" : depthIndex + 1}${face}${suffix}`
        ))
      )).flat()
    ));
    const invariants = invariantMasks(model);
    for (let sample = 0; sample < 250; sample += 1) {
      const algorithm = Array.from({ length: 25 }, () => moves[random() % moves.length]);
      const parities = orbitParities(model, algorithm);
      const parityBits = model.pieceOrbits.reduce((bits, orbit, index) => (
        bits | (parities[orbit.id] << index)
      ), 0);
      assert.ok(invariants.every((mask) => {
        let overlap = mask & parityBits;
        let parity = 0;
        while (overlap !== 0) {
          parity ^= overlap & 1;
          overlap >>= 1;
        }
        return parity === 0;
      }));
      const state = model.applyAlgorithm(model.solvedColors, algorithm);
      assert.equal(analyzePieceState(model, state).valid, true);
    }
  }
});
