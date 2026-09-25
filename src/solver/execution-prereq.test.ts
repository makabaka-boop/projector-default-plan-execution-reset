import { describe, expect, it } from 'vitest';
import { type CalibrationPlan, prerequisiteMasks, validatePlan } from './plan';
import { solveTopRoutes } from './tsp';
import {
  confirmNext,
  deltaVsOriginal,
  finishReturn,
  projectedTotal,
  routeCost,
  startExecution,
} from './execution';
import { bruteForceOptimal, makeRng, randomMatrix } from './brute';

/**
 * 构造测试计划。n ≥ 8 时走真实 validatePlan 校验链路（顺带验证无环）；
 * n < 8 是执行层小样本（计划层按业务规则只接受 8—18），直接构造，
 * 所用边集在各用例中手工保证是 DAG。
 */
function planWith(
  n: number,
  edges: Array<[number, number]> = [],
  seed = 2026,
): CalibrationPlan {
  const flat = randomMatrix(n + 1, makeRng(seed + n * 7 + edges.length * 13));
  if (n < 8) {
    return { n, matrixFlat: flat, prerequisites: edges };
  }
  const checked = validatePlan({
    n,
    matrix: Array.from({ length: n + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => flat[i * (n + 1) + j]),
    ),
    prerequisites: edges,
  });
  if (!checked.ok || !checked.plan) throw new Error(checked.errors.join(';'));
  return checked.plan;
}

function range1(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(i);
  return out;
}

describe('执行台“先于”约束：确认门与中途重排', () => {
  it('前置未确认时拒绝后置姿态：抛错且已确认进度、费用、位置原样保留', () => {
    const plan = planWith(
      6,
      [
        [1, 3],
        [2, 3],
      ],
      11,
    );
    const state0 = startExecution(plan);

    // 3 的前置 1、2 都未确认
    const before = state0;
    expect(() => confirmNext(state0, 3)).toThrow(/前置姿态尚未完成/);
    expect(() => confirmNext(state0, 3)).toThrow(/1、2|2、1/);

    // 纯函数：拒绝调用不产生新状态；现有进度为空且保持为空
    expect(before.visited).toEqual([]);
    expect(before.current).toBe(0);
    expect(before.incurred).toBe(0);

    // 确认 1 后，3 仍被 2 阻塞
    let state = confirmNext(state0, 1);
    const snapshot = {
      visited: state.visited.slice(),
      current: state.current,
      incurred: state.incurred,
    };
    expect(() => confirmNext(state, 3)).toThrow(/2/);
    // 拒绝后保留已确认进度（React 层 setState 不发生，这里核对原状态未被改写）
    expect(state.visited).toEqual(snapshot.visited);
    expect(state.current).toBe(snapshot.current);
    expect(state.incurred).toBe(snapshot.incurred);

    // 2 确认后，3 放行
    state = confirmNext(state, 2);
    expect(() => confirmNext(state, 3)).not.toThrow();
  });

  it('沿合法顺序确认：每拍后缀都在剩余姿态上遵守依赖且与受约束穷举一致', () => {
    const n = 6;
    const edges: Array<[number, number]> = [
      [1, 3],
      [2, 3],
      [3, 5],
      [4, 6],
    ];
    const plan = planWith(n, edges, 23);
    const pre = prerequisiteMasks(edges);
    let state = startExecution(plan);

    // 初始后缀必须满足全部依赖，且是受约束全排列最优
    let brute = bruteForceOptimal(plan.matrixFlat, n + 1, range1(n), 0, 0, pre);
    expect(state.suffix.sequence).toEqual(brute.sequence);
    expect(state.suffix.cost).toBe(brute.cost);

    const order = [4, 1, 2, 3, 6, 5]; // 全程合法（6 在 4 后；5 在 3 后；3 在 1、2 后）
    const path = [0];
    let incurred = 0;
    for (const pose of order) {
      state = confirmNext(state, pose);
      path.push(pose);
      incurred = routeCost(plan.matrixFlat, n + 1, path);
      expect(state.incurred).toBe(incurred);
      brute = bruteForceOptimal(plan.matrixFlat, n + 1, state.remaining, pose, 0, pre);
      expect(state.suffix.cost).toBe(brute.cost);
      expect(state.suffix.sequence).toEqual(brute.sequence);
      // 后缀推荐的第一站必须当前即可确认（其前置已全部完成）
      const first = state.suffix.sequence[0];
      if (first !== undefined) {
        const bits = pre[first]!;
        const stillBlocking = state.remaining.some(
          (p) => p !== first && (bits & (1 << p)) !== 0,
        );
        expect(stillBlocking).toBe(false);
      }
    }
    expect(projectedTotal(state)).toBe(incurred + state.suffix.cost);
    state = finishReturn(state);
    expect(state.finished).toBe(true);
    expect(state.incurred).toBe(routeCost(plan.matrixFlat, n + 1, [...path, 0]));
    // 这是一条任意合法顺序（未必是最优）：增量 = 实际 − 约束最优，且必 ≥ 0
    expect(deltaVsOriginal(state)).toBe(state.incurred - state.original.cost);
    expect(deltaVsOriginal(state)).toBeGreaterThanOrEqual(0);
  });

  it('中途重排只在剩余姿态上继续遵守依赖：已完成姿态一律视为满足', () => {
    const n = 5;
    const edges: Array<[number, number]> = [
      [1, 4],
      [2, 5],
    ];
    const plan = planWith(n, edges, 71);
    const pre = prerequisiteMasks(edges);
    let state = startExecution(plan);

    // 先确认 1、2：此后 4 与 5 的前置均已完成，重排不再受其约束
    state = confirmNext(state, 1);
    state = confirmNext(state, 2);
    expect(state.remaining.slice().sort((a, b) => a - b)).toEqual([3, 4, 5]);

    const brute = bruteForceOptimal(plan.matrixFlat, n + 1, [3, 4, 5], 2, 0, pre);
    expect(state.suffix.sequence).toEqual(brute.sequence);
    // 4、5 此时不再被阻塞（3/4/5 全部可直接确认）
    for (const p of [3, 4, 5]) {
      expect(() => confirmNext(state, p)).not.toThrow();
    }
  });

  it('推荐后缀从不把被阻塞姿态放在首位：阻塞解除前后推荐站切换正确', () => {
    const n = 5;
    // 等费矩阵：无约束时字典序推荐恒为最小可走姿态
    const flat = new Array<number>((n + 1) * (n + 1)).fill(7);
    for (let i = 0; i <= n; i++) flat[i * (n + 1) + i] = 0;
    const plan: CalibrationPlan = { n, matrixFlat: flat, prerequisites: [[3, 1]] };

    let state = startExecution(plan);
    // 等费下字典序最小的可行首站不是 1（1 被 3 阻塞），而是 2
    expect(state.suffix.sequence[0]).not.toBe(1);
    expect(state.suffix.sequence[0]).toBe(2);

    // 确认 3 后，1 解除阻塞；剩余 {1,2,4,5} 等费，推荐回到 1
    state = confirmNext(state, 3);
    expect(state.suffix.sequence[0]).toBe(1);
    expect(() => confirmNext(state, 1)).not.toThrow();
  });

  it('基线候选（候选前三名）本身全部满足依赖，可直接作为执行基线走完', () => {
    const n = 6;
    const edges: Array<[number, number]> = [
      [2, 1],
      [4, 3],
    ];
    const plan = planWith(n, edges, 101);
    const set = solveTopRoutes(
      plan.matrixFlat,
      n + 1,
      range1(n),
      0,
      0,
      prerequisiteMasks(edges),
    );
    expect(set.candidates.length).toBeGreaterThan(0);
    for (const c of set.candidates) {
      for (const [a, b] of edges) {
        expect(c.sequence.indexOf(a)).toBeLessThan(c.sequence.indexOf(b));
      }
    }

    // 以第 2 名（若存在）为基线逐站走完，每拍确认都不会被前置门拒绝
    const baseline = set.candidates[Math.min(1, set.candidates.length - 1)]!;
    let state = startExecution(plan, baseline);
    for (const pose of baseline.sequence) {
      expect(() => confirmNext(state, pose)).not.toThrow();
      state = confirmNext(state, pose);
    }
    state = finishReturn(state);
    expect(state.finished).toBe(true);
    expect(state.incurred).toBe(baseline.cost);
  });

  it('无依赖计划：执行行为与旧版完全一致（逐拍穷举核对）', () => {
    const n = 6;
    const plan = planWith(n, [], 31337);
    let state = startExecution(plan);
    const order = [4, 1, 6, 2, 5, 3];
    for (const pose of order) {
      state = confirmNext(state, pose);
      const brute = bruteForceOptimal(plan.matrixFlat, n + 1, state.remaining, pose, 0);
      expect(state.suffix.sequence).toEqual(brute.sequence);
      expect(state.suffix.cost).toBe(brute.cost);
    }
    state = finishReturn(state);
    expect(state.finished).toBe(true);
  });
});
