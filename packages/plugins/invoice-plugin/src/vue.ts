import View from "./View.vue";
import Preview from "./Preview.vue";
import { TOOL_DEFINITION } from "./definition";

export const plugin = {
  toolDefinition: TOOL_DEFINITION,
  viewComponent: View,
  previewComponent: Preview,
};
