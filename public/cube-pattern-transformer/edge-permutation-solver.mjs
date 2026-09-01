import { analyzePieceState } from "./piece-state.mjs";
import {
  OrbitSolverError,
  UNSUPPORTED_ORBIT_SUBGROUP,
} from "./orbit-solver-error.mjs";

const BASE_ALGORITHM = Object.freeze(
  "R U' R U R U R U' R' U' R2".split(" "),
);
const SETUP_MOVES = Object.freeze(
  ["U", "R", "F", "D", "L", "B"].flatMap((face) => [face, `${face}'`, `${face}2`]),
);

function invertToken(token) {
  if (token.endsWith("2")) return token;
  return token.endsWith("'") ? token.slice(0, -1) : `${token}'`;
}

function invertAlgorithm(tokens) {
  return [...tokens].reverse().map(invertToken);
}

function compose(first, second) {
  return first.map((location) => second[location]);
}

function invertPermutation(permutation) {
  const inverse = Array(permutation.length);
  permutation.forEach((destination, source) => { inverse[destination] = source; });
  return inverse;
}

function canonicalCycle(cycle) {
  const rotations = [cycle, [cycle[1], cycle[2], cycle[0]], [cycle[2], cycle[0], cycle[1]]];
  return rotations.sort((first, second) => (
    first[0] - second[0] || first[1] - second[1] || first[2] - second[2]
  ))[0];
}

function cycleFromPermutation(permutation) {
  const moved = permutation.map((destination, source) => ({ source, destination }))
    .filter(({ source, destination }) => source !== destination);
  if (moved.length !== 3) return null;
  const a = moved[0].source;
  const b = permutation[a];
  const c = permutation[b];
  return permutation[c] === a ? canonicalCycle([a, b, c]) : null;
}

function permutationParity(permutation) {
  const visited = new Set();
  let transpositions = 0;
  for (let start = 0; start < permutation.length; start += 1) {
    if (visited.has(start)) continue;
    let length = 0;
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      length += 1;
      current = permutation[current];
    }
    transpositions += Math.max(0, length - 1);
  }
  return transpositions % 2;
}

function decomposeIntoThreeCycles(permutation) {
  const visited = new Set();
  const triples = [];
  const transpositions = [];
  for (let start = 0; start < permutation.length; start += 1) {
    if (visited.has(start) || permutation[start] === start) continue;
    const cycle = [];
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      cycle.push(current);
      current = permutation[current];
    }
    const stop = cycle.length % 2 === 0 ? cycle.length - 2 : cycle.length - 1;
    for (let index = 1; index < stop; index += 2) {
      triples.push([cycle[0], cycle[index], cycle[index + 1]]);
    }
    if (cycle.length % 2 === 0) transpositions.push([cycle[0], cycle.at(-1)]);
  }
  if (transpositions.length % 2 !== 0) {
    throw new OrbitSolverError(
      UNSUPPORTED_ORBIT_SUBGROUP,
      "12-edge odd permutation 超出当前 A12 primitive 限制；这不表示目标不可达",
      { implementedGroup: "A12", requestedParity: 1 },
    );
  }
  for (let index = 0; index < transpositions.length; index += 2) {
    const [a, b] = transpositions[index];
    const [c, d] = transpositions[index + 1];
    triples.push([a, b, d], [a, c, d]);
  }
  return triples;
}

function simplifyTokens(tokens) {
  const stack = [];
  for (const token of tokens) {
    const face = token[0];
    const amount = token.endsWith("2") ? 2 : token.endsWith("'") ? 3 : 1;
    const previous = stack.at(-1);
    if (!previous || previous.face !== face) {
      stack.push({ face, amount });
      continue;
    }
    previous.amount = (previous.amount + amount) % 4;
    if (previous.amount === 0) stack.pop();
  }
  return stack.map(({ face, amount }) => (
    amount === 1 ? face : amount === 2 ? `${face}2` : `${face}'`
  ));
}

function decodeOrbit(model, orbit, colors) {
  const analysis = analyzePieceState(model, colors);
  const decoded = analysis.orbits.find((candidate) => candidate.id === orbit.id);
  if (!decoded?.valid) {
    const codes = decoded?.errors.map((error) => error.code).join(", ") || "missing-edge-orbit";
    throw new Error(`12-edge 状态无效：${codes}`);
  }
  if (decoded.positions.some((position) => position.candidates.length !== 1)) {
    throw new Error("12-edge orbit 的贴纸颜色不能唯一识别 piece identity");
  }
  const localPieceIndex = new Map(orbit.pieceIndices.map((pieceIndex, local) => [pieceIndex, local]));
  return {
    permutation: decoded.positions.map((position) => (
      localPieceIndex.get(position.candidates[0].pieceIndex)
    )),
    orientation: decoded.positions.map((position) => position.candidates[0].orientation),
  };
}

export function createTwelveEdgePermutationSolver(model) {
  const orbit = model.pieceOrbits.find((candidate) => (
    candidate.kind === "edge" && candidate.pieceIndices.length === 12
  ));
  if (!orbit) throw new Error("模型没有 12-piece edge orbit");

  const localPosition = new Map(orbit.pieceIndices.map((pieceIndex, local) => [pieceIndex, local]));
  const pieceByKey = new Map(model.pieces.map((piece, index) => [piece.key, index]));
  const orbitStickerPosition = new Map(
    orbit.stickerIndices.map((stickerIndex, local) => [stickerIndex, local]),
  );
  const localStickerPiece = Array(orbit.stickerIndices.length);
  const localStickerSlot = Array(orbit.stickerIndices.length);
  orbit.pieceIndices.forEach((pieceIndex, pieceLocal) => {
    model.pieces[pieceIndex].stickerIndices.forEach((stickerIndex, slot) => {
      const stickerLocal = orbitStickerPosition.get(stickerIndex);
      localStickerPiece[stickerLocal] = pieceLocal;
      localStickerSlot[stickerLocal] = slot;
    });
  });

  function piecePermutationFromStickers(stickerPermutation) {
    return orbit.pieceIndices.map((pieceIndex) => {
      const sourceSticker = model.pieces[pieceIndex].stickerIndices[0];
      const sourceLocal = orbitStickerPosition.get(sourceSticker);
      return localStickerPiece[stickerPermutation[sourceLocal]];
    });
  }

  function positionPermutation(algorithm) {
    const stickerPermutation = model.algorithmPermutation(algorithm);
    return orbit.pieceIndices.map((pieceIndex) => {
      const sourcePiece = model.pieces[pieceIndex];
      const destinationSticker = model.stickers[stickerPermutation[sourcePiece.stickerIndices[0]]];
      const destinationPiece = pieceByKey.get(destinationSticker.position.join(","));
      const destination = localPosition.get(destinationPiece);
      if (destination === undefined) throw new Error(`公式把 piece 移出了 ${orbit.id}`);
      return destination;
    });
  }

  function edgeAction(stickerPermutation) {
    const destinationToSource = Array(12);
    const orientation = Array(12);
    orbit.pieceIndices.forEach((pieceIndex, source) => {
      const firstSticker = model.pieces[pieceIndex].stickerIndices[0];
      const firstLocal = orbitStickerPosition.get(firstSticker);
      const destinationSticker = stickerPermutation[firstLocal];
      const destination = localStickerPiece[destinationSticker];
      destinationToSource[destination] = source;
      orientation[destination] = localStickerSlot[destinationSticker];
    });
    return { destinationToSource, orientation };
  }

  const basePermutation = positionPermutation(BASE_ALGORITHM);
  const baseCycle = cycleFromPermutation(basePermutation);
  const baseState = decodeOrbit(
    model,
    orbit,
    model.applyAlgorithm(model.solvedColors, BASE_ALGORITHM),
  );
  if (!baseCycle || baseState.orientation.some((orientation) => orientation !== 0)) {
    throw new Error("基础公式不是无翻转的 12-edge 3-cycle");
  }

  const baseStickerPermutation = model.orbitPermutation(orbit.id, BASE_ALGORITHM);
  const database = new Map([[
    baseStickerPermutation.join(","),
    { stickerPermutation: baseStickerPermutation, setup: [] },
  ]]);
  const queue = [baseStickerPermutation];
  const setupPermutations = new Map(SETUP_MOVES.map((token) => [token, {
    forward: model.orbitPermutation(orbit.id, token),
    inverse: model.orbitPermutation(orbit.id, invertToken(token)),
  }]));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const action = queue[cursor];
    const setup = database.get(action.join(",")).setup;
    for (const token of SETUP_MOVES) {
      const move = setupPermutations.get(token);
      const nextAction = compose(compose(move.forward, action), move.inverse);
      const key = nextAction.join(",");
      if (!database.has(key)) {
        database.set(key, { stickerPermutation: nextAction, setup: [token, ...setup] });
        queue.push(nextAction);
      }
    }
  }
  if (database.size !== 1760) {
    throw new Error(`12-edge orientation 3-cycle 覆盖不完整：${database.size}/1760`);
  }

  function formulaForEntry(entry) {
    const { setup } = entry;
    return [...setup, ...BASE_ALGORITHM, ...invertAlgorithm(setup)];
  }

  const variantsByCycle = Map.groupBy([...database.values()], (entry) => {
    const cycle = cycleFromPermutation(piecePermutationFromStickers(entry.stickerPermutation));
    if (!cycle) throw new Error("共轭动作不是 12-edge 3-cycle");
    return cycle.join(",");
  });
  if (variantsByCycle.size !== 440
      || [...variantsByCycle.values()].some((variants) => variants.length !== 4)) {
    throw new Error("12-edge cycle 的 orientation 变体覆盖不完整");
  }

  function formulaForCycle(cycle) {
    const variants = variantsByCycle.get(canonicalCycle(cycle).join(","));
    if (!variants) throw new Error("找不到目标 12-edge 3-cycle 公式");
    return formulaForEntry(variants[0]);
  }

  const flipBasis = Array(12).fill(null);
  function addFlipGenerator(vector, tokens) {
    for (let bit = 11; bit >= 0; bit -= 1) {
      if ((vector & (1 << bit)) === 0) continue;
      if (flipBasis[bit]) {
        vector ^= flipBasis[bit].vector;
        tokens = [...tokens, ...flipBasis[bit].tokens];
      } else {
        flipBasis[bit] = { vector, tokens };
        return;
      }
    }
  }

  for (const variants of variantsByCycle.values()) {
    const reference = variants[0];
    const referenceFormula = formulaForEntry(reference);
    const inverseReference = invertPermutation(reference.stickerPermutation);
    for (const variant of variants.slice(1)) {
      const pureFlip = compose(variant.stickerPermutation, inverseReference);
      const action = edgeAction(pureFlip);
      if (action.destinationToSource.some((source, destination) => source !== destination)) {
        throw new Error("orientation 变体相消后仍改变 edge permutation");
      }
      const vector = action.orientation.reduce(
        (bits, orientation, position) => bits | (orientation << position),
        0,
      );
      addFlipGenerator(vector, [
        ...formulaForEntry(variant),
        ...invertAlgorithm(referenceFormula),
      ]);
    }
  }
  const flipBasisRank = flipBasis.filter(Boolean).length;
  if (flipBasisRank !== 11) {
    throw new Error(`12-edge flip 基底覆盖不完整：${flipBasisRank}/11`);
  }

  function formulaForFlips(vector) {
    const tokens = [];
    for (let bit = 11; bit >= 0; bit -= 1) {
      if ((vector & (1 << bit)) === 0) continue;
      const basis = flipBasis[bit];
      if (!basis) throw new Error("目标 edge orientation 不在偶数翻转子群中");
      vector ^= basis.vector;
      tokens.push(...basis.tokens);
    }
    if (vector !== 0) throw new Error("目标 edge orientation 不在偶数翻转子群中");
    return tokens;
  }

  return Object.freeze({
    orbitId: orbit.id,
    databaseSize: variantsByCycle.size,
    actionDatabaseSize: database.size,
    flipBasisRank,
    supportsOrientationChanges: true,
    physicalPermutationGroup: "A12",
    oddAssignmentsSupported: false,
    localToFullCube: model.isOrbitLocalAlgorithm(orbit.id, BASE_ALGORITHM),
    solve(fromColors, toColors) {
      const from = decodeOrbit(model, orbit, fromColors);
      const to = decodeOrbit(model, orbit, toColors);
      const targetPositionByIdentity = Array(12);
      to.permutation.forEach((identity, position) => { targetPositionByIdentity[identity] = position; });
      const relative = from.permutation.map((identity) => targetPositionByIdentity[identity]);

      if (permutationParity(relative) !== 0) {
        throw new OrbitSolverError(
          UNSUPPORTED_ORBIT_SUBGROUP,
          "12-edge odd permutation 超出当前 A12 primitive 限制；这不表示目标不可达",
          { orbitId: orbit.id, implementedGroup: "A12", requestedParity: 1 },
        );
      }
      const triples = decomposeIntoThreeCycles(relative);
      const permutationTokens = triples.flatMap(formulaForCycle);
      const intermediate = model.applyAlgorithm(fromColors, permutationTokens);
      const intermediateState = decodeOrbit(model, orbit, intermediate);
      if (intermediateState.permutation.some((identity, position) => identity !== to.permutation[position])) {
        throw new Error("12-edge permutation 分解结果不正确");
      }
      const flipVector = intermediateState.orientation.reduce((bits, orientation, position) => (
        bits | ((orientation ^ to.orientation[position]) << position)
      ), 0);
      const tokens = simplifyTokens([...permutationTokens, ...formulaForFlips(flipVector)]);
      const result = model.applyAlgorithm(fromColors, tokens);
      if (!orbit.stickerIndices.every((index) => result[index] === toColors[index])) {
        throw new Error("当前 12-edge permutation 阶段无法达到目标 orientation");
      }
      return Object.freeze({
        triples: Object.freeze(triples.map((cycle) => Object.freeze(cycle))),
        tokens: Object.freeze(tokens),
        formula: tokens.join(" "),
        effects: Object.freeze(model.algorithmOrbitEffects(tokens)),
      });
    },
  });
}
