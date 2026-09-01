import { createTwentyFourCenterSolver } from "./center-orbit-solver.mjs";

const ODD_WING_CANDIDATE = Object.freeze(
  "2R2 B2 U2 2L' U2 2R U2 2R' U2 F2 2R' F2 2L B2 2R2".split(" "),
);

function inversePermutation(permutation) {
  const inverse = Array(permutation.length);
  permutation.forEach((destination, source) => { inverse[destination] = source; });
  return inverse;
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

export function createFourByFourOddWingPrimitive(model) {
  if (model.size !== 4) {
    throw new Error("odd wing-local primitive 当前只为 4x4x4 建立证书");
  }
  const center = model.pieceOrbits.find((orbit) => (
    orbit.kind === "center" && orbit.pieceIndices.length === 24
  ));
  const wing = model.pieceOrbits.find((orbit) => (
    orbit.kind === "edge" && orbit.pieceIndices.length === 24
  ));
  if (!center || !wing) throw new Error("4x4x4 模型缺少 24-center 或 24-wing orbit");

  const candidateEffects = model.algorithmOrbitEffects(ODD_WING_CANDIDATE);
  if (candidateEffects.length !== 2
      || !candidateEffects.some((effect) => effect.orbitId === center.id)
      || !candidateEffects.some((effect) => effect.orbitId === wing.id)) {
    throw new Error("odd wing 候选公式的 orbit effects 与证书不一致");
  }

  const centerPermutation = piecePermutation(model, center, ODD_WING_CANDIDATE);
  const repair = createTwentyFourCenterSolver(model, center.id)
    .solvePhysicalPermutation(inversePermutation(centerPermutation));
  const tokens = [...ODD_WING_CANDIDATE, ...repair.tokens];
  const effects = model.algorithmOrbitEffects(tokens);
  if (effects.length !== 1 || effects[0].orbitId !== wing.id) {
    throw new Error("修复中心后的 odd wing primitive 不是 wing-local");
  }

  const physicalPermutation = piecePermutation(model, wing, tokens);
  const parity = permutationParity(physicalPermutation);
  if (parity !== 1) throw new Error("wing-local primitive 的 physical permutation 不是 odd");

  return Object.freeze({
    orbitId: wing.id,
    tokens: Object.freeze(tokens),
    formula: tokens.join(" "),
    physicalPermutation: Object.freeze(physicalPermutation),
    parity,
    movedPieceCount: physicalPermutation.filter((destination, source) => (
      destination !== source
    )).length,
    effects: Object.freeze(effects),
    centerRepairMoveCount: repair.tokens.length,
  });
}
