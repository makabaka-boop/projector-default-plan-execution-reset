// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App';
import { type CalibrationPlan, createDefaultPlan, matrixToNested } from '../solver/plan';

/** 等费非对称矩阵（非对角统一 edge）：总耗时 = (N+1) 条边 × edge。 */
function uniformPlan(n: number, edge: number): CalibrationPlan {
  const p = createDefaultPlan(n);
  for (let i = 0; i < p.matrixFlat.length; i++) {
    if (p.matrixFlat[i] !== 0) p.matrixFlat[i] = edge;
  }
  return p;
}

/** 通过编辑台 JSON 文本框走真实“解析→校验→应用→落盘”链路。 */
function importAndApply(plan: CalibrationPlan) {
  fireEvent.change(screen.getByPlaceholderText(/n/), {
    target: { value: JSON.stringify({ n: plan.n, matrix: matrixToNested(plan) }) },
  });
  fireEvent.click(screen.getByRole('button', { name: /解析并载入草稿/ }));
  fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
}

function startExecuting() {
  fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
}

function resetToDefault() {
  fireEvent.click(screen.getByRole('button', { name: /恢复默认计划/ }));
}

/** 确认一个未完成姿态（标题含本步费用）。 */
function confirmPose(pose: number, edge: number) {
  fireEvent.click(
    screen.getByTitle(`确认姿态 ${pose} 为下一站，本步镜组转动费用 ${edge}`),
  );
}

function goHome() {
  fireEvent.click(screen.getByRole('button', { name: /返回停放位/ }));
}

/** 指标卡：按标签精确取值。 */
function metric(label: string): string {
  const grid = document.querySelector('.metric-grid')!;
  for (const m of grid.querySelectorAll('.metric')) {
    if (m.querySelector('.label')?.textContent === label) {
      return m.querySelector('.value')!.textContent!;
    }
  }
  throw new Error(`未找到指标卡：${label}`);
}

function ledgerCell(label: string): string {
  const th = screen.getByText(label, { selector: 'th' });
  return th.closest('tr')!.querySelector('td')!.textContent!;
}

function poseButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('.pose-btn'));
}

/** 按当前等费计划沿任意顺序走完全部姿态并回库。 */
function runWholeRoute(n: number, edge: number, order?: number[]) {
  const poses = order ?? Array.from({ length: n }, (_, k) => k + 1);
  for (const p of poses) confirmPose(p, edge);
  goHome();
}

describe('恢复默认计划：计划编辑、候选选择、逐步执行与最终结算属于同一次计划', () => {
  beforeEach(() => localStorage.clear());

  it('运行前恢复：N=14 自定义计划未开跑即恢复默认，执行面板从起点 0 按 N=12 重新待开始', () => {
    render(<App />);
    importAndApply(uniformPlan(14, 9));
    startExecuting();

    // 旧（尚未开跑的）计划
    expect(screen.getByText(/执行台（N=14）/)).toBeTruthy();
    expect(metric('已发生费用')).toBe('0');
    expect(metric('所选候选基线总耗时（第 1 名）')).toBe('135'); // 15 边 × 9

    resetToDefault();

    // 恢复后：起点、计数、费用、可选动作全部属于默认 N=12 计划
    expect(screen.getByText(/执行台（N=12）/)).toBeTruthy();
    expect(screen.getByText('待开始：从停放位 0 出发')).toBeTruthy();
    expect(metric('已发生费用')).toBe('0');
    expect(metric('所选候选基线总耗时（第 1 名）')).toBe('13'); // 13 边 × 1
    expect(metric('当前最短后缀耗时（含回 0）')).toBe('13');
    expect(poseButtons()).toHaveLength(12);
    expect(poseButtons().every((b) => !b.disabled)).toBe(true);
    expect(document.querySelectorAll('.pose-btn.locked-prereq')).toHaveLength(0);
    // 等费默认计划：字典序最小，推荐首站为 1
    expect(document.querySelectorAll('.pose-btn.recommended')).toHaveLength(1);
    expect(
      poseButtons().find((b) => b.classList.contains('recommended'))?.textContent,
    ).toContain('姿态 1');

    // 可以从起点正常试跑并按当前计划结算
    confirmPose(3, 1);
    expect(metric('已发生费用')).toBe('1');
    runWholeRoute(12, 1, [3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12].slice(1));
    expect(screen.getByText('已回到停放位 0，结案')).toBeTruthy();
    expect(ledgerCell('实际总耗时')).toBe('13');
    expect(ledgerCell('所选候选基线总耗时（第 1 名）')).toBe('13');

    // 编辑台草稿同样属于恢复后的计划
    fireEvent.click(screen.getByRole('button', { name: /返回编辑台/ }));
    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('12');
    expect((screen.getByLabelText('选择候选路线第 1 名') as HTMLInputElement).checked).toBe(true);
  });

  it('运行中恢复且节点数缩小（14→12）：旧已访问节点/累计费用/剩余步骤不进入新路线，新计划可从 0 正常走完', () => {
    render(<App />);
    importAndApply(uniformPlan(14, 5));
    startExecuting();

    // 旧计划走两站：0→3、3→1，每边 5
    confirmPose(3, 5);
    confirmPose(1, 5);
    expect(metric('已发生费用')).toBe('10');
    expect(screen.getByText(/剩余 12 个姿态/)).toBeTruthy();
    expect(poseButtons()).toHaveLength(14);
    expect(poseButtons().filter((b) => b.disabled)).toHaveLength(2);

    resetToDefault();

    // 执行面板整体重建：旧的 3、1 已访问标记、10 费用、14 节点规模全部清空
    expect(screen.getByText(/执行台（N=12）/)).toBeTruthy();
    expect(screen.getByText('待开始：从停放位 0 出发')).toBeTruthy();
    expect(screen.queryByText(/执行中/)).toBeNull();
    expect(metric('已发生费用')).toBe('0');
    expect(metric('预计完工（已发生+最短后缀）')).toBe('13');
    expect(metric('所选候选基线总耗时（第 1 名）')).toBe('13');
    expect(metric('相对所选候选增量')).toBe('0');
    expect(screen.getByText(/剩余 12 个姿态/)).toBeTruthy();
    const buttons = poseButtons();
    expect(buttons).toHaveLength(12);
    expect(buttons.every((b) => !b.disabled)).toBe(true);
    // 旧计划已完成的 3、1 在新路线中必须重新可选
    expect(screen.getByTitle('确认姿态 3 为下一站，本步镜组转动费用 1')).toBeTruthy();
    expect(screen.getByTitle('确认姿态 1 为下一站，本步镜组转动费用 1')).toBeTruthy();

    // 旧节点 13、14 不得出现在新路线中
    expect(screen.queryByText(/确认姿态 13/)).toBeNull();
    expect(screen.queryByText(/确认姿态 14/)).toBeNull();

    // 用新边权（每边 1）走完：累计费用不得混入旧的每边 5
    runWholeRoute(12, 1, [3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(screen.getByText('已回到停放位 0，结案')).toBeTruthy();
    expect(ledgerCell('实际总耗时')).toBe('13');
    expect(ledgerCell('实际完整路线')).toBe('0 → 3 → 1 → 2 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 0');
    expect(ledgerCell('所选候选基线总耗时（第 1 名）')).toBe('13');
    expect(screen.getByText(/0（与原计划一致）/)).toBeTruthy();
  });

  it('运行中恢复且同规模改距离/候选顺序（12，每边 7→默认每边 1）：旧费用不与新边权混算，候选选择回到首名', () => {
    render(<App />);
    importAndApply(uniformPlan(12, 7));

    // 旧计划改选第 2 名后开跑
    fireEvent.click(screen.getByLabelText('选择候选路线第 2 名'));
    startExecuting();
    expect(metric('所选候选基线总耗时（第 2 名）')).toBe('91'); // 13 边 × 7
    confirmPose(5, 7);
    confirmPose(2, 7);
    expect(metric('已发生费用')).toBe('14');

    resetToDefault();

    // 同规模但距离全变：基线、候选名次、累计费用一律以新计划为准
    expect(screen.getByText('待开始：从停放位 0 出发')).toBeTruthy();
    expect(metric('所选候选基线总耗时（第 1 名）')).toBe('13');
    expect(metric('已发生费用')).toBe('0');
    expect(metric('当前最短后缀耗时（含回 0）')).toBe('13');
    expect(poseButtons()).toHaveLength(12);
    expect(poseButtons().every((b) => !b.disabled)).toBe(true);

    // 确认一站的费用取新边权 1（旧边权 7 下应为 7，旧累计 14 下更不可能为 1）
    confirmPose(5, 1);
    expect(metric('已发生费用')).toBe('1');
    expect(metric('预计完工（已发生+最短后缀）')).toBe('13');

    runWholeRoute(12, 1, [5, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12].slice(1));
    expect(ledgerCell('实际总耗时')).toBe('13');
    expect(screen.getByText(/0（与原计划一致）/)).toBeTruthy();
  });

  it('完成后恢复：旧路线已结案再恢复默认，新计划从起点待开始而不是直接显示旧结算', () => {
    render(<App />);
    importAndApply(uniformPlan(10, 9));
    startExecuting();
    runWholeRoute(10, 9);
    expect(screen.getByText('已回到停放位 0，结案')).toBeTruthy();
    expect(ledgerCell('实际总耗时')).toBe('99'); // 11 边 × 9

    resetToDefault();

    // 不得沿用旧的已完成结算
    expect(screen.queryByText('已回到停放位 0，结案')).toBeNull();
    expect(screen.queryByText('最终台账')).toBeNull();
    expect(screen.getByText('待开始：从停放位 0 出发')).toBeTruthy();
    expect(metric('已发生费用')).toBe('0');
    expect(metric('所选候选基线总耗时（第 1 名）')).toBe('13');
    expect(screen.getByText(/剩余 12 个姿态/)).toBeTruthy();
    const buttons = poseButtons();
    expect(buttons).toHaveLength(12);
    expect(buttons.every((b) => !b.disabled)).toBe(true);
    // 回库按钮只应在全部姿态确认后出现
    expect(screen.queryByRole('button', { name: /返回停放位/ })).toBeNull();

    // 新计划可以从起点正常试跑并独立结算
    runWholeRoute(12, 1);
    expect(screen.getByText('已回到停放位 0，结案')).toBeTruthy();
    expect(ledgerCell('实际总耗时')).toBe('13');
    expect(ledgerCell('所选候选基线总耗时（第 1 名）')).toBe('13');
    expect(screen.getByText(/0（与原计划一致）/)).toBeTruthy();
  });
});
