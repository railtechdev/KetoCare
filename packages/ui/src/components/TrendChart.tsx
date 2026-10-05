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
import { formatMeasured } from "../lib/format";

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
  /**
   * Форматирование ДАТЫ остаётся за приложением: локаль у него, не у пакета.
   *
   * Значения — наоборот, печатает сам кит (`formatMeasured`): на графике стоят
   * величины, снятые прибором, и правило их записи одно на всю систему
   * (правило П45). Пока числа подставлялись сырыми, на экране дневника «2.7
   * ммоль/л» в подсказке и в текстовой альтернативе стояло рядом с «2,7
   * ммоль/л» в карточке записи — про один и тот же замер.
   */
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
    return (
      <div className={cn("text-muted-foreground", className)}>{emptyState}</div>
    );
  }

  // Recharts работает с числами: даты переводим в миллисекунды и форматируем на осях.
  const data = points
    .map((point) => ({ ts: point.at.getTime(), value: point.value }))
    .sort((a, b) => a.ts - b.ts);

  return (
    // `min-w-0` обязателен: график стоит в колонке (`flex flex-col`), а у
    // элемента флекса `min-width: auto` — он не сжимается уже своего
    // содержимого. Recharts рисует SVG по первому замеру и держит эту ширину,
    // поэтому на экране 360 px дневник уезжал в горизонтальную прокрутку на
    // 54 px. Тот же приём уже применён в примитивах раскладки.
    // `min-w-0` — страховка, а не починка замеченного дефекта: воспроизвести
    // переполнение на настоящем окне 360 px и при повороте не удалось. Но
    // график стоит в колонке (`flex flex-col`), а у элемента флекса
    // `min-width: auto` — он не сжимается уже своего содержимого, и Recharts
    // держит первый замер. Тот же приём стоит в примитивах раскладки по той же
    // причине; здесь его не было.
    <figure className={cn("m-0 min-w-0", className)}>
      <figcaption className="sr-only">{caption}</figcaption>

      {/* Цвета берутся из токенов темы: Mini App перекрашивает интерфейс,
          подставляя themeParams Telegram в те же переменные.
          Имена сверяются тестом: Recharts не умеет ругаться на несуществующую
          переменную — она просто раскрывается в пустую строку, и сетка с осями
          рисуются невидимыми. Именно так и случилось после переименования
          токенов под словарь кита. */}
      <ResponsiveContainer width="100%" height={260}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
        >
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={(ts: number) => formatDate(new Date(ts))}
            stroke="var(--color-muted-foreground)"
            fontSize={12}
          />
          <YAxis
            stroke="var(--color-muted-foreground)"
            fontSize={12}
            width={48}
            tickFormatter={(value: number) => formatMeasured(value)}
            label={{
              value: unit,
              angle: -90,
              position: "insideLeft",
              fontSize: 12,
            }}
          />
          <Tooltip
            // Имени у ряда нет — он на графике один, и подпись «значение»
            // ничего не добавляет. Без `separator` recharts всё равно ставит
            // своё « : » между пустым именем и числом, и подсказка читалась
            // как «08.09 : 2,8 ммоль/л» — с двоеточием, повисшим в воздухе.
            separator=""
            labelFormatter={(ts) => formatDate(new Date(Number(ts)))}
            formatter={(value: number) => [
              `${formatMeasured(value)} ${unit}`,
              "",
            ]}
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              color: "var(--color-foreground)",
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
            stroke="var(--color-chart-1)"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Текстовая альтернатива: линию скринридер не прочитает, а данные нужны всем.
          `sr-only` — на обёртке, а не на самой таблице: таблица не сжимается
          уже своего содержимого и ширину 1 px игнорирует, поэтому на 360 px
          невидимая таблица из тридцати строк распирала экран до 401 px и
          давала горизонтальную прокрутку (замер 05.10.2026, Mini App). */}
      <div className="sr-only" data-testid="trend-text-alternative">
        <table>
          <caption>{caption}</caption>
          <tbody>
            {data.map((point) => (
              <tr key={point.ts}>
                <th scope="row">{formatDate(new Date(point.ts))}</th>
                <td>
                  {formatMeasured(point.value)} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
