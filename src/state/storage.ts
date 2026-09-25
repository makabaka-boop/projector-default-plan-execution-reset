/**
 * 浏览器本地持久化。所有数据仅存于浏览器 localStorage，不向任何服务发送。
 * 加载时重新校验（费用矩阵与“先于”依赖一并校验），损坏或被外部改坏的数据
 * （含非法依赖/成环）一律丢弃，回退到调用方给定默认值。
 */
import { type CalibrationPlan, validatePlan } from '../solver/plan';
import { matrixToNested } from '../solver/plan';

const STORAGE_KEY = 'dome-calibration-plan-v1';

export function loadPlan(fallback: CalibrationPlan): CalibrationPlan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    const result = validatePlan(parsed);
    if (result.ok && result.plan) return result.plan;
    return fallback;
  } catch {
    return fallback;
  }
}

export function savePlan(plan: CalibrationPlan): void {
  // 落盘前再校验一次，拒绝写入任何不合法数据（矩阵或“先于”依赖）
  const payload: { n: number; matrix: number[][]; prerequisites?: [number, number][] } = {
    n: plan.n,
    matrix: matrixToNested(plan),
  };
  // 无依赖时不写该字段：旧版数据格式与展示逐项不变。
  if (plan.prerequisites && plan.prerequisites.length > 0) {
    payload.prerequisites = plan.prerequisites.map(([a, b]) => [a, b]);
  }
  const result = validatePlan(payload);
  if (!result.ok) {
    throw new Error('内部错误：拒绝把不合法计划写入本地存储');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearStoredPlan(): void {
  localStorage.removeItem(STORAGE_KEY);
}
