import "https://cdn.cubing.net/v0/js/cubing/twisty";

const N = 4;
const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const FACE_COLORS = { U: "white", R: "red", F: "green", D: "yellow", L: "orange", B: "blue" };
const COLORS = ["white", "red", "green", "yellow", "orange", "blue"];
const COLOR_CSS = {
  white: "var(--white)", red: "var(--red-sticker)", green: "var(--green-sticker)",
  yellow: "var(--yellow)", orange: "var(--orange)", blue: "var(--blue-sticker)",
};
const COLOR_NAMES = { white: "白", red: "红", green: "绿", yellow: "黄", orange: "橙", blue: "蓝" };
const FACE_MOVES = {
  U: ["y", N - 1, 1], D: ["y", 0, -1], R: ["x", N - 1, 1],
  L: ["x", 0, -1], F: ["z", N - 1, -1], B: ["z", 0, 1],
};
const BASE_ALG = "F' 2L 2F' 2L' F 2L 2F 2L'";
const SETUP_QUANTUMS = ["U", "R", "F", "D", "L", "B", "2U", "2R", "2F"];
const SETUP_MOVES = SETUP_QUANTUMS.flatMap((move) => [move, `${move}'`, `${move}2`]);

const elements = {
  fromNet: document.querySelector("#from-net"), toNet: document.querySelector("#to-net"),
  fromValid: document.querySelector("#from-valid"), toValid: document.querySelector("#to-valid"),
  palette: document.querySelector("#palette"), swapMode: document.querySelector("#swap-mode"),
  solve: document.querySelector("#solve"), example: document.querySelector("#example"), reset: document.querySelector("#reset"),
  swapStates: document.querySelector("#swap-states"), output: document.querySelector("#output"),
  status: document.querySelector("#status"), copy: document.querySelector("#copy"), player: document.querySelector("#player"),
  cycleCount: document.querySelector("#cycle-count"), moveCount: document.querySelector("#move-count"), fixedCount: document.querySelector("#fixed-count"),
};

function rotateVector([x, y, z], axis, sign) {
  if (axis === "x") return sign === 1 ? [x, -z, y] : [x, z, -y];
  if (axis === "y") return sign === 1 ? [z, y, -x] : [-z, y, x];
  return sign === 1 ? [-y, x, z] : [y, -x, z];
}

function rotatePosition(position, axis, sign) {
  const center = (N - 1) / 2;
  return rotateVector(position.map((value) => value - center), axis, sign).map((value) => Math.round(value + center));
}

function positionFor(face, row, column) {
  const max = N - 1;
  if (face === "U") return [column, max, row];
  if (face === "D") return [column, 0, max - row];
  if (face === "F") return [column, max - row, max];
  if (face === "B") return [max - column, max - row, 0];
  if (face === "R") return [max, max - row, max - column];
  return [0, max - row, column];
}

const NORMALS = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };
const stickers = [];
for (const face of FACE_ORDER) {
  for (let row = 0; row < N; row += 1) {
    for (let column = 0; column < N; column += 1) {
      stickers.push({ face, row, column, position: positionFor(face, row, column), normal: NORMALS[face] });
    }
  }
}
const stickerIndex = new Map(stickers.map((sticker, index) => [`${sticker.position.join(",")}|${sticker.normal.join(",")}`, index]));
const centerIndices = stickers.map((sticker, index) => ({ sticker, index }))
  .filter(({ sticker }) => sticker.position.filter((coordinate) => coordinate === 0 || coordinate === N - 1).length === 1)
  .map(({ index }) => index);
const centerSet = new Set(centerIndices);
const solvedColors = stickers.map((sticker) => FACE_COLORS[sticker.face]);
const identityPermutation = () => stickers.map((_sticker, index) => index);
const moveCache = new Map();

function parseMove(token) {
  const prime = token.includes("'");
  let clean = token.replace("'", "");
  const halfTurn = clean.endsWith("2");
  if (halfTurn) clean = clean.slice(0, -1);
  const depth = /^\d/.test(clean) ? Number.parseInt(clean, 10) : 1;
  const face = clean.at(-1);
  const [axis, outerLayer, baseSign] = FACE_MOVES[face];
  const layer = depth === 1 ? outerLayer : (outerLayer === 0 ? depth - 1 : N - depth);
  return { axis, layer, sign: baseSign * (prime ? -1 : 1), turns: halfTurn ? 2 : 1 };
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
    permutation[index] = stickerIndex.get(`${position.join(",")}|${normal.join(",")}`);
  });
  moveCache.set(token, permutation);
  return permutation;
}

function compose(first, second) { return first.map((location) => second[location]); }
function algorithmPermutation(algorithm) {
  const tokens = Array.isArray(algorithm) ? algorithm : algorithm.trim().split(/\s+/).filter(Boolean);
  return tokens.reduce((permutation, token) => compose(permutation, movePermutation(token)), identityPermutation());
}
function invertToken(token) {
  if (token.endsWith("2")) return token;
  return token.endsWith("'") ? token.slice(0, -1) : `${token}'`;
}
function invertAlgorithm(tokens) { return [...tokens].reverse().map(invertToken); }
function canonicalCycle(cycle) {
  const rotations = [cycle, [cycle[1], cycle[2], cycle[0]], [cycle[2], cycle[0], cycle[1]]];
  return rotations.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])[0];
}
function cycleFromPermutation(permutation) {
  const moved = centerIndices.filter((index) => permutation[index] !== index);
  if (moved.length !== 3) return null;
  const a = moved[0];
  const b = permutation[a];
  const c = permutation[b];
  return permutation[c] === a ? canonicalCycle([a, b, c]) : null;
}

function buildCycleDatabase() {
  const basePermutation = algorithmPermutation(BASE_ALG);
  const baseCycle = cycleFromPermutation(basePermutation);
  if (!baseCycle || stickers.some((_sticker, index) => !centerSet.has(index) && basePermutation[index] !== index)) {
    throw new Error("基础交换子不是纯中心 3-cycle");
  }
  const database = new Map([[baseCycle.join(","), []]]);
  const queue = [baseCycle];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cycle = queue[cursor];
    const setup = database.get(cycle.join(","));
    for (const token of SETUP_MOVES) {
      const inverseMove = movePermutation(invertToken(token));
      const nextCycle = canonicalCycle(cycle.map((index) => inverseMove[index]));
      const key = nextCycle.join(",");
      if (!database.has(key)) {
        database.set(key, [...setup, token]);
        queue.push(nextCycle);
      }
    }
  }
  if (database.size !== 4048) throw new Error(`局部交换子覆盖不完整：${database.size}/4048`);
  return database;
}

let cycleDatabase;
function formulaForCycle(cycle) {
  const setup = cycleDatabase.get(canonicalCycle(cycle).join(","));
  if (!setup) throw new Error("找不到目标 3-cycle 的局部公式");
  return [...setup, ...BASE_ALG.split(" "), ...invertAlgorithm(setup)];
}

function permutationParity(permutation) {
  const visited = new Set();
  let transpositions = 0;
  for (const start of centerIndices) {
    if (visited.has(start)) continue;
    let length = 0;
    let current = start;
    while (!visited.has(current)) { visited.add(current); length += 1; current = permutation[current]; }
    transpositions += Math.max(0, length - 1);
  }
  return transpositions % 2;
}

function colorCounts(colors) {
  const counts = Object.fromEntries(COLORS.map((color) => [color, 0]));
  centerIndices.forEach((index) => { counts[colors[index]] += 1; });
  return counts;
}
function validateColors(colors) {
  const counts = colorCounts(colors);
  const invalid = COLORS.filter((color) => counts[color] !== 4);
  return { valid: invalid.length === 0, counts, invalid };
}

function relativeColorPermutation(fromColors, toColors) {
  if (!validateColors(fromColors).valid || !validateColors(toColors).valid) throw new Error("每种颜色必须各有 4 个中心贴纸");
  const permutation = identityPermutation();
  for (const color of COLORS) {
    const sources = centerIndices.filter((index) => fromColors[index] === color);
    const targets = centerIndices.filter((index) => toColors[index] === color);
    sources.forEach((source, index) => { permutation[source] = targets[index]; });
  }
  if (permutationParity(permutation) === 1) {
    const sources = centerIndices.filter((index) => fromColors[index] === COLORS[0]);
    [permutation[sources[0]], permutation[sources[1]]] = [permutation[sources[1]], permutation[sources[0]]];
  }
  return permutation;
}

function decomposeIntoThreeCycles(permutation) {
  const visited = new Set();
  const triples = [];
  const transpositions = [];
  for (const start of centerIndices) {
    if (visited.has(start) || permutation[start] === start) continue;
    const cycle = [];
    let current = start;
    while (!visited.has(current)) { visited.add(current); cycle.push(current); current = permutation[current]; }
    const stop = cycle.length % 2 === 0 ? cycle.length - 2 : cycle.length - 1;
    for (let index = 1; index < stop; index += 2) triples.push([cycle[0], cycle[index], cycle[index + 1]]);
    if (cycle.length % 2 === 0) transpositions.push([cycle[0], cycle.at(-1)]);
  }
  if (transpositions.length % 2 !== 0) throw new Error("相对置换 parity 无法由 3-cycle 表示");
  for (let index = 0; index < transpositions.length; index += 2) {
    const [a, b] = transpositions[index];
    const [c, d] = transpositions[index + 1];
    triples.push([a, b, d], [a, c, d]);
  }
  return triples;
}

function simplifyTokens(tokens) {
  const stack = [];
  function info(token) {
    if (token.endsWith("'")) return [token.slice(0, -1), 3];
    if (token.endsWith("2")) return [token.slice(0, -1), 2];
    return [token, 1];
  }
  for (const token of tokens) {
    const [quantum, amount] = info(token);
    const previous = stack.at(-1);
    if (!previous || previous.quantum !== quantum) { stack.push({ quantum, amount }); continue; }
    previous.amount = (previous.amount + amount) % 4;
    if (previous.amount === 0) stack.pop();
  }
  return stack.map(({ quantum, amount }) => amount === 1 ? quantum : amount === 2 ? `${quantum}2` : `${quantum}'`);
}

function applyPermutationToColors(colors, permutation) {
  const result = [...colors];
  colors.forEach((color, index) => { result[permutation[index]] = color; });
  return result;
}

function solveColorStates(fromColors, toColors) {
  const relative = relativeColorPermutation(fromColors, toColors);
  const triples = decomposeIntoThreeCycles(relative);
  const tokens = simplifyTokens(triples.flatMap(formulaForCycle));
  const fullPermutation = algorithmPermutation(tokens);
  const resultColors = applyPermutationToColors(fromColors, fullPermutation);
  if (!centerIndices.every((index) => resultColors[index] === toColors[index])) throw new Error("生成公式未达到目标中心状态");
  if (stickers.some((_sticker, index) => !centerSet.has(index) && fullPermutation[index] !== index)) throw new Error("生成公式意外改变了非中心贴纸");
  return { triples, tokens, formula: tokens.join(" ") };
}

function createFace(face, stateName) {
  const faceElement = document.createElement("div");
  faceElement.className = "face";
  faceElement.dataset.face = face;
  const label = document.createElement("span");
  label.className = "face-label";
  label.textContent = face;
  faceElement.append(label);
  stickers.forEach((sticker, index) => {
    if (sticker.face !== face) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sticker ${centerSet.has(index) ? "editable" : "locked"}`;
    button.dataset.index = index;
    button.dataset.state = stateName;
    button.disabled = !centerSet.has(index);
    button.setAttribute("aria-label", `${stateName === "from" ? "起点" : "终点"} ${face} 面第 ${sticker.row + 1} 行第 ${sticker.column + 1} 列`);
    faceElement.append(button);
  });
  return faceElement;
}
function createNet(container, stateName) { FACE_ORDER.forEach((face) => container.append(createFace(face, stateName))); }

const states = { from: [...solvedColors], to: [...solvedColors] };
let editMode = "swap";
let selectedColor = "green";
let pendingSticker = null;
let lastFormula = "";

function renderPalette() {
  elements.palette.replaceChildren();
  COLORS.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `palette-button ${editMode === "paint" && selectedColor === color ? "selected" : ""}`;
    button.style.background = COLOR_CSS[color];
    button.title = `${COLOR_NAMES[color]}色：点击后进入涂色模式`;
    button.setAttribute("aria-label", `选择${COLOR_NAMES[color]}色`);
    button.addEventListener("click", () => { editMode = "paint"; selectedColor = color; pendingSticker = null; renderAll(); });
    elements.palette.append(button);
  });
  elements.swapMode.classList.toggle("active", editMode === "swap");
}

function renderNet(container, stateName) {
  container.querySelectorAll(".sticker").forEach((button) => {
    const index = Number(button.dataset.index);
    const color = states[stateName][index];
    button.style.setProperty("--sticker-color", COLOR_CSS[color]);
    button.title = `${COLOR_NAMES[color]}色${centerSet.has(index) ? "中心" : "（锁定）"}`;
    button.classList.toggle("pending", pendingSticker?.stateName === stateName && pendingSticker?.index === index);
  });
  const validation = validateColors(states[stateName]);
  const validationElement = stateName === "from" ? elements.fromValid : elements.toValid;
  validationElement.className = validation.valid ? "count-ok" : "count-bad";
  validationElement.textContent = validation.valid ? "颜色数量正确" : `${validation.invalid.map((color) => COLOR_NAMES[color]).join("、")}色数量错误`;
}
function renderAll() { renderPalette(); renderNet(elements.fromNet, "from"); renderNet(elements.toNet, "to"); }

function markDirty() {
  lastFormula = "";
  elements.output.textContent = "图案已改变，点击“求解图案”重新计算";
  elements.status.className = "status";
  elements.status.textContent = "等待计算新的中心 orbit 解法。";
  elements.cycleCount.textContent = "—";
  elements.moveCount.textContent = "—";
  elements.fixedCount.textContent = "—";
}

function handleStickerClick(event) {
  const button = event.target.closest(".sticker.editable");
  if (!button) return;
  const index = Number(button.dataset.index);
  const stateName = button.dataset.state;
  if (editMode === "paint") {
    states[stateName][index] = selectedColor;
  } else if (!pendingSticker || pendingSticker.stateName !== stateName) {
    pendingSticker = { stateName, index };
    renderAll();
    return;
  } else {
    const firstIndex = pendingSticker.index;
    [states[stateName][firstIndex], states[stateName][index]] = [states[stateName][index], states[stateName][firstIndex]];
    pendingSticker = null;
  }
  markDirty();
  renderAll();
}

function showError(message) {
  elements.status.className = "status error";
  elements.status.textContent = message;
  elements.output.textContent = "无法生成解法";
  elements.cycleCount.textContent = "—";
  elements.moveCount.textContent = "—";
  elements.fixedCount.textContent = "—";
}

function solveAndRender() {
  try {
    const solution = solveColorStates(states.from, states.to);
    const source = solveColorStates(solvedColors, states.from);
    lastFormula = solution.formula;
    elements.output.textContent = solution.formula || "（无需转动：两个中心图案相同）";
    elements.status.className = "status success";
    elements.status.textContent = "已验证：结果命中全部 24 个目标中心，且 72 个非中心贴纸保持原位。";
    elements.cycleCount.textContent = String(solution.triples.length);
    elements.moveCount.textContent = String(solution.tokens.length);
    elements.fixedCount.textContent = "72 / 72";
    elements.player.experimentalSetupAlg = source.formula;
    elements.player.alg = solution.formula;
  } catch (error) { showError(error.message); }
}

createNet(elements.fromNet, "from");
createNet(elements.toNet, "to");
elements.fromNet.addEventListener("click", handleStickerClick);
elements.toNet.addEventListener("click", handleStickerClick);
elements.swapMode.addEventListener("click", () => { editMode = "swap"; pendingSticker = null; renderAll(); });
elements.solve.addEventListener("click", solveAndRender);
elements.reset.addEventListener("click", () => {
  states.from = [...solvedColors]; states.to = [...solvedColors]; pendingSticker = null; markDirty(); renderAll();
});
elements.swapStates.addEventListener("click", () => {
  [states.from, states.to] = [states.to, states.from]; pendingSticker = null; markDirty(); renderAll();
});
elements.example.addEventListener("click", () => {
  states.from = [...solvedColors];
  const examplePermutation = algorithmPermutation("R U 2F D' 2R F2");
  states.to = applyPermutationToColors(solvedColors, examplePermutation);
  stickers.forEach((_sticker, index) => { if (!centerSet.has(index)) states.to[index] = solvedColors[index]; });
  pendingSticker = null; markDirty(); renderAll(); solveAndRender();
});
elements.copy.addEventListener("click", async () => {
  if (!lastFormula) return;
  await navigator.clipboard.writeText(lastFormula);
  elements.copy.textContent = "已复制";
  window.setTimeout(() => { elements.copy.textContent = "复制公式"; }, 1200);
});

try {
  cycleDatabase = buildCycleDatabase();
  renderAll();
  elements.status.textContent = "局部交换子数据库已生成：覆盖 4048 个有向中心 3-cycle。";
  elements.player.alg = "";
} catch (error) {
  showError(error.message);
  elements.solve.disabled = true;
}
