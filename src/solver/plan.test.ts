import { describe, expect, it } from 'vitest';
import {
  COST_MAX,
  COST_MIN,
  N_MAX,
  N_MIN,
  createDefaultPlan,
  matrixToNested,
  validatePlan,
} from './plan';

function validNested(n: number, offDiag = 7): number[][] {
  const dim = n + 1;
  return Array.from({ length: dim }, (_, i) =>
    Array.from({ length: dim }, (_, j) => (i === j ? 0 : offDiag)),
  );
}

describe('计划校验', () => {
  it('接受边界 N=8 与 N=18 的合法计划', () => {
    for (const n of [N_MIN, N_MAX]) {
      const r = validatePlan({ n, matrix: validNested(n) });
      expect(r.ok).toBe(true);
      expect(r.plan?.n).toBe(n);
      expect(r.plan?.matrixFlat).toHaveLength((n + 1) ** 2);
    }
  });

  it('接受裸二维数组（边长推断 N）与 costs 别名', () => {
    const nested = validNested(10);
    const r1 = validatePlan(nested);
    expect(r1.ok).toBe(true);
    expect(r1.plan?.n).toBe(10);
    const r2 = validatePlan({ n: 10, costs: nested });
    expect(r2.ok).toBe(true);
    expect(r2.plan?.matrixFlat).toEqual(r1.plan?.matrixFlat);
  });

  it('接受费用上下限 1 与 9999', () => {
    const m = validNested(8, COST_MIN);
    m[1]![2] = COST_MAX;
    const r = validatePlan({ n: 8, matrix: m });
    expect(r.ok).toBe(true);
  });

  it('拒绝 N 越界（7 与 19）、非整数、错误类型', () => {
    expect(validatePlan({ n: 7, matrix: validNested(7) }).ok).toBe(false);
    expect(validatePlan({ n: 19, matrix: validNested(19) }).ok).toBe(false);
    expect(validatePlan({ n: 8.5, matrix: validNested(8) }).ok).toBe(false);
    expect(validatePlan({ n: '8', matrix: validNested(8) }).ok).toBe(false);
    expect(validatePlan(null).ok).toBe(false);
    expect(validatePlan('x').ok).toBe(false);
    expect(validatePlan(42).ok).toBe(false);
  });

  it('缺项/行列形状不符：整批拒绝并给出就地错误', () => {
    const m = validNested(8) as unknown[][];
    m[3] = m[3]!.slice(0, 8); // 少一项
    const r = validatePlan({ n: 8, matrix: m });
    expect(r.ok).toBe(false);
    expect(r.plan).toBeUndefined();
    expect(r.errors.join(' ')).toContain('第 3 行');
  });

  it('行数不符即拒绝', () => {
    const m = validNested(8);
    m.pop();
    const r = validatePlan({ n: 8, matrix: m });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('矩阵行数必须为 9');
  });

  it('对角非 0、非对角为 0、越界、小数、字符串、null 全部拒绝', () => {
    const bad: Array<[string, unknown]> = [
      ['对角非零', 5],
      ['非对角零', 0],
      ['超上限', 10000],
      ['负数', -3],
      ['小数', 2.5],
      ['字符串', '9'],
      ['null', null],
      ['缺项', undefined],
    ];
    for (const [label, badValue] of bad) {
      const m = validNested(8) as unknown[][];
      if (label === '对角非零') {
        m[2]![2] = badValue;
      } else {
        m[2]![5] = badValue;
      }
      const r = validatePlan({ n: 8, matrix: m });
      expect(r.ok, label).toBe(false);
      expect(r.errors.length, label).toBeGreaterThan(0);
      expect(r.plan, label).toBeUndefined();
    }
  });

  it('默认计划始终合法（编辑器初始数据）', () => {
    for (const n of [N_MIN, 12, N_MAX]) {
      const plan = createDefaultPlan(n);
      const r = validatePlan({ n, matrix: matrixToNested(plan) });
      expect(r.ok).toBe(true);
    }
  });

  it('往返序列化保持精确整数值', () => {
    const m = validNested(8, 1234);
    m[0]![1] = 9999;
    m[7]![8] = 1;
    const r = validatePlan(JSON.parse(JSON.stringify({ n: 8, matrix: m })));
    expect(r.ok).toBe(true);
    expect(r.plan!.matrixFlat[0 * 9 + 1]).toBe(9999);
    expect(r.plan!.matrixFlat[7 * 9 + 8]).toBe(1);
    expect(Number.isSafeInteger(r.plan!.matrixFlat.reduce((a, b) => a + b, 0))).toBe(true);
  });
});
