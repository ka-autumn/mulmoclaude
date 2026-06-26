// Wire @mulmoclaude/accounting-plugin/vue to this host's network client
// and raw pub/sub transport. Side-effect module: imported once from
// main.ts before app.mount(), so the seams are set before any accounting
// View mounts. Mirrors composables/collections/uiHost.ts.
//
// The package ships its own Tailwind utilities (the host's content scan
// doesn't reach node_modules), so we import its stylesheet here too.

import "@mulmoclaude/accounting-plugin/style.css";
import { configureAccountingHost } from "@mulmoclaude/accounting-plugin/vue";
import { apiCall } from "../utils/api";
import { usePubSub } from "./usePubSub";

const { subscribe } = usePubSub();

configureAccountingHost({ apiCall, subscribe });
