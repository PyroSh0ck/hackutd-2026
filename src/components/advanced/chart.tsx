import { useId } from "react";
import s from "@visual/advanced.module.css";
export type ChartPoint = { label: string; value: number };
export type ChartProps = {
  title: string;
  data: readonly ChartPoint[];
  kind: "line" | "bar" | "donut";
  loading?: boolean;
  error?: string;
  unit?: string;
};
const palette = [
  "#2458d3",
  "#16856b",
  "#a85419",
  "#8550bb",
  "#bf3663",
  "#53752c",
];
export function Chart({
  title,
  data,
  kind,
  loading = false,
  error,
  unit = "",
}: ChartProps) {
  const id = useId();
  const points = data.filter((p) => Number.isFinite(p.value));
  if (loading)
    return (
      <section aria-label={title}>
        <p role="status">Loading chart…</p>
      </section>
    );
  if (error)
    return (
      <section aria-label={title}>
        <p role="alert">{error}</p>
      </section>
    );
  if (!points.length)
    return (
      <section aria-label={title}>
        <p>No chart data.</p>
      </section>
    );
  if (
    kind === "donut" &&
    (points.some((p) => p.value < 0) || points.every((p) => p.value === 0))
  )
    return (
      <section aria-label={title}>
        <p role="status">
          A donut chart requires nonnegative values with a positive total.
        </p>
      </section>
    );
  const low = Math.min(0, ...points.map((p) => p.value)),
    high = Math.max(0, ...points.map((p) => p.value)),
    span = high - low || 1;
  const y = (value: number) => 220 - ((value - low) / span) * 180;
  const x = (i: number) =>
    60 + (points.length === 1 ? 230 : (i * 460) / (points.length - 1));
  const total = points.reduce((sum, p) => sum + p.value, 0);
  let offset = 0;
  return (
    <figure className={s.chart}>
      <figcaption id={id}>{title}</figcaption>
      <svg
        viewBox="0 0 580 260"
        role="img"
        aria-labelledby={id}
        aria-describedby={`${id}-description`}
      >
        <desc id={`${id}-description`}>
          Values are listed in the data table below.
        </desc>
        {kind === "donut" ? (
          points.map((p, i) => {
            const percent = (p.value / total) * 100;
            const before = offset;
            offset += percent;
            return (
              <circle
                key={`${p.label}-${i}`}
                cx="290"
                cy="130"
                r="85"
                fill="none"
                stroke={palette[i % palette.length]}
                strokeWidth="35"
                pathLength="100"
                strokeDasharray={`${percent} ${100 - percent}`}
                strokeDashoffset={-before}
                transform="rotate(-90 290 130)"
              >
                <title>
                  {p.label}: {p.value}
                  {unit}
                </title>
              </circle>
            );
          })
        ) : (
          <>
            <line x1="50" x2="540" y1={y(0)} y2={y(0)} stroke="currentColor" />
            <text x="5" y="40">
              {high}
            </text>
            <text x="5" y="220">
              {low}
            </text>
            {kind === "line" ? (
              <>
                <polyline
                  points={points
                    .map((p, i) => `${x(i)},${y(p.value)}`)
                    .join(" ")}
                  fill="none"
                  stroke={palette[0]}
                  strokeWidth="3"
                />
                {points.map((p, i) => (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(p.value)}
                    r="4"
                    fill={palette[0]}
                  >
                    <title>
                      {p.label}: {p.value}
                      {unit}
                    </title>
                  </circle>
                ))}
              </>
            ) : (
              points.map((p, i) => {
                const width = 460 / points.length;
                return (
                  <rect
                    key={i}
                    x={60 + i * width}
                    y={Math.min(y(p.value), y(0))}
                    width={width * 0.75}
                    height={Math.abs(y(p.value) - y(0))}
                    fill={palette[0]}
                  >
                    <title>
                      {p.label}: {p.value}
                      {unit}
                    </title>
                  </rect>
                );
              })
            )}
            {points.map((p, i) => (
              <text
                key={i}
                x={
                  kind === "line"
                    ? x(i)
                    : 60 + ((i + 0.375) * 460) / points.length
                }
                y="246"
                textAnchor="middle"
                fontSize="11"
              >
                {p.label.length > 10 ? p.label.slice(0, 9) + "…" : p.label}
              </text>
            ))}
          </>
        )}
      </svg>
      <details>
        <summary>View chart data</summary>
        <table className={s.table}>
          <caption>{title} values</caption>
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">Value{unit ? ` (${unit})` : ""}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <th scope="row">{p.label}</th>
                <td>{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
