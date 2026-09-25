/**
 * 现场执行状态机（纯函数，不依赖 React，便于验收逐拍核对）。
 *
 * 流程：
 * - startExecution：以工程师在校准路线候选集中选定的路线（默认候选首名，即精确
 *   最优）作为“原计划及增量基线”；初始最短后缀仍是当前剩余姿态集合上的精确最优
 *   （同样遵守“先于”约束），因此基线本身是次优候选时，初始增量允许为负。
 * - confirmNext：工程师把任一“未完成”姿态确认为实际下一站；该姿态的全部前置姿态
 *   必须已经确认，否则拒绝并原样返回已确认进度（抛错，调用方保留旧状态）；
 *   累加实际已发生费用，并以该姿态为新起点，对全部剩余姿态精确重排（Held–Karp），
 *   重排仍只在剩余姿态上继续遵守依赖——已完成姿态一律视为前置满足。
 * - finishReturn：剩余为空后，回到停放位 0，结算最终费用。
 */

import { type CalibrationPlan, prerequisiteMasks } from './plan';
import {
  solveOptimal,
  type OptimalRoute,
  type RouteCandidate,
} from './tsp';

export interface ExecutionState {
  plan: CalibrationPlan;
  /** 基线计划：工程师所选的校准路线候选（默认候选首名 = 精确最优） */
  original: OptimalRoute;
  /** 基线候选的全局名次（1 起）；默认 1 */
  baselineRank: number;
  /** 已确认姿态（按确认顺序） */
  visited: number[];
  /** 当前所在点：初始为 0，确认后为最新姿态，回库后为 0 */
  current: number;
  /** 已实际发生的费用（已走边之和） */
  incurred: number;
  /** 尚未访问的姿态（升序） */
  remaining: number[];
  /** 从 current 出发、遍历 remaining 回到 0 的精确最短后缀（遵守“先于”约束） */
  suffix: OptimalRoute;
  /**
   * “先于”约束的前置位掩码（下标 = 姿态编号，第 a 位为 1 表示 a 是本姿态的前置）。
   * 全程不变；重排时只对 remaining 求解，已完成姿态不在剩余集合中，自动视为满足。
   */
  preByPose: Uint32Array;
  /** 是否已回到停放位 0 结案 */
  finished: boolean;
}

/**
 * 开始执行。baseline 为工程师选定的候选路线；省略时取候选首名（精确最优），
 * 兼容既有“原计划即最优”的现场后缀重排流程。
 */
export function startExecution(
  plan: CalibrationPlan,
  baseline?: RouteCandidate,
): ExecutionState {
  const all = range1(plan.n);
  const preByPose = prerequisiteMasks(plan.prerequisites);
  const selected: OptimalRoute = baseline
    ? {
        sequence: baseline.sequence,
        tour: baseline.tour,
        cost: baseline.cost,
        targetCount: baseline.targetCount,
        solveMs: 0,
      }
    : solveOptimal(plan.matrixFlat, plan.n + 1, all, 0, 0, preByPose);

  // 初始后缀始终是“从 0 出发遍历全部姿态”的精确最短后缀（而非基线照抄）：
  // 基线选次优候选时，最短后缀严格更短，初始增量即为负。
  const suffix =
    baseline && baseline.rank === 1
      ? { ...selected, solveMs: 0 }
      : solveOptimal(plan.matrixFlat, plan.n + 1, all, 0, 0, preByPose);

  return {
    plan,
    original: selected,
    baselineRank: baseline ? baseline.rank : 1,
    visited: [],
    current: 0,
    incurred: 0,
    remaining: all,
    suffix,
    preByPose,
    finished: false,
  };
}

export function confirmNext(state: ExecutionState, pose: number): ExecutionState {
  if (state.finished) {
    throw new Error('执行已结案（已回到停放位 0），不能再确认姿态');
  }
  const { n, matrixFlat } = state.plan;
  if (!Number.isInteger(pose) || pose < 1 || pose > n) {
    throw new Error(`姿态编号必须是 1—${n} 的整数，收到：${String(pose)}`);
  }
  if (state.visited.includes(pose)) {
    throw new Error(`姿态 ${pose} 已完成，已完成姿态不得再次确认`);
  }
  if (!state.remaining.includes(pose)) {
    throw new Error(`姿态 ${pose} 不在剩余列表中`);
  }

  // 前置条件检查：pose 的前置姿态若仍在剩余集合中（即尚未确认）则拒绝；
  // 状态不变更，调用方保留全部已确认进度。
  const prereqBits = state.preByPose[pose] ?? 0;
  if (prereqBits !== 0) {
    const blocked: number[] = [];
    for (const p of state.remaining) {
      if (p !== pose && (prereqBits & (1 << p)) !== 0) blocked.push(p);
    }
    if (blocked.length > 0) {
      throw new Error(
        `姿态 ${pose} 的前置姿态尚未完成：必须先确认 ${blocked.join('、')}，本次确认已拒绝（已确认进度保留）`,
      );
    }
  }

  const dim = n + 1;
  const incurred = state.incurred + matrixFlat[state.current * dim + pose]!;
  const visited = [...state.visited, pose];
  const remaining = state.remaining.filter((p) => p !== pose);
  // 中途重算只在剩余姿态上继续遵守依赖：已完成姿态不在 remaining 中，
  // 求解器的“先于”门自动把它们视为满足。
  const suffix = solveOptimal(matrixFlat, dim, remaining, pose, 0, state.preByPose);

  return {
    ...state,
    visited,
    current: pose,
    incurred,
    remaining,
    suffix,
    finished: false,
  };
}

export function finishReturn(state: ExecutionState): ExecutionState {
  if (state.finished) {
    throw new Error('执行已结案');
  }
  if (state.remaining.length > 0) {
    throw new Error(`还有 ${state.remaining.length} 个姿态未完成，不能回库`);
  }
  const dim = state.plan.n + 1;
  const backCost = state.plan.matrixFlat[state.current * dim + 0]!;
  return {
    ...state,
    incurred: state.incurred + backCost,
    current: 0,
    suffix: { sequence: [], tour: [0, 0], cost: 0, targetCount: 0, solveMs: 0 },
    finished: true,
  };
}

/** 预计完工总耗时 = 已发生 + 当前精确最短后缀（含回 0） */
export function projectedTotal(state: ExecutionState): number {
  return state.incurred + state.suffix.cost;
}

/**
 * 相对所选候选基线的增量。
 * 基线为次优候选时，尚未偏离的初始状态即可能为负（精确最短后缀优于所选路线）。
 */
export function deltaVsOriginal(state: ExecutionState): number {
  return projectedTotal(state) - state.original.cost;
}

export function routeCost(flat: ArrayLike<number>, dim: number, tour: number[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < tour.length; i++) {
    sum += flat[tour[i]! * dim + tour[i + 1]!]!;
  }
  return sum;
}

function range1(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(i);
  return out;
}
