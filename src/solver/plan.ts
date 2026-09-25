/**
 * 计划数据模型与严格校验。
 *
 * 约定：
 * - 姿态编号 1..N（N 取 8—18），0 为停放位。
 * - 费用矩阵为 (N+1)×(N+1) 的方阵，行优先二维数组。
 * - 主对角线必须为 0；其余项必须是 1..9999 的整数（费用有方向性，矩阵不必对称）。
 * - 可选“先于”关系 prerequisites：[a, b] 表示姿态 a 必须先于姿态 b 被确认；
 *   提交前校验姿态存在、不可自指、依赖图无环；重复边去重。缺省即无约束，
 *   旧输入行为逐项不变。
 * - 任一缺项、越界、形状不符或非法依赖，整批拒绝（调用方保留旧计划）。
 *
 * 迁移期新旧字段共存（matrix/costs、prerequisites/dependencies）：
 * - 只提供当前字段（matrix、prerequisites）或只提供旧别名（costs、dependencies）时
 *   完全兼容，行为与单字段版本逐项一致。
 * - 两套费用矩阵同时存在：各自独立规范化，逐格（含对角线）完全一致才视为同一计划。
 * - 两套依赖同时存在：各自去重、按 (a,b) 升序规范化后边集合完全一致才视为同一计划；
 *   空数组与缺省同义（均为无约束），故一空一非空即冲突。
 * - 任一侧自身非法（损坏、成环、越界……）或两侧规范化后不一致：整批拒绝，
 *   绝不静默优先其中一侧；调用方据此保留已生效计划、候选选择与执行进度。
 */

export const N_MIN = 8;
export const N_MAX = 18;
export const COST_MIN = 1;
export const COST_MAX = 9999;

/** “先于”关系：[a, b] 表示姿态 a 必须先于姿态 b（a 是 b 的前置/基准姿态）。 */
export type Precedence = [number, number];

export interface CalibrationPlan {
  /** 姿态数量（姿态编号 1..n） */
  n: number;
  /** (n+1)² 个费用，行优先；matrix[i][j] = matrixFlat[i*(n+1)+j] */
  matrixFlat: number[];
  /**
   * 可选“先于”关系（已校验：姿态存在、不自指、无环，并按 (a,b) 升序去重）。
   * 缺省或空数组 = 无任何前置约束，求解/执行/展示与旧版完全一致。
   */
  prerequisites?: Precedence[];
}

export interface ValidationResult {
  ok: boolean;
  /** 校验通过的计划；失败时为 undefined */
  plan?: CalibrationPlan;
  /** 就地展示给工程师的错误信息（失败时至少一条） */
  errors: string[];
}

/**
 * 校验工程师编辑或导入的 JSON。
 * 接受形如 { "n": 10, "matrix": [[0, ...], ...] } 或 { "n": 10, "costs": [[...]] } 的对象，
 * 也接受裸二维数组（此时 n = 边长 - 1）。
 * 可选字段 "prerequisites"（旧别名 "dependencies"）：形如 [[1, 3], [2, 3]]，
 * 每条 [a, b] 表示姿态 a 必须先于姿态 b；逐条校验姿态存在、不可自指，整批校验无环。
 *
 * 迁移期同一计划可能同时带新旧两套字段：此时两侧分别规范化（去重/排序/逐项检查），
 * 只有规范化结果逐项一致才接受；任一侧损坏或两侧冲突都整批拒绝，
 * 不静默偏向当前字段一侧（防止一次看似无损的导入导出改写计划语义）。
 */
export function validatePlan(input: unknown): ValidationResult {
  const errors: string[] = [];

  type MatrixCandidate = { field: string; value: unknown };
  let matrixCandidates: MatrixCandidate[] = [];
  let nCandidate: unknown;
  /** 字段名（当前/旧别名） → 原始值；存在性必须逐键探测（空数组也是“存在”）。 */
  let prereqCandidates: Array<{ field: string; value: unknown }> = [];

  if (Array.isArray(input)) {
    matrixCandidates = [{ field: 'matrix', value: input }];
  } else if (isPlainObject(input)) {
    const obj = input as Record<string, unknown>;
    nCandidate = obj.n;
    if (Object.prototype.hasOwnProperty.call(obj, 'matrix')) {
      matrixCandidates.push({ field: 'matrix', value: obj.matrix });
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'costs')) {
      matrixCandidates.push({ field: 'costs', value: obj.costs });
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'prerequisites')) {
      prereqCandidates.push({ field: 'prerequisites', value: obj.prerequisites });
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'dependencies')) {
      prereqCandidates.push({ field: 'dependencies', value: obj.dependencies });
    }
  } else {
    return { ok: false, errors: ['JSON 顶层必须是对象（含 n 与 matrix）或二维数组'] };
  }

  let n: number;
  if (typeof nCandidate === 'number') {
    n = nCandidate;
    if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) {
      errors.push(`n 必须是 ${N_MIN}—${N_MAX} 的整数，收到：${formatValue(nCandidate)}`);
    }
  } else if (nCandidate === undefined) {
    // 无 n 字段时从费用矩阵边长推断：两侧边长不一致时记为冲突，稍后逐候选报错。
    const inferred = matrixCandidates
      .map((c) => (Array.isArray(c.value) ? c.value.length - 1 : NaN))
      .filter((v) => Number.isInteger(v));
    n = inferred.length === 0 || inferred.some((v) => v !== inferred[0])
      ? (inferred[0] ?? NaN)
      : inferred[0]!;
  } else {
    errors.push(`n 必须是数字，收到：${formatValue(nCandidate)}`);
    n = NaN;
  }

  if (matrixCandidates.length === 0) {
    errors.push('matrix（费用矩阵）必须是数组，行优先的 (N+1)×(N+1) 二维数组');
    return { ok: false, errors: dedupe(errors) };
  }

  const nValid = Number.isInteger(n) && n >= N_MIN && n <= N_MAX;
  if (!nValid) {
    // n 本身非法（含两侧推断边长不一致）时，对每个矩阵候选给出形状/范围错误。
    for (const cand of matrixCandidates) {
      errors.push(...nShapeErrors(cand.value));
    }
    return { ok: false, errors: dedupe(errors) };
  }

  // N 已合法：两套矩阵分别完整规范化（形状 + 逐格），任一损坏都不静默采用另一侧。
  // 单字段时错误措辞与旧版逐字一致；两套并存时才加字段名前缀以指出损坏侧。
  const dim = n + 1;
  const coexist = matrixCandidates.length > 1;
  const normalizedMatrices = matrixCandidates.map((cand) => ({
    ...cand,
    ...normalizeMatrix(cand.value, dim, cand.field, coexist),
  }));
  for (const m of normalizedMatrices) {
    errors.push(...m.errors);
  }

  // “先于”关系：两套分别校验（姿态存在性、不自指、无环、去重排序）。
  // 单字段时错误前缀与旧版一致（恒为 prerequisites）；并存时按真实字段名指出损坏侧。
  const preCoexist = prereqCandidates.length > 1;
  const normalizedPrecedences = prereqCandidates.map((cand) => {
    const result = validatePrecedences(cand.value, n, cand.field, !preCoexist);
    return { field: cand.field, edges: result.edges, errors: result.errors };
  });
  for (const p of normalizedPrecedences) {
    errors.push(...p.errors);
  }

  // 两套矩阵都自身合法时，逐格一致性判定（不同字段顺序不影响数组顺序）。
  let matrixFlat: number[] = [];
  const validMatrices = normalizedMatrices.filter((m) => m.errors.length === 0);
  if (validMatrices.length === matrixCandidates.length && validMatrices.length > 0) {
    const first = validMatrices[0]!;
    const conflicts = validMatrices.slice(1).filter((m) => !arraysEqual(m.flat, first.flat));
    if (conflicts.length > 0) {
      errors.push(
        `matrix 与 costs 同时存在但费用矩阵不一致（第 ${firstMismatch(first.flat, conflicts[0]!.flat, dim)} 项起不同）：` +
          '两套表示必须逐项一致才视为同一计划，已整批拒绝（已生效计划保留）',
      );
    } else {
      matrixFlat = first.flat;
    }
  }

  // 两套依赖都自身合法时，按规范化后的边集合判定一致；空与缺省同义、空与非空即冲突。
  let prerequisites: Precedence[] | undefined;
  const validPrecedences = normalizedPrecedences.filter((p) => p.errors.length === 0);
  if (validPrecedences.length === prereqCandidates.length && validPrecedences.length > 0) {
    const firstEdges = validPrecedences[0]!.edges;
    const conflicting = validPrecedences
      .slice(1)
      .find((p) => !edgesEqual(p.edges, firstEdges));
    if (conflicting) {
      errors.push(
        `prerequisites 与 dependencies 同时存在但规范化后的“先于”关系不一致` +
          `（${formatEdges(firstEdges)} ≠ ${formatEdges(conflicting.edges)}）：` +
          '两套表示必须逐项一致才视为同一计划，已整批拒绝（已生效计划及其候选、执行进度保留）',
      );
    } else {
      prerequisites = firstEdges.length > 0 ? firstEdges : undefined;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors: dedupe(errors) };
  }

  const plan: CalibrationPlan = { n, matrixFlat };
  if (prerequisites && prerequisites.length > 0) plan.prerequisites = prerequisites;
  return { ok: true, plan, errors: [] };
}

interface NormalizedMatrix {
  /** 逐项检查通过后的行优先扁平矩阵 */
  flat: number[];
  errors: string[];
}

/**
 * 完整规范化一个费用矩阵候选：行数、行形状与逐格取值（对角线 0，其余 1..9999 整数）。
 * 单字段（label=false）时错误措辞与旧版逐字一致；两套并存（label=true）时带字段名前缀。
 */
function normalizeMatrix(
  raw: unknown,
  dim: number,
  field: string,
  label: boolean,
): NormalizedMatrix {
  const errors: string[] = [];
  const p = label ? `${field} ` : '';
  if (!Array.isArray(raw)) {
    return {
      flat: [],
      errors: [
        label
          ? `${field}（费用矩阵）必须是数组，行优先的 ${dim}×${dim} 二维数组`
          : 'matrix（费用矩阵）必须是数组，行优先的 (N+1)×(N+1) 二维数组',
      ],
    };
  }

  if (raw.length !== dim) {
    errors.push(
      label
        ? `${field} 行数必须为 ${dim}（N+1），实际 ${raw.length} 行；任一缺项即整批拒绝`
        : `矩阵行数必须为 ${dim}（N+1，N=${dim - 1}），实际 ${raw.length} 行；任一缺项即整批拒绝`,
    );
  }

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!Array.isArray(row)) {
      errors.push(`${p}第 ${i} 行不是数组`);
      continue;
    }
    if (row.length !== dim) {
      errors.push(`${p}第 ${i} 行有 ${row.length} 项，必须为 ${dim} 项；任一缺项即整批拒绝`);
    }
  }

  if (errors.length > 0) {
    return { flat: [], errors: dedupe(errors) };
  }

  // 形状已确认：恰好 dim 行 × dim 列，逐格检查并压平。
  const flat: number[] = [];
  for (let i = 0; i < dim; i++) {
    const row = (raw as unknown[][])[i]!;
    for (let j = 0; j < dim; j++) {
      const cell = row[j];
      const loc = label ? `${field}[${i}][${j}]` : `matrix[${i}][${j}]`;
      if (i === j) {
        if (cell !== 0) {
          errors.push(`主对角线必须为 0：${loc} 收到 ${formatValue(cell)}`);
        }
        flat.push(0);
      } else if (
        typeof cell === 'number' &&
        Number.isInteger(cell) &&
        cell >= COST_MIN &&
        cell <= COST_MAX
      ) {
        flat.push(cell);
      } else {
        errors.push(
          `${loc} 必须是 ${COST_MIN}—${COST_MAX} 的整数（不能缺项、小数或越界），收到：${formatValue(cell)}`,
        );
        flat.push(0); // 占位，最终仍会整体拒绝
      }
    }
  }

  return { flat, errors: dedupe(errors) };
}

/** n 非法时对矩阵候选做形状/范围检查，给出与单字段版本一致的就地错误。 */
function nShapeErrors(matrix: unknown): string[] {
  if (!Array.isArray(matrix)) {
    return ['matrix（费用矩阵）必须是数组，行优先的 (N+1)×(N+1) 二维数组'];
  }
  const square =
    matrix.length > 0 &&
    matrix.every((row) => Array.isArray(row) && row.length === matrix.length);
  if (!square) {
    return ['无法从矩阵推断 N：矩阵必须是 (N+1)×(N+1) 的方形二维数组'];
  }
  return [`推断的 N=${matrix.length - 1} 不在 ${N_MIN}—${N_MAX} 范围内`];
}

function arraysEqual(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** 两个扁平矩阵首个不同项的 [行][列] 定位文本（dim = N+1）。 */
function firstMismatch(a: ReadonlyArray<number>, b: ReadonlyArray<number>, dim: number): string {
  const len = Math.min(a.length, b.length);
  for (let k = 0; k < len; k++) {
    if (a[k] !== b[k]) {
      return `[${Math.floor(k / dim)}][${k % dim}]`;
    }
  }
  return `长度 ${a.length} vs ${b.length}`;
}

function edgesEqual(a: ReadonlyArray<Precedence>, b: ReadonlyArray<Precedence>): boolean {
  return a.length === b.length && a.every(([x, y], i) => x === b[i]![0] && y === b[i]![1]);
}

function formatEdges(edges: ReadonlyArray<Precedence>): string {
  return edges.length === 0 ? '[]（无依赖）' : edges.map(([a, b]) => `[${a}, ${b}]`).join('、');
}

interface PrecedenceResult {
  /** 校验通过后按 (a, b) 升序去重的“先于”边 */
  edges: Precedence[];
  errors: string[];
}

/**
 * 校验“先于”关系：必须是 [a, b] 二元整数数组；a、b 必须是 1..n 的现有姿态；
 * 不可自指；重复边去重；整图必须无环（环上的姿态永远无法满足前置）。
 * @param field 来源字段名，用于逐条错误定位。
 * @param legacyWording 单字段输入时为 true：错误措辞与旧版逐字一致（恒以 prerequisites 开头、
 *   环信息不带字段名）；新旧字段并存时为 false：按真实字段名指出损坏侧。
 */
export function validatePrecedences(
  raw: unknown,
  n: number,
  field = 'prerequisites',
  legacyWording = true,
): PrecedenceResult {
  const name = legacyWording ? 'prerequisites' : field;
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    return {
      edges: [],
      errors: [
        `${name} 必须是形如 [[a, b], ...] 的数组（a 先于 b），收到：${formatValue(raw)}`,
      ],
    };
  }

  const seen = new Set<number>();
  const edges: Precedence[] = [];
  const adjacency: number[][] = Array.from({ length: n + 1 }, () => []);

  raw.forEach((entry, idx) => {
    const badEntry = (msg: string): void => {
      errors.push(`${name}[${idx}] ${msg}`);
    };
    if (!Array.isArray(entry) || entry.length !== 2) {
      badEntry(`必须是恰好两个姿态编号的数组 [a, b]（a 先于 b），收到：${formatValue(entry)}`);
      return;
    }
    const [a, b] = entry as unknown[];
    const validA = typeof a === 'number' && Number.isInteger(a) && a >= 1 && a <= n;
    const validB = typeof b === 'number' && Number.isInteger(b) && b >= 1 && b <= n;
    if (!validA) {
      badEntry(`的前置姿态 a 必须是 1—${n} 的现有姿态编号，收到：${formatValue(a)}`);
    }
    if (!validB) {
      badEntry(`的后置姿态 b 必须是 1—${n} 的现有姿态编号，收到：${formatValue(b)}`);
    }
    if (!validA || !validB) return;
    const av = a as number;
    const bv = b as number;
    if (av === bv) {
      badEntry(`不可自指：姿态 ${av} 不能先于自己`);
      return;
    }
    const key = av * (n + 1) + bv;
    if (seen.has(key)) {
      return; // 重复边静默去重（不报错）
    }
    seen.add(key);
    edges.push([av, bv]);
    adjacency[av]!.push(bv);
  });

  if (edges.length > 0) {
    const cycle = findCycle(adjacency, n);
    if (cycle) {
      const prefix = legacyWording ? '“先于”依赖图' : `${field} 的“先于”依赖图`;
      errors.push(
        `${prefix}存在环：${cycle.join(' → ')}（环上姿态的前置条件互相依赖，永远无法全部满足）`,
      );
    }
  }

  if (errors.length > 0) return { edges: [], errors: dedupe(errors) };
  edges.sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!);
  return { edges, errors: [] };
}

/**
 * 有向图找环（DFS 三色法）：边 a→b 表示“a 必须先于 b”。
 * 返回环上姿态（首尾相接展示），无环返回 null。n ≤ 18，递归深度安全。
 */
function findCycle(adjacency: number[][], n: number): number[] | null {
  // 0 = 未访问，1 = 在当前递归栈中，2 = 已结束
  const color = new Uint8Array(n + 1);
  const stack: number[] = [];

  const dfs = (u: number): number[] | null => {
    color[u] = 1;
    stack.push(u);
    for (const v of adjacency[u]!) {
      if (color[v] === 0) {
        const found = dfs(v);
        if (found) return found;
      } else if (color[v] === 1) {
        const start = stack.indexOf(v);
        return [...stack.slice(start), v];
      }
    }
    stack.pop();
    color[u] = 2;
    return null;
  };

  for (let u = 1; u <= n; u++) {
    if (color[u] === 0) {
      const found = dfs(u);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 把“先于”边转成求解器/执行机使用的前置位掩码：
 * 返回数组按下标 = 姿态编号（0 号位闲置），preByPose[b] 的第 a 位为 1
 * 表示姿态 a 必须先于姿态 b。
 */
export function prerequisiteMasks(prerequisites: ReadonlyArray<Precedence> | undefined): Uint32Array {
  // 长度取 19：姿态编号 1..18，0 号位闲置；调用方按下标取位，无需知道 n。
  const masks = new Uint32Array(N_MAX + 1);
  if (prerequisites) {
    for (const [a, b] of prerequisites) {
      masks[b]! |= 1 << a;
    }
  }
  return masks;
}

/** 生成默认合法计划：对角线 0，非对角默认 1（工程师可改出方向性）。 */
export function createDefaultPlan(n: number): CalibrationPlan {
  const dim = n + 1;
  const matrixFlat = new Array<number>(dim * dim);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      matrixFlat[i * dim + j] = i === j ? 0 : 1;
    }
  }
  return { n, matrixFlat };
}

export function matrixToNested(plan: CalibrationPlan): number[][] {
  const dim = plan.n + 1;
  const rows: number[][] = [];
  for (let i = 0; i < dim; i++) {
    rows.push(plan.matrixFlat.slice(i * dim, (i + 1) * dim));
  }
  return rows;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === undefined) return 'undefined（缺项）';
  return String(v);
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}
