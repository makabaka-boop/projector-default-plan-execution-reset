import { describe, expect, it } from 'vitest';
import { solveOptimal, solveTopRoutes } from './tsp';
import { startExecution, confirmNext, finishReturn } from './execution';
import { makeRng, randomMatrix } from './brute';

/**
 * 验收硬指标：N=18（19×19 非对称矩阵）的精确求解必须在 4 秒内完成；
 * 校准路线候选集（固定三名后缀的扩展 Held–Karp）同样必须在 4 秒内给出三条互异路线；
 * 现场每次改序都要对剩余姿态重算，因此逐拍计时也必须达标。
 */
describe('性能：N=18 停机窗口', () => {
  it('单次 Held–Karp（18 目标）< 4 秒', () => {
    const n = 18;
    const flat = randomMatrix(n + 1, makeRng(2026));
    const r = solveOptimal(flat, n + 1, Array.from({ length: n }, (_, k) => k + 1), 0, 0);
    expect(r.cost).toBeGreaterThan(0);
    expect(r.sequence).toHaveLength(18);
    expect(new Set(r.sequence).size).toBe(18);
    // 打印实际耗时，供验收留痕
    console.log(`N=18 单次求解耗时：${r.solveMs.toFixed(1)} ms`);
    expect(r.solveMs).toBeLessThan(4000);
  });

  it('校准路线候选集（18 目标，三条互异精确路线）< 4 秒', () => {
    const n = 18;
    const flat = randomMatrix(n + 1, makeRng(2028));
    const set = solveTopRoutes(
      flat,
      n + 1,
      Array.from({ length: n }, (_, k) => k + 1),
      0,
      0,
    );
    expect(set.candidates).toHaveLength(3);
    for (const c of set.candidates) {
      expect(c.sequence).toHaveLength(18);
      expect(new Set(c.sequence).size).toBe(18);
      // 自报费用必须能由当前矩阵逐边复算
      let summed = 0;
      for (let i = 0; i + 1 < c.tour.length; i++) {
        summed += flat[c.tour[i]! * (n + 1) + c.tour[i + 1]!]!;
      }
      expect(summed).toBe(c.cost);
    }
    // 互异
    const seqs = set.candidates.map((c) => c.sequence.join(','));
    expect(new Set(seqs).size).toBe(3);
    // 非降序
    expect(set.candidates[1]!.cost).toBeGreaterThanOrEqual(set.candidates[0]!.cost);
    expect(set.candidates[2]!.cost).toBeGreaterThanOrEqual(set.candidates[1]!.cost);
    console.log(
      `N=18 三条候选耗时：${set.solveMs.toFixed(1)} ms，费用：${set.candidates
        .map((c) => c.cost)
        .join(' / ')}`,
    );
    expect(set.solveMs).toBeLessThan(4000);
  });

  it('现场逐步偏离：每一拍重排（含满 18 目标起步）均 < 4 秒', () => {
    const n = 18;
    const flat = randomMatrix(n + 1, makeRng(2027));
    let state = startExecution(plan(flat));
    const timings: number[] = [state.suffix.solveMs];
    expect(state.suffix.solveMs).toBeLessThan(4000);

    // 每一步都故意选“非推荐”的姿态，最坏现场情形
    const order = [9, 18, 1, 10, 17, 2, 8, 11, 3, 16, 7, 12, 4, 15, 6, 13, 5, 14];
    for (const pose of order) {
      state = confirmNext(state, pose);
      timings.push(state.suffix.solveMs);
      expect(state.suffix.solveMs).toBeLessThan(4000);
    }
    state = finishReturn(state);
    expect(state.finished).toBe(true);
    console.log(
      `N=18 逐步重排耗时（ms）：${timings.map((t) => t.toFixed(1)).join(', ')}`,
    );
  });

  function plan(flat: number[]) {
    return { n: 18, matrixFlat: flat };
  }
});
