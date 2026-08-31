import { analyzePieceState } from "./piece-state.mjs";

const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const MOVE_TOKENS = Object.freeze(FACE_NAMES.flatMap((face) => [face, `${face}2`, `${face}'`]));
const FACTORIAL = Object.freeze([1, 1, 2, 6, 24, 120, 720, 5040, 40320]);
const PERMUTATION_COUNT = FACTORIAL[8];
const ORIENTATION_COUNT = 3 ** 7;
const UNVISITED = 255;
const tableCache = new Map();

function permutationIndex(permutation) {
  let index = 0;
  for (let position = 0; position < permutation.length - 1; position += 1) {
    let lower = 0;
    for (let next = position + 1; next < permutation.length; next += 1) {
      if (permutation[next] < permutation[position]) lower += 1;
    }
    index += lower * FACTORIAL[permutation.length - 1 - position];
  }
  return index;
}

function permutationFromIndex(index) {
  const available = [0, 1, 2, 3, 4, 5, 6, 7];
  const permutation = [];
  for (let position = 0; position < 8; position += 1) {
    const divisor = FACTORIAL[7 - position];
    const selected = Math.floor(index / divisor);
    index %= divisor;
    permutation.push(available.splice(selected, 1)[0]);
  }
  return permutation;
}

function orientationIndex(orientation) {
  return orientation.slice(0, 7).reduce((index, value) => (index * 3) + value, 0);
}

function orientationFromIndex(index) {
  const orientation = Array(8).fill(0);
  let sum = 0;
  for (let position = 6; position >= 0; position -= 1) {
    orientation[position] = index % 3;
    sum += orientation[position];
    index = Math.floor(index / 3);
  }
  orientation[7] = (3 - (sum % 3)) % 3;
  return orientation;
}

function cornerStateFromAnalysis(model, analysis) {
  const orbit = model.pieceOrbits.find((candidate) => candidate.kind === "corner");
  const decoded = analysis.orbits.find((candidate) => candidate.id === orbit.id);
  if (!decoded?.valid) {
    const codes = decoded?.errors.map((error) => error.code).join(", ") || "missing-corner-orbit";
    throw new Error(`角块状态无效：${codes}`);
  }
  const localPieceIndex = new Map(orbit.pieceIndices.map((pieceIndex, local) => [pieceIndex, local]));
  return {
    permutation: decoded.positions.map((position) => localPieceIndex.get(position.candidates[0].pieceIndex)),
    orientation: decoded.positions.map((position) => position.candidates[0].orientation),
  };
}

function cornerState(model, colors) {
  return cornerStateFromAnalysis(model, analyzePieceState(model, colors));
}

function moveTransforms(model) {
  return MOVE_TOKENS.map((token) => cornerState(
    model,
    model.applyAlgorithm(model.solvedColors, token),
  ));
}

function applyTransform(permutation, orientation, transform) {
  const nextPermutation = Array(8);
  const nextOrientation = Array(8);
  for (let destination = 0; destination < 8; destination += 1) {
    const source = transform.permutation[destination];
    nextPermutation[destination] = permutation[source];
    nextOrientation[destination] = (
      orientation[source] + transform.orientation[destination]
    ) % 3;
  }
  return { permutation: nextPermutation, orientation: nextOrientation };
}

function buildMoveTables(transforms) {
  const permutationMoves = transforms.map(() => new Uint16Array(PERMUTATION_COUNT));
  const orientationMoves = transforms.map(() => new Uint16Array(ORIENTATION_COUNT));

  for (let index = 0; index < PERMUTATION_COUNT; index += 1) {
    const permutation = permutationFromIndex(index);
    transforms.forEach((transform, moveIndex) => {
      const next = applyTransform(permutation, Array(8).fill(0), transform);
      permutationMoves[moveIndex][index] = permutationIndex(next.permutation);
    });
  }
  for (let index = 0; index < ORIENTATION_COUNT; index += 1) {
    const orientation = orientationFromIndex(index);
    transforms.forEach((transform, moveIndex) => {
      const next = applyTransform([0, 1, 2, 3, 4, 5, 6, 7], orientation, transform);
      orientationMoves[moveIndex][index] = orientationIndex(next.orientation);
    });
  }
  return { permutationMoves, orientationMoves };
}

function buildDistances(moveTables, stateCount) {
  const distances = new Uint8Array(stateCount);
  distances.fill(UNVISITED);
  distances[0] = 0;
  const queue = new Uint32Array(stateCount);
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const state = queue[head];
    head += 1;
    const nextDistance = distances[state] + 1;
    for (const table of moveTables) {
      const next = table[state];
      if (distances[next] === UNVISITED) {
        distances[next] = nextDistance;
        queue[tail] = next;
        tail += 1;
      }
    }
  }
  if (tail !== stateCount) throw new Error(`角块坐标搜索表覆盖不完整：${tail}/${stateCount}`);
  return distances;
}

function tablesFor(model) {
  const transforms = moveTransforms(model);
  const key = JSON.stringify(transforms);
  if (tableCache.has(key)) return tableCache.get(key);
  const moves = buildMoveTables(transforms);
  const tables = Object.freeze({
    ...moves,
    permutationDistance: buildDistances(moves.permutationMoves, PERMUTATION_COUNT),
    orientationDistance: buildDistances(moves.orientationMoves, ORIENTATION_COUNT),
  });
  tableCache.set(key, tables);
  return tables;
}

function solveCoordinates(state, tables, maxDepth) {
  const startPermutation = permutationIndex(state.permutation);
  const startOrientation = orientationIndex(state.orientation);
  const path = [];
  let searchedNodes = 0;

  function search(permutation, orientation, remaining, previousFace) {
    searchedNodes += 1;
    const heuristic = Math.max(
      tables.permutationDistance[permutation],
      tables.orientationDistance[orientation],
    );
    if (heuristic > remaining) return false;
    if (remaining === 0) return permutation === 0 && orientation === 0;

    for (let move = 0; move < MOVE_TOKENS.length; move += 1) {
      const face = Math.floor(move / 3);
      if (face === previousFace) continue;
      path.push(MOVE_TOKENS[move]);
      if (search(
        tables.permutationMoves[move][permutation],
        tables.orientationMoves[move][orientation],
        remaining - 1,
        face,
      )) return true;
      path.pop();
    }
    return false;
  }

  const initialBound = Math.max(
    tables.permutationDistance[startPermutation],
    tables.orientationDistance[startOrientation],
  );
  for (let depth = initialBound; depth <= maxDepth; depth += 1) {
    if (search(startPermutation, startOrientation, depth, -1)) {
      return { tokens: [...path], searchedNodes, depth };
    }
  }
  throw new Error(`在 ${maxDepth} 步内找不到角块解`);
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

export function createCornerOrbitSolver(model, options = {}) {
  const cornerOrbit = model.pieceOrbits.find((orbit) => orbit.kind === "corner");
  if (!cornerOrbit) throw new Error("模型没有角块 orbit");
  const maxDepth = options.maxDepth ?? 14;
  const tables = tablesFor(model);

  return Object.freeze({
    orbitId: cornerOrbit.id,
    moveCount: MOVE_TOKENS.length,
    permutationStateCount: PERMUTATION_COUNT,
    orientationStateCount: ORIENTATION_COUNT,
    solve(fromColors, toColors) {
      const fromState = cornerState(model, fromColors);
      const toState = cornerState(model, toColors);
      const fromSolution = solveCoordinates(fromState, tables, maxDepth);
      const toSolution = solveCoordinates(toState, tables, maxDepth);
      const tokens = simplifyTokens([
        ...fromSolution.tokens,
        ...model.invertAlgorithm(toSolution.tokens),
      ]);
      const result = model.applyAlgorithm(fromColors, tokens);
      if (!cornerOrbit.stickerIndices.every((index) => result[index] === toColors[index])) {
        throw new Error("生成公式未达到目标角块状态");
      }
      return Object.freeze({
        tokens: Object.freeze(tokens),
        formula: tokens.join(" "),
        searchedNodes: fromSolution.searchedNodes + toSolution.searchedNodes,
        stageDepth: fromSolution.depth + toSolution.depth,
        effects: Object.freeze(model.algorithmOrbitEffects(tokens)),
      });
    },
  });
}
