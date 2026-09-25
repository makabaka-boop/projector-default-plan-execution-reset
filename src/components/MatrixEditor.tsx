import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COST_MAX,
  COST_MIN,
  N_MAX,
  N_MIN,
  type CalibrationPlan,
  type Precedence,
  validatePlan,
} from '../solver/plan';

interface MatrixEditorProps {
  /** 已生效的计划（导入/应用失败时始终保留它） */
  plan: CalibrationPlan;
  onApply: (plan: CalibrationPlan) => void;
}

/**
 * 编辑台：可改 N、可逐格编辑费用、可粘贴/导入 JSON、可导出。
 * 草稿与“已生效计划”分离：只有整批校验通过才调用 onApply；
 * 任一缺项或越界都就地显示错误并保留旧计划。
 */
export function MatrixEditor({ plan, onApply }: MatrixEditorProps) {
  const [n, setN] = useState<number>(plan.n);
  const [cells, setCells] = useState<number[]>(plan.matrixFlat);
  // “先于”关系草稿：与已生效计划分离，只有“校验并应用”通过才随计划一起生效。
  const [prereqs, setPrereqs] = useState<Precedence[]>(plan.prerequisites ?? []);
  // 下一条待加入关系的两个端点（草稿中的草稿，未点“添加”不进列表）。
  const [draftA, setDraftA] = useState<number>(1);
  const [draftB, setB] = useState<number>(2);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>('');
  const [jsonText, setJsonText] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dim = n + 1;

  // 切换 N：在合法范围内重建网格，沿用能复用的旧费用，新位置给默认值 1
  function changeN(nextN: number) {
    if (!Number.isInteger(nextN) || nextN < N_MIN || nextN > N_MAX) return;
    const nextDim = nextN + 1;
    const next = new Array<number>(nextDim * nextDim);
    const oldDim = dim;
    for (let i = 0; i < nextDim; i++) {
      for (let j = 0; j < nextDim; j++) {
        if (i === j) {
          next[i * nextDim + j] = 0;
        } else if (i < oldDim && j < oldDim) {
          next[i * nextDim + j] = cells[i * oldDim + j] ?? 1;
        } else {
          next[i * nextDim + j] = 1;
        }
      }
    }
    setN(nextN);
    setCells(next);
    // “先于”草稿同步裁掉引用已删除姿态的边；待加入的端点也收回范围。
    setPrereqs((prev) =>
      prev.filter(([a, b]) => a <= nextN && b <= nextN),
    );
    setDraftA((a) => Math.min(a, nextN));
    setB((b) => Math.min(Math.max(b, 2), nextN));
    setErrors([]);
    setNotice('');
  }

  function editCell(i: number, j: number, raw: string) {
    const idx = i * dim + j;
    const next = cells.slice();
    if (i === j) {
      next[idx] = 0; // 对角线锁定为 0
    } else if (raw.trim() === '') {
      // 用 NaN 标记“缺项”：界面标红，应用时整批拒绝（不会污染已生效计划）
      next[idx] = Number.NaN;
    } else {
      const v = Number(raw);
      next[idx] = v;
    }
    setCells(next);
    setErrors([]);
    setNotice('');
  }

  /** 逐格即时合法性（只影响标红，不阻断输入） */
  function cellInvalid(i: number, j: number, v: number): boolean {
    if (i === j) return v !== 0;
    return !Number.isInteger(v) || v < COST_MIN || v > COST_MAX;
  }

  /**
   * 加入一条“先于”草稿 [a, b]：仅改草稿（自指/重复/越界就地提示，不触碰已生效计划）；
   * 环与提交时的整批校验一起在 commit 里完成。
   */
  function addPrereq(a: number, b: number) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || a > n || b < 1 || b > n) {
      setErrors([`“先于”姿态必须是 1—${n} 的现有姿态编号`]);
      setNotice('');
      return;
    }
    if (a === b) {
      setErrors([`不可自指：姿态 ${a} 不能先于自己（未加入依赖草稿）`]);
      setNotice('');
      return;
    }
    if (prereqs.some(([pa, pb]) => pa === a && pb === b)) {
      setNotice(`依赖 ${a} 先于 ${b} 已在草稿中，重复添加被忽略。`);
      return;
    }
    const next = [...prereqs, [a, b] as Precedence].sort(
      (p, q) => p[0] - q[0] || p[1] - q[1],
    );
    setPrereqs(next);
    setErrors([]);
    setNotice(`已加入草稿依赖：姿态 ${a} 必须先于姿态 ${b}。点击“校验并应用”后才会生效。`);
  }

  function removePrereq(a: number, b: number) {
    setPrereqs(prereqs.filter(([pa, pb]) => pa !== a || pb !== b));
    setErrors([]);
    setNotice('');
  }

  function commit() {
    const nested: number[][] = [];
    for (let i = 0; i < dim; i++) nested.push(cells.slice(i * dim, (i + 1) * dim));
    const result = validatePlan({ n, matrix: nested, prerequisites: prereqs });
    if (!result.ok || !result.plan) {
      setErrors([...result.errors, '整批拒绝：当前已生效计划（含其依赖）保持不变。']);
      setNotice('');
      return;
    }
    setErrors([]);
    setPrereqs(result.plan.prerequisites ?? []);
    const depCount = result.plan.prerequisites?.length ?? 0;
    setNotice(
      `计划已生效：N=${result.plan.n}，费用矩阵 (${dim}×${dim}) 全部合法，“先于”约束 ${depCount} 条。`,
    );
    onApply(result.plan);
  }

  function applyJson(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setErrors([`JSON 语法错误：${(e as Error).message}；旧计划已保留`]);
      setNotice('');
      return;
    }
    const result = validatePlan(parsed);
    if (!result.ok || !result.plan) {
      setErrors([...result.errors, '整批拒绝：当前已生效计划（含其依赖）保持不变。']);
      setNotice('');
      return;
    }
    setN(result.plan.n);
    setCells(result.plan.matrixFlat);
    setPrereqs(result.plan.prerequisites ?? []);
    setErrors([]);
    setNotice(
      `导入成功：N=${result.plan.n}，“先于”约束 ${result.plan.prerequisites?.length ?? 0} 条。点击“校验并应用”后才会替换当前计划。`,
    );
  }

  function importJson() {
    const text = jsonText.trim();
    if (!text) {
      setErrors(['JSON 内容为空，未导入任何数据']);
      setNotice('');
      return;
    }
    applyJson(text);
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setJsonText(text);
      applyJson(text);
    };
    reader.onerror = () => {
      setErrors([`读取文件失败：${file.name}`]);
    };
    reader.readAsText(file);
  }

  function exportJson() {
    const nested: number[][] = [];
    for (let i = 0; i < dim; i++) nested.push(cells.slice(i * dim, (i + 1) * dim));
    const payload: { n: number; matrix: number[][]; prerequisites?: [number, number][] } = {
      n,
      matrix: nested,
    };
    if (prereqs.length > 0) {
      payload.prerequisites = prereqs.map(([a, b]) => [a, b]);
    }
    const text = JSON.stringify(payload, null, 2);
    setJsonText(text);
    setNotice('已把当前网格与依赖草稿序列化为 JSON（仍以已生效计划为准，除非再应用）。');
  }

  const columnHeaders = useMemo(() => Array.from({ length: dim }, (_, k) => k), [dim]);

  useEffect(() => {
    // 外部（如“恢复默认”）更换计划时同步草稿（费用网格与“先于”依赖一起）
    setN(plan.n);
    setCells(plan.matrixFlat);
    setPrereqs(plan.prerequisites ?? []);
    setDraftA(1);
    setB(Math.min(2, plan.n));
  }, [plan]);

  const invalidCount = cells.filter((v, idx) => {
    const i = Math.floor(idx / dim);
    const j = idx % dim;
    return cellInvalid(i, j, v);
  }).length;

  return (
    <div>
      <div className="panel">
        <h2>姿态与费用矩阵</h2>
        <div className="row spread">
          <div className="row">
            <label>
              姿态数 N（8—18）：
              <select
                value={n}
                onChange={(e) => changeN(Number(e.target.value))}
                style={{ marginLeft: 8 }}
              >
                {Array.from({ length: N_MAX - N_MIN + 1 }, (_, k) => N_MIN + k).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">
              矩阵 {dim}×{dim}（含停放位 0）；C[i→j]，转动有方向性
            </span>
            {invalidCount > 0 && <span className="badge warn">{invalidCount} 项待修正</span>}
          </div>
          <div className="row">
            <button className="btn" onClick={exportJson}>
              导出为 JSON
            </button>
            <label className="file-label btn">
              导入 JSON 文件
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = '';
                }}
              />
            </label>
            <button className="btn primary" onClick={commit}>
              校验并应用
            </button>
          </div>
        </div>

        <div className="matrix-scroll" style={{ marginTop: 12 }}>
          <table className="matrix">
            <thead>
              <tr>
                <th className="corner">行 i ↓ / 列 j →</th>
                {columnHeaders.map((j) => (
                  <th key={j}>{j}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: dim }, (_, i) => (
                <tr key={i}>
                  <th>{i}</th>
                  {Array.from({ length: dim }, (_, j) => {
                    const v = cells[i * dim + j]!;
                    const diag = i === j;
                    return (
                      <td key={j}>
                        <input
                          className={[
                            diag ? 'diag' : '',
                            cellInvalid(i, j, v) ? 'invalid' : '',
                          ].join(' ')}
                          value={Number.isNaN(v) ? '' : v}
                          disabled={diag}
                          inputMode="numeric"
                          aria-label={`matrix[${i}][${j}]`}
                          onChange={(e) => editCell(i, j, e.target.value)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint">
          对角线锁定为 0；其余项必须为 {COST_MIN}—{COST_MAX} 的整数。清空一格即视为“缺项”，
          应用时整批拒绝，已生效计划不会被破坏。
        </div>

        {errors.length > 0 && (
          <div className="alert error" role="alert">
            数据被整批拒绝，旧计划保留：
            <ul>
              {errors.map((msg, idx) => (
                <li key={idx}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
        {notice && (
          <div className="alert ok" role="status">
            {notice}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>“先于”关系（可选基准姿态约束）</h2>
        <div className="hint" style={{ marginBottom: 10 }}>
          每条 [a, b] 表示姿态 <b>a 必须先于</b> 姿态 b：规划器只在 a 已访问后才把 b 纳入扩展，
          执行台在 a 确认前会拒绝确认 b。此处只是<b>草稿</b>，与下方费用一起点“校验并应用”
          通过后才生效；非法姿态、自指或依赖成环会被整批拒绝，<b>已应用计划与旧候选不被污染</b>。
          无依赖的旧数据行为完全不变。
        </div>

        <div className="row prereq-add">
          <label>
            前置姿态
            <select
              aria-label="新增先于关系的前置姿态 a"
              value={draftA}
              onChange={(e) => setDraftA(Number(e.target.value))}
            >
              {Array.from({ length: n }, (_, k) => k + 1).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <span className="muted">必须先于</span>
          <label>
            后置姿态
            <select
              aria-label="新增先于关系的后置姿态 b"
              value={draftB}
              onChange={(e) => setB(Number(e.target.value))}
            >
              {Array.from({ length: n }, (_, k) => k + 1).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            aria-label="添加先于关系到草稿"
            onClick={() => addPrereq(draftA, draftB)}
          >
            添加到草稿
          </button>
          {prereqs.length > 0 && (
            <button type="button" className="btn" onClick={() => setPrereqs([])}>
              清空草稿（不影响已生效计划）
            </button>
          )}
        </div>

        {prereqs.length === 0 ? (
          <div className="muted" data-testid="prereq-empty">
            当前草稿无“先于”约束：所有姿态可任意排序，路线即原始非对称 TSP 精确解。
          </div>
        ) : (
          <ul className="prereq-list" data-testid="prereq-list">
            {prereqs.map(([a, b]) => (
              <li key={`${a}-${b}`} className="prereq-item">
                <span>
                  姿态 <b>{a}</b> 必须先于姿态 <b>{b}</b>
                </span>
                <button
                  type="button"
                  className="btn small"
                  aria-label={`删除先于关系 ${a} 先于 ${b}`}
                  onClick={() => removePrereq(a, b)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="hint">
          已生效计划当前带 {(plan.prerequisites ?? []).length} 条约束；草稿 {prereqs.length} 条。
          应用后候选路线与执行台立即在剩余姿态上遵守这些前置条件。
        </div>
      </div>

      <div className="panel">
        <h2>JSON 编辑 / 导入</h2>
        <textarea
          spellCheck={false}
          value={jsonText}
          placeholder={'{\n  "n": 8,\n  "matrix": [\n    [0, 12, 7, ...],\n    ...\n  ]\n}'}
          onChange={(e) => setJsonText(e.target.value)}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={importJson}>
            解析并载入草稿
          </button>
          <span className="muted">
            支持 {'{ "n": 8, "matrix": [[...]] }'} 或裸二维数组；校验通过才进入网格。
          </span>
        </div>
      </div>
    </div>
  );
}
