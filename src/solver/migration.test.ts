import { describe, expect, it } from 'vitest';
import {
  type Precedence,
  createDefaultPlan,
  matrixToNested,
  prerequisiteMasks,
  validatePlan,
} from './plan';
import { solveTopRoutes } from './tsp';
import { makeRng, randomMatrix } from './brute';

function range1(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(i);
  return out;
}

function respectsEdges(seq: number[], edges: ReadonlyArray<Precedence>): boolean {
  for (const [a, b] of edges) {
    if (seq.indexOf(a) >= seq.indexOf(b)) return false;
  }
  return true;
}

/** 深拷贝费用矩阵，便于在副本上制造冲突格。 */
function clone(m: number[][]): number[][] {
  return m.map((row) => row.slice());
}

describe('迁移期新旧字段共存：兼容（只提供一侧）', () => {
  function nested(n: number) {
    return matrixToNested(createDefaultPlan(n));
  }

  it('只提供旧别名 costs + dependencies：接受且依赖真正生效（不被当成无约束）', () => {
    const r = validatePlan({ n: 8, costs: nested(8), dependencies: [[1, 2], [3, 2]] });
    expect(r.ok).toBe(true);
    expect(r.plan?.prerequisites).toEqual([
      [1, 2],
      [3, 2],
    ]);

    // 关键回归：旧别名依赖必须进入约束位掩码、改变候选集，而不是给出无约束前三
    const flat = r.plan!.matrixFlat;
    const constrained = solveTopRoutes(
      flat,
      9,
      range1(8),
      0,
      0,
      prerequisiteMasks(r.plan!.prerequisites),
    );
    for (const c of constrained.candidates) {
      expect(respectsEdges(c.sequence, r.plan!.prerequisites!)).toBe(true);
    }
  });

  it('只提供当前字段 matrix + prerequisites：接受（行为与旧版逐项一致）', () => {
    const r = validatePlan({
      n: 8,
      matrix: nested(8),
      prerequisites: [
        [1, 2],
        [3, 2],
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.plan?.prerequisites).toEqual([
      [1, 2],
      [3, 2],
    ]);
  });

  it('只给 costs（无 n）时仍从边长推断 N', () => {
    const r = validatePlan({ costs: nested(10) });
    expect(r.ok).toBe(true);
    expect(r.plan?.n).toBe(10);
  });
});

describe('迁移期新旧字段共存：等价共存（规范化后逐项一致即同一计划）', () => {
  function nested(n: number) {
    return matrixToNested(createDefaultPlan(n));
  }

  it('matrix 与 costs 逐格相同：接受，扁平矩阵与单侧版本逐项一致', () => {
    const m = nested(8);
    const both = validatePlan({ n: 8, matrix: m, costs: clone(m) });
    const one = validatePlan({ n: 8, matrix: m });
    expect(both.ok).toBe(true);
    expect(both.plan!.matrixFlat).toEqual(one.plan!.matrixFlat);
    expect(both.plan!.n).toBe(8);
  });

  it('prerequisites 与 dependencies 边序不同、含重复边：去重排序后一致即接受', () => {
    const m = nested(8);
    const r = validatePlan({
      n: 8,
      matrix: m,
      costs: clone(m),
      prerequisites: [
        [4, 5],
        [1, 2],
        [3, 1],
        [1, 2], // 当前字段内部重复
      ],
      dependencies: [
        [3, 1],
        [1, 2], // 跨字段重复
        [4, 5],
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.plan?.prerequisites).toEqual([
      [1, 2],
      [3, 1],
      [4, 5],
    ]);
  });

  it('两侧均为空数组：接受，计划不带 prerequisites（与无字段旧输入同义）', () => {
    const m = nested(8);
    const r = validatePlan({
      n: 8,
      matrix: m,
      costs: clone(m),
      prerequisites: [],
      dependencies: [],
    });
    expect(r.ok).toBe(true);
    expect(r.plan?.prerequisites).toBeUndefined();
  });

  it('不同 JSON 字段顺序不影响等价判定（对象键序 + 边序均无关）', () => {
    const m = nested(8);
    // 手动构造：旧字段写在前面，新字段写在后面；依赖顺序相反
    const text = JSON.stringify({
      dependencies: [
        [3, 2],
        [1, 2],
      ],
      costs: m,
      n: 8,
      prerequisites: [
        [1, 2],
        [3, 2],
      ],
      matrix: m,
    });
    const r = validatePlan(JSON.parse(text));
    expect(r.ok).toBe(true);
    expect(r.plan?.prerequisites).toEqual([
      [1, 2],
      [3, 2],
    ]);
  });

  it('等价共存计划的候选前三名与单侧（当前字段）计划完全相同', () => {
    const n = 8;
    const flat = randomMatrix(n + 1, makeRng(20260924));
    const dim = n + 1;
    const nested = matrixToNested({ n, matrixFlat: flat });
    const edges: Precedence[] = [
      [2, 1],
      [1, 4],
      [3, 4],
    ];

    const currentOnly = validatePlan({ n, matrix: nested, prerequisites: edges });
    const mixed = validatePlan({
      n,
      matrix: nested,
      costs: clone(nested),
      prerequisites: [[3, 4], [1, 4], [2, 1]],
      dependencies: [[1, 4], [2, 1], [2, 1], [3, 4]],
    });
    expect(mixed.ok).toBe(true);
    expect(mixed.plan!.matrixFlat).toEqual(currentOnly.plan!.matrixFlat);

    const a = solveTopRoutes(
      currentOnly.plan!.matrixFlat,
      dim,
      range1(n),
      0,
      0,
      prerequisiteMasks(currentOnly.plan!.prerequisites),
    );
    const b = solveTopRoutes(
      mixed.plan!.matrixFlat,
      dim,
      range1(n),
      0,
      0,
      prerequisiteMasks(mixed.plan!.prerequisites),
    );
    expect(b.candidates.map((c) => [c.rank, c.cost, c.sequence])).toEqual(
      a.candidates.map((c) => [c.rank, c.cost, c.sequence]),
    );
    for (const c of b.candidates) expect(respectsEdges(c.sequence, edges)).toBe(true);
  });
});

describe('迁移期新旧字段共存：矩阵冲突 / 一侧损坏 → 整批拒绝', () => {
  function nested(n: number) {
    return matrixToNested(createDefaultPlan(n));
  }

  it('matrix 与 costs 任一格不同：拒绝且不给出 plan', () => {
    const a = nested(8);
    const b = clone(a);
    b[2]![5] = 999; // 与 a[2][5]=1 冲突（两格各自都合法）
    const r = validatePlan({ n: 8, matrix: a, costs: b });
    expect(r.ok).toBe(false);
    expect(r.plan).toBeUndefined();
    expect(r.errors.join(' ')).toContain('不一致');
    expect(r.errors.join(' ')).toContain('matrix');
    expect(r.errors.join(' ')).toContain('costs');
  });

  it('对角线一侧为 0、一侧非 0：视为冲突/损坏，拒绝', () => {
    const a = nested(8);
    const b = clone(a);
    b[3]![3] = 5;
    expect(validatePlan({ n: 8, matrix: a, costs: b }).ok).toBe(false);
  });

  it('两套矩阵边长不同（推断 N 不一致）：拒绝', () => {
    const r = validatePlan({ matrix: nested(8), costs: nested(10) });
    expect(r.ok).toBe(false);
    expect(r.plan).toBeUndefined();
  });

  it('一侧损坏（costs 有缺项/越界）：拒绝并指出损坏侧，不静默采用完好侧', () => {
    const good = nested(8);
    const bad = clone(good) as unknown[][];
    bad[1] = bad[1]!.slice(0, 8); // costs 少一项
    const r1 = validatePlan({ n: 8, matrix: good, costs: bad });
    expect(r1.ok).toBe(false);
    expect(r1.errors.join(' ')).toContain('costs');

    const badCell = clone(good);
    badCell[0]![1] = 10000; // costs 越界
    const r2 = validatePlan({ n: 8, matrix: good, costs: badCell });
    expect(r2.ok).toBe(false);
    expect(r2.errors.join(' ')).toContain('costs[0][1]');
  });
});

describe('迁移期新旧字段共存：依赖冲突（含“空新 vs 非空旧”）→ 整批拒绝', () => {
  function nested(n: number) {
    return matrixToNested(createDefaultPlan(n));
  }

  it('prerequisites 为空而 dependencies 含必要前置：拒绝（旧字段不得被静默忽略）', () => {
    // 这是事故核心场景：空新依赖 + 非空旧依赖，旧系统会给出无约束前三并放行执行
    const r = validatePlan({
      n: 8,
      matrix: nested(8),
      prerequisites: [],
      dependencies: [[1, 2]],
    });
    expect(r.ok).toBe(false);
    expect(r.plan).toBeUndefined();
    expect(r.errors.join(' ')).toContain('不一致');
    expect(r.errors.join(' ')).toContain('prerequisites');
    expect(r.errors.join(' ')).toContain('dependencies');
  });

  it('反向：prerequisites 非空而 dependencies 为空：同样拒绝', () => {
    const r = validatePlan({
      n: 8,
      matrix: nested(8),
      prerequisites: [[1, 2]],
      dependencies: [],
    });
    expect(r.ok).toBe(false);
    expect(r.plan).toBeUndefined();
  });

  it('两侧边集合不同（非纯重复）：拒绝并展示各自规范化结果', () => {
    const r = validatePlan({
      n: 8,
      matrix: nested(8),
      prerequisites: [
        [1, 2],
        [3, 4],
      ],
      dependencies: [[1, 2]],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('不一致');
    expect(r.errors.join(' ')).toContain('[3, 4]');
  });

  it('一侧依赖成环、另一侧合法：拒绝并指出成环侧，不静默采用合法侧', () => {
    const r = validatePlan({
      n: 8,
      matrix: nested(8),
      costs: clone(nested(8)),
      prerequisites: [
        [1, 2],
        [2, 1],
      ],
      dependencies: [[1, 2]],
    });
    expect(r.ok).toBe(false);
    expect(r.plan).toBeUndefined();
    expect(r.errors.join(' ')).toContain('环');
    expect(r.errors.join(' ')).toContain('prerequisites');
  });

  it('一侧依赖类型损坏（非数组 / 越界姿态）：拒绝', () => {
    const base = { n: 8, matrix: nested(8), costs: clone(nested(8)) };
    const r1 = validatePlan({ ...base, prerequisites: 'x', dependencies: [[1, 2]] });
    expect(r1.ok).toBe(false);
    expect(r1.errors.join(' ')).toContain('prerequisites');

    const r2 = validatePlan({
      ...base,
      prerequisites: [[1, 2]],
      dependencies: [[1, 9]],
    });
    expect(r2.ok).toBe(false);
    expect(r2.errors.join(' ')).toContain('dependencies[0]');
  });
});
