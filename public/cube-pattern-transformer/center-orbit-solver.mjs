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
  if (transpositions.length % 2 !== 0) throw new Error("中心相对置换 parity 无法由 3-cycle 表示");
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

function baseAlgorithm(firstDepth, secondDepth) {
  return [
    "F'",
    `${firstDepth}L`,
    `${secondDepth}F'`,
    `${firstDepth}L'`,
    "F",
    `${firstDepth}L`,
    `${secondDepth}F`,
    `${firstDepth}L'`,
  ];
}

function countOrbitColors(model, orbit, colors) {
  const counts = Object.fromEntries(model.colors.map((color) => [color, 0]));
  for (const index of orbit.stickerIndices) {
    if (!(colors[index] in counts)) throw new Error(`不支持的中心颜色：${colors[index]}`);
    counts[colors[index]] += 1;
  }
  return counts;
}

export function createTwentyFourCenterSolver(model, orbitId) {
  const candidates = model.pieceOrbits.filter((orbit) => (
    orbit.kind === "center" && orbit.pieceIndices.length === 24
  ));
  const orbit = orbitId
    ? candidates.find((candidate) => candidate.id === orbitId)
    : candidates.length === 1 ? candidates[0] : null;
  if (!orbit) {
    throw new Error(orbitId
      ? `模型没有指定的 24-center orbit：${orbitId}`
      : "模型必须恰好有一个 24-center orbit，或显式提供 orbitId");
  }

  const possibleBases = [];
  for (let firstDepth = 2; firstDepth <= model.size - 2; firstDepth += 1) {
    for (let secondDepth = 2; secondDepth <= model.size - 2; secondDepth += 1) {
      possibleBases.push(baseAlgorithm(firstDepth, secondDepth));
    }
  }
  const base = possibleBases.find((algorithm) => {
    const effects = model.algorithmOrbitEffects(algorithm);
    return effects.length === 1
      && effects[0].orbitId === orbit.id
      && effects[0].movedStickerCount === 3;
  });
  if (!base) throw new Error(`找不到 ${orbit.id} 的纯中心 3-cycle 基础公式`);

  const basePermutation = model.orbitPermutation(orbit.id, base);
  const moved = basePermutation.map((destination, source) => ({ source, destination }))
    .filter(({ source, destination }) => source !== destination);
  if (moved.length !== 3) throw new Error("基础中心公式不是 3-cycle");
  const a = moved[0].source;
  const b = basePermutation[a];
  const c = basePermutation[b];
  if (basePermutation[c] !== a) throw new Error("基础中心公式不是 directed 3-cycle");
  const baseCycle = canonicalCycle([a, b, c]);

  const setupQuantums = ["U", "R", "F", "D", "L", "B"];
  for (let depth = 2; depth <= model.size - 2; depth += 1) {
    setupQuantums.push(`${depth}U`, `${depth}R`, `${depth}F`);
  }
  const setupMoves = setupQuantums.flatMap((token) => [token, `${token}'`, `${token}2`]);
  const inverseMoves = new Map(setupMoves.map((token) => [
    token,
    model.orbitPermutation(orbit.id, invertToken(token)),
  ]));
  const database = new Map([[baseCycle.join(","), []]]);
  const queue = [baseCycle];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cycle = queue[cursor];
    const setup = database.get(cycle.join(","));
    for (const token of setupMoves) {
      const inverseMove = inverseMoves.get(token);
      const nextCycle = canonicalCycle(cycle.map((position) => inverseMove[position]));
      const key = nextCycle.join(",");
      if (!database.has(key)) {
        database.set(key, [token, ...setup]);
        queue.push(nextCycle);
      }
    }
  }
  if (database.size !== 4048) {
    throw new Error(`${orbit.id} 的中心 3-cycle 覆盖不完整：${database.size}/4048`);
  }

  function formulaForCycle(cycle) {
    const setup = database.get(canonicalCycle(cycle).join(","));
    if (!setup) throw new Error(`找不到 ${orbit.id} 的目标中心 3-cycle`);
    return [...setup, ...base, ...invertAlgorithm(setup)];
  }

  function solvePhysicalPermutation(permutation) {
    if (!Array.isArray(permutation)
        || permutation.length !== 24
        || permutation.some((destination) => (
          !Number.isInteger(destination) || destination < 0 || destination >= 24
        ))
        || new Set(permutation).size !== 24) {
      throw new Error(`${orbit.id} physical permutation 必须是 0..23 的双射`);
    }
    if (permutationParity(permutation) !== 0) {
      throw new Error(`${orbit.id} physical permutation 是奇置换，无法由 local 3-cycle 生成`);
    }
    const triples = decomposeIntoThreeCycles(permutation);
    const tokens = simplifyTokens(triples.flatMap(formulaForCycle));
    const actual = model.orbitPermutation(orbit.id, tokens);
    if (actual.some((destination, source) => destination !== permutation[source])) {
      throw new Error(`${orbit.id} physical permutation 公式验证失败`);
    }
    const effects = model.algorithmOrbitEffects(tokens);
    if (effects.some((effect) => effect.orbitId !== orbit.id)) {
      throw new Error(`${orbit.id} physical permutation 公式意外影响其他 orbit`);
    }
    return Object.freeze({
      permutation: Object.freeze([...permutation]),
      triples: Object.freeze(triples.map((cycle) => Object.freeze(cycle))),
      tokens: Object.freeze(tokens),
      formula: tokens.join(" "),
      effects: Object.freeze(effects),
    });
  }

  return Object.freeze({
    orbitId: orbit.id,
    databaseSize: database.size,
    localToFullCube: true,
    solvePhysicalPermutation,
    solve(fromColors, toColors) {
      if (!Array.isArray(fromColors) || fromColors.length !== model.stickers.length
          || !Array.isArray(toColors) || toColors.length !== model.stickers.length) {
        throw new Error(`中心状态必须各包含 ${model.stickers.length} 个贴纸`);
      }
      const fromCounts = countOrbitColors(model, orbit, fromColors);
      const toCounts = countOrbitColors(model, orbit, toColors);
      for (const color of model.colors) {
        if (fromCounts[color] !== toCounts[color]) {
          throw new Error(`${orbit.id} 的起点与目标中心颜色库存不同`);
        }
      }

      const relative = Array.from({ length: 24 }, (_unused, index) => index);
      for (const color of model.colors) {
        const sources = orbit.stickerIndices
          .map((stickerIndex, local) => ({ stickerIndex, local }))
          .filter(({ stickerIndex }) => fromColors[stickerIndex] === color)
          .map(({ local }) => local);
        const targets = orbit.stickerIndices
          .map((stickerIndex, local) => ({ stickerIndex, local }))
          .filter(({ stickerIndex }) => toColors[stickerIndex] === color)
          .map(({ local }) => local);
        sources.forEach((source, index) => { relative[source] = targets[index]; });
      }
      if (permutationParity(relative) === 1) {
        const interchangeable = model.colors
          .map((color) => orbit.stickerIndices
            .map((stickerIndex, local) => ({ stickerIndex, local }))
            .filter(({ stickerIndex }) => fromColors[stickerIndex] === color)
            .map(({ local }) => local))
          .find((positions) => positions.length >= 2);
        if (!interchangeable) throw new Error(`${orbit.id} 没有可用于修正 parity 的同色中心`);
        const [first, second] = interchangeable;
        [relative[first], relative[second]] = [relative[second], relative[first]];
      }

      const physical = solvePhysicalPermutation(relative);
      const result = model.applyAlgorithm(fromColors, physical.tokens);
      if (!orbit.stickerIndices.every((index) => result[index] === toColors[index])) {
        throw new Error(`生成公式未达到目标 ${orbit.id} 中心状态`);
      }
      return Object.freeze({
        triples: physical.triples,
        tokens: physical.tokens,
        formula: physical.formula,
        effects: physical.effects,
      });
    },
  });
}
