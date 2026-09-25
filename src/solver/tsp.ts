/**
 * 非对称旅行商精确求解：Held–Karp 动态规划（k 名不同最优扩展）。
 *
 * 不使用贪心，也不枚举全排列（m 个目标的排列数 m! 不可接受），
 * 更不靠“禁用首选路线中的边”反复调用单最优求解器——候选集求解时每个 DP 状态一次算好
 * 固定 TOP_K 个互异后缀及其子排名，恢复时沿 (后继位, 子排名) 指针确定性回溯。
 *
 * 状态定义（g 表，按“从某点出发并回家”的视角，便于执行中以新起点重排）：
 *   g[mask][i][r] = 从 target[i] 出发，恰好访问 mask 中全部目标（target[i] 不在
 *                   mask 内）、最后回到 home 的全部互异后缀中，按
 *                   （总耗时升序，同费按完整姿态序列字典序升序）排列的第 r 名耗时。
 *   g[0][i][0]   = C(target[i] -> home)
 *   g[mask][i]   = 对所有 j ∈ mask 合并候选流：
 *                    C(target[i] -> target[j]) + g[mask \\ {j}][j][*]
 *
 * 每个后继 j 给出一条按 （耗时, 后缀字典序） 排好序的候选流（子状态只保留 TOP_K
 * 名即够，k 最优引理：父状态的第 k 名必来自某条流的前 k 名）；不同 j 的首姿态不同，
 * 同一 j 的不同子排名对应互异后缀，故 (j, 子排名) 一一对应互异完整序列，无需去重。
 *
 * 同费字典序 tie-break：targets 按编号升序；在耗时相同的候选之间，首姿态编号小者
 * 整序列字典序更小，故合并键直接取 （耗时, j, 子排名）——j 升序即首姿态编号升序，
 * 子排名升序即该首姿态之后后缀的字典序升序。
 *
 * 答案（从 origin 出发）：对首个姿态 i 合并
 *   C(origin -> target[i]) + g[full \\ {i}][i][*]
 * 取前 TOP_K 名；互异路线总数 m! 不足 TOP_K 时只返回实际数量（无占位、无重复）。
 *
 * 紧凑存储：候选集（k=3）耗时用 Int32Array（每状态 3 槽），(后继位, 子排名) 打包成
 * j*k+r 存 Int8Array（j ≤ 19、r < 3，单字节足够）；现场单最优重排走 k=1 紧凑快路径
 * （每状态单槽，等价原 Held–Karp），保证每拍重排与历史性能一致。
 *
 * 可选“先于”约束（preByPose，按姿态编号取位的掩码：preByPose[b] 的第 a 位为 1 表示
 * a 必须先于 b）：状态只在后继 j 的全部前置都已访问时扩展。在“从 i 出发、还要走 mask”
 * 的视角下，已访问集合 = 全部目标 \\ (mask ∪ {i})，故 j 可扩展当且仅当
 * (preMask[j] & mask) === 0——j 的前置只要还落在待走集合 mask 中即必须让位；
 * 前置若不属于当前目标集合（执行中途已完成），其位不在 mask 内，自动视为满足。
 * 无 preByPose 或掩码全 0 时退化为原始 TSP，费用、序列、tie-break 逐项不变。
 *
 * 复杂度 O(k·m²·2^m) 时间、O(k·m·2^m) 空间；k=3、m=18 实测亚秒至一秒级。
 */

export const TOP_K = 3;

export interface OptimalRoute {
  /** 目标姿态访问顺序（不含起点 origin，不含结尾的 home） */
  sequence: number[];
  /** 完整路线 */
  tour: number[];
  /** 总耗时（含最后回到 home 的边） */
  cost: number;
  /** 目标姿态数量 */
  targetCount: number;
  /** 求解耗时（毫秒） */
  solveMs: number;
}

/** 校准路线候选：一条恰访目标各一次的互异精确路线及其全局排名（1 起）。 */
export interface RouteCandidate {
  /** 全局名次（1 起）：按总耗时升序、同费按完整姿态序列字典序升序 */
  rank: number;
  /** 目标姿态访问顺序（不含起点 origin，不含结尾的 home） */
  sequence: number[];
  /** 从 origin 出发并回到 home 的完整路径（原计划即从 0 出发回到 0） */
  tour: number[];
  /** 总耗时（含最后回到 home 的边），可由当前矩阵逐边复算 */
  cost: number;
  /** 目标姿态数量 */
  targetCount: number;
}

/** 候选集：按排名升序的互异精确路线，数量 = min(TOP_K, m!)。 */
export interface CandidateSet {
  candidates: RouteCandidate[];
  /** 目标姿态数量 */
  targetCount: number;
  /** 求解耗时（毫秒） */
  solveMs: number;
  /**
   * 约束下是否存在可行路线。“先于”图由计划层保证无环；此处对不可行
   * （理论上不会发生的防御分支）给出空候选并标记 false，调用方不得把它当计划。
   */
  feasible: boolean;
}

/**
 * “先于”约束：按姿态编号取位的掩码数组（下标即姿态编号）。
 * 省略或掩码全 0 表示无约束；见文件头的可扩展条件说明。
 */
export type PrerequisiteMasks = ArrayLike<number> | undefined;

/**
 * 无穷远哨兵。注意：g 表是 Int32Array，fill 的值必须落在有符号 32 位范围内——
 * 1_000_000_000 会被截断成 0（曾静默污染整张表），故取 10_000_000：
 * 合法路线至多 20 边 × 9999 < 200_000，哨兵加上一条边后仍远超任何真实解。
 */
export const INF = 10_000_000;

function countTrailingZeros(x: number): number {
  // x 必为正整数（32 位内）。x & -x 隔离最低置位，再数其前导零。
  // 切勿写成 31 - clz32(x)：那是最高位索引，与 x & (x-1) 的最低位清位错配。
  return 31 - Math.clz32(x & -x);
}

function elapsedMs(started: number): number {
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  return now - started;
}

/**
 * 把按姿态编号取位的全局前置掩码映射到 sorted 目标数组的本地位：
 * local[j] 的第 p 位为 1 ⇔ sorted[p] 必须先于 sorted[j]。
 * 不属于当前目标集合的前置（执行中途已完成的姿态）被丢弃，自动视为满足。
 * 无约束时返回 undefined，求解循环走零成本原始路径。
 */
function toLocalPreMasks(
  preByPose: PrerequisiteMasks,
  sorted: number[],
): Uint32Array | undefined {
  if (!preByPose) return undefined;
  const m = sorted.length;
  const local = new Uint32Array(m);
  let any = 0;
  for (let j = 0; j < m; j++) {
    let bits = 0;
    const global = preByPose[sorted[j]!] ?? 0;
    for (let p = 0; p < m; p++) {
      if ((global & (1 << sorted[p]!)) !== 0) bits |= 1 << p;
    }
    local[j] = bits;
    any |= bits;
  }
  return any === 0 ? undefined : local;
}

/**
 * 精确最优路线：单槽 Held–Karp 紧凑快路径（现场每拍后缀重排使用）。
 * 结果恒等于 solveTopRoutes 的候选首名。
 *
 * @param flat    行优先展开的方阵（dim × dim）
 * @param dim     方阵边长（= n + 1）
 * @param targets 需要访问的目标编号（会被复制并按升序排列）
 * @param origin  当前起点（原计划为 0；执行改序时为刚确认的姿态）
 * @param home    最终停放位（始终为 0）
 * @param preByPose 可选“先于”约束（按姿态编号取位的掩码数组）；仅在前置已访问时扩展
 */
export function solveOptimal(
  flat: ArrayLike<number>,
  dim: number,
  targets: ArrayLike<number>,
  origin: number,
  home: number,
  preByPose?: PrerequisiteMasks,
): OptimalRoute {
  const started =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const m = targets.length;
  const sorted = Array.from(targets).sort((a, b) => a - b);
  const edge = (a: number, b: number): number => flat[a * dim + b]!;
  const localPre = toLocalPreMasks(preByPose, sorted);

  // 无目标：只剩 origin -> home 一条边（执行到最后一个姿态后，预计返回即此值）。
  if (m === 0) {
    return {
      sequence: [],
      tour: [origin, home],
      cost: edge(origin, home),
      targetCount: 0,
      solveMs: elapsedMs(started),
    };
  }
  if (m > 20) {
    throw new Error(`目标数量 ${m} 超出支持上限（20）`);
  }

  const size = 1 << m;
  const full = size - 1;

  // g[mask * m + i]，仅在 i ∉ mask 时有意义；密集存储换取简单索引。
  const g = new Int32Array(size * m).fill(INF);
  // choice[mask * m + i]：最优后继位 j（恢复路线用，只在 mask ≠ 0 时有意义）。
  const choice = new Int8Array(size * m);

  // 边界：mask = 0，从每个目标直接回家。
  for (let i = 0; i < m; i++) {
    g[i] = edge(sorted[i]!, home);
  }

  // 递推：去掉一个集合位后数值必然变小，故按 mask 数值升序即可保证依赖先算。
  for (let mask = 1; mask < size; mask++) {
    const rowBase = mask * m;
    let complement = full ^ mask;
    while (complement !== 0) {
      const i = countTrailingZeros(complement);
      complement &= complement - 1;

      const fromRow = sorted[i]! * dim;
      let members = mask;
      let best = INF;
      let bestJ = -1;
      // members 从低到高取位 ⇒ j 升序；严格小于保住同费时编号最小的 j（字典序 tie-break）。
      while (members !== 0) {
        const j = countTrailingZeros(members);
        members &= members - 1;
        // “先于”门：j 的任一前置仍在待走集合 mask 中则不得在此扩展。
        if (localPre && (localPre[j]! & mask) !== 0) continue;

        const candidate =
          flat[fromRow + sorted[j]!]! + g[(mask ^ (1 << j)) * m + j]!;
        if (candidate < best) {
          best = candidate;
          bestJ = j;
        }
      }
      g[rowBase + i] = best;
      choice[rowBase + i] = bestJ;
    }
  }

  // 沿后继指针恢复字典序最小的最优路线，同时逐边复算总耗时。
  const sequence: number[] = [];
  const tour: number[] = [origin];
  let cur = origin;
  let remaining = full;
  let total = 0;

  while (remaining !== 0) {
    let chosen = -1;
    let chosenValue = INF;
    let bits = remaining; // sorted 升序 ⇒ 低位到高位即姿态编号升序
    while (bits !== 0) {
      const b = countTrailingZeros(bits);
      bits &= bits - 1;
      // “先于”门：只剩当前已确认姿态之前的检查在这里等价——待走集合中不得还有 b 的前置。
      if (localPre && (localPre[b]! & remaining) !== 0) continue;

      const value = edge(cur, sorted[b]!) + g[(remaining ^ (1 << b)) * m + b]!;
      if (value < chosenValue) {
        chosenValue = value;
        chosen = b;
      }
    }
    if (chosen < 0) {
      // 计划层已保证无环，任何诱导子问题都可行；走到这里说明约束集本身不可行。
      throw new Error('前置约束下不存在可行路线（依赖可能成环）');
    }
    const nextPose = sorted[chosen]!;
    sequence.push(nextPose);
    tour.push(nextPose);
    total += edge(cur, nextPose);
    cur = nextPose;
    remaining &= ~(1 << chosen); // 从剩余集合移除该位（位掩码写法，避免优先级陷阱）
  }

  total += edge(cur, home);
  tour.push(home);

  return { sequence, tour, cost: total, targetCount: m, solveMs: elapsedMs(started) };
}

/**
 * 校准路线候选集：按总耗时升序、同费按完整姿态序列字典序升序排列的前 k 条
 * 互异精确路线；互异路线总数不足 k 时只返回实际数量。每个 DP 状态一次保留固定
 * k 个不同后缀及子排名（k=TOP_K），不靠反复调用单最优求解器。
 *
 * preByPose 为可选“先于”约束（按姿态编号取位的掩码数组）：规划器只在候选后继
 * 的全部前置姿态都已访问时扩展该状态；同费字典序裁决仍在“可行路线集合内部”
 * 保持原规则。约束下无可行路线时返回空候选且 feasible=false。
 */
export function solveTopRoutes(
  flat: ArrayLike<number>,
  dim: number,
  targets: ArrayLike<number>,
  origin: number,
  home: number,
  preByPose?: PrerequisiteMasks,
): CandidateSet {
  const started =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const k = TOP_K;
  const m = targets.length;
  const sorted = Array.from(targets).sort((a, b) => a - b);
  const edge = (a: number, b: number): number => flat[a * dim + b]!;
  const localPre = toLocalPreMasks(preByPose, sorted);

  // 无目标：只剩 origin -> home 一条路线。
  if (m === 0) {
    return {
      candidates: [
        { rank: 1, sequence: [], tour: [origin, home], cost: edge(origin, home), targetCount: 0 },
      ],
      targetCount: 0,
      solveMs: elapsedMs(started),
      feasible: true,
    };
  }
  if (m > 20) {
    throw new Error(`目标数量 ${m} 超出支持上限（20）`);
  }

  const size = 1 << m;
  const full = size - 1;

  // g[(mask * m + i) * k + r]：状态 (mask,i) 的第 r 名耗时；无效槽保持 INF。
  // 仅在 i ∉ mask 时有意义；密集存储换取简单索引。
  const g = new Int32Array(size * m * k).fill(INF);
  // choice[(mask * m + i) * k + r]：该名次的后继选择，打包为 j*k + childRank。
  const choice = new Int8Array(size * m * k);

  // 边界：mask = 0，从每个目标直接回家，只有一个后缀。
  for (let i = 0; i < m; i++) {
    g[i * k] = edge(sorted[i]!, home);
  }

  // 单个状态合并候选流用的 k 槽累加器（循环外分配，逐状态重置，避免百万次小数组分配）。
  const topCost = new Int32Array(k).fill(INF);
  const topJ = new Int8Array(k);
  const topR = new Int8Array(k);

  // 递推：去掉一个集合位后数值必然变小，故按 mask 数值升序即可保证依赖先算。
  for (let mask = 1; mask < size; mask++) {
    let complement = full ^ mask;
    while (complement !== 0) {
      const i = countTrailingZeros(complement);
      complement &= complement - 1;

      for (let t = 0; t < k; t++) {
        topCost[t] = INF;
        topJ[t] = -1;
        topR[t] = 0;
      }

      const fromRow = sorted[i]! * dim;
      let members = mask;
      // members 从低到高取位 ⇒ j（首姿态编号）升序，正是同费字典序所需。
      while (members !== 0) {
        const j = countTrailingZeros(members);
        members &= members - 1;
        // “先于”门：j 的任一前置仍在待走集合 mask 中时，该后继流整体不参与合并。
        if (localPre && (localPre[j]! & mask) !== 0) continue;

        const stepCost = flat[fromRow + sorted[j]!]!;
        const childBase = (mask ^ (1 << j)) * m + j;
        for (let r = 0; r < k; r++) {
          const childCost = g[childBase * k + r]!;
          if (childCost === INF) break; // 子状态的有效名次是紧凑前缀，后面皆空
          const cand = stepCost + childCost;

          // 按 （耗时, j, 子排名） 插入 k 槽有序累加器的合适位置。
          for (let t = 0; t < k; t++) {
            const cur2 = topCost[t]!;
            const better =
              cand < cur2 || (cand === cur2 && (j < topJ[t]! || (j === topJ[t]! && r < topR[t]!)));
            if (!better) continue;
            for (let u = k - 1; u > t; u--) {
              topCost[u] = topCost[u - 1]!;
              topJ[u] = topJ[u - 1]!;
              topR[u] = topR[u - 1]!;
            }
            topCost[t] = cand;
            topJ[t] = j;
            topR[t] = r;
            break;
          }
        }
      }

      const cellBase = (mask * m + i) * k;
      for (let t = 0; t < k; t++) {
        const c = topCost[t]!;
        g[cellBase + t] = c;
        if (c < INF) choice[cellBase + t] = topJ[t]! * k + topR[t]!;
      }
    }
  }

  // 答案合并：首个姿态 i 升序、子排名 r 升序，同样取前 k 个 （耗时, i, r)。
  const ansCost = new Int32Array(k).fill(INF);
  const ansI = new Int8Array(k);
  const ansR = new Int8Array(k);
  for (let i = 0; i < m; i++) {
    // “先于”门：第一个姿态不得还有未访问（即仍在 full 中）的前置。
    if (localPre && localPre[i]! !== 0) continue;
    const stepCost = edge(origin, sorted[i]!);
    const childBase = (full ^ (1 << i)) * m + i;
    for (let r = 0; r < k; r++) {
      const childCost = g[childBase * k + r]!;
      if (childCost === INF) break;
      const cand = stepCost + childCost;
      for (let t = 0; t < k; t++) {
        const cur2 = ansCost[t]!;
        const better =
          cand < cur2 || (cand === cur2 && (i < ansI[t]! || (i === ansI[t]! && r < ansR[t]!)));
        if (!better) continue;
        for (let u = k - 1; u > t; u--) {
          ansCost[u] = ansCost[u - 1]!;
          ansI[u] = ansI[u - 1]!;
          ansR[u] = ansR[u - 1]!;
        }
        ansCost[t] = cand;
        ansI[t] = i;
        ansR[t] = r;
        break;
      }
    }
  }

  let count = 0;
  while (count < k && ansCost[count]! < INF) count++;

  const candidates: RouteCandidate[] = [];
  for (let rank = 0; rank < count; rank++) {
    // 沿 (后继位, 子排名) 指针确定性恢复完整姿态序列，同时逐边复算总耗时。
    const sequence: number[] = [];
    const tour: number[] = [origin];
    let cur = origin;
    let remaining = full;
    let nextIdx = ansI[rank]!;
    let cellRank = ansR[rank]!;
    let total = 0;

    for (;;) {
      const pose = sorted[nextIdx]!;
      total += edge(cur, pose);
      sequence.push(pose);
      tour.push(pose);
      remaining &= ~(1 << nextIdx);
      cur = pose;
      if (remaining === 0) break;
      const packed = choice[(remaining * m + nextIdx) * k + cellRank]!;
      cellRank = packed % k;
      nextIdx = (packed - cellRank) / k;
    }
    total += edge(cur, home);
    tour.push(home);

    candidates.push({ rank: rank + 1, sequence, tour, cost: total, targetCount: m });
  }

  return {
    candidates,
    targetCount: m,
    solveMs: elapsedMs(started),
    feasible: candidates.length > 0,
  };
}
