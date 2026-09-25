import { describe, expect, it } from 'vitest';
import { solveOptimal, solveTopRoutes, TOP_K, type RouteCandidate } from './tsp';
import { bruteForceTopK, makeRng, randomMatrix } from './brute';

/** 从当前非对称矩阵逐边复算完整路线费用（不采信求解器自报值）。 */
function recompute(flat: number[], dim: number, tour: number[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < tour.length; i++) {
    sum += flat[tour[i]! * dim + tour[i + 1]!]!;
  }
  return sum;
}

function expectCandidateShape(c: RouteCandidate, m: number) {
  // 恰访 1..m 各一次：tour 以 0 起、0 收，中间 m 个姿态互异且恰好覆盖目标集
  expect(c.tour[0]).toBe(0);
  expect(c.tour[c.tour.length - 1]).toBe(0);
  expect(c.sequence).toHaveLength(m);
  expect(c.tour).toEqual([0, ...c.sequence, 0]);
  expect(new Set(c.sequence).size).toBe(m);
  expect([...c.sequence].sort((a, b) => a - b)).toEqual(
    Array.from({ length: m }, (_, k) => k + 1),
  );
}

describe('校准路线候选集：HK 固定三名后缀 vs 全排列前三名', () => {
  // 小样本目标数；m=1、2 时互异路线数（m!）不足 3，专门核对“数量不足”分支
  const sizes = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const m of sizes) {
    it(`目标数 m=${m}：多组随机非对称矩阵的前三名逐组等于全排列`, () => {
      for (let seed = 1; seed <= 30; seed++) {
        const dim = m + 1;
        const rng = makeRng(seed * 104729 + m * 31);
        const flat = randomMatrix(dim, rng);
        const targets = Array.from({ length: m }, (_, k) => k + 1);

        const set = solveTopRoutes(flat, dim, targets, 0, 0);
        const brute = bruteForceTopK(flat, dim, targets, 0, 0, TOP_K);

        // 数量 = min(3, m!)，无占位、无重复
        expect(set.candidates).toHaveLength(Math.min(TOP_K, factorial(m)));
        expect(brute).toHaveLength(Math.min(TOP_K, factorial(m)));

        // 排名连续 1 起
        set.candidates.forEach((c, idx) => expect(c.rank).toBe(idx + 1));

        for (let r = 0; r < set.candidates.length; r++) {
          const c = set.candidates[r]!;
          const b = brute[r]!;
          expect(c.cost).toBe(b.cost);
          expect(c.sequence).toEqual(b.sequence);
          expectCandidateShape(c, m);
          // 费用可由当前非对称矩阵逐边复算
          expect(recompute(flat, dim, c.tour)).toBe(c.cost);
        }

        // 互异性：序列两两不同
        const seqs = set.candidates.map((c) => c.sequence.join(','));
        expect(new Set(seqs).size).toBe(seqs.length);

        // 排序断言：总耗时非降；同费时完整姿态序列字典序非降
        for (let r = 1; r < set.candidates.length; r++) {
          const prev = set.candidates[r - 1]!;
          const cur = set.candidates[r]!;
          expect(cur.cost).toBeGreaterThanOrEqual(prev.cost);
          if (cur.cost === prev.cost) {
            expect(lexCompare(cur.sequence, prev.sequence)).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });
  }

  it('任意起点与任意剩余子集（执行重排场景）前三名也与穷举一致', () => {
    const dim = 7; // 编号 0..6
    const rng = makeRng(4242);
    const flat = randomMatrix(dim, rng);
    const cases: Array<{ origin: number; targets: number[] }> = [
      { origin: 3, targets: [1, 2, 4, 5, 6] },
      { origin: 6, targets: [1, 4] }, // 2! = 2，只应有两条
      { origin: 2, targets: [5] }, // 1! = 1
      { origin: 1, targets: [] }, // 0 目标，只有 origin->home
    ];
    for (const cse of cases) {
      const set = solveTopRoutes(flat, dim, cse.targets, cse.origin, 0);
      const brute = bruteForceTopK(flat, dim, cse.targets, cse.origin, 0, TOP_K);
      expect(set.candidates).toHaveLength(brute.length);
      for (let r = 0; r < brute.length; r++) {
        expect(set.candidates[r]!.cost).toBe(brute[r]!.cost);
        expect(set.candidates[r]!.sequence).toEqual(brute[r]!.sequence);
      }
    }
  });

  it('原 solveOptimal 恒等于候选首名（兼容既有现场后缀重排）', () => {
    for (const m of [1, 3, 6, 8]) {
      for (let seed = 1; seed <= 20; seed++) {
        const dim = m + 1;
        const flat = randomMatrix(dim, makeRng(seed * 131 + m));
        const targets = Array.from({ length: m }, (_, k) => k + 1);
        const one = solveOptimal(flat, dim, targets, 0, 0);
        const top = solveTopRoutes(flat, dim, targets, 0, 0);
        expect(one.cost).toBe(top.candidates[0]!.cost);
        expect(one.sequence).toEqual(top.candidates[0]!.sequence);
        expect(one.tour).toEqual(top.candidates[0]!.tour);
      }
    }
  });

  it('数量不足：m=1 仅 1 条、m=2 仅 2 条，无占位无重复', () => {
    {
      // 2×2：0→1=5，1→0=7
      const flat = [0, 5, 7, 0];
      const m = 1;
      const set = solveTopRoutes(flat, m + 1, [1], 0, 0);
      expect(set.candidates).toHaveLength(1);
      expect(set.candidates[0]!.rank).toBe(1);
      expect(set.candidates[0]!.tour).toEqual([0, 1, 0]);
      expect(set.candidates[0]!.cost).toBe(12);
    }
    {
      // 0→1=1,0→2=2,1→0=3,1→2=4,2→0=5,2→1=6
      const flat = [
        0, 1, 2,
        3, 0, 4,
        5, 6, 0,
      ];
      const set = solveTopRoutes(flat, 3, [1, 2], 0, 0);
      expect(set.candidates).toHaveLength(2);
      // 0-1-2-0 = 1+4+5 = 10；0-2-1-0 = 2+6+3 = 11
      expect(set.candidates[0]!.sequence).toEqual([1, 2]);
      expect(set.candidates[0]!.cost).toBe(10);
      expect(set.candidates[1]!.sequence).toEqual([2, 1]);
      expect(set.candidates[1]!.cost).toBe(11);
    }
  });

  it('锁定全等费用 N=8 前三序列（字典序升序）', () => {
    const n = 8;
    const dim = n + 1;
    const flat = new Array<number>(dim * dim).fill(1);
    for (let i = 0; i < dim; i++) flat[i * dim + i] = 0;
    const targets = Array.from({ length: n }, (_, k) => k + 1);
    const set = solveTopRoutes(flat, dim, targets, 0, 0);

    expect(set.candidates).toHaveLength(3);
    expect(set.candidates[0]!.sequence).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(set.candidates[1]!.sequence).toEqual([1, 2, 3, 4, 5, 6, 8, 7]);
    expect(set.candidates[2]!.sequence).toEqual([1, 2, 3, 4, 5, 7, 6, 8]);
    // 全等费用 ⇒ 三名同费，且每条 tour 逐边复算均为 9
    for (const c of set.candidates) {
      expect(c.cost).toBe(9);
      expect(recompute(flat, dim, c.tour)).toBe(9);
    }
  });

  it('非对称方向性构造：候选集整体与全排列一致且费用逐边复算', () => {
    const n = 8;
    const dim = n + 1;
    const flat = new Array<number>(dim * dim).fill(100);
    for (let i = 0; i < dim; i++) flat[i * dim + i] = 0;
    for (let k = 0; k < n; k++) flat[k * dim + (k + 1)] = 1;
    flat[n * dim + 0] = 1;

    const targets = Array.from({ length: n }, (_, k) => k + 1);
    const set = solveTopRoutes(flat, dim, targets, 0, 0);
    const brute = bruteForceTopK(flat, dim, targets, 0, 0, TOP_K);
    expect(set.candidates[0]!.sequence).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(set.candidates[0]!.cost).toBe(9);
    for (let r = 0; r < TOP_K; r++) {
      expect(set.candidates[r]!.cost).toBe(brute[r]!.cost);
      expect(set.candidates[r]!.sequence).toEqual(brute[r]!.sequence);
      expect(recompute(flat, dim, set.candidates[r]!.tour)).toBe(brute[r]!.cost);
    }
  });

  it('高并列压力（小值域费用）：m=4…9、大量随机组前三名逐组等于全排列', () => {
    // 非对角边只取 1..3：同费路线极多，专门压 (j, 子排名) 合并与字典序 tie-break。
    for (let m = 4; m <= 9; m++) {
      const dim = m + 1;
      for (let seed = 1; seed <= 40; seed++) {
        const rng = makeRng(seed * 7919 + m * 13);
        const flat = new Array<number>(dim * dim).fill(0);
        for (let i = 0; i < dim; i++) {
          for (let j = 0; j < dim; j++) {
            if (i !== j) flat[i * dim + j] = 1 + Math.floor(rng() * 3);
          }
        }
        const targets = Array.from({ length: m }, (_, k) => k + 1);
        const set = solveTopRoutes(flat, dim, targets, 0, 0);
        const brute = bruteForceTopK(flat, dim, targets, 0, 0, TOP_K);

        expect(set.candidates).toHaveLength(3); // m ≥ 4 ⇒ m! ≥ 24 > 3
        for (let r = 0; r < 3; r++) {
          expect(set.candidates[r]!.cost).toBe(brute[r]!.cost);
          expect(set.candidates[r]!.sequence).toEqual(brute[r]!.sequence);
          expect(recompute(flat, dim, set.candidates[r]!.tour)).toBe(brute[r]!.cost);
        }
        // 同费档内必须严格字典序
        expect(set.candidates[0]!.cost).toBeLessThanOrEqual(set.candidates[1]!.cost);
        expect(set.candidates[1]!.cost).toBeLessThanOrEqual(set.candidates[2]!.cost);
        if (set.candidates[0]!.cost === set.candidates[1]!.cost) {
          expect(lexCompare(set.candidates[1]!.sequence, set.candidates[0]!.sequence)).toBe(1);
        }
      }
    }
  });
});

function factorial(m: number): number {
  let v = 1;
  for (let i = 2; i <= m; i++) v *= i;
  return v;
}

function lexCompare(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length - b.length;
}
