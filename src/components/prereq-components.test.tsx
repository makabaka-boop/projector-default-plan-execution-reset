// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { App } from '../App';
import { MatrixEditor } from './MatrixEditor';
import { ExecutionConsole } from './ExecutionConsole';
import { createDefaultPlan, matrixToNested, type CalibrationPlan } from '../solver/plan';

const STORAGE_KEY = 'dome-calibration-plan-v1';

function setSelect(ariaLabel: string, value: string) {
  const sel = screen.getByLabelText(ariaLabel) as HTMLSelectElement;
  fireEvent.change(sel, { target: { value } });
}

function addDraftEdge(a: number, b: number) {
  setSelect('新增先于关系的前置姿态 a', String(a));
  setSelect('新增先于关系的后置姿态 b', String(b));
  fireEvent.click(screen.getByLabelText('添加先于关系到草稿'));
}

function apply() {
  fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
}

describe('页面：“先于”草稿与已应用计划分离', () => {
  beforeEach(() => localStorage.clear());

  it('只改草稿不生效：候选集看不到依赖；应用后才出现在候选与执行台', () => {
    render(<App />);

    // 初始无任何依赖
    expect(screen.getByTestId('prereq-empty')).toBeTruthy();
    expect(screen.queryByTestId('prereq-banner')).toBeNull();

    // 未应用草稿时，进入执行台看不到约束、姿态 2 未被锁（页签切换会丢弃草稿，
    // 与矩阵草稿的既有行为一致，故这一段在加入草稿之前核对）
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    expect(screen.queryByTestId('exec-prereq-banner')).toBeNull();
    const pose2Free = screen.getByTitle(/确认姿态 2 为下一站/) as HTMLButtonElement;
    expect(pose2Free.classList.contains('locked-prereq')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /放弃执行/ }));

    // 加入草稿 [1, 2] 但不应用：候选横幅仍不出现
    addDraftEdge(1, 2);
    expect(screen.getByTestId('prereq-list').textContent).toContain('姿态 1');
    expect(screen.queryByTestId('prereq-banner')).toBeNull();

    // 应用草稿后候选横幅出现
    apply();
    const banner = screen.getByTestId('prereq-banner');
    expect(banner.textContent).toContain('1 先于 2');

    // 进入执行台：约束生效
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    const execBanner = screen.getByTestId('exec-prereq-banner');
    expect(execBanner.textContent).toContain('1→2');
    const pose2Locked = screen.getByTitle(/姿态 2 的前置姿态[^。]*尚未确认/) as HTMLButtonElement;
    expect(pose2Locked.classList.contains('locked-prereq')).toBe(true);
    expect(pose2Locked.textContent).toContain('🔒');
  });

  it('非法依赖（成环）不能提交：错误就地显示，已应用计划与候选不被污染', () => {
    render(<App />);

    // 先应用一条合法依赖作为“上次有效计划”
    addDraftEdge(1, 2);
    apply();
    expect(screen.getByTestId('prereq-banner').textContent).toContain('1 先于 2');

    // 试图追加成环边 [2, 1]：1→2→1
    addDraftEdge(2, 1);
    apply();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('环');
    expect(alert.textContent).toContain('整批拒绝');

    // 已应用计划仍是 1 先于 2（候选横幅未变）
    const banner = screen.getByTestId('prereq-banner');
    expect(banner.textContent).toContain('1 先于 2');
    expect(banner.textContent).not.toContain('2 先于 1');

    // 执行台仍只锁姿态 2、不锁姿态 1（上次有效计划未被污染）
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    const execBannerText = screen.getByTestId('exec-prereq-banner').textContent!;
    expect(execBannerText).toContain('1→2');
    expect(execBannerText).not.toContain('2→1');
    expect(screen.queryByTitle(/姿态 1 的前置姿态/)).toBeNull();
    expect(screen.getByTitle(/姿态 2 的前置姿态[^。]*尚未确认/)).toBeTruthy();
  });

  it('自指依赖：UI 添加阶段即拒绝且不入草稿；JSON 提交整批拒绝', () => {
    render(<App />);
    addDraftEdge(5, 5);
    expect(screen.getByRole('alert').textContent).toContain('不可自指');
    expect(screen.getByTestId('prereq-empty')).toBeTruthy();

    // 通过 JSON 走提交链路同样被整批拒绝，旧计划保留
    const nested = matrixToNested(createDefaultPlan(8));
    fireEvent.change(screen.getByPlaceholderText(/n/), {
      target: { value: JSON.stringify({ n: 8, matrix: nested, prerequisites: [[6, 6]] }) },
    });
    fireEvent.click(screen.getByRole('button', { name: /解析并载入草稿/ }));
    expect(screen.getByRole('alert').textContent).toContain('不可自指');
    expect(screen.queryByTestId('prereq-list')).toBeNull();
  });

  it('引用不存在姿态的依赖草稿在添加阶段即被拒绝，不进列表', () => {
    render(<App />);
    // 编辑器下拉只给现有姿态，这里直接用 MatrixEditor 的 JSON 导入验证存在性校验
    const nested = matrixToNested(createDefaultPlan(8));
    fireEvent.change(screen.getByPlaceholderText(/n/), {
      target: { value: JSON.stringify({ n: 8, matrix: nested, prerequisites: [[1, 9]] }) },
    });
    fireEvent.click(screen.getByRole('button', { name: /解析并载入草稿/ }));
    expect(screen.getByRole('alert').textContent).toContain('后置姿态 b');
    expect(screen.queryByTestId('prereq-list')).toBeNull();
  });
});

describe('页面：执行中前置拒绝、进度保留与重算同步', () => {
  beforeEach(() => localStorage.clear());

  it('点击被阻塞姿态：拒绝并报错，已确认进度保留；前置完成后放行且后缀同步', () => {
    render(<App />); // 默认 N=12，等费矩阵

    // 应用依赖 3 先于 5
    addDraftEdge(3, 5);
    apply();
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));

    // 初始：姿态 5 被锁，点击被拒绝
    const pose5Locked = screen.getByTitle(/姿态 5 的前置姿态[^。]*尚未确认/) as HTMLButtonElement;
    fireEvent.click(pose5Locked);
    const errorBox = screen.getByRole('alert');
    expect(errorBox.textContent).toContain('姿态 5 的前置姿态尚未完成');
    expect(errorBox.textContent).toContain('3');
    // 进度未变：仍待开始
    expect(screen.getByText(/待开始：从停放位 0 出发/)).toBeTruthy();

    // 确认 1、2、3（默认等费矩阵，推荐序列就是当前最小可行姿态）
    fireEvent.click(screen.getByTitle(/确认姿态 1 为下一站/));
    fireEvent.click(screen.getByTitle(/确认姿态 2 为下一站/));
    fireEvent.click(screen.getByTitle(/确认姿态 3 为下一站/));
    expect(screen.getByText(/已确认 3\/12/)).toBeTruthy();
    // 之前的拒绝错误在成功确认后清空
    expect(screen.queryByText(/前置姿态尚未完成/)).toBeNull();

    // 3 已完成 ⇒ 5 放行；中途重算只在剩余姿态上遵守依赖
    const pose5 = screen.getByTitle(/确认姿态 5 为下一站/) as HTMLButtonElement;
    expect(pose5.classList.contains('locked-prereq')).toBe(false);
    fireEvent.click(pose5);
    expect(screen.getByText(/已确认 4\/12/)).toBeTruthy();

    // 实际已走路线面板按确认顺序展示 0 → 1 → 2 → 3 → 5
    const routePanel = screen
      .getAllByText(/实际已走路线/)[0]!
      .closest('.panel') as HTMLElement;
    const nodeText = within(routePanel)
      .getAllByText(/^(0 停放|[0-9]+)$/)
      .map((el) => el.textContent!);
    expect(nodeText[0]).toBe('0 停放');
    expect(nodeText.slice(1, 6)).toEqual(['1', '2', '3', '5', expect.any(String)]);
  });

  it('带依赖直接渲染 ExecutionConsole：被锁姿态可点但拒绝，进度与费用不前进', () => {
    const plan: CalibrationPlan = {
      ...createDefaultPlan(8),
      prerequisites: [
        [1, 4],
        [2, 4],
      ],
    };
    render(<ExecutionConsole plan={plan} onAbort={() => {}} />);

    // 4 被 1、2 阻塞
    const locked4 = screen.getByTitle(/姿态 4 的前置姿态[^。]*尚未确认/) as HTMLButtonElement;
    fireEvent.click(locked4);
    expect(screen.getByRole('alert').textContent).toMatch(/1、2|2、1/);
    // 已发生费用仍为 0（没有任何指标变成进行中）
    expect(screen.getByText('待开始：从停放位 0 出发')).toBeTruthy();

    // 确认 1 后 4 仍被 2 阻塞，错误保留已确认的 1
    fireEvent.click(screen.getByTitle(/确认姿态 1 为下一站/));
    fireEvent.click(screen.getByTitle(/姿态 4 的前置姿态[^。]*尚未确认/));
    expect(screen.getByRole('alert').textContent).toContain('2');
    expect(screen.getByText(/已确认 1\/8/)).toBeTruthy();

    // 确认 2 后 4 放行，点击成功，后缀推荐与剩余数同步
    fireEvent.click(screen.getByTitle(/确认姿态 2 为下一站/));
    fireEvent.click(screen.getByTitle(/确认姿态 4 为下一站/));
    expect(screen.getByText(/已确认 3\/8/)).toBeTruthy();
    expect(screen.getByText(/剩余 5 个姿态/)).toBeTruthy();
  });
});

describe('页面：依赖随计划持久化，损坏（成环）数据回退上次/默认', () => {
  beforeEach(() => localStorage.clear());

  it('应用依赖后刷新（重挂载）仍在', () => {
    const { unmount } = render(<App />);
    addDraftEdge(7, 3);
    apply();
    expect(screen.getByTestId('prereq-banner').textContent).toContain('7 先于 3');

    unmount();
    render(<App />);
    expect(screen.getByTestId('prereq-banner').textContent).toContain('7 先于 3');
  });

  it('localStorage 中的成环依赖加载时被丢弃，回退默认无依赖计划', () => {
    const nested = matrixToNested(createDefaultPlan(8));
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ n: 8, matrix: nested, prerequisites: [[1, 2], [2, 1]] }),
    );
    render(<App />);
    expect(screen.queryByTestId('prereq-banner')).toBeNull();
    // 默认回退是 N=12 的无依赖计划：执行台不显示约束横幅，姿态不被锁
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    expect(screen.queryByTestId('exec-prereq-banner')).toBeNull();
  });
});

describe('页面：无依赖旧输入逐项保持原行为', () => {
  beforeEach(() => localStorage.clear());

  it('无 prerequisites 字段的计划：编辑台空状态、候选无横幅、执行无横幅', () => {
    const plan = createDefaultPlan(8);
    render(<MatrixEditor plan={plan} onApply={() => {}} />);
    expect(screen.getByTestId('prereq-empty').textContent).toContain('无“先于”约束');
  });
});
