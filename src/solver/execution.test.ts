import { describe, expect, it } from 'vitest';
import { type CalibrationPlan } from './plan';
import { solveTopRoutes, type RouteCandidate } from './tsp';
import {
  confirmNext,
  deltaVsOriginal,
  finishReturn,
  projectedTotal,
  routeCost,
  startExecution,
} from './execution';
import { bruteForceOptimal, bruteForceTopK, makeRng, randomMatrix } from './brute';

function planFromFlat(n: number, flat: number[]): CalibrationPlan {
  return { n, matrixFlat: flat };
}

describe('现场执行与逐步重排', () => {
  it('沿原计划逐站确认：累计费用与原计划一致，增量恒为 0，最终回 0', () => {
    const n = 8;
    const flat = randomMatrix(n + 1, makeRng(20260918));
    const state0 = startExecution(planFromFlat(n, flat));
    let state = state0;

    for (const pose of state0.original.sequence) {
      state = confirmNext(state, pose);
      // 每一步的后缀必须是当前剩余集合上的精确最优（与穷举一致）
      const brute = bruteForceOptimal(flat, n + 1, state.remaining, state.current, 0);
      expect(state.suffix.cost).toBe(brute.cost);
      expect(state.suffix.sequence).toEqual(brute.sequence);
      // 已发生费用 = 已走路线逐边求和
      const walked = [0, ...state.visited];
      expect(state.incurred).toBe(routeCost(flat, n + 1, walked));
      expect(projectedTotal(state)).toBe(state0.original.cost);
      expect(deltaVsOriginal(state)).toBe(0);
      expect(state.visited).not.toContain(undefined);
    }

    expect(state.remaining).toEqual([]);
    state = finishReturn(state);
    expect(state.finished).toBe(true);
    expect(state.current).toBe(0);
    expect(state.incurred).toBe(state0.original.cost);
    expect(deltaVsOriginal(state)).toBe(0);
  });

  it('逐步偏离原路线：每次最优后缀、累计费用、增量与最终回库全部核对', () => {
    const n = 6; // 小样本，后缀可穷举
    const flat = randomMatrix(n + 1, makeRng(77));
    const initial = startExecution(planFromFlat(n, flat));

    // 故意总选“原计划不推荐”的下一站
    const deviationOrder = [4, 1, 6, 2, 5, 3];
    expect([...deviationOrder].sort((a, b) => a - b)).toEqual(
      Array.from({ length: n }, (_, k) => k + 1),
    );

    let state = initial;
    const path = [0];
    let expectedIncurred = 0;

    for (const pose of deviationOrder) {
      // 该站确属未完成
      expect(state.remaining).toContain(pose);
      expect(state.visited).not.toContain(pose);

      const prev = path[path.length - 1]!;
      state = confirmNext(state, pose);
      path.push(pose);
      expectedIncurred += flat[prev * (n + 1) + pose]!;

      // 1) 累计费用精确
      expect(state.incurred).toBe(expectedIncurred);
      expect(state.incurred).toBe(routeCost(flat, n + 1, path));

      // 2) 后缀是剩余姿态的精确最优解
      const brute = bruteForceOptimal(flat, n + 1, state.remaining, pose, 0);
      expect(state.suffix.cost).toBe(brute.cost);
      expect(state.suffix.sequence).toEqual(brute.sequence);

      // 3) 预计完工 = 已发生 + 最优后缀（含回 0）
      expect(projectedTotal(state)).toBe(expectedIncurred + brute.cost);

      // 4) 增量 = 预计完工 - 原计划；偏离只会让最短收尾不优于原计划
      expect(deltaVsOriginal(state)).toBe(
        expectedIncurred + brute.cost - initial.original.cost,
      );
      expect(deltaVsOriginal(state)).toBeGreaterThanOrEqual(0);

      // 5) 已完成姿态不得再次确认
      expect(() => confirmNext(state, pose)).toThrow(/不得再次确认/);
    }

    state = finishReturn(state);
    const finalActual = routeCost(flat, n + 1, [...path, 0]);
    expect(state.incurred).toBe(finalActual);
    expect(state.current).toBe(0);
    // 最终增量恰为实际路线与原最优路线之差
    expect(deltaVsOriginal(state)).toBe(finalActual - initial.original.cost);
  });

  it('工程师可从任一未完成姿态中选择（不限于原计划下一站），且全部可枚举核对', () => {
    const n = 5;
    const flat = randomMatrix(n + 1, makeRng(99));
    let state = startExecution(planFromFlat(n, flat));

    // 第一站枚举所有姿态，各自的后缀都必须精确
    for (const first of [1, 2, 3, 4, 5]) {
      const s1 = confirmNext(state, first);
      const brute = bruteForceOptimal(flat, n + 1, s1.remaining, first, 0);
      expect(s1.suffix.cost).toBe(brute.cost);
      expect(projectedTotal(s1)).toBe(flat[0 * (n + 1) + first]! + brute.cost);
    }

    // 状态本身不可变：选另一条路继续
    state = confirmNext(state, 5);
    state = confirmNext(state, 2);
    expect(state.visited).toEqual([5, 2]);
    expect(() => confirmNext(state, 5)).toThrow();
    expect(() => confirmNext(state, 0)).toThrow(); // 0 是停放位，非姿态
    expect(() => finishReturn(state)).toThrow(/未完成/);
  });

  it('重排后后缀字典序仍最小（后缀内部并列）', () => {
    const n = 4;
    const dim = n + 1;
    const flat = new Array<number>(dim * dim).fill(7);
    for (let i = 0; i < dim; i++) flat[i * dim + i] = 0;
    // 让从 4 出发时 1/2/3 完全等价
    let state = startExecution(planFromFlat(n, flat));
    state = confirmNext(state, 4);
    expect(state.suffix.sequence).toEqual([1, 2, 3]);
    expect(state.suffix.cost).toBe(28); // 4→1,1→2,2→3,3→0 四条 7
  });

  it('结案后禁止任何确认或再次回库', () => {
    const n = 8;
    const flat = randomMatrix(n + 1, makeRng(5));
    let state = startExecution(planFromFlat(n, flat));
    for (const p of Array.from({ length: n }, (_, k) => k + 1)) {
      state = confirmNext(state, p);
    }
    state = finishReturn(state);
    expect(() => confirmNext(state, 1)).toThrow(/已结案/);
    expect(() => finishReturn(state)).toThrow(/已结案/);
  });

  it('选次优候选为基线：初始增量为负，现场确认后仍逐拍精确最短后缀', () => {
    const n = 6;
    const flat = randomMatrix(n + 1, makeRng(31337));
    const plan = planFromFlat(n, flat);

    const top = solveTopRoutes(flat, n + 1, range1(n), 0, 0);
    // 该随机矩阵前三名费用必须互异，才能构造“严格次优基线”
    expect(top.candidates).toHaveLength(3);
    if (top.candidates[1]!.cost === top.candidates[0]!.cost) {
      return; // 小概率同费，换不到严格次优时本组跳过
    }
    const suboptimal: RouteCandidate = top.candidates[1]!;
    expect(suboptimal.cost).toBeGreaterThan(top.candidates[0]!.cost);

    const initial = startExecution(plan, suboptimal);
    // 基线就是所选的第二名
    expect(initial.baselineRank).toBe(2);
    expect(initial.original.sequence).toEqual(suboptimal.sequence);
    expect(initial.original.cost).toBe(suboptimal.cost);
    // 初始后缀仍是精确最短（候选首名），预计完工严格小于次优基线 ⇒ 增量为负
    const bruteBest = bruteForceOptimal(flat, n + 1, range1(n), 0, 0);
    expect(initial.suffix.cost).toBe(bruteBest.cost);
    expect(projectedTotal(initial)).toBe(bruteBest.cost);
    expect(deltaVsOriginal(initial)).toBe(bruteBest.cost - suboptimal.cost);
    expect(deltaVsOriginal(initial)).toBeLessThan(0);

    // 现场确认任意未完成姿态后，后缀仍是该状态下的精确最短后缀（与穷举一致）
    const deviationOrder = [4, 1, 6, 2, 5, 3];
    let state = initial;
    const path = [0];
    let incurred = 0;
    for (const pose of deviationOrder) {
      const prev = path[path.length - 1]!;
      state = confirmNext(state, pose);
      path.push(pose);
      incurred += flat[prev * (n + 1) + pose]!;

      const brute = bruteForceOptimal(flat, n + 1, state.remaining, pose, 0);
      expect(state.suffix.cost).toBe(brute.cost);
      expect(state.suffix.sequence).toEqual(brute.sequence);
      expect(state.incurred).toBe(routeCost(flat, n + 1, path));
      // 增量始终相对“所选次优基线”计算
      expect(deltaVsOriginal(state)).toBe(incurred + brute.cost - suboptimal.cost);
    }
    state = finishReturn(state);
    expect(state.finished).toBe(true);
    expect(state.incurred).toBe(routeCost(flat, n + 1, [...path, 0]));
  });

  it('基线候选的费用可由当前矩阵逐边复算，前三名与全排列一致', () => {
    const n = 6;
    const flat = randomMatrix(n + 1, makeRng(2024));
    const plan = planFromFlat(n, flat);
    const top = solveTopRoutes(flat, n + 1, range1(n), 0, 0);
    const brute = bruteForceTopK(flat, n + 1, range1(n), 0, 0, 3);
    expect(top.candidates).toHaveLength(3);
    for (let r = 0; r < 3; r++) {
      expect(top.candidates[r]!.cost).toBe(brute[r]!.cost);
      expect(top.candidates[r]!.sequence).toEqual(brute[r]!.sequence);
      expect(routeCost(flat, n + 1, top.candidates[r]!.tour)).toBe(brute[r]!.cost);
    }

    // 选第三名进入执行台：基线名次 3
    const state = startExecution(plan, top.candidates[2]!);
    expect(state.baselineRank).toBe(3);
    expect(state.original.tour).toEqual(top.candidates[2]!.tour);
  });
});

function range1(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(i);
  return out;
}
