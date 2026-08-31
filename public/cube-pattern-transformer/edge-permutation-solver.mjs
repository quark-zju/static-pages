import { analyzePieceState } from "./piece-state.mjs";

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
    throw new Error("12-edge 相对置换是奇置换，需要跨 orbit parity 协调");
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

  const database = new Map([[baseCycle.join(","), []]]);
  const queue = [baseCycle];
  const setupPermutations = new Map(SETUP_MOVES.map((token) => [
    token,
    positionPermutation(invertToken(token)),
  ]));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cycle = queue[cursor];
    const setup = database.get(cycle.join(","));
    for (const token of SETUP_MOVES) {
      const inverseMove = setupPermutations.get(token);
      const nextCycle = canonicalCycle(cycle.map((position) => inverseMove[position]));
      const key = nextCycle.join(",");
      if (!database.has(key)) {
        database.set(key, [token, ...setup]);
        queue.push(nextCycle);
      }
    }
  }
  if (database.size !== 440) {
    throw new Error(`12-edge 3-cycle 覆盖不完整：${database.size}/440`);
  }

  function formulaForCycle(cycle) {
    const setup = database.get(canonicalCycle(cycle).join(","));
    if (!setup) throw new Error("找不到目标 12-edge 3-cycle 公式");
    return [...setup, ...BASE_ALGORITHM, ...invertAlgorithm(setup)];
  }

  return Object.freeze({
    orbitId: orbit.id,
    databaseSize: database.size,
    supportsOrientationChanges: false,
    localToFullCube: model.isOrbitLocalAlgorithm(orbit.id, BASE_ALGORITHM),
    solve(fromColors, toColors) {
      const from = decodeOrbit(model, orbit, fromColors);
      const to = decodeOrbit(model, orbit, toColors);
      const targetPositionByIdentity = Array(12);
      to.permutation.forEach((identity, position) => { targetPositionByIdentity[identity] = position; });
      const relative = from.permutation.map((identity) => targetPositionByIdentity[identity]);

      if (permutationParity(relative) !== 0) {
        throw new Error("12-edge 相对置换是奇置换，需要跨 orbit parity 协调");
      }
      for (let source = 0; source < 12; source += 1) {
        const destination = relative[source];
        if (from.orientation[source] !== to.orientation[destination]) {
          throw new Error("当前 12-edge permutation 阶段尚不支持 orientation 变化");
        }
      }

      const triples = decomposeIntoThreeCycles(relative);
      const tokens = simplifyTokens(triples.flatMap(formulaForCycle));
      const result = model.applyAlgorithm(fromColors, tokens);
      if (!orbit.stickerIndices.every((index) => result[index] === toColors[index])) {
        throw new Error("生成公式未达到目标 12-edge 状态");
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
