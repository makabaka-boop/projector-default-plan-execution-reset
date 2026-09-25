// @vitest-environment jsdom
/**
 * “恢复默认计划”验收：恢复默认后，计划编辑、候选选择、逐步执行与最终结算
 * 必须同属一次新计划——旧执行过程（已访问节点、累计费用、剩余步骤、结案台账）
 * 不得污染新计划。覆盖恢复时机（运行前/运行中/完成后）与计划形态变化
 * （节点数缩小、同规模改距离与候选顺序）。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App';
import {
  type CalibrationPlan,
  createDefaultPlan,
  matrixToNested,
} from '../solver/plan';

/** 等费计划：非对角恒为 edge（默认候选序列即 1…N 字典序）。 */
function constantPlan(n: number, edge: number): CalibrationPlan {
  const p = createDefaultPlan(n);
  for (let i = 0; i < p.matrixFlat.length; i++) {
    if (p.matrixFlat[i] !== 0) p.matrixFlat[i] = edge;
  }
  return p;
}

/**
 * 方向性计划：唯一便宜回路是反向巡游 0→N→N-1→…→1→0（每边 1），
 * 其余非对角边恒为 100。故候选首名序列严格为 [N,N-1,…,1]，
 * 与默认等费计划的首名 [1,2,…,N] 距离与候选顺序都不同。
 */
function reverseTourPlan(n: number): CalibrationPlan {
  const p = createDefaultPlan(n);
  const dim = n + 1;
  const set = (a: number, b: number, v: number) => {
    p.matrixFlat[a * dim + b] = v;
  };
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      if (i !== j) set(i, j, 100);
    }
  }
  set(0, n, 1);
  for (let k = n; k >= 2; k--) set(k, k - 1, 1);
  set(1, 0, 1);
  return p;
}

/** 走编辑台 JSON 链路导入并应用一份计划（含真实校验与落盘）。 */
function importAndApply(plan: CalibrationPlan) {
  fireEvent.change(screen.getByPlaceholderText(/n/), {
    target: { value: JSON.stringify({ n: plan.n, matrix: matrixToNested(plan) }) },
  });
  fireEvent.click(screen.getByRole('button', { name: '解析并载入草稿' }));
  fireEvent.click(screen.getByRole('button', { name: '校验并应用' }));
}

function resetToDefault() {
  fireEvent.click(screen.getByRole('button', { name: '恢复默认计划（N=12）' }));
}

function enterExecution() {
  fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
}

/** 读取指标卡“标签 → 值”。 */
function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  return (labelEl.nextElementSibling as HTMLElement).textContent ?? '';
}

function poseButton(pose: number, cost: number): HTMLButtonElement {
  // 推荐/非推荐按钮的 title 都以“确认姿态 p 为下一站，本步镜组转动费用 c”开头，
  // 用同时锚定姿态与本步费用的正则匹配。
  return screen.getByTitle(
    new RegExp(`确认姿态 ${pose} 为下一站，本步镜组转动费用 ${cost}`),
  ) as HTMLButtonElement;
}

/** 已完成姿态按钮（title 已变为禁用文案，无法再按费用匹配）。 */
function donePoseButton(pose: number): HTMLButtonElement {
  return screen.getByTitle(`姿态 ${pose} 已完成，不得再次确认`) as HTMLButtonElement;
}

function confirmPose(pose: number, cost: number) {
  fireEvent.click(poseButton(pose, cost));
}

/** 候选第 rank 名路线渲染出的节点序列（含两端停放位）。 */
function candidateNodes(rank: number): string[] {
  const row = screen.getByTestId(`candidate-row-${rank}`);
  return Array.from(row.querySelectorAll('.node')).map((el) => el.textContent ?? '');
}

/** 恢复后界面应回到编辑台：新计划与候选在，旧执行台内容全部消失。 */
function expectEditTabWithFreshCandidates() {
  // 候选集属于新的默认计划（N=12；该提示在每条候选行各出现一次）
  expect(screen.getAllByText(/恰访姿态 1…12/).length).toBeGreaterThan(0);
  expect(screen.getByTestId('candidate-row-1')).toBeTruthy();
  // 选择重置为首名
  expect((screen.getByLabelText('选择候选路线第 1 名') as HTMLInputElement).checked).toBe(true);
  // 旧执行台（任何代际）不残留
  expect(screen.queryByText(/执行台（N=/)).toBeNull();
  expect(screen.queryByText('最终台账')).toBeNull();
  expect(screen.queryByText(/已回到停放位 0，结案/)).toBeNull();
  // 落盘的也是默认计划
  const stored = JSON.parse(localStorage.getItem('dome-calibration-plan-v1')!) as {
    n: number;
    matrix: number[][];
  };
  expect(stored.n).toBe(12);
  expect(stored.matrix[0]![1]).toBe(1);
}

/** 全新执行台断言：从停放位 0 出发，无任何旧进度，可选动作与当前计划一致。 */
function expectFreshExecution(n: number, firstStepCost: number) {
  expect(screen.getByText(new RegExp(`执行台（N=${n}）`))).toBeTruthy();
  expect(screen.getByText('待开始：从停放位 0 出发')).toBeTruthy();
  expect(metricValue('已发生费用')).toBe('0');
  expect(screen.getByText(new RegExp(`剩余 ${n} 个姿态`))).toBeTruthy();

  const buttons = screen.getAllByTitle(/^确认姿态 \d+ 为下一站/) as HTMLButtonElement[];
  expect(buttons).toHaveLength(n);
  // 新计划下没有任何姿态被旧进度标记为已完成
  expect(buttons.every((b) => !b.disabled)).toBe(true);
  // 本步边权全部取自当前计划
  expect(poseButton(1, firstStepCost)).toBeTruthy();
}

function runAllAndGoHome(n: number, edge: number) {
  for (let p = 1; p <= n; p++) confirmPose(p, edge);
  fireEvent.click(screen.getByRole('button', { name: /返回停放位/ }));
}

describe('App：恢复默认计划后执行过程不跨计划污染', () => {
  beforeEach(() => localStorage.clear());

  it('运行前恢复：候选与选择重置为默认首名，执行台从起点全新开始', () => {
    render(<App />);

    // 自定义 N=8 计划并改选第 2 名（运行前状态）
    importAndApply(constantPlan(8, 7));
    fireEvent.click(screen.getByLabelText('选择候选路线第 2 名'));
    expect((screen.getByLabelText('选择候选路线第 2 名') as HTMLInputElement).checked).toBe(
      true,
    );

    resetToDefault();
    expectEditTabWithFreshCandidates();

    // 重新试跑：全新执行台，属于默认 N=12 计划
    enterExecution();
    expectFreshExecution(12, 1);
    // 默认等费计划：字典序最小，姿态 1 为精确后缀推荐
    expect(poseButton(1, 1).classList.contains('recommended')).toBe(true);
  });

  it('运行中恢复 · 新计划节点数更小：旧节点/旧费用/旧剩余全部作废', () => {
    render(<App />);
    importAndApply(constantPlan(14, 7));
    enterExecution();

    expect(screen.getByText(/执行台（N=14）/)).toBeTruthy();
    // 旧计划走两站：0→5→6，每边 7，累计 14
    confirmPose(5, 7);
    confirmPose(6, 7);
    expect(metricValue('已发生费用')).toBe('14');
    expect(donePoseButton(5).disabled).toBe(true);
    expect(screen.getByText(/剩余 12 个姿态/)).toBeTruthy();

    resetToDefault();
    expectEditTabWithFreshCandidates();

    // 以默认 N=12 重新试跑：旧的 14 节点执行不复存在
    enterExecution();
    expectFreshExecution(12, 1);
    // 旧计划独有的姿态 13、14 不得出现在新路线/动作中
    expect(screen.queryByTitle(/^确认姿态 13 为下一站/)).toBeNull();
    expect(screen.queryByTitle(/^确认姿态 14 为下一站/)).toBeNull();
    // 旧累计费用 14 未被带入；旧的已完成姿态 5 重新可点
    expect(metricValue('已发生费用')).toBe('0');
    expect(poseButton(5, 1).disabled).toBe(false);
    expect(poseButton(1, 1).classList.contains('recommended')).toBe(true);

    // 后续距离与结算均按当前计划（等费 1）：12 姿态 + 回库共 13 条边
    runAllAndGoHome(12, 1);
    expect(screen.getByText(/已回到停放位 0，结案/)).toBeTruthy();
    expect(screen.getByText('实际总耗时').nextElementSibling!.textContent).toBe('13');
    expect(screen.getByText(/0（与原计划一致）/)).toBeTruthy();
  });

  it('运行中恢复 · 同规模改距离与候选顺序：旧费用不与新边权混算', () => {
    render(<App />);
    // 方向性 N=12：首名是反向巡游，0→1 是昂贵边（100），推荐首站为 12
    importAndApply(reverseTourPlan(12));
    expect(candidateNodes(1)).toEqual([
      '0 停放',
      '12',
      '11',
      '10',
      '9',
      '8',
      '7',
      '6',
      '5',
      '4',
      '3',
      '2',
      '1',
      '0 停放',
    ]);
    enterExecution();
    expect(poseButton(12, 1).classList.contains('recommended')).toBe(true);

    // 偏离推荐，确认昂贵首站 1：旧计划下本步费用 100，累计 100
    confirmPose(1, 100);
    expect(metricValue('已发生费用')).toBe('100');

    resetToDefault();
    expectEditTabWithFreshCandidates();
    // 候选顺序随当前计划恢复为字典序首名
    expect(candidateNodes(1)).toEqual([
      '0 停放',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '0 停放',
    ]);

    enterExecution();
    // 同规模（仍 N=12）但距离不同：旧累计 100 与旧已访问集合必须清零
    expectFreshExecution(12, 1);
    expect(metricValue('已发生费用')).toBe('0');
    expect(poseButton(1, 1).classList.contains('recommended')).toBe(true);
    // 旧计划下已确认的姿态 1 在新计划中未完成、可确认
    expect(poseButton(1, 1).disabled).toBe(false);

    runAllAndGoHome(12, 1);
    expect(screen.getByText('实际总耗时').nextElementSibling!.textContent).toBe('13');
    expect(screen.getByText(/0（与原计划一致）/)).toBeTruthy();
  });

  it('旧路线完成后恢复：新计划不显示旧结案台账，可从起点正常试跑并重新结算', () => {
    render(<App />);
    importAndApply(constantPlan(8, 7));
    enterExecution();
    runAllAndGoHome(8, 7);

    // 旧计划已结案：9 条边 × 7 = 63
    expect(screen.getByText(/已回到停放位 0，结案/)).toBeTruthy();
    expect(screen.getByText('实际总耗时').nextElementSibling!.textContent).toBe('63');

    resetToDefault();
    expectEditTabWithFreshCandidates();

    // 新计划必须能从停放位 0 正常试跑，而不是直接显示旧结算
    enterExecution();
    expectFreshExecution(12, 1);
    runAllAndGoHome(12, 1);
    expect(screen.getByText(/已回到停放位 0，结案/)).toBeTruthy();
    // 最终结算属于当前默认计划（13 条边 × 1）
    expect(screen.getByText('实际总耗时').nextElementSibling!.textContent).toBe('13');
    // 台账的基线总耗时也是当前默认候选（13），不是旧 N=8 计划的 63
    const baselineCells = screen
      .getAllByText(/所选候选基线总耗时（第 1 名）/)
      .map((el) => el.parentElement!.querySelector('td, .value')?.textContent);
    expect(baselineCells).toContain('13');
    expect(baselineCells).not.toContain('63');
    expect(screen.getByText(/0（与原计划一致）/)).toBeTruthy();
  });
});
