import { useMemo, useState } from 'react';
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
  // 执行代际：执行台以此为 key。计划被替换（应用新计划/恢复默认）或重新进入
  // 执行台时递增，强制执行台以当前计划全新挂载——旧的已访问节点、累计费用、
  // 剩余步骤与结算一律作废，绝不与新计划的矩阵/候选混算。
  const [planVersion, setPlanVersion] = useState(0);
  // 工程师在候选集中的选择（全局名次，1 起）；默认首名。
  const [selectedRank, setSelectedRank] = useState(1);

  // 当前已生效计划的校准路线候选集（扩展 Held–Karp 一次给出前三名互异精确路线）。
  // 应用新矩阵时 plan 引用更换即触发重算；候选选择在 applyPlan/resetToDefault
  // 中同步重置为首名，旧候选与旧选择一起失效。
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

  // 计划替换是一次整体代际切换：候选重算、选择回到首名，并在同一更新批次内
  // 递增执行代际——若此时执行台正挂载（如在执行台点“恢复默认计划”），
  // 新 key 让它以新计划全新挂载，避免旧执行状态与新边权混算。
  function applyPlan(next: CalibrationPlan) {
    savePlan(next);
    setPlan(next); // 引用变化即触发候选重算
    setSelectedRank(1);
    setPlanVersion((v) => v + 1);
  }

  function resetToDefault() {
    const fallback = createDefaultPlan(12);
    savePlan(fallback);
    setPlan(fallback);
    setSelectedRank(1);
    setPlanVersion((v) => v + 1);
    // 恢复默认是一次破坏性重置：回到编辑台，让操作员面对新计划与候选重新选择，
    // 再从停放位 0 正常试跑；旧执行过程（含已结案台账）不再停留界面。
    setTab('edit');
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
            // 每次进入执行台都以当前计划全新开始（计划替换时 applyPlan/恢复默认
            // 已先递增过代际，这里再次递增保证从编辑台进入也是全新执行）。
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
