import type { Messages } from "./messages";

const de: Messages = {
  untitled: "Diagramm",
  chartCount: (count) => `${count} Diagramm${count === 1 ? "" : "e"}`,
  chartTitle: (num) => `Diagramm ${num}`,
  png: "PNG",
};

export default de;
