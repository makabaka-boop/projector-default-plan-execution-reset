import { useEffect, useMemo, useState } from 'react';
import {
  type CalibrationPlan,
  createDefaultPlan,
  prerequisiteMasks,
} from './solver/plan';
import { solveTopRoutes } from './solver/tsp';
import { MatrixEditor } from './components/MatrixEditor';
import { ExecutionConsole } from './components/ExecutionConsole';
import { CandidatePicker } from './components/CandidatePicker';
import { loadPlan, savePlan } from './state/storage';

type Tab = 'edit' | 'execute';

export function App() {
  const [plan, setPlan] = useState<CalibrationPlan>(() => {
    const fallback = createDefaultPlan(12);
    return loadPlan(fallback);
  });
  const [tab, setTab] = useState<Tab>('edit');
  const [planVersion, setPlanVersion] = useState(0); // 进入执行台时重建执行状态
  // 工程师在候选集中的选择（全局名次，1 起）；默认首名。
  const [selectedRank, setSelectedRank] = useState(1);

  // 当前已生效计划的校准路线候选集（扩展 Held–Karp 一次给出前三名互异精确路线）。
  // 应用新矩阵时 plan 引用更换，旧候选与选择随之失效：下面的 effect 立即重算并重置选择。
  const allTargets = useMemo(
    () => Array.from({ length: plan.n }, (_, k) => k + 1),
    [plan.n],
  );
  // “先于”约束的位掩码；无依赖时为全 0，求解器走零成本原始路径。
  const preByPose = useMemo(() => prerequisiteMasks(plan.prerequisites), [plan]);
  const candidateSet = useMemo(
    () => solveTopRoutes(plan.matrixFlat, plan.n + 1, allTargets, 0, 0, preByPose),
    [plan, allTargets, preByPose],
  );

  // 新计划生效：选择回到候选首名（旧候选与旧选择一起作废）。
  useEffect(() => {
    setSelectedRank(1);
  }, [plan]);

  function applyPlan(next: CalibrationPlan) {
    savePlan(next);
    setPlan(next); // 引用变化即触发候选重算与选择重置
  }

  function resetToDefault() {
    const fallback = createDefaultPlan(12);
    savePlan(fallback);
    setPlan(fallback);
  }

  const selected =
    candidateSet.candidates.find((c) => c.rank === selectedRank) ??
    candidateSet.candidates[0];
  const feasible = candidateSet.feasible && selected !== undefined;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>穹幕投影机校准 · 精确路线台</h1>
          <div className="sub">
            镜组转动耗时有方向性 · 非对称 TSP 精确解（Held–Karp 动态规划，非贪心、非全排列）
            · 数据仅存本浏览器
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={resetToDefault}>
            恢复默认计划（N=12）
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${tab === 'edit' ? 'active' : ''}`}
          onClick={() => setTab('edit')}
        >
          1. 编辑与导入
        </button>
        <button
          className={`tab ${tab === 'execute' ? 'active' : ''}`}
          disabled={!feasible}
          title={feasible ? undefined : '当前“先于”约束下没有可执行路线，请先在编辑台修正依赖'}
          onClick={() => {
            if (!feasible) return;
            setPlanVersion((v) => v + 1);
            setTab('execute');
          }}
        >
          2. 开始执行{feasible ? `（当前选择：候选第 ${selected.rank} 名）` : '（无可执行路线）'}
        </button>
      </nav>

      {tab === 'edit' && (
        <>
          <CandidatePicker
            plan={plan}
            candidateSet={candidateSet}
            selectedRank={selectedRank}
            onSelect={setSelectedRank}
          />

          <MatrixEditor plan={plan} onApply={applyPlan} />
        </>
      )}

      {tab === 'execute' && feasible && (
        <ExecutionConsole
          key={planVersion}
          plan={plan}
          baseline={selected}
          baselineRank={selected.rank}
          onAbort={() => setTab('edit')}
        />
      )}
    </div>
  );
}
