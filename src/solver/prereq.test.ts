import { describe, expect, it } from 'vitest';
import {
  createDefaultPlan,
  matrixToNested,
  prerequisiteMasks,
  validatePlan,
  type Precedence,
} from './plan';
import { solveOptimal, solveTopRoutes, TOP_K } from './tsp';
import { bruteForceOptimal, bruteForceTopK, makeRng, randomMatrix } from './brute';

function range1(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(i);
  return out;
}

function masks(edges: ReadonlyArray<Precedence>): Uint32Array {
  return prerequisiteMasks(edges);
}

function recompute(flat: number[], dim: number, tour: number[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < tour.length; i++) {
    sum += flat[tour[i]! * dim + tour[i + 1]!]!;
  }
  return sum;
}

/** 序列是否满足全部“先于”边（a 在 b 之前）。 */
function respectsEdges(seq: number[], edges: ReadonlyArray<Precedence>): boolean {
  for (const [a, b] of edges) {
    if (seq.indexOf(a) >= seq.indexOf(b)) return false;
  }
  return true;
}

describe('“先于”校验：姿态存在 / 不可自指 / 依赖图无环', () => {
  function nested(n: number) {
    return matrixToNested(createDefaultPlan(n));
  }

  it('合法依赖（链式/分叉/多组件）通过并按 (a,b) 升序去重返回', () => {
    const r = validatePlan({
      n: 8,
      matrix: nested(8),
      prerequisites: [
        [3, 1],
        [1, 2],
        [1, 2], // 重复边
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

  it('接受别名 dependencies；空数组等价无依赖', () => {
    const r1 = validatePlan({ n: 8, matrix: nested(8), dependencies: [[1, 2]] });
    expect(r1.ok).toBe(true);
    expect(r1.plan?.prerequisites).toEqual([[1, 2]]);
    const r2 = validatePlan({ n: 8, matrix: nested(8), prerequisites: [] });
    expect(r2.ok).toBe(true);
    expect(r2.plan?.prerequisites).toBeUndefined();
  });

  it('自指被拒绝', () => {
    const r = validatePlan({ n: 8, matrix: nested(8), prerequisites: [[3, 3]] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('不可自指');
  });

  it('引用不存在的姿态（0 与 N+1、小数、字符串）被拒绝', () => {
    const bad: unknown[] = [
      [[0, 1]],
      [[1, 9]],
      [[9, 1]],
      [[1.5, 2]],
      [['1', 2]],
      [[1]],
      [1, 2],
      [[1, 2, 3]],
    ];
    for (const prereq of bad) {
      const r = validatePlan({ n: 8, matrix: nested(8), prerequisites: prereq });
      expect(r.ok, JSON.stringify(prereq)).toBe(false);
      expect(r.errors.length, JSON.stringify(prereq)).toBeGreaterThan(0);
    }
  });

  it('prerequisites 非数组被拒绝', () => {
    expect(validatePlan({ n: 8, matrix: nested(8), prerequisites: 'x' }).ok).toBe(false);
    expect(validatePlan({ n: 8, matrix: nested(8), prerequisites: { '1': '2' } }).ok).toBe(
      false,
    );
  });

  it('环（二元互指/三元环/自环）一律拒绝，错误信息列出环上姿态', () => {
    const cyclic: Precedence[][] = [
      [
        [1, 2],
        [2, 1],
      ],
      [
        [1, 2],
        [2, 3],
        [3, 1],
      ],
      [
        [1, 2],
        [3, 4],
        [4, 5],
        [5, 3],
      ],
    ];
    for (const edges of cyclic) {
      const r = validatePlan({ n: 8, matrix: nested(8), prerequisites: edges });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain('环');
    }
  });

  it('无 prerequisites 字段的旧输入逐项保持原行为（计划中不带该字段）', () => {
    const r = validatePlan({ n: 8, matrix: nested(8) });
    expect(r.ok).toBe(true);
    expect(r.plan?.prerequisites).toBeUndefined();
  });
});

describe('“先于”约束下：HK 前三名 vs 全排列（独立枚举只接受拓扑序）', () => {
  const edgeSets: Array<{ name: string; edges: Precedence[] }> = [
    { name: '单条 a 先于 b', edges: [[2, 1]] },
    { name: '链 3→1→4', edges: [[3, 1], [1, 4]] },
    {
      name: '共同基准 1 先于 2,3,4',
      edges: [
        [1, 2],
        [1, 3],
        [1, 4],
      ],
    },
    {
      name: '两条独立链',
      edges: [
        [2, 1],
        [4, 3],
        [6, 5],
      ],
    },
    {
      name: '近乎全序',
      edges: [
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
      ],
    },
    {
      name: '菱形 1→2,1→3,2→4,3→4',
      edges: [
        [1, 2],
        [1, 3],
        [2, 4],
        [3, 4],
      ],
    },
  ];

  const sizes = [4, 5, 6, 7, 8];

  for (const m of sizes) {
    for (const { name, edges } of edgeSets) {
      // 跳过引用了不存在姿态的边集（不会发生，边按本批 m 手工给出）
      const usable = edges.filter(([a, b]) => a <= m && b <= m);
      it(`m=${m}，${name}：多组随机矩阵前三名逐组等于受约束全排列`, () => {
        for (let seed = 1; seed <= 20; seed++) {
          const dim = m + 1;
          const rng = makeRng(seed * 4099 + m * 17 + usable.length);
          const flat = randomMatrix(dim, rng);
          const targets = range1(m);
          const pre = masks(usable);

          const set = solveTopRoutes(flat, dim, targets, 0, 0, pre);
          const brute = bruteForceTopK(flat, dim, targets, 0, 0, TOP_K, pre);

          expect(set.feasible).toBe(true);
          expect(set.candidates).toHaveLength(brute.length);
          for (let r = 0; r < brute.length; r++) {
            const c = set.candidates[r]!;
            const b = brute[r]!;
            expect(c.cost).toBe(b.cost);
            expect(c.sequence).toEqual(b.sequence);
            expect(c.sequence).toHaveLength(m);
            // 每条输出路线都必须真正满足全部“先于”关系
            expect(respectsEdges(c.sequence, usable)).toBe(true);
            expect(recompute(flat, dim, c.tour)).toBe(c.cost);
          }
          // 排序：费用非降；同费时字典序非降（原有裁决在可行集合内保持）
          for (let r = 1; r < set.candidates.length; r++) {
            expect(set.candidates[r]!.cost).toBeGreaterThanOrEqual(
              set.candidates[r - 1]!.cost,
            );
          }
        }
      });
    }
  }

  it('强制固定顺序：1 先于 2…先于 m 时唯一可行路线即 1,2,…,m（随机非对称矩阵）', () => {
    const m = 6;
    const dim = m + 1;
    const edges: Precedence[] = [];
    for (let i = 1; i < m; i++) edges.push([i, i + 1]);
    const pre = masks(edges);
    for (let seed = 1; seed <= 10; seed++) {
      const flat = randomMatrix(dim, makeRng(seed * 131 + 7));
      const set = solveTopRoutes(flat, dim, range1(m), 0, 0, pre);
      expect(set.candidates).toHaveLength(1);
      expect(set.candidates[0]!.sequence).toEqual([1, 2, 3, 4, 5, 6]);
      expect(set.candidates[0]!.cost).toBe(recompute(flat, dim, set.candidates[0]!.tour));
      // 无约束最优通常不是这条——约束确实改变了结果而非空转
      const unconstrained = solveTopRoutes(flat, dim, range1(m), 0, 0);
      // 至少在某些种子下无约束最优不同于强制顺序
      if (unconstrained.candidates[0]!.sequence.join() !== '1,2,3,4,5,6') {
        expect(set.candidates[0]!.cost).toBeGreaterThanOrEqual(
          unconstrained.candidates[0]!.cost,
        );
      }
    }
  });

  it('单最优 solveOptimal 与受约束穷举最优一致（多起点、多子集，模拟执行中途）', () => {
    const dim = 9;
    const flat = randomMatrix(dim, makeRng(20260923));
    const edges: Precedence[] = [
      [1, 3],
      [2, 3],
      [3, 5],
      [4, 6],
    ];
    const pre = masks(edges);
    const cases: Array<{ origin: number; targets: number[] }> = [
      { origin: 0, targets: [1, 2, 3, 4, 5, 6, 7, 8] },
      { origin: 2, targets: [1, 3, 4, 5, 6, 7, 8] }, // 2 已确认：它作为 3 的前置视为满足
      { origin: 1, targets: [3, 4, 5, 6, 7, 8] }, // 1 已确认：3 的另一前置 2 不在目标集
      { origin: 3, targets: [5, 7, 8] }, // 3 已确认，只剩其后续 5
      { origin: 4, targets: [6] },
      { origin: 7, targets: [] },
    ];
    for (const cse of cases) {
      const exact = solveOptimal(flat, dim, cse.targets, cse.origin, 0, pre);
      const brute = bruteForceOptimal(flat, dim, cse.targets, cse.origin, 0, pre);
      expect(exact.cost).toBe(brute.cost);
      expect(exact.sequence).toEqual(brute.sequence);
      // 只核对两端都出现在 [起点, …剩余序列] 中的边；前置不在剩余集即已完成（自动满足）。
      const present = new Set([cse.origin, ...cse.targets]);
      const activeEdges = edges.filter(([a, b]) => present.has(a) && present.has(b));
      expect(respectsEdges([cse.origin, ...exact.sequence], activeEdges)).toBe(true);
    }
  });

  it('同费并列时仍按字典序裁决，但只在满足依赖的路线之间', () => {
    const n = 4;
    const dim = n + 1;
    const flat = new Array<number>(dim * dim).fill(1);
    for (let i = 0; i < dim; i++) flat[i * dim + i] = 0;
    // 约束 3 先于 1：可行的字典序最小序列不再是 [1,2,3,4]
    const pre = masks([[3, 1]]);
    const set = solveTopRoutes(flat, dim, range1(n), 0, 0, pre);
    const brute = bruteForceTopK(flat, dim, range1(n), 0, 0, TOP_K, pre);
    expect(set.candidates.map((c) => c.sequence)).toEqual(brute.map((b) => b.sequence));
    // 3 必须在 1 前；等费下字典序最小可行序列是 [2,3,1,4]
    expect(set.candidates[0]!.sequence).toEqual([2, 3, 1, 4]);
    for (const c of set.candidates) expect(respectsEdges(c.sequence, [[3, 1]])).toBe(true);
  });

  it('无约束（undefined 与全 0 掩码）结果与原求解器逐项一致', () => {
    const dim = 7;
    const flat = randomMatrix(dim, makeRng(555));
    const targets = range1(dim - 1);
    const a = solveTopRoutes(flat, dim, targets, 0, 0);
    const b = solveTopRoutes(flat, dim, targets, 0, 0, undefined);
    const c = solveTopRoutes(flat, dim, targets, 0, 0, new Uint32Array(dim));
    expect(b.candidates).toEqual(a.candidates);
    expect(c.candidates).toEqual(a.candidates);
  });

  it('相互约束（2 先于 4 与 4 先于 2 同时存在）：无可行路线，候选为空且 feasible=false', () => {
    // 注意：这种输入在计划层会被判成环拒绝，这里直接喂给求解器验证其防御行为。
    const dim = 5;
    const flat = randomMatrix(dim, makeRng(999));
    const pre = masks([
      [2, 4],
      [4, 2],
    ]);
    const set = solveTopRoutes(flat, dim, range1(4), 0, 0, pre);
    expect(set.feasible).toBe(false);
    expect(set.candidates).toEqual([]);
    expect(bruteForceTopK(flat, dim, range1(4), 0, 0, TOP_K, pre)).toEqual([]);
    expect(() => solveOptimal(flat, dim, range1(4), 0, 0, pre)).toThrow(/不可行|环/);
  });
});

describe('“先于”约束下 N=18 性能不退化（< 4 秒）', () => {
  it('18 目标带 12 条链/分叉约束的前三名求解 < 4000 ms', () => {
    const n = 18;
    const flat = randomMatrix(n + 1, makeRng(20280923));
    const edges: Precedence[] = [
      [1, 3],
      [2, 3],
      [3, 7],
      [4, 8],
      [5, 9],
      [6, 10],
      [7, 12],
      [8, 12],
      [9, 13],
      [10, 14],
      [11, 15],
      [12, 18],
    ];
    const started = Date.now();
    const set = solveTopRoutes(flat, n + 1, range1(n), 0, 0, masks(edges));
    const elapsed = Date.now() - started;
    expect(set.feasible).toBe(true);
    expect(set.candidates).toHaveLength(3);
    for (const c of set.candidates) {
      expect(c.sequence).toHaveLength(18);
      expect(respectsEdges(c.sequence, edges)).toBe(true);
      expect(recompute(flat, n + 1, c.tour)).toBe(c.cost);
    }
    console.log(`N=18 带“先于”约束三条候选耗时：${elapsed} ms（求解器自报 ${set.solveMs.toFixed(1)} ms）`);
    expect(elapsed).toBeLessThan(4000);
  });
});
