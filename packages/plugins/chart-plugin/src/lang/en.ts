import type { Messages } from "./messages";

const en: Messages = {
  untitled: "Chart",
  chartCount: (count) => `${count} chart${count === 1 ? "" : "s"}`,
  chartTitle: (num) => `Chart ${num}`,
  png: "PNG",
};

export default en;
