import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "../lib/cn";

export interface TrendPoint {
  /** Момент измерения */
  at: Date;
  value: number;
}

export interface PrescriptionMarker {
  /** Дата вступления версии назначения в силу */
  at: Date;
  label: string;
}

export interface TrendChartProps {
  points: TrendPoint[];
  /**
   * Вертикальные маркеры смены назначения (раздел 8.2 ТЗ).
   *
   * Без них график динамики вводит в заблуждение: скачок показателя после смены
   * назначения выглядит как ухудшение состояния, хотя это следствие изменённой
   * терапии.
   */
  markers?: PrescriptionMarker[];
  /** Подпись оси значений — например «ммоль/л» или «кг» */
  unit: string;
  /** Доступное описание графика: скринридер не видит линию */
  caption: string;
  emptyState: React.ReactNode;
  /** Форматирование даты остаётся за приложением: локаль у него, не у пакета */
  formatDate: (value: Date) => string;
  className?: string;
}

/** График динамики показателя с маркерами смены назначения (раздел 8.2 ТЗ). */
export function TrendChart({
  points,
  markers = [],
  unit,
  caption,
  emptyState,
  formatDate,
  className,
}: TrendChartProps) {
  if (points.length === 0) {
    return <div className={cn("text-muted", className)}>{emptyState}</div>;
  }

  // Recharts работает с числами: даты переводим в миллисекунды и форматируем на осях.
  const data = points
    .map((point) => ({ ts: point.at.getTime(), value: point.value }))
    .sort((a, b) => a.ts - b.ts);

  return (
    <figure className={cn("m-0", className)}>
      <figcaption className="sr-only">{caption}</figcaption>

      {/* Цвета берутся из токенов темы: Mini App перекрашивает интерфейс,
          подставляя themeParams Telegram в те же переменные. */}
      <ResponsiveContainer width="100%" height={260}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
        >
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={(ts: number) => formatDate(new Date(ts))}
            stroke="var(--color-muted)"
            fontSize={12}
          />
          <YAxis
            stroke="var(--color-muted)"
            fontSize={12}
            width={48}
            label={{
              value: unit,
              angle: -90,
              position: "insideLeft",
              fontSize: 12,
            }}
          />
          <Tooltip
            labelFormatter={(ts) => formatDate(new Date(Number(ts)))}
            formatter={(value: number) => [`${value} ${unit}`, ""]}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: "var(--radius-kc)",
              color: "var(--color-ink)",
            }}
          />

          {markers.map((marker) => (
            <ReferenceLine
              key={`${marker.at.getTime()}-${marker.label}`}
              x={marker.at.getTime()}
              stroke="var(--color-warning)"
              strokeDasharray="4 4"
              label={{ value: marker.label, position: "top", fontSize: 11 }}
            />
          ))}

          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Текстовая альтернатива: линию скринридер не прочитает, а данные нужны всем. */}
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((point) => (
            <tr key={point.ts}>
              <th scope="row">{formatDate(new Date(point.ts))}</th>
              <td>
                {point.value} {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
