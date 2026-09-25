/** 路线渲染：节点 + 逐边费用；已访问姿态可标绿，停放位 0 用暖色描边。 */

interface RouteLineProps {
  tour: number[];
  edgeAt: (a: number, b: number) => number;
  visited?: Set<number>;
  /** 不显示逐边费用（候选集列表里可省） */
  hideEdgeCost?: boolean;
}

export function RouteLine({ tour, edgeAt, visited, hideEdgeCost }: RouteLineProps) {
  const done = visited ?? new Set<number>();
  const unique: number[] = [];
  for (let i = 0; i < tour.length; i++) {
    if (i === 0 || tour[i] !== tour[i - 1]) unique.push(tour[i]!);
  }
  return (
    <div className="route-line">
      {unique.map((node, idx) => {
        const next = unique[idx + 1];
        const isHome = node === 0;
        const isDone = done.has(node);
        return (
          <span key={idx}>
            <span className={['node', isHome ? 'home' : '', isDone ? 'done' : ''].join(' ')}>
              {isHome ? '0 停放' : node}
            </span>
            {next !== undefined && (
              <>
                <span className="arrow">→</span>
                {!hideEdgeCost && <span className="edgecost">[{edgeAt(node, next)}]</span>}
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
