// 把 validateEditorState / analyzePieceState / compileOrbitTarget 的结构化
// findings 翻译成用户能照着修改贴纸图案的中文句子。纯展示层：不改变任何
// 校验判定，只解释“为什么这组贴纸无法被转动实现”。

const COLOR_NAMES = {
  white: "白", red: "红", green: "绿", yellow: "黄", orange: "橙", blue: "蓝",
};
const DEFAULT_COLOR_ORDER = ["white", "red", "green", "yellow", "orange", "blue"];

function colorName(color) {
  return COLOR_NAMES[color] ?? color;
}

function orbitLabel(model, orbitId, signature = "") {
  const orbit = model?.pieceOrbits?.find((candidate) => candidate.id === orbitId);
  if (orbit) {
    if (orbit.kind === "corner") return "角块";
    if (orbit.kind === "center") return "中心块";
    return orbit.pieceIndices.length === 24 ? "翼块" : "棱块";
  }
  const stickerCount = signature ? signature.split("|").length : 0;
  if (stickerCount === 3) return "角块";
  if (stickerCount === 2) return "棱块";
  if (stickerCount === 1) return "中心块";
  return "块";
}

function describeSignature(signature, model) {
  const order = model?.colors ?? DEFAULT_COLOR_ORDER;
  const colors = (signature ?? "").split("|").filter(Boolean);
  const sorted = [...colors].sort((first, second) => (
    order.indexOf(first) - order.indexOf(second)
  ));
  return sorted.map(colorName).join("-");
}

function pieceLocation(model, pieceIndex) {
  const piece = model?.pieces?.[pieceIndex];
  if (!piece || !model.stickers) return null;
  return piece.stickerIndices
    .map((index) => {
      const sticker = model.stickers[index];
      return `${sticker.face}${sticker.row + 1}-${sticker.column + 1}`;
    })
    .join(" / ");
}

export function describePieceStateError(model, error) {
  const name = `${describeSignature(error.signature, model)} ${orbitLabel(
    model,
    error.orbitId,
    error.signature,
  )}`;
  switch (error?.code) {
    case "sticker-count":
      return `贴纸总数应为 ${error.expectedCount} 枚，实为 ${error.actualCount ?? "其他"} 枚`;
    case "unknown-color":
      return `出现未知颜色：${(error.colors ?? []).map(colorName).join("、")}`;
    case "piece-inventory": {
      const difference = (error.actualCount ?? 0) - (error.expectedCount ?? 0);
      return difference < 0
        ? `缺少 ${-difference} 个 ${name}`
        : `多出 ${difference} 个 ${name}`;
    }
    case "mirrored-piece": {
      const location = pieceLocation(model, error.pieceIndex);
      return `${name}被摆成镜像朝向（两枚贴纸互换），任何转动都做不到${
        location ? `：${location}` : ""
      }`;
    }
    case "corner-orientation-sum":
      return `角块扭转总和不是 3 的倍数（余 ${error.remainder}）：有角块被原地拧转了`;
    case "edge-orientation-sum":
      return "棱块翻转总和为奇数：有棱块被原地翻了面";
    case "wing-orientation-ambiguous":
      return `${name} 的朝向无法唯一判定，wildcard 补全依赖明确手性`;
    case "wing-handedness-inventory":
      return `${name}手性不配平：应 ${error.expected?.[0] ?? "?"}+${
        error.expected?.[1] ?? "?"
      }，实为 ${error.actual?.[0] ?? "?"}+${
        error.actual?.[1] ?? "?"
      }（有翼块被原地翻面）`;
    default:
      return null;
  }
}

export function describePieceStateErrors(model, errors, { max = 3 } = {}) {
  const sentences = [];
  let unrecognized = 0;
  for (const error of errors ?? []) {
    const text = describePieceStateError(model, error);
    if (text === null) unrecognized += 1;
    else sentences.push(text);
  }
  const unique = [...new Set(sentences)];
  const shown = unique.slice(0, max);
  const hidden = unique.length - shown.length + unrecognized;
  if (shown.length === 0 && hidden === 0) return "";
  if (shown.length === 0) return `另有 ${hidden} 处问题`;
  const prefix = shown.join("；");
  return hidden > 0 ? `${prefix}；另有 ${hidden} 处问题` : prefix;
}

export function describePatternTargetError(model, details) {
  if (!details) return "";
  if (Array.isArray(details)) return describePieceStateErrors(model, details);
  const label = orbitLabel(model, details.orbitId);
  switch (details.code) {
    case "invalid-pattern-shape":
      return "目标图案的贴纸数量与当前阶数不符";
    case "unknown-pattern-color":
      return `第 ${(details.index ?? 0) + 1} 枚贴纸的颜色「${
        colorName(details.value)
      }」不在六色之内`;
    case "partial-piece-wildcard": {
      const location = pieceLocation(model, details.pieceIndex);
      return `有块只把部分贴纸设成了 ?，必须整块设 ?${location ? `（${location}）` : ""}`;
    }
    case "no-position-candidate":
      return `${label}内存在凑不出来的块位（块位 #${(details.target ?? 0) + 1}）：没有任何合法块能满足该处颜色`;
    case "no-physical-assignment":
      return `${label}的颜色约束与 orientation / parity 冲突，wildcard 也补不出合法拼法`;
    case "ambiguous-source-identity":
      return `起点的${label}存在无法区分的同色块，wildcard 补全失败`;
    case "ambiguous-wing-orientation":
      return `起点的${label}有翼块朝向无法判定，wildcard 补全失败`;
    case "invalid-current-orbit":
      return describePieceStateErrors(model, details.errors ?? []);
    default:
      return "";
  }
}
