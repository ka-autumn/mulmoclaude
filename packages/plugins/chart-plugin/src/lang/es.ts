import type { Messages } from "./messages";

const es: Messages = {
  untitled: "Gráfico",
  chartCount: (count) => `${count} gráfico${count === 1 ? "" : "s"}`,
  chartTitle: (num) => `Gráfico ${num}`,
  png: "PNG",
};

export default es;
