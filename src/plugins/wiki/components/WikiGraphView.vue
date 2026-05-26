<template>
  <div ref="container" class="w-full h-full" data-testid="wiki-graph-canvas" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts";
import type { WikiGraph } from "../../../lib/wiki-page/graph";

const props = defineProps<{ graph: WikiGraph }>();
const emit = defineEmits<{ navigate: [slug: string] }>();

const container = ref<HTMLDivElement | null>(null);
// Managed imperatively — not a `ref` — so ECharts internals don't get
// wrapped in Vue reactivity (mirrors the chart plugin's View.vue).
let instance: echarts.ECharts | null = null;

function buildOption(graph: WikiGraph): echarts.EChartsCoreOption {
  return {
    tooltip: { show: true },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        label: { show: true, position: "right", fontSize: 11 },
        force: { repulsion: 140, edgeLength: 90, gravity: 0.08 },
        emphasis: { focus: "adjacency" },
        lineStyle: { color: "#cbd5e1", width: 1, curveness: 0 },
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 6,
        itemStyle: { color: "#3b82f6" },
        symbolSize: 18,
        data: graph.nodes.map((node) => ({ id: node.slug, name: node.title })),
        links: graph.edges.map((edge) => ({ source: edge.from, target: edge.to })),
      },
    ],
  };
}

function render(): void {
  const element = container.value;
  if (!element) return;
  if (!instance) {
    instance = echarts.init(element);
    instance.on("click", (params) => {
      if (params.dataType !== "node") return;
      const nodeId = (params.data as { id?: unknown } | null | undefined)?.id;
      if (typeof nodeId === "string") emit("navigate", nodeId);
    });
  }
  instance.setOption(buildOption(props.graph), true);
}

function handleResize(): void {
  instance?.resize();
}

onMounted(() => {
  queueMicrotask(render);
  window.addEventListener("resize", handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  instance?.dispose();
  instance = null;
});

watch(
  () => props.graph,
  () => queueMicrotask(render),
);
</script>
