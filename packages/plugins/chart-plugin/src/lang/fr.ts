import type { Messages } from "./messages";

const fr: Messages = {
  untitled: "Graphique",
  chartCount: (count) => `${count} graphique${count === 1 ? "" : "s"}`,
  chartTitle: (num) => `Graphique ${num}`,
  png: "PNG",
};

export default fr;
