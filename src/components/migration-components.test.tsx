// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App';
import {
  type CalibrationPlan,
  type Precedence,
  createDefaultPlan,
  matrixToNested,
  prerequisiteMasks,
} from '../solver/plan';
import { solveTopRoutes } from '../solver/tsp';
import { makeRng, randomMatrix } from '../solver/brute';
import { loadPlan } from '../state/storage';

const STORAGE_KEY = 'dome-calibration-plan-v1';

function range1(n: number): number[] {
  return Array.from({ length: n }, (_, k) => k + 1);
}

function clone(m: number[][]): number[][] {
  return m.map((row) => row.slice());
}

/** N=8 随机非对称矩阵计划素材（现场文件）。 */
function siteFixture(): { n: number; nested: number[][]; flat: number[] } {
  const n = 8;
  const flat = randomMatrix(n + 1, makeRng(20260924));
  return { n, flat, nested: matrixToNested({ n, matrixFlat: flat }) };
}

function importJson(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/n/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /解析并载入草稿/ }));
}

function apply() {
  fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
}

function expectRejected(keyword: string) {
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain('整批拒绝');
  expect(alert.textContent).toContain(keyword);
}

describe('页面：等价共存的混合文件（新旧字段逐项一致）', () => {
  beforeEach(() => localStorage.clear());

  it('导入→应用：候选排名与单侧计划一致，执行闸门守约束，导出只留当前字段', () => {
    const { n, nested, flat } = siteFixture();
    const edges: Precedence[] = [
      [2, 1],
      [1, 4],
      [3, 4],
    ];
    // 现场文件：两套矩阵逐格相同；两套依赖边序不同、含跨字段重复
    const file = {
      n,
      costs: clone(nested),
      dependencies: [
        [1, 4],
        [2, 1],
        [2, 1],
        [3, 4],
      ],
      matrix: nested,
      prerequisites: [
        [3, 4],
        [1, 4],
        [2, 1],
      ],
    };

    render(<App />);

    importJson(JSON.stringify(file));
    // 仅载入草稿：尚未应用，候选横幅不出现
    expect(screen.getByRole('status').textContent).toContain('导入成功');
    expect(screen.queryByTestId('prereq-banner')).toBeNull();
    expect(screen.getByTestId('prereq-list').textContent).toContain('姿态 2');

    apply();
    const banner = screen.getByTestId('prereq-banner');
    expect(banner.textContent).toContain('2 先于 1');
    expect(banner.textContent).toContain('1 先于 4');
    expect(banner.textContent).toContain('3 先于 4');

    // 候选前三名逐名等于按当前字段单侧计划的精确解，路线节点与费用都在行内
    const expected = solveTopRoutes(
      flat,
      n + 1,
      range1(n),
      0,
      0,
      prerequisiteMasks(edges),
    );
    for (const c of expected.candidates) {
      const row = screen.getByTestId(`candidate-row-${c.rank}`);
      expect(row.textContent).toContain(`总耗时 ${c.cost}`);
      for (const pose of c.sequence) {
        expect(row.textContent).toContain(String(pose));
      }
    }

    // 执行闸门：姿态 1 被 2 锁、姿态 4 被 1、3 锁
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    expect(screen.getByTestId('exec-prereq-banner').textContent).toContain('2→1');
    expect(screen.getByTitle(/姿态 1 的前置姿态[^。]*尚未确认/)).toBeTruthy();
    expect(screen.getByTitle(/姿态 4 的前置姿态[^。]*尚未确认/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /放弃执行/ }));

    // 导出：只剩当前字段（matrix/prerequisites），且内容是规范化后的同一计划
    fireEvent.click(screen.getByRole('button', { name: /导出为 JSON/ }));
    const exported = JSON.parse(
      (screen.getByPlaceholderText(/n/) as HTMLTextAreaElement).value,
    ) as Record<string, unknown>;
    expect(exported.n).toBe(n);
    expect(exported.matrix).toEqual(nested);
    expect(exported).toHaveProperty('prerequisites');
    expect(exported).not.toHaveProperty('costs');
    expect(exported).not.toHaveProperty('dependencies');
    // 导出物只含当前字段，规范化依赖按 (a,b) 升序
    expect(exported.prerequisites).toEqual([
      [1, 4],
      [2, 1],
      [3, 4],
    ]);
  });
});

describe('页面：两套矩阵冲突 / 一侧损坏 → 整批拒绝，已生效计划与候选选择保留', () => {
  beforeEach(() => localStorage.clear());

  it('矩阵单格冲突：拒绝，默认计划、候选第 2 名选择与执行闸门全部不变', () => {
    const { nested } = siteFixture();
    render(<App />);

    // 改选候选第 2 名（默认 N=12 等费计划）
    fireEvent.click(screen.getByLabelText('选择候选路线第 2 名'));
    expect(
      (screen.getByLabelText('选择候选路线第 2 名') as HTMLInputElement).checked,
    ).toBe(true);

    const conflicting = clone(nested);
    conflicting[2]![5] = 999; // 与 matrix 的同格（默认非 999）冲突，两侧各自合法
    importJson(JSON.stringify({ n: 8, matrix: nested, costs: conflicting }));
    expectRejected('不一致');
    // 无成功提示
    expect(screen.queryByText(/导入成功/)).toBeNull();

    // 已生效计划仍是 N=12：候选网格/选择保留
    expect(
      (screen.getByLabelText('选择候选路线第 2 名') as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByTestId('candidate-row-1').textContent).toContain('1…12');

    // 执行闸门仍可进入（旧计划可行，未被失败导入污染）
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    expect(screen.getByText(/执行台（N=12）/)).toBeTruthy();
    expect(screen.queryByTestId('exec-prereq-banner')).toBeNull();
  });

  it('一侧矩阵损坏（costs 缺项）：拒绝并点名 costs，不静默采用 matrix', () => {
    const { nested } = siteFixture();
    const broken = clone(nested) as unknown[][];
    broken[1] = (broken[1] as number[]).slice(0, 8);
    render(<App />);
    importJson(JSON.stringify({ n: 8, matrix: nested, costs: broken }));
    expectRejected('costs');
    // 仍停留在默认计划
    expect(screen.getByTestId('candidate-row-1').textContent).toContain('1…12');
  });
});

describe('页面：空新依赖 + 非空旧依赖（事故核心场景）→ 拒绝且执行不被放行', () => {
  beforeEach(() => localStorage.clear());

  it('prerequisites=[] 而 dependencies=[[3,5]]：拒绝，旧约束与候选选择保留，闸门仍锁 5', () => {
    const { nested } = siteFixture();
    render(<App />);

    // 先让已生效计划带上约束 3 先于 5，并改选第 2 名
    importJson(JSON.stringify({ n: 8, matrix: nested, prerequisites: [[3, 5]] }));
    apply();
    expect(screen.getByTestId('prereq-banner').textContent).toContain('3 先于 5');
    fireEvent.click(screen.getByLabelText('选择候选路线第 2 名'));

    // 事故文件：新依赖清空、旧依赖仍含必要前置
    importJson(
      JSON.stringify({ n: 8, matrix: clone(nested), costs: clone(nested), prerequisites: [], dependencies: [[3, 5], [1, 2]] }),
    );
    expectRejected('不一致');

    // 已生效计划：横幅仍是 3 先于 5（不是无约束，也不是 1 先于 2）
    const banner = screen.getByTestId('prereq-banner');
    expect(banner.textContent).toContain('3 先于 5');
    expect(banner.textContent).not.toContain('1 先于 2');
    // 候选选择保留
    expect(
      (screen.getByLabelText('选择候选路线第 2 名') as HTMLInputElement).checked,
    ).toBe(true);

    // 执行闸门：姿态 5 仍被 3 锁；系统未给出不受约束的前三路线
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    const locked5 = screen.getByTitle(/姿态 5 的前置姿态[^。]*尚未确认/) as HTMLButtonElement;
    expect(locked5.classList.contains('locked-prereq')).toBe(true);
    fireEvent.click(locked5);
    expect(screen.getByRole('alert').textContent).toContain('姿态 5 的前置姿态尚未完成');
  });

  it('一侧依赖成环：拒绝；已确认的执行进度不被失败导入波及', () => {
    const { nested } = siteFixture();
    render(<App />);
    importJson(JSON.stringify({ n: 8, matrix: nested, prerequisites: [[1, 2]] }));
    apply();

    // 进入执行台并确认 1（进度 1/8）
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    fireEvent.click(screen.getByTitle(/确认姿态 1 为下一站/));
    expect(screen.getByText(/已确认 1\/8/)).toBeTruthy();
    // 执行台没有导入入口；放弃执行回到编辑台后再发起失败导入，验证旧计划未被污染
    fireEvent.click(screen.getByRole('button', { name: /放弃执行/ }));
    importJson(
      JSON.stringify({
        n: 8,
        matrix: clone(nested),
        costs: clone(nested),
        prerequisites: [
          [1, 2],
          [2, 1],
        ],
        dependencies: [[1, 2]],
      }),
    );
    expectRejected('环');
    expect(screen.getByTestId('prereq-banner').textContent).toContain('1 先于 2');
    expect(screen.getByTestId('prereq-banner').textContent).not.toContain('2 先于 1');
    // 旧计划仍可行：执行闸门可再次进入，且仍锁姿态 2
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    expect(screen.getByTitle(/姿态 2 的前置姿态[^。]*尚未确认/)).toBeTruthy();
  });
});

describe('页面：混合存储恢复（刷新沿用同一严格校验）', () => {
  beforeEach(() => localStorage.clear());

  it('等价共存的混合记录：刷新后作为有效计划恢复，约束仍在', () => {
    const { n, nested } = siteFixture();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        n,
        costs: clone(nested),
        matrix: nested,
        dependencies: [
          [3, 4],
          [1, 2],
        ],
        prerequisites: [
          [1, 2],
          [3, 4],
        ],
      }),
    );
    render(<App />);
    const banner = screen.getByTestId('prereq-banner');
    expect(banner.textContent).toContain('1 先于 2');
    expect(banner.textContent).toContain('3 先于 4');
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    expect(screen.getByTestId('exec-prereq-banner').textContent).toContain('1→2');
    expect(screen.getByTitle(/姿态 2 的前置姿态[^。]*尚未确认/)).toBeTruthy();
  });

  it('矩阵冲突的混合记录：丢弃并回退默认，不把混合记录当有效计划', () => {
    const { nested } = siteFixture();
    const conflicting = clone(nested);
    conflicting[0]![1] = 42;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ n: 8, matrix: nested, costs: conflicting }),
    );
    const fallback = createDefaultPlan(12);
    const loaded = loadPlan(fallback);
    expect(loaded).toBe(fallback);

    render(<App />);
    expect(screen.queryByTestId('prereq-banner')).toBeNull();
    expect(screen.getByTestId('candidate-row-1').textContent).toContain('1…12');
  });

  it('空新依赖 + 非空旧依赖的混合记录：丢弃并回退默认', () => {
    const { nested } = siteFixture();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ n: 8, matrix: nested, prerequisites: [], dependencies: [[1, 2]] }),
    );
    const fallback: CalibrationPlan = createDefaultPlan(12);
    expect(loadPlan(fallback)).toBe(fallback);

    render(<App />);
    expect(screen.queryByTestId('prereq-banner')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /开始执行/ }));
    expect(screen.queryByTestId('exec-prereq-banner')).toBeNull();
    // 默认计划下姿态 2 不受约束
    expect(
      (screen.getByTitle(/确认姿态 2 为下一站/) as HTMLButtonElement).classList.contains(
        'locked-prereq',
      ),
    ).toBe(false);
  });

  it('一侧损坏（dependencies 成环）的混合记录：丢弃并回退默认', () => {
    const { nested } = siteFixture();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        n: 8,
        matrix: nested,
        costs: clone(nested),
        prerequisites: [[1, 2]],
        dependencies: [
          [1, 2],
          [2, 1],
        ],
      }),
    );
    const fallback: CalibrationPlan = createDefaultPlan(12);
    expect(loadPlan(fallback)).toBe(fallback);
  });
});
