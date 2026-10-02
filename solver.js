export const BOARD_SIZE = 7;
export const PLACEMENT_COST = 200;
export const STRATEGY = "center";
export const TYPES = Object.freeze({
  vertical: { name: "세로줄", width: 1, height: 7, offsets: Array.from({ length: 7 }, (_, row) => [row, 0]) },
  horizontal: { name: "가로줄", width: 7, height: 1, offsets: Array.from({ length: 7 }, (_, col) => [0, col]) },
  cross: { name: "십자", width: 3, height: 3, offsets: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] },
  star: { name: "X자", width: 3, height: 3, offsets: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]] },
  square: { name: "네모", width: 3, height: 3, offsets: Array.from({ length: 9 }, (_, index) => [Math.floor(index / 3), index % 3]) },
});
export const TYPE_IDS = Object.keys(TYPES);
const FULL_LO = 0xffffffff;
const FULL_HI = 0x1ffff;

function maskFromCells(cells) {
  let lo = 0, hi = 0;
  for (const cell of cells) {
    if (cell < 32) lo = (lo | (1 << cell)) >>> 0;
    else hi |= 1 << (cell - 32);
  }
  return { lo, hi };
}

export const PLACEMENTS = Object.fromEntries(TYPE_IDS.map(type => {
  const definition = TYPES[type];
  const placements = [];
  for (let anchorRow = 0; anchorRow < 7; anchorRow++) {
    for (let anchorCol = 0; anchorCol < 7; anchorCol++) {
      const row = anchorRow - Math.floor(definition.height / 2);
      const col = anchorCol - Math.floor(definition.width / 2);
      const cells = definition.offsets.map(([dr, dc]) => [row + dr, col + dc])
        .filter(([cellRow, cellCol]) => cellRow >= 0 && cellRow < 7 && cellCol >= 0 && cellCol < 7)
        .map(([cellRow, cellCol]) => cellRow * 7 + cellCol);
      placements.push({ type, row, col, cells, ...maskFromCells(cells),
        anchor: anchorRow * 7 + anchorCol });
    }
  }
  return [type, placements];
}));

// More coverage with the same piece, reserve, and cost can never make completion harder.
const USEFUL_PLACEMENTS = Object.fromEntries(TYPE_IDS.map(type => [type, PLACEMENTS[type].filter(placement =>
  !PLACEMENTS[type].some(other => other !== placement && other.cells.length > placement.cells.length &&
    ((other.lo & placement.lo) >>> 0) === placement.lo && (other.hi & placement.hi) === placement.hi))]));

function popcount(value) {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
export function countFilled(board) { return popcount(board.lo) + popcount(board.hi); }
export function isFilled(board, index) { return index < 32 ? !!(board.lo & (1 << index)) : !!(board.hi & (1 << (index - 32))); }
export function placementGain(board, placement) { return popcount(placement.lo & ~board.lo) + popcount(placement.hi & ~board.hi); }
export function addPlacement(board, placement) { return { lo: (board.lo | placement.lo) >>> 0, hi: board.hi | placement.hi }; }
export function createState() { return { board: { lo: 0, hi: 0 }, held: null, latest: null, turn: 0, placements: 0, spent: 0, lastAction: null }; }
function complete(board) { return board.lo === FULL_LO && board.hi === FULL_HI; }

// Two axis bits and two completion bits per quadrant: cross + star = all nine cells.
// The model minimizes paid placements, with one pattern held and equally likely future types.
const TARGET_MASK = 1023;
const TYPE_COUNT = TYPE_IDS.length;
function transitions(mask, type) {
  if (type === "vertical") return [mask | 1];
  if (type === "horizontal") return [mask | 2];
  const successors = [];
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const shift = 2 + quadrant * 2;
    const bits = type === "cross" ? 1 : type === "star" ? 2 : 3;
    successors.push(mask | (bits << shift));
  }
  return [...new Set(successors)];
}
function buildCostTable() {
  const table = new Float64Array(1024 * TYPE_COUNT);
  for (let mask = TARGET_MASK - 1; mask >= 0; mask--) {
    const moves = TYPE_IDS.map(type => transitions(mask, type));
    const progress = moves.map(list => list.filter(next => next !== mask));
    const useless = progress.findIndex(list => list.length === 0);
    const values = new Float64Array(TYPE_COUNT);
    // Finite upper bounds come from always making progress whenever either available type can.
    if (useless !== -1) {
      let sum = 0, usefulCount = 0;
      for (let incoming = 0; incoming < TYPE_COUNT; incoming++) {
        if (!progress[incoming].length) continue;
        usefulCount++;
        sum += Math.min(...progress[incoming].map(next => table[next * TYPE_COUNT + useless]));
      }
      const waitingValue = (TYPE_COUNT + sum) / usefulCount;
      for (let held = 0; held < TYPE_COUNT; held++) if (!progress[held].length) values[held] = waitingValue;
    }
    for (let held = 0; held < TYPE_COUNT; held++) {
      if (!progress[held].length) continue;
      let expected = 0;
      for (let incoming = 0; incoming < TYPE_COUNT; incoming++) {
        let best = Infinity;
        for (const next of progress[incoming]) best = Math.min(best, table[next * TYPE_COUNT + held]);
        for (const next of progress[held]) best = Math.min(best, table[next * TYPE_COUNT + incoming]);
        expected += best / TYPE_COUNT;
      }
      values[held] = 1 + expected;
    }
    // Include exchanges with no template progress, paying for the deployed piece as usual.
    for (let iteration = 0; iteration < 160; iteration++) {
      const updated = new Float64Array(TYPE_COUNT);
      let difference = 0;
      for (let held = 0; held < TYPE_COUNT; held++) {
        let expected = 0;
        for (let incoming = 0; incoming < TYPE_COUNT; incoming++) {
          let best = Infinity;
          for (const next of moves[incoming]) best = Math.min(best, next === mask ? values[held] : table[next * TYPE_COUNT + held]);
          for (const next of moves[held]) best = Math.min(best, next === mask ? values[incoming] : table[next * TYPE_COUNT + incoming]);
          expected += best / TYPE_COUNT;
        }
        updated[held] = 1 + expected;
        difference = Math.max(difference, Math.abs(updated[held] - values[held]));
      }
      values.set(updated);
      if (difference < 1e-11) break;
    }
    table.set(values, mask * TYPE_COUNT);
  }
  return table;
}
const COST_TABLE = buildCostTable();
const EMPTY_COST_TABLE = (() => {
  const table = new Float64Array(1024);
  for (let mask = TARGET_MASK - 1; mask >= 0; mask--) {
    const moves = TYPE_IDS.map(type => transitions(mask, type));
    let value = TYPE_IDS.reduce((sum, _, type) => sum + COST_TABLE[mask * TYPE_COUNT + type], 0) / TYPE_COUNT;
    for (let iteration = 0; iteration < 160; iteration++) {
      let nextValue = 0;
      for (let type = 0; type < TYPE_COUNT; type++) {
        let best = COST_TABLE[mask * TYPE_COUNT + type]; // Store this input for free.
        for (const next of moves[type]) best = Math.min(best, 1 + (next === mask ? value : table[next]));
        nextValue += best / TYPE_COUNT;
      }
      const difference = Math.abs(nextValue - value);
      value = nextValue;
      if (difference < 1e-11) break;
    }
    table[mask] = value;
  }
  return table;
})();

export function strategyPlan(strategy = STRATEGY) {
  if (strategy !== "center" && strategy !== "edge") throw new Error("알 수 없는 배치 전략입니다.");
  const axis = strategy === "center" ? 3 : 0;
  const starts = strategy === "center" ? [0, 4] : [1, 4];
  const quadrants = starts.flatMap(row => starts.map(col => ({ row, col,
    cross: PLACEMENTS.cross.find(item => item.row === row && item.col === col),
    star: PLACEMENTS.star.find(item => item.row === row && item.col === col),
    square: PLACEMENTS.square.find(item => item.row === row && item.col === col),
  })));
  return {
    vertical: PLACEMENTS.vertical.find(item => item.col === axis && item.row === 0),
    horizontal: PLACEMENTS.horizontal.find(item => item.row === axis && item.col === 0), quadrants,
  };
}
const PLANS = { center: strategyPlan("center"), edge: strategyPlan("edge") };
const FUTURE_RECTANGLES = [...USEFUL_PLACEMENTS.vertical, ...USEFUL_PLACEMENTS.horizontal, ...USEFUL_PLACEMENTS.square];
const CELL_RECTANGLES = Array.from({ length: 49 }, (_, cell) => FUTURE_RECTANGLES.filter(placement => placement.cells.includes(cell)));
const ROW_MASKS = Array.from({ length: 7 }, (_, row) => maskFromCells(Array.from({ length: 7 }, (_, col) => row * 7 + col)));
const COL_MASKS = Array.from({ length: 7 }, (_, col) => maskFromCells(Array.from({ length: 7 }, (_, row) => row * 7 + col)));
const coverCache = new Map();
export function minimumCover(board) {
  const key = board.hi * 4294967296 + board.lo;
  if (coverCache.has(key)) return coverCache.get(key);
  const missing = { lo: (~board.lo) >>> 0, hi: (~board.hi) & FULL_HI };
  const count = countFilled(missing);
  if (!count) return 0;
  let upper = 6;
  for (const plan of Object.values(PLANS)) {
    const pieces = [plan.vertical, plan.horizontal, ...plan.quadrants.map(quadrant => quadrant.square)];
    upper = Math.min(upper, pieces.filter(piece => placementGain(board, piece) > 0).length);
  }
  const failed = new Set();
  function enoughCapacity(holes, budget) {
    const columns = COL_MASKS.map(mask => popcount(mask.lo & holes.lo) + popcount(mask.hi & holes.hi));
    const rows = ROW_MASKS.map(mask => popcount(mask.lo & holes.lo) + popcount(mask.hi & holes.hi));
    for (let vertical = 0; vertical <= budget; vertical++) for (let horizontal = 0; horizontal <= budget - vertical; horizontal++) {
      const squares = budget - vertical - horizontal;
      if (7 * (vertical + horizontal) + 9 * squares < countFilled(holes)) continue;
      const colDemand = columns.map(n => Math.ceil(Math.max(0, n - horizontal) / 3)).sort((a, b) => b - a).slice(vertical).reduce((sum, n) => sum + n, 0);
      const rowDemand = rows.map(n => Math.ceil(Math.max(0, n - vertical) / 3)).sort((a, b) => b - a).slice(horizontal).reduce((sum, n) => sum + n, 0);
      if (colDemand <= 3 * squares && rowDemand <= 3 * squares) return true;
    }
    return false;
  }
  function search(holes, budget) {
    const left = countFilled(holes);
    if (!left) return true;
    if (!budget || left > 9 * budget || !enoughCapacity(holes, budget)) return false;
    const failKey = `${holes.lo}:${holes.hi}:${budget}`;
    if (failed.has(failKey)) return false;
    let choices = null;
    for (let cell = 0; cell < 49; cell++) {
      if (!isFilled(holes, cell)) continue;
      if (!choices || CELL_RECTANGLES[cell].length < choices.length) choices = CELL_RECTANGLES[cell];
      if (choices.length === 3) break;
    }
    const sorted = choices.map(piece => ({ piece, gain: popcount(piece.lo & holes.lo) + popcount(piece.hi & holes.hi) })).sort((a, b) => b.gain - a.gain);
    for (const { piece } of sorted) {
      const next = { lo: (holes.lo & ~piece.lo) >>> 0, hi: holes.hi & ~piece.hi };
      if (search(next, budget - 1)) return true;
    }
    failed.add(failKey);
    return false;
  }
  let result = upper;
  for (let budget = Math.ceil(count / 9); budget < upper; budget++) if (search(missing, budget)) { result = budget; break; }
  if (coverCache.size > 50000) coverCache.clear();
  coverCache.set(key, result);
  return result;
}
function covers(board, placement) { return ((board.lo & placement.lo) >>> 0) === placement.lo && (board.hi & placement.hi) === placement.hi; }
function templateMask(board, plan) {
  let mask = (covers(board, plan.vertical) ? 1 : 0) | (covers(board, plan.horizontal) ? 2 : 0);
  plan.quadrants.forEach((quadrant, index) => {
    if (covers(board, quadrant.cross)) mask |= 1 << (2 + index * 2);
    if (covers(board, quadrant.star)) mask |= 1 << (3 + index * 2);
  });
  return mask;
}
function isCanonical(placement, plan) {
  if (placement.type === "vertical") return placement.col === plan.vertical.col && placement.row === 0;
  if (placement.type === "horizontal") return placement.row === plan.horizontal.row && placement.col === 0;
  return plan.quadrants.some(quadrant => quadrant.row === placement.row && quadrant.col === placement.col);
}
let tailContext = null;
function tailFor(board) {
  const blankLo = (~board.lo) >>> 0, blankHi = (~board.hi) & FULL_HI;
  if (tailContext && !(blankLo & ~tailContext.blankLo) && !(blankHi & ~tailContext.blankHi)) return tailContext;
  const positions = Array.from({ length: 49 }, (_, index) => index).filter(index => !isFilled(board, index));
  if (positions.length > 12) return null;
  const size = 1 << positions.length;
  const slots = TYPE_COUNT + 1;
  const coverage = TYPE_IDS.map(type => [...new Set(USEFUL_PLACEMENTS[type].map(placement =>
    positions.reduce((mask, position, index) => isFilled(placement, position) ? mask | (1 << index) : mask, 0)))].filter(Boolean));
  const table = new Float64Array(size * slots);
  for (let remaining = 1; remaining < size; remaining++) {
    const minimums = new Float64Array(TYPE_COUNT * slots).fill(Infinity);
    for (let type = 0; type < TYPE_COUNT; type++) {
      const masks = [...new Set(coverage[type].map(mask => mask & remaining))].filter(Boolean)
        .sort((a, b) => popcount(b) - popcount(a));
      const maximal = [];
      for (const mask of masks) if (!maximal.some(other => (mask & other) === mask)) maximal.push(mask);
      for (const mask of maximal) {
        const next = (remaining & ~mask) * slots;
        for (let held = 0; held < slots; held++) minimums[type * slots + held] = Math.min(minimums[type * slots + held], table[next + held]);
      }
    }
    // Every piece can hit any single hole at its center, so all positive moves reach smaller states.
    for (let held = 0; held < TYPE_COUNT; held++) {
      let value = 1;
      for (let input = 0; input < TYPE_COUNT; input++) value += Math.min(minimums[input * slots + held], minimums[held * slots + input]) / TYPE_COUNT;
      table[remaining * slots + held] = value;
    }
    let emptyValue = 0;
    for (let input = 0; input < TYPE_COUNT; input++) emptyValue += Math.min(1 + minimums[input * slots + TYPE_COUNT], table[remaining * slots + input]) / TYPE_COUNT;
    table[remaining * slots + TYPE_COUNT] = emptyValue;
  }
  tailContext = { blankLo, blankHi, positions, table, slots };
  return tailContext;
}
function exactValue(context, board, held) {
  const remaining = context.positions.reduce((mask, position, index) => isFilled(board, position) ? mask : mask | (1 << index), 0);
  return context.table[remaining * context.slots + (held === null ? TYPE_COUNT : TYPE_IDS.indexOf(held))];
}
export function expectedRemainingPlacements(board, held, strategy = STRATEGY) {
  if (held !== null && !TYPES[held]) throw new Error("알 수 없는 보관 패턴입니다.");
  const context = tailFor(board);
  if (context) return exactValue(context, board, held);
  const mask = templateMask(board, PLANS[strategy]);
  return held === null ? EMPTY_COST_TABLE[mask] : COST_TABLE[mask * TYPE_COUNT + TYPE_IDS.indexOf(held)];
}

export function decideAction(state, incoming, strategy = STRATEGY, sampleCount = 64) {
  if (!TYPES[incoming]) throw new Error("알 수 없는 패턴입니다.");
  if (complete(state.board)) return { kind: "complete" };
  const plan = PLANS[strategy];
  if (!plan) throw new Error("알 수 없는 배치 전략입니다.");
  const tail = tailFor(state.board);

  const leafCache = new Map();
  function estimate(board, held) {
    const heldIndex = held === null ? TYPE_COUNT : TYPE_IDS.indexOf(held);
    const key = (board.hi * 4294967296 + board.lo) * (TYPE_COUNT + 1) + heldIndex;
    if (!leafCache.has(key)) {
      const mask = templateMask(board, plan);
      leafCache.set(key, tail ? exactValue(tail, board, held) : held === null ? EMPTY_COST_TABLE[mask] : COST_TABLE[mask * TYPE_COUNT + heldIndex]);
    }
    return leafCache.get(key);
  }
  function candidates(board, held, input) {
    const actions = [];
    for (const kind of held === null || held === input ? ["place"] : ["place", "swap"]) {
      const deployed = kind === "swap" ? held : input;
      const nextHeld = kind === "swap" ? input : held;
      for (const placement of USEFUL_PLACEMENTS[deployed]) {
        const nextBoard = addPlacement(board, placement);
        const gain = placementGain(board, placement);
        if (!gain) continue;
        actions.push({ kind, incoming: input, deployed, placement, nextHeld, nextBoard, cost: 1,
          gain, futureCost: 1 + estimate(nextBoard, nextHeld), canonical: isCanonical(placement, plan), anchorBlank: !isFilled(board, placement.anchor) });
      }
    }
    if (held === null) actions.push({ kind: "hold", incoming: input, deployed: null, placement: null, nextHeld: input, nextBoard: board, cost: 0,
      gain: 0, futureCost: estimate(board, input), canonical: false, anchorBlank: false });
    return actions;
  }
  function compare(a, b) { return a.futureCost - b.futureCost || b.gain - a.gain || Number(b.canonical) - Number(a.canonical) || Number(b.anchorBlank) - Number(a.anchorBlank); }
  function policyChoice(board, held, input, policy) {
    const actions = candidates(board, held, input);
    const finish = actions.find(action => complete(action.nextBoard));
    if (finish) return finish;
    const needed = input === "vertical" ? !covers(board, plan.vertical) : input === "horizontal" ? !covers(board, plan.horizontal) : null;
    // Keep the free reserve for a repeated axis instead of paying for a premature extra line.
    if (held === null && needed === false) return actions.find(action => action.kind === "hold");
    actions.sort(policy === "gain" ? (a, b) => b.gain - a.gain || compare(a, b) : compare);
    return actions[0];
  }
  function rollout(board, held, sequence, policy) {
    let steps = 0;
    for (const input of sequence) {
      if (complete(board)) return steps;
      const best = policyChoice(board, held, input, policy);
      board = best.nextBoard;
      held = best.nextHeld;
      steps += best.cost;
    }
    return complete(board) ? steps : steps + Math.ceil((49 - countFilled(board)) / 5);
  }
  const all = candidates(state.board, state.held, incoming).sort(compare);
  const finishing = all.find(action => complete(action.nextBoard));
  if (tail || finishing) {
    const best = finishing ?? all[0];
    const { futureCost, canonical, anchorBlank, cost, nextBoard, nextHeld, ...action } = best;
    return action;
  }
  if (state.held === null && (incoming === "vertical" || incoming === "horizontal")) {
    const axis = incoming === "vertical" ? plan.vertical : plan.horizontal;
    if (covers(state.board, axis)) return { kind: "hold", incoming, deployed: null, placement: null, gain: 0 };
    if (countFilled(state.board) === 0) return { kind: "place", incoming, deployed: incoming, placement: axis, gain: 7 };
  }
  const currentMask = templateMask(state.board, plan);
  for (const action of all) {
    action.minimumCost = action.cost + minimumCover(action.nextBoard);
    action.progress = popcount(templateMask(action.nextBoard, plan)) - popcount(currentMask);
  }
  const minimumCost = Math.min(...all.map(action => action.minimumCost));
  const efficient = all.filter(action => action.minimumCost === minimumCost);
  const progress = Math.max(...efficient.map(action => action.progress));
  // Preserve the input/reserve choice guided by the template, while comparing
  // alternative anchors with the same geometric lower bound on completion cost.
  const kinds = new Set(efficient.filter(action => action.progress === progress).map(action => action.kind));
  const structured = efficient.filter(action => kinds.has(action.kind));
  const shortlist = structured.filter(action => action.canonical);
  const storage = all.find(action => action.kind === "hold");
  if (storage && structured.includes(storage)) shortlist.push(storage);
  for (const kind of ["place", "swap"]) {
    const available = structured.filter(action => action.kind === kind);
    const promising = [...available.slice(0, 4), ...available.slice().sort((a, b) => b.gain - a.gain || compare(a, b)).slice(0, 4)];
    for (const action of promising) if (!shortlist.includes(action)) shortlist.push(action);
  }
  let best = finishing ?? null;
  if (!finishing) {
    // Compare the number of paid placements needed to actually complete sampled future boards.
    // Common, deterministic future sequences make all candidate comparisons fair and undo replay stable.
    let seed = (Math.imul(state.board.lo ^ state.board.hi, 2654435761) ^ ((TYPE_IDS.indexOf(incoming) + 1) * 7919)) >>> 0;
    const samples = Array.from({ length: sampleCount }, () => Array.from({ length: 32 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return TYPE_IDS[Math.floor(seed / 4294967296 * TYPE_COUNT)];
    }));
    for (const candidate of shortlist) {
      let templateTotal = 0, gainTotal = 0;
      for (const sequence of samples) {
        templateTotal += rollout(candidate.nextBoard, candidate.nextHeld, sequence, "template");
        gainTotal += rollout(candidate.nextBoard, candidate.nextHeld, sequence, "gain");
      }
      const action = { ...candidate, futureCost: candidate.cost + Math.min(templateTotal, gainTotal) / samples.length };
      if (!best || action.futureCost < best.futureCost - 1e-9 ||
          (Math.abs(action.futureCost - best.futureCost) < 1e-9 && compare(action, best) < 0)) best = action;
    }
  }
  const { futureCost, canonical, anchorBlank, cost, nextBoard, nextHeld, minimumCost: discardedMinimum, progress: discardedProgress, ...action } = best;
  return action;
}

export function applyAction(state, action) {
  if (complete(state.board) || action.kind === "complete") return state;
  if (!TYPES[action.incoming]) throw new Error("알 수 없는 패턴입니다.");
  if (action.kind === "hold") {
    if (state.held !== null) throw new Error("보관함이 이미 차 있습니다.");
    return { ...state, held: action.incoming, turn: state.turn + 1, lastAction: { ...action, gain: 0 } };
  }
  if (action.kind !== "place" && action.kind !== "swap") throw new Error("알 수 없는 동작입니다.");
  const type = action.kind === "swap" ? state.held : action.incoming;
  if (!type || action.placement?.type !== type) throw new Error("배치할 패턴이 일치하지 않습니다.");
  const placement = PLACEMENTS[type].find(candidate => candidate.row === action.placement.row && candidate.col === action.placement.col);
  if (!placement) throw new Error("보드 밖에 배치할 수 없습니다.");
  const gain = placementGain(state.board, placement);
  return {
    board: addPlacement(state.board, placement),
    held: action.kind === "swap" ? action.incoming : state.held,
    latest: { ...placement, gain, fromHold: action.kind === "swap" },
    turn: state.turn + 1,
    placements: state.placements + 1,
    spent: state.spent + PLACEMENT_COST,
    lastAction: { kind: action.kind, incoming: action.incoming, deployed: type, placement, gain },
  };
}
