import { analyzePieceState } from "./piece-state.mjs";
import { createFourByFourOddWingPrimitive } from "./four-by-four-wing-parity.mjs";
import {
  deriveWingPositionGauge,
  matchWingVisualAssignments,
} from "./wing-state.mjs";

const BASE_ALGORITHM = Object.freeze(
  "U R U' 2R U R' U' 2R'".split(" "),
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
  if (transpositions.length % 2 !== 0) throw new Error("wing 相对置换不是偶置换");
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
    const quantum = token.replace(/[2']$/, "");
    const amount = token.endsWith("2") ? 2 : token.endsWith("'") ? 3 : 1;
    const previous = stack.at(-1);
    if (!previous || previous.quantum !== quantum) {
      stack.push({ quantum, amount });
      continue;
    }
    previous.amount = (previous.amount + amount) % 4;
    if (previous.amount === 0) stack.pop();
  }
  return stack.map(({ quantum, amount }) => (
    amount === 1 ? quantum : amount === 2 ? `${quantum}2` : `${quantum}'`
  ));
}

function applyLocalPermutation(values, permutation) {
  const result = [...values];
  values.forEach((value, source) => { result[permutation[source]] = value; });
  return result;
}

function decodedOrbit(model, orbit, colors) {
  const analysis = analyzePieceState(model, colors);
  const decoded = analysis.orbits.find((candidate) => candidate.id === orbit.id);
  if (!decoded?.valid) {
    const codes = decoded?.errors.map((error) => error.code).join(", ") || "missing-wing-orbit";
    throw new Error(`24-wing 状态无效：${codes}`);
  }
  return decoded;
}

export function createTwentyFourWingSolver(model) {
  const orbit = model.pieceOrbits.find((candidate) => (
    candidate.kind === "edge" && candidate.pieceIndices.length === 24
  ));
  if (!orbit) throw new Error("模型没有 24-piece wing orbit");
  const baseEffects = model.algorithmOrbitEffects(BASE_ALGORITHM);
  if (baseEffects.length !== 1
      || baseEffects[0].orbitId !== orbit.id
      || baseEffects[0].movedStickerCount !== 6) {
    throw new Error("基础 wing 公式不是纯局部 3-cycle");
  }

  const orbitStickerPosition = new Map(
    orbit.stickerIndices.map((stickerIndex, local) => [stickerIndex, local]),
  );
  const localStickerPiece = Array(orbit.stickerIndices.length);
  orbit.pieceIndices.forEach((pieceIndex, pieceLocal) => {
    model.pieces[pieceIndex].stickerIndices.forEach((stickerIndex) => {
      localStickerPiece[orbitStickerPosition.get(stickerIndex)] = pieceLocal;
    });
  });

  function piecePermutation(stickerPermutation) {
    return orbit.pieceIndices.map((pieceIndex) => {
      const sourceSticker = model.pieces[pieceIndex].stickerIndices[0];
      return localStickerPiece[stickerPermutation[orbitStickerPosition.get(sourceSticker)]];
    });
  }

  const setupQuantums = ["U", "R", "F", "D", "L", "B"];
  for (let depth = 2; depth <= model.size - 2; depth += 1) {
    setupQuantums.push(`${depth}U`, `${depth}R`, `${depth}F`);
  }
  const setupMoves = setupQuantums.flatMap((token) => [token, `${token}'`, `${token}2`]);
  const setupActions = new Map(setupMoves.map((token) => [token, {
    forward: model.orbitPermutation(orbit.id, token),
    inverse: model.orbitPermutation(orbit.id, invertToken(token)),
  }]));
  const baseAction = model.orbitPermutation(orbit.id, BASE_ALGORITHM);
  const database = new Map([[
    cycleFromPermutation(piecePermutation(baseAction)).join(","),
    { action: baseAction, setup: [] },
  ]]);
  const queue = [...database.values()];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const entry = queue[cursor];
    for (const token of setupMoves) {
      const move = setupActions.get(token);
      const action = compose(compose(move.forward, entry.action), move.inverse);
      const cycle = cycleFromPermutation(piecePermutation(action));
      if (!cycle) throw new Error("共轭 wing 动作不是 3-cycle");
      const key = cycle.join(",");
      if (!database.has(key)) {
        const next = { action, setup: [token, ...entry.setup] };
        database.set(key, next);
        queue.push(next);
      }
    }
  }
  if (database.size !== 4048) {
    throw new Error(`wing 3-cycle 覆盖不完整：${database.size}/4048`);
  }

  function formulaForEntry(entry) {
    return [...entry.setup, ...BASE_ALGORITHM, ...invertAlgorithm(entry.setup)];
  }

  const positionGauge = deriveWingPositionGauge(model, orbit.id);

  return Object.freeze({
    orbitId: orbit.id,
    databaseSize: database.size,
    assignmentMethod: "handedness-matching",
    physicalPermutationGroup: model.size === 4 ? "S24" : "A24",
    oddAssignmentsSupported: model.size === 4,
    positionGauge,
    localToFullCube: true,
    solve(fromColors, toColors) {
      const fromDecoded = decodedOrbit(model, orbit, fromColors);
      const toDecoded = decodedOrbit(model, orbit, toColors);
      const initialAssignment = matchWingVisualAssignments(
        model,
        orbit.id,
        positionGauge,
        fromDecoded,
        toDecoded,
      );
      let workingFromColors = fromColors;
      let oddPrimitive = null;
      let assignment = initialAssignment;
      if (initialAssignment.parity !== 0) {
        if (model.size !== 4) {
          throw new Error(
            "5x5x5 odd 24-wing assignment 超出第一版 A24 local solver 限制；这不表示目标不可达",
          );
        }
        oddPrimitive = createFourByFourOddWingPrimitive(model);
        workingFromColors = model.applyAlgorithm(fromColors, oddPrimitive.tokens);
        const workingDecoded = decodedOrbit(model, orbit, workingFromColors);
        assignment = matchWingVisualAssignments(
          model,
          orbit.id,
          positionGauge,
          workingDecoded,
          toDecoded,
        );
        if (assignment.parity !== 0) {
          throw new Error("4x4x4 odd wing primitive 没有把剩余目标归一化到 A24");
        }
      }
      const fromLocalColors = orbit.stickerIndices.map((index) => workingFromColors[index]);
      const toLocalColors = orbit.stickerIndices.map((index) => toColors[index]);
      const triples = decomposeIntoThreeCycles(assignment.relative);
      let action = Array.from({ length: 48 }, (_unused, index) => index);
      const entries = [];
      for (const cycle of triples) {
        const entry = database.get(canonicalCycle(cycle).join(","));
        if (!entry) throw new Error("找不到目标 wing 3-cycle");
        action = compose(action, entry.action);
        entries.push(entry);
      }
      if (!applyLocalPermutation(fromLocalColors, action)
        .every((color, index) => color === toLocalColors[index])) {
        throw new Error("24-wing handedness matching 与完整 sticker action 不一致");
      }

      const tokens = simplifyTokens([
        ...(oddPrimitive?.tokens ?? []),
        ...entries.flatMap(formulaForEntry),
      ]);
      const result = model.applyAlgorithm(fromColors, tokens);
      if (!orbit.stickerIndices.every((index) => result[index] === toColors[index])) {
        throw new Error("生成公式未达到目标 24-wing 状态");
      }
      const effects = model.algorithmOrbitEffects(tokens);
      if (effects.some((effect) => effect.orbitId !== orbit.id)) {
        throw new Error("24-wing 公式意外影响其他 orbit");
      }
      return Object.freeze({
        assignmentParity: initialAssignment.parity,
        normalizedAssignmentParity: assignment.parity,
        forcedPairCount: initialAssignment.forcedPairCount,
        freePairCount: initialAssignment.freePairCount,
        usedOddPrimitive: oddPrimitive !== null,
        triples: Object.freeze(triples.map((cycle) => Object.freeze(cycle))),
        tokens: Object.freeze(tokens),
        formula: tokens.join(" "),
        effects: Object.freeze(effects),
      });
    },
  });
}
