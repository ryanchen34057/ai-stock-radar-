import { useStockCapacity, type CapacityItem, type CapacitySource } from '../hooks/useStockCapacity';

interface Props {
  symbol: string;
  name: string;
}

/**
 * Capacity-analysis block for the detail modal.
 *
 * Surfaces (a) MOPS/news items mentioning capacity keywords (擴產, 月產能,
 * 資本支出, 法說會 …) and (b) curated deep-links to the authoritative
 * primary sources a serious capacity read-through should visit:
 *   法說會 (MOPS + YouTube) → 年報 / 重大訊息 → 鉅亨 / Goodinfo / MoneyDJ
 */
export default function CapacitySection({ symbol, name }: Props) {
  const { data, loading } = useStockCapacity(symbol);

  if (loading) {
    return (
      <div className="border-t border-border-c pt-4">
        <div className="text-xs text-text-t animate-pulse py-3">載入產能分析中...</div>
      </div>
    );
  }

  const sources = data?.primary_sources ?? [];
  const grouped = groupBy(sources, (s) => s.category);
  const categoryOrder = ['法說會', '年報', '產業研究'];

  return (
    <div className="border-t border-border-c pt-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text-p mb-1">產能分析</h3>
        <p className="text-[11px] text-text-t leading-relaxed">
          此處聚合「擴產 / 月產能 / 資本支出 / 法說會」等關鍵字之近期公告與新聞，
          並附上官方與研究機構之深度資料連結。核心的產能數字仍需從
          <span className="text-text-s mx-1">法說會簡報</span>
          與
          <span className="text-text-s mx-1">年報營運概況章節</span>
          中查證。
        </p>
      </div>

      {/* A. Filtered MOPS */}
      {data && data.capacity_mops.length > 0 && (
        <div>
          <SubHead label="公告擴產 / 資本支出 (MOPS)" count={data.capacity_mops.length} />
          <div className="space-y-1.5">
            {data.capacity_mops.map((m, i) => (
              <CapacityRow key={i} item={m} kind="mops" />
            ))}
          </div>
        </div>
      )}

      {/* B. Filtered news */}
      {data && data.capacity_news.length > 0 && (
        <div>
          <SubHead label="產能相關新聞" count={data.capacity_news.length} />
          <div className="space-y-1.5">
            {data.capacity_news.map((n, i) => (
              <CapacityRow key={i} item={n} kind="news" />
            ))}
          </div>
        </div>
      )}

      {/* C. Primary sources — always shown, grouped */}
      <div>
        <SubHead label="權威資料源" />
        <div className="space-y-3">
          {categoryOrder.map((cat) => {
            const items = grouped[cat];
            if (!items || items.length === 0) return null;
            return (
              <div key={cat}>
                <div className="text-[10px] uppercase tracking-wide text-text-t mb-1.5">{cat}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {items.map((s) => (
                    <SourceCard key={s.name} source={s} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* D. Zero-hit fallback */}
      {data && data.capacity_mops.length === 0 && data.capacity_news.length === 0 && (
        <div className="text-[11px] text-text-t bg-card-bg/60 border border-border-c rounded p-3">
          近期快取中未偵測到 <span className="text-text-s">{name}</span> 之產能關鍵字訊息。
          建議從上方「法說會」與「年報」連結直接查閱最新一季簡報。
        </div>
      )}
    </div>
  );
}

function CapacityRow({ item, kind }: { item: CapacityItem; kind: 'mops' | 'news' }) {
  const badgeCls =
    kind === 'mops'
      ? 'bg-accent/10 text-accent border border-accent/30'
      : 'bg-white/5 text-text-s border border-border-c';
  return (
    <a
      href={item.url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-2 items-start text-xs text-text-p hover:text-accent transition-colors group"
    >
      <span className="text-text-t font-mono w-[72px] shrink-0">{item.date || '—'}</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${badgeCls}`}>
        {item.matched_keyword}
      </span>
      <span className="flex-1 leading-snug group-hover:underline">{item.title}</span>
    </a>
  );
}

function SourceCard({ source }: { source: CapacitySource }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col gap-0.5 px-3 py-2 rounded border border-border-c
                 hover:border-accent hover:bg-accent/5 transition-colors group"
    >
      <span className="text-xs text-text-p group-hover:text-accent">
        {source.name} <span className="text-text-t">↗</span>
      </span>
      <span className="text-[10px] text-text-t leading-snug">{source.desc}</span>
    </a>
  );
}

function SubHead({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h4 className="text-xs font-semibold text-text-s uppercase tracking-wide">{label}</h4>
      {count !== undefined && count > 0 && (
        <span className="text-[10px] text-text-t font-mono">({count})</span>
      )}
    </div>
  );
}

function groupBy<T, K extends string>(arr: T[], keyFn: (x: T) => K): Record<K, T[]> {
  return arr.reduce((acc, x) => {
    const k = keyFn(x);
    (acc[k] = acc[k] || []).push(x);
    return acc;
  }, {} as Record<K, T[]>);
}
