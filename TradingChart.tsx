"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CandlestickData,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineData,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

import type { CandleDTO, SignalDTO } from "@/lib/client/types";

interface Props {
  candles: CandleDTO[];
  overlays: {
    ema21: { time: number; value: number }[];
    ema50: { time: number; value: number }[];
    ema200: { time: number; value: number }[];
  };
  signal: SignalDTO | null;
  digits: number;
  instrumentLabel: string;
  timeframeLabel: string;
  livePrice: number;
  loading?: boolean;
}

const MINT = "#12e39a";
const ROSE = "#ff4d6a";
const AMBER = "#f7b955";
const AZURE = "#4d8dff";

export default function TradingChart({
  candles,
  overlays,
  signal,
  digits,
  instrumentLabel,
  timeframeLabel,
  livePrice,
  loading,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaRefs = useRef<Record<string, ISeriesApi<"Line"> | null>>({});
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const markerPluginRef = useRef<{ setMarkers: (m: unknown[]) => void } | null>(null);
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<CandleDTO | null>(null);

  /* ---- create chart once ---- */
  useEffect(() => {
    let disposed = false;
    let cleanupResize: (() => void) | undefined;

    (async () => {
      const lwc = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      const chart = lwc.createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { type: lwc.ColorType.Solid, color: "transparent" },
          textColor: "#7d8ba6",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: "rgba(34,46,72,0.35)" },
          horzLines: { color: "rgba(34,46,72,0.35)" },
        },
        rightPriceScale: {
          borderColor: "rgba(44,60,94,0.8)",
          scaleMargins: { top: 0.12, bottom: 0.14 },
        },
        timeScale: {
          borderColor: "rgba(44,60,94,0.8)",
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 6,
          barSpacing: 8,
        },
        crosshair: {
          mode: lwc.CrosshairMode.Normal,
          vertLine: { color: "rgba(125,139,166,0.45)", width: 1, style: lwc.LineStyle.Dashed, labelBackgroundColor: "#16203a" },
          horzLine: { color: "rgba(125,139,166,0.45)", width: 1, style: lwc.LineStyle.Dashed, labelBackgroundColor: "#16203a" },
        },
        localization: {
          priceFormatter: (p: number) =>
            p.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }),
        },
      });

      const candleSeries = chart.addSeries(lwc.CandlestickSeries, {
        upColor: "rgba(18,227,154,0.92)",
        downColor: "rgba(255,77,106,0.92)",
        wickUpColor: "rgba(18,227,154,0.65)",
        wickDownColor: "rgba(255,77,106,0.65)",
        borderVisible: false,
        priceFormat: { type: "price", precision: digits, minMove: 1 / 10 ** digits },
      });

      emaRefs.current.ema21 = chart.addSeries(lwc.LineSeries, {
        color: "rgba(247,185,85,0.95)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      emaRefs.current.ema50 = chart.addSeries(lwc.LineSeries, {
        color: "rgba(77,141,255,0.9)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      emaRefs.current.ema200 = chart.addSeries(lwc.LineSeries, {
        color: "rgba(160,174,201,0.75)",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      markerPluginRef.current = lwc.createSeriesMarkers(candleSeries, []) as unknown as {
        setMarkers: (m: unknown[]) => void;
      };

      chart.subscribeCrosshairMove((param) => {
        const data = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
        if (!data || param.time === undefined) {
          setHover(null);
          return;
        }
        setHover({
          time: Number(param.time),
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: 0,
        });
      });

      chartRef.current = chart;
      candleRef.current = candleSeries;
      setReady(true);

      const handle = () => chart.applyOptions({});
      window.addEventListener("resize", handle);
      cleanupResize = () => window.removeEventListener("resize", handle);
    })();

    return () => {
      disposed = true;
      cleanupResize?.();
      chartRef.current?.remove();
      chartRef.current = null;
      candleRef.current = null;
      emaRefs.current = {};
      priceLinesRef.current = [];
      markerPluginRef.current = null;
      setReady(false);
    };
  }, [digits]);

  /* ---- feed data ---- */
  useEffect(() => {
    if (!ready || !candleRef.current || !candles.length) return;
    const data: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleRef.current.setData(data);

    const toLine = (points: { time: number; value: number }[]): LineData<Time>[] =>
      points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
    emaRefs.current.ema21?.setData(toLine(overlays.ema21));
    emaRefs.current.ema50?.setData(toLine(overlays.ema50));
    emaRefs.current.ema200?.setData(toLine(overlays.ema200));
  }, [candles, overlays, ready]);

  /* ---- entry / SL / TP levels + markers ---- */
  useEffect(() => {
    const series = candleRef.current;
    if (!ready || !series) return;

    priceLinesRef.current.forEach((line) => series.removePriceLine(line));
    priceLinesRef.current = [];
    markerPluginRef.current?.setMarkers([]);
    if (!signal) return;

    const fmt = (v: number) =>
      v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

    const levels = [
      { price: signal.takeProfit, color: MINT, title: `TP ${fmt(signal.takeProfit)}`, width: 2 as const, style: 0 },
      { price: signal.takeProfit1, color: "rgba(18,227,154,0.55)", title: `TP1 ${fmt(signal.takeProfit1)}`, width: 1 as const, style: 2 },
      { price: signal.entry, color: AMBER, title: `ENTRY ${fmt(signal.entry)}`, width: 2 as const, style: 0 },
      { price: signal.stopLoss, color: ROSE, title: `SL ${fmt(signal.stopLoss)}`, width: 2 as const, style: 0 },
    ];
    for (const level of levels) {
      priceLinesRef.current.push(
        series.createPriceLine({
          price: level.price,
          color: level.color,
          lineWidth: level.width,
          lineStyle: level.style,
          axisLabelVisible: true,
          title: level.title,
        }),
      );
    }

    markerPluginRef.current?.setMarkers([
      {
        time: signal.signalBarTime as UTCTimestamp,
        position: signal.direction === "BUY" ? "belowBar" : "aboveBar",
        color: signal.direction === "BUY" ? MINT : ROSE,
        shape: signal.direction === "BUY" ? "arrowUp" : "arrowDown",
        text: `${signal.direction} ${signal.confidence}%`,
      },
    ]);
  }, [signal, ready, digits]);

  /* ---- animated TP / SL zones drawn over the canvas ---- */
  useEffect(() => {
    if (!ready || !signal || !zoneRef.current) return;
    let frame = 0;
    const paint = () => {
      const series = candleRef.current;
      const host = zoneRef.current;
      if (series && host) {
        try {
          const yEntry = series.priceToCoordinate(signal.entry);
          const yTp = series.priceToCoordinate(signal.takeProfit);
          const ySl = series.priceToCoordinate(signal.stopLoss);
          if (yEntry != null && yTp != null && ySl != null) {
            const tpTop = Math.min(yEntry, yTp);
            const tpHeight = Math.abs(yEntry - yTp);
            const slTop = Math.min(yEntry, ySl);
            const slHeight = Math.abs(yEntry - ySl);
            host.style.opacity = "1";
            const tpEl = host.children[0] as HTMLDivElement;
            const slEl = host.children[1] as HTMLDivElement;
            tpEl.style.transform = `translateY(${tpTop}px)`;
            tpEl.style.height = `${tpHeight}px`;
            slEl.style.transform = `translateY(${slTop}px)`;
            slEl.style.height = `${slHeight}px`;
          }
        } catch {
          /* chart disposed */
        }
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [ready, signal]);

  const shown = hover ?? candles[candles.length - 1] ?? null;
  const up = shown ? shown.close >= shown.open : true;
  const fmtVal = (v: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-2xl border border-[#1a2338] bg-[#070b14] sm:h-[500px]">
      <div ref={containerRef} className="absolute inset-0" />

      {/* TP / SL zones */}
      <div ref={zoneRef} className="pointer-events-none absolute inset-0 opacity-0 transition-opacity">
        <div className="absolute left-0 right-[68px] bg-[linear-gradient(90deg,rgba(18,227,154,0.16),rgba(18,227,154,0.04))] border-y border-[rgba(18,227,154,0.25)]" />
        <div className="absolute left-0 right-[68px] bg-[linear-gradient(90deg,rgba(255,77,106,0.16),rgba(255,77,106,0.04))] border-y border-[rgba(255,77,106,0.25)]" />
      </div>

      {/* legend */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-[#10192b]/90 px-2 py-1 text-[11px] font-semibold tracking-widest text-slate-200">
            {instrumentLabel}
          </span>
          <span className="rounded-md bg-[#10192b]/90 px-2 py-1 text-[11px] font-semibold tracking-widest text-[var(--color-azure)]">
            {timeframeLabel}
          </span>
          <span className="num rounded-md bg-[#10192b]/90 px-2 py-1 text-[11px] text-slate-300">
            {fmtVal(livePrice)}
          </span>
        </div>
        {shown ? (
          <div className="num flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-[#0b1220]/80 px-2 py-1 text-[10px] text-slate-400">
            <span>O {fmtVal(shown.open)}</span>
            <span>H {fmtVal(shown.high)}</span>
            <span>L {fmtVal(shown.low)}</span>
            <span className={up ? "text-[var(--color-mint)]" : "text-[var(--color-rose)]"}>
              C {fmtVal(shown.close)}
            </span>
          </div>
        ) : null}
        <div className="flex gap-3 rounded-md bg-[#0b1220]/70 px-2 py-1 text-[10px] text-slate-400">
          <span className="flex items-center gap-1">
            <i className="h-[2px] w-3 rounded" style={{ background: AMBER }} /> EMA21
          </span>
          <span className="flex items-center gap-1">
            <i className="h-[2px] w-3 rounded" style={{ background: AZURE }} /> EMA50
          </span>
          <span className="flex items-center gap-1">
            <i className="h-[2px] w-3 rounded bg-slate-400" /> EMA200
          </span>
        </div>
      </div>

      {loading ? (
        <div className="absolute right-3 top-3 rounded-md bg-[#10192b]/90 px-2 py-1 text-[10px] tracking-widest text-slate-400">
          SYNCING…
        </div>
      ) : null}

      {!candles.length ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          Loading market data…
        </div>
      ) : null}
    </div>
  );
}
