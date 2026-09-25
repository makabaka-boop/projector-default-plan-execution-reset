import { describe, expect, it } from 'vitest';
import { solveOptimal } from './tsp';
import { bruteForceOptimal, makeRng, randomMatrix } from './brute';

/**
 * 穷举小样本：m 个目标（外加停放位 0），随机非对称矩阵，
 * Held–Karp 的费用与字典序最优序列必须与全排列枚举完全一致（精确值）。
 */
describe('Held–Karp 精确解 vs 全排列穷举', () => {
  const sizes = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const m of sizes) {
    it(`目标数 m=${m}：多组随机非对称矩阵逐组核对`, () => {
      for (let seed = 1; seed <= 30; seed++) {
        const dim = m + 1;
        const rng = makeRng(seed * 7919 + m);
        const flat = randomMatrix(dim, rng);
        const targets = Array.from({ length: m }, (_, k) => k + 1);

        const exact = solveOptimal(flat, dim, targets, 0, 0);
        const brute = bruteForceOptimal(flat, dim, targets, 0, 0);

        expect(exact.cost).toBe(brute.cost);
        expect(exact.sequence).toEqual(brute.sequence);
        // 报出的总耗时必须等于路线逐边求和，杜绝假结果
        let summed = 0;
        for (let i = 0; i + 1 < exact.tour.length; i++) {
          summed += flat[exact.tour[i]! * dim + exact.tour[i + 1]!]!;
        }
        expect(summed).toBe(exact.cost);
        expect(exact.tour).toEqual([0, ...brute.sequence, 0]);
      }
    });
  }

  it('手工精确值：n=2，0→1→2→0 = 2+3+4 = 9；反向 5+9+7 = 21', () => {
    //   行\列  0  1  2
    const flat = [
      0, 2, 5, // 0
      7, 0, 3, // 1
      4, 9, 0, // 2
    ];
    const r = solveOptimal(flat, 3, [1, 2], 0, 0);
    expect(r.cost).toBe(9);
    expect(r.sequence).toEqual([1, 2]);
  });

  it('方向性必须起作用：便宜有向环正向 9、反向 900，必须选正向（禁止按对称问题处理）', () => {
    // 闭环 TSP 中矩阵转置的最优费用必然相同（最优环反向），因此不能用转置比较费用；
    // 这里构造唯一便宜的有向环 0→1→2→...→n→0=1，其余有向边=100。
    const n = 8;
    const dim = n + 1;
    const flat = new Array<number>(dim * dim).fill(100);
    for (let i = 0; i < dim; i++) flat[i * dim + i] = 0;
    for (let k = 0; k < n; k++) flat[k * dim + (k + 1)] = 1; // 0→1,1→2,...,n-1→n
    flat[n * dim + 0] = 1; // n→0

    const targets = Array.from({ length: n }, (_, k) => k + 1);
    const a = solveOptimal(flat, dim, targets, 0, 0);
    const bruteA = bruteForceOptimal(flat, dim, targets, 0, 0);
    expect(a.cost).toBe(bruteA.cost);
    expect(a.sequence).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a.cost).toBe(9);

    // 同一矩阵里反向序列的费用必须是昂贵的——证明 C(i,j)≠C(j,i) 被区别对待
    const reversedTour = [0, ...targets.slice().reverse(), 0];
    let reversedCost = 0;
    for (let i = 0; i + 1 < reversedTour.length; i++) {
      reversedCost += flat[reversedTour[i]! * dim + reversedTour[i + 1]!]!;
    }
    expect(reversedCost).toBe(900);

    // 转置后：最优环整体反向，费用仍为 9，但序列必须变为降序
    const transposed = new Array<number>(dim * dim);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) transposed[i * dim + j] = flat[j * dim + i]!;
    }
    const b = solveOptimal(transposed, dim, targets, 0, 0);
    expect(b.cost).toBe(9);
    expect(b.sequence).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('任意起点/终点与任意剩余子集（执行重排场景）也与穷举一致', () => {
    const dim = 7; // 编号 0..6
    const rng = makeRng(123);
    const flat = randomMatrix(dim, rng);
    const cases: Array<{ origin: number; targets: number[] }> = [
      { origin: 3, targets: [1, 2, 4, 5, 6] },
      { origin: 6, targets: [1, 4] },
      { origin: 2, targets: [5] },
      { origin: 1, targets: [] },
    ];
    for (const c of cases) {
      const exact = solveOptimal(flat, dim, c.targets, c.origin, 0);
      const brute = bruteForceOptimal(flat, dim, c.targets, c.origin, 0);
      expect(exact.cost).toBe(brute.cost);
      expect(exact.sequence).toEqual(brute.sequence);
    }
  });

  it('并列时取姿态序列字典序最小：构造三条并列最优，必选 [1,2,3]', () => {
    // n=3，下列 9 条边费用为 1，其余 3 条为 10：
    // 01,12,23,30 / 13,32,20 / 02,21
    // 路线 0-1-2-3-0、0-1-3-2-0、0-2-1-3-0 费用均为 4，其余为 22。
    const flat = Array.from({ length: 16 }, () => 10);
    const dim = 4;
    const set = (i: number, j: number, v: number) => {
      flat[i * dim + j] = v;
    };
    for (let i = 0; i < 4; i++) set(i, i, 0);
    const cheapEdges: number[][] = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [1, 3], [3, 2], [2, 0], [0, 2], [2, 1],
    ];
    for (const [i, j] of cheapEdges) {
      set(i!, j!, 1);
    }
    const r = solveOptimal(flat, dim, [1, 2, 3], 0, 0);
    const brute = bruteForceOptimal(flat, dim, [1, 2, 3], 0, 0);
    expect(brute.cost).toBe(4);
    expect(r.cost).toBe(4);
    expect(r.sequence).toEqual([1, 2, 3]);
  });

  it('所有边等费：字典序即 1..m 升序', () => {
    for (const m of [1, 4, 8]) {
      const dim = m + 1;
      const flat = new Array<number>(dim * dim).fill(1);
      for (let i = 0; i < dim; i++) flat[i * dim + i] = 0;
      const targets = Array.from({ length: m }, (_, k) => k + 1);
      const r = solveOptimal(flat, dim, targets, 0, 0);
      expect(r.sequence).toEqual(targets);
      expect(r.cost).toBe(m + 1);
    }
  });
});
