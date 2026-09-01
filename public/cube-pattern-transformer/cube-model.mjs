export const FACE_ORDER = Object.freeze(["U", "R", "F", "D", "L", "B"]);
export const FACE_COLORS = Object.freeze({
  U: "white",
  R: "red",
  F: "green",
  D: "yellow",
  L: "orange",
  B: "blue",
});
export const COLORS = Object.freeze(["white", "red", "green", "yellow", "orange", "blue"]);

const NORMALS = Object.freeze({
  U: [0, 1, 0],
  D: [0, -1, 0],
  R: [1, 0, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
});

function rotateVector([x, y, z], axis, sign) {
  if (axis === "x") return sign === 1 ? [x, -z, y] : [x, z, -y];
  if (axis === "y") return sign === 1 ? [z, y, -x] : [-z, y, x];
  return sign === 1 ? [-y, x, z] : [y, -x, z];
}

function positionFor(size, face, row, column) {
  const max = size - 1;
  if (face === "U") return [column, max, row];
  if (face === "D") return [column, 0, max - row];
  if (face === "F") return [column, max - row, max];
  if (face === "B") return [max - column, max - row, 0];
  if (face === "R") return [max, max - row, max - column];
  return [0, max - row, column];
}

function invertToken(token) {
  if (token.endsWith("2")) return token;
  return token.endsWith("'") ? token.slice(0, -1) : `${token}'`;
}

function tokenize(algorithm) {
  return Array.isArray(algorithm)
    ? [...algorithm]
    : algorithm.trim().split(/\s+/).filter(Boolean);
}

function pieceKind(stickerCount) {
  if (stickerCount === 3) return "corner";
  if (stickerCount === 2) return "edge";
  return "center";
}

export function createCubeModel(size) {
  if (!Number.isInteger(size) || size < 2 || size > 5) {
    throw new Error(`魔方阶数必须是 2 到 5 的整数：${size}`);
  }

  const max = size - 1;
  const center = max / 2;
  const faceMoves = {
    U: ["y", max, -1],
    D: ["y", 0, 1],
    R: ["x", max, -1],
    L: ["x", 0, 1],
    F: ["z", max, -1],
    B: ["z", 0, 1],
  };

  const stickers = [];
  for (const face of FACE_ORDER) {
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        stickers.push({
          face,
          row,
          column,
          position: positionFor(size, face, row, column),
          normal: NORMALS[face],
        });
      }
    }
  }

  const stickerIndex = new Map(
    stickers.map((sticker, index) => [
      `${sticker.position.join(",")}|${sticker.normal.join(",")}`,
      index,
    ]),
  );
  const pieceMap = new Map();
  stickers.forEach((sticker, index) => {
    const key = sticker.position.join(",");
    if (!pieceMap.has(key)) pieceMap.set(key, []);
    pieceMap.get(key).push(index);
  });
  const pieces = [...pieceMap.entries()].map(([key, stickerIndices]) => Object.freeze({
    key,
    position: key.split(",").map(Number),
    kind: pieceKind(stickerIndices.length),
    stickerIndices: Object.freeze(stickerIndices),
  }));
  const pieceIndex = new Map(pieces.map((piece, index) => [piece.key, index]));
  const solvedColors = stickers.map((sticker) => FACE_COLORS[sticker.face]);
  const moveCache = new Map();
  const identityPermutation = () => stickers.map((_sticker, index) => index);

  function rotatePosition(position, axis, sign) {
    return rotateVector(position.map((value) => value - center), axis, sign)
      .map((value) => Math.round(value + center));
  }

  function parseMove(token) {
    if (typeof token !== "string" || token.length === 0) {
      throw new Error(`不支持的转动：${token}`);
    }
    const match = token.match(/^(\d+)?([URFDLB])(2|')?$/);
    if (!match) throw new Error(`不支持的转动：${token}`);
    const depth = match[1] ? Number.parseInt(match[1], 10) : 1;
    if (depth < 1 || depth > size) throw new Error(`不支持的转动：${token}`);
    const [, , face, suffix] = match;
    const [axis, outerLayer, baseSign] = faceMoves[face];
    const layer = outerLayer === 0 ? depth - 1 : size - depth;
    return {
      axis,
      layer,
      sign: baseSign * (suffix === "'" ? -1 : 1),
      turns: suffix === "2" ? 2 : 1,
    };
  }

  function movePermutation(token) {
    if (moveCache.has(token)) return moveCache.get(token);
    const { axis, layer, sign, turns } = parseMove(token);
    const axisIndex = "xyz".indexOf(axis);
    const permutation = identityPermutation();
    stickers.forEach((sticker, index) => {
      if (sticker.position[axisIndex] !== layer) return;
      let position = sticker.position;
      let normal = sticker.normal;
      for (let turn = 0; turn < turns; turn += 1) {
        position = rotatePosition(position, axis, sign);
        normal = rotateVector(normal, axis, sign);
      }
      const destination = stickerIndex.get(`${position.join(",")}|${normal.join(",")}`);
      if (destination === undefined) throw new Error(`转动 ${token} 产生了无效贴纸位置`);
      permutation[index] = destination;
    });
    const frozen = Object.freeze(permutation);
    moveCache.set(token, frozen);
    return frozen;
  }

  function compose(first, second) {
    return first.map((location) => second[location]);
  }

  function algorithmPermutation(algorithm) {
    return tokenize(algorithm).reduce(
      (permutation, token) => compose(permutation, movePermutation(token)),
      identityPermutation(),
    );
  }

  function applyPermutation(state, permutation) {
    if (!Array.isArray(state) || state.length !== stickers.length) {
      throw new Error(`状态必须包含 ${stickers.length} 个贴纸`);
    }
    const result = [...state];
    state.forEach((value, index) => { result[permutation[index]] = value; });
    return result;
  }

  function applyAlgorithm(state, algorithm) {
    return applyPermutation(state, algorithmPermutation(algorithm));
  }

  function invertAlgorithm(algorithm) {
    return tokenize(algorithm).reverse().map(invertToken);
  }

  function derivePieceOrbits() {
    const parent = pieces.map((_piece, index) => index);

    function find(index) {
      let root = index;
      while (parent[root] !== root) root = parent[root];
      while (parent[index] !== index) {
        const next = parent[index];
        parent[index] = root;
        index = next;
      }
      return root;
    }

    function union(first, second) {
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot !== secondRoot) parent[secondRoot] = firstRoot;
    }

    const generators = FACES_FOR_ORBITS.flatMap((face) => (
      Array.from({ length: size }, (_unused, index) => `${index === 0 ? "" : index + 1}${face}`)
    ));
    for (const token of generators) {
      const permutation = movePermutation(token);
      pieces.forEach((piece, sourceIndex) => {
        const destinationSticker = stickers[permutation[piece.stickerIndices[0]]];
        const destinationIndex = pieceIndex.get(destinationSticker.position.join(","));
        if (destinationIndex === undefined || pieces[destinationIndex].kind !== piece.kind) {
          throw new Error(`转动 ${token} 产生了无效块位置`);
        }
        union(sourceIndex, destinationIndex);
      });
    }

    const groups = new Map();
    pieces.forEach((_piece, index) => {
      const root = find(index);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(index);
    });
    const counters = { corner: 0, edge: 0, center: 0 };
    return [...groups.values()]
      .sort((first, second) => {
        const firstKind = pieces[first[0]].kind;
        const secondKind = pieces[second[0]].kind;
        return firstKind.localeCompare(secondKind)
          || first.length - second.length
          || pieces[first[0]].key.localeCompare(pieces[second[0]].key);
      })
      .map((pieceIndices) => {
        const kind = pieces[pieceIndices[0]].kind;
        const ordinal = counters[kind];
        counters[kind] += 1;
        return Object.freeze({
          id: `${kind}-${ordinal}`,
          kind,
          pieceIndices: Object.freeze(pieceIndices),
          pieceKeys: Object.freeze(pieceIndices.map((index) => pieces[index].key)),
          stickerIndices: Object.freeze(pieceIndices.flatMap((index) => pieces[index].stickerIndices)),
        });
      });
  }

  const FACES_FOR_ORBITS = ["U", "R", "F"];
  const pieceOrbits = derivePieceOrbits();
  const orbitByPieceIndex = Array(pieces.length);
  const orbitById = new Map(pieceOrbits.map((orbit) => [orbit.id, orbit]));
  pieceOrbits.forEach((orbit) => {
    orbit.pieceIndices.forEach((index) => { orbitByPieceIndex[index] = orbit.id; });
  });

  function requireOrbit(orbitId) {
    const orbit = orbitById.get(orbitId);
    if (!orbit) throw new Error(`未知的块 orbit：${orbitId}`);
    return orbit;
  }

  function orbitPermutation(orbitId, algorithm) {
    const orbit = requireOrbit(orbitId);
    const globalPermutation = algorithmPermutation(algorithm);
    const localIndex = new Map(orbit.stickerIndices.map((index, local) => [index, local]));
    return orbit.stickerIndices.map((index) => {
      const destination = localIndex.get(globalPermutation[index]);
      if (destination === undefined) {
        throw new Error(`公式把贴纸移出了 ${orbitId}`);
      }
      return destination;
    });
  }

  function algorithmOrbitEffects(algorithm) {
    const permutation = algorithmPermutation(algorithm);
    return pieceOrbits.flatMap((orbit) => {
      const movedStickerCount = orbit.stickerIndices
        .filter((index) => permutation[index] !== index)
        .length;
      return movedStickerCount === 0
        ? []
        : [Object.freeze({ orbitId: orbit.id, kind: orbit.kind, movedStickerCount })];
    });
  }

  function isOrbitLocalAlgorithm(orbitId, algorithm) {
    requireOrbit(orbitId);
    return algorithmOrbitEffects(algorithm).every((effect) => effect.orbitId === orbitId);
  }

  return Object.freeze({
    size,
    faceOrder: FACE_ORDER,
    faceColors: FACE_COLORS,
    colors: COLORS,
    stickers: Object.freeze(stickers),
    pieces: Object.freeze(pieces),
    pieceOrbits: Object.freeze(pieceOrbits),
    orbitByPieceIndex: Object.freeze(orbitByPieceIndex),
    solvedColors: Object.freeze(solvedColors),
    movePermutation,
    algorithmPermutation,
    orbitPermutation,
    algorithmOrbitEffects,
    isOrbitLocalAlgorithm,
    applyPermutation,
    applyAlgorithm,
    invertAlgorithm,
  });
}
