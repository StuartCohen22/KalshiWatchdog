import { useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useNavigate } from "react-router-dom";

import type { AnomalyRecord, KnownCase } from "../types";

const COLOR_HUB = "#00f0ff";
const COLOR_ANOMALY = "#ff2a6d";
const COLOR_CASE = "#f59e0b";

const SEVERITY_R: Record<string, number> = {
  CRITICAL: 8,
  HIGH: 6,
  MEDIUM: 5,
  LOW: 4,
};

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "#ff2a6d",
  HIGH: "#ff9e64",
  MEDIUM: "#f59e0b",
  LOW: "#64748b",
};

const TYPE_LABEL: Record<string, string> = {
  coordinated: "Coordinated activity",
  golden_window: "Golden window",
  volume_spike: "Volume spike",
};

interface GraphNode {
  id: string;
  label: string;
  nodeType: "hub" | "anomaly" | "case";
  anomalyId?: string;
  severity?: string;
  anomalyType?: string;
  totalVolume?: number;
  zScore?: number;
  r: number;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
}

function buildGraph(
  anomalies: AnomalyRecord[],
  knownCases: KnownCase[],
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [
    { id: "watchdog", label: "WATCHDOG", nodeType: "hub", r: 10 },
  ];
  const links: GraphLink[] = [];

  for (const a of anomalies.slice(0, 12)) {
    nodes.push({
      id: a.anomaly_id,
      label: a.market_title,
      nodeType: "anomaly",
      anomalyId: a.anomaly_id,
      severity: a.severity,
      anomalyType: a.anomaly_type,
      totalVolume: a.total_volume,
      zScore: (a as AnomalyRecord & { z_score?: number }).z_score,
      r: SEVERITY_R[a.severity] ?? 5,
    });
    links.push({ source: "watchdog", target: a.anomaly_id });
  }

  for (const c of knownCases.slice(0, 4)) {
    nodes.push({ id: c.id, label: c.title, nodeType: "case", r: 6 });
    links.push({ source: "watchdog", target: c.id });
  }

  return { nodes, links };
}

function nodeColor(node: GraphNode): string {
  if (node.nodeType === "hub") return COLOR_HUB;
  if (node.nodeType === "case") return COLOR_CASE;
  return SEVERITY_COLOR[node.severity ?? ""] ?? COLOR_ANOMALY;
}

function nodeCanvasObject(
  node: GraphNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const r = node.r;
  const color = nodeColor(node);

  // Animated pulse glow
  const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 600);
  const glowAlpha = Math.round(pulse * 40).toString(16).padStart(2, "0");

  ctx.shadowColor = color;
  ctx.shadowBlur = 15 * pulse;

  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
  ctx.fillStyle = color + glowAlpha;
  ctx.fill();

  ctx.shadowBlur = 0;

  // Filled node
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();

  // Label
  const fontSize = Math.max(10 / globalScale, 3);
  const label = node.label.length > 24 ? `${node.label.slice(0, 22)}…` : node.label;
  ctx.font = `${fontSize}px JetBrains Mono, monospace`;
  ctx.fillStyle = "#9e9e9e";
  ctx.textAlign = "center";
  ctx.fillText(label, x, y + r + fontSize + 2);
}

function NodePanel({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const navigate = useNavigate();
  const sevColor = SEVERITY_COLOR[node.severity ?? ""] ?? "#64748b";

  return (
    <div className="flex w-[200px] shrink-0 flex-col gap-3 border-l border-border-default p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-tertiary">
          {node.nodeType === "case" ? "known case" : "anomaly"}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-text-tertiary hover:text-text-secondary"
        >
          ×
        </button>
      </div>

      <p className="text-sm font-medium leading-5 text-text-primary">
        {node.label.length > 48 ? `${node.label.slice(0, 46)}…` : node.label}
      </p>

      {node.anomalyType && (
        <p className="text-xs text-text-secondary">
          {TYPE_LABEL[node.anomalyType] ?? node.anomalyType}
        </p>
      )}

      <div className="space-y-2 text-xs">
        {node.severity && (
          <div className="flex items-center justify-between">
            <span className="text-text-tertiary">Severity</span>
            <span className="font-semibold" style={{ color: sevColor }}>{node.severity}</span>
          </div>
        )}
        {node.totalVolume != null && node.totalVolume > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-text-tertiary">Volume</span>
            <span className="font-mono text-text-primary">${Math.round(node.totalVolume).toLocaleString()}</span>
          </div>
        )}
        {node.zScore != null && (
          <div className="flex items-center justify-between">
            <span className="text-text-tertiary">Z-score</span>
            <span className="font-mono text-text-primary">{node.zScore.toFixed(1)}</span>
          </div>
        )}
      </div>

      {node.anomalyId && (
        <button
          type="button"
          onClick={() => navigate(`/anomalies/${node.anomalyId}`)}
          className="mt-auto text-left text-xs text-[var(--accent)] hover:underline"
        >
          View full case →
        </button>
      )}
    </div>
  );
}

export function ForceGraph({
  anomalies,
  knownCases,
}: {
  anomalies: AnomalyRecord[];
  knownCases: KnownCase[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const HEIGHT = 300;

  const { nodes, links } = buildGraph(anomalies, knownCases);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handleNodeClick(node: GraphNode) {
    setSelectedNode((prev) => (prev?.id === node.id ? null : node));
  }

  const graphWidth = selectedNode ? Math.max(width - 200, 200) : width;

  return (
    <div className="panel">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Entity map</p>
          <h2 className="font-mono text-lg font-semibold uppercase tracking-[0.12em] text-text-primary">
            Surveillance link view
          </h2>
        </div>
        <div className="flex items-center gap-4 text-xs uppercase tracking-[0.14em] text-text-tertiary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR_ANOMALY }} />
            anomaly
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR_CASE }} />
            known case
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR_HUB }} />
            hub
          </span>
        </div>
      </div>

      <div
        className="flex overflow-hidden rounded-[20px] border border-border-default"
        style={{ height: HEIGHT, background: "#05050a" }}
      >
        <div ref={containerRef} className="flex-1 overflow-hidden">
          <ForceGraph2D
            graphData={{ nodes: nodes as never[], links: links as never[] }}
            width={graphWidth}
            height={HEIGHT}
            backgroundColor="#05050a"
            nodeRelSize={1}
            nodeCanvasObject={nodeCanvasObject as never}
            nodeCanvasObjectMode={() => "replace"}
            onNodeClick={handleNodeClick as never}
            linkColor={() => "rgba(0,240,255,0.10)"}
            linkWidth={0.8}
            linkDirectionalParticles={2}
            linkDirectionalParticleSpeed={0.004}
            linkDirectionalParticleWidth={1.5}
            linkDirectionalParticleColor={() => "rgba(0, 240, 255, 0.5)"}
            d3AlphaDecay={0.04}
            d3VelocityDecay={0.35}
            cooldownTicks={Infinity}
            nodeLabel={(node: GraphNode) =>
              `${node.label} — ${node.nodeType}${node.severity ? ` (${node.severity})` : ""}`
            }
          />
        </div>
        {selectedNode && (
          <NodePanel node={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
      </div>
    </div>
  );
}
