import { type CalibrationPlan } from '../solver/plan';
import { type CandidateSet } from '../solver/tsp';
import { RouteLine } from './RouteLine';

interface CandidatePickerProps {
  plan: CalibrationPlan;
  /** 当前已生效计划对应的候选集（由求解层一次算出） */
  candidateSet: CandidateSet;
  /** 当前选中的全局名次（1 起），默认首名 1 */
  selectedRank: number;
  onSelect: (rank: number) => void;
}

/**
 * 校准路线候选集：一次给出按总耗时升序、同费按完整姿态序列字典序升序排列的
 * 前三条互异精确路线（不足三条时只有实际数量）。默认选择首名，工程师可改选，
 * 所选路线将作为执行台的原计划及增量基线。
 *
 * 当计划带“先于”约束时，候选只在满足约束的可行路线集合内排名；约束导致
 * 无可行路线（理论上计划层已拦环，此处为防御展示）时就地说明、不提供选择。
 */
export function CandidatePicker({
  plan,
  candidateSet,
  selectedRank,
  onSelect,
}: CandidatePickerProps) {
  const dim = plan.n + 1;
  const edgeAt = (a: number, b: number) => plan.matrixFlat[a * dim + b]!;
  const prereqs = plan.prerequisites ?? [];

  if (!candidateSet.feasible || candidateSet.candidates.length === 0) {
    return (
      <div className="panel">
        <h2>校准路线候选集</h2>
        <div className="alert error" role="alert">
          当前“先于”约束下不存在满足全部前置条件的可执行路线；请删除相互约束（环）后重新应用。
          已应用的上一份有效计划未被修改。
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>校准路线候选集（精确解 · 前 {candidateSet.candidates.length} 条互异路线）</h2>
      <div className="hint" style={{ marginBottom: 10 }}>
        一次求解同时保留每名状态的固定三个不同后缀及子排名（扩展 Held–Karp，非贪心、非全排列、
        非反复禁用边重算）。排序：总耗时升序；同费时按完整姿态序列字典序升序。
        默认选择首名，可改选后点上方“开始执行”进入执行台。求解耗时
        {candidateSet.solveMs.toFixed(1)} ms。
      </div>
      {prereqs.length > 0 && (
        <div className="alert info" role="status" data-testid="prereq-banner">
          已生效“先于”约束（{prereqs.length} 条，规划器只在前置姿态已访问时扩展）：
          {' '}
          {prereqs.map(([a, b]) => `${a} 先于 ${b}`).join('；')}
        </div>
      )}

      <div className="candidate-list">
        {candidateSet.candidates.map((c) => {
          const checked = c.rank === selectedRank;
          return (
            <label
              key={c.rank}
              data-testid={`candidate-row-${c.rank}`}
              className={['candidate-row', checked ? 'selected' : ''].join(' ')}
            >
              <input
                type="radio"
                name="candidate-rank"
                value={c.rank}
                checked={checked}
                onChange={() => onSelect(c.rank)}
                aria-label={`选择候选路线第 ${c.rank} 名`}
              />
              <div className="candidate-body">
                <div className="row spread">
                  <span className="candidate-rank">
                    第 {c.rank} 名
                    {c.rank === 1 && <span className="badge good">默认首名 · 精确最优</span>}
                  </span>
                  <span className="candidate-cost">总耗时 {c.cost}</span>
                </div>
                <RouteLine tour={c.tour} edgeAt={edgeAt} hideEdgeCost />
                <div className="hint">
                  从 0 出发，恰访姿态 1…{plan.n} 各一次并回到 0；总耗时可由当前非对称矩阵逐边复算。
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
