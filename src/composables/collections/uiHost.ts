// Wire @mulmoclaude/collection-plugin/vue to MulmoClaude's collection REST API +
// asset-URL scheme. Imported for side effect at app startup (src/main.ts) so the
// package's rendering composable can resolve ref/embed data and file/asset URLs.
// MulmoTerminal has its own equivalent shim.
import { configureCollectionUi } from "@mulmoclaude/collection-plugin/vue";
import { apiGet } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { htmlPreviewUrlFor, svgPreviewUrlFor } from "../useContentDisplay";
import { isValidFilePath } from "../useFileSelection";
import { resolveImageSrc } from "../../utils/image/resolve";
import type { CollectionDetailResponse } from "../../components/collectionTypes";

configureCollectionUi({
  fetchCollectionDetail: (slug) => apiGet<CollectionDetailResponse>(API_ROUTES.collections.detail.replace(":slug", encodeURIComponent(slug))),
  fileAssetUrl: (value) => (isValidFilePath(value) ? (htmlPreviewUrlFor(value) ?? svgPreviewUrlFor(value)) : null),
  fileRoutePath: (value) => (isValidFilePath(value) ? `/files/${value.split("/").map(encodeURIComponent).join("/")}` : null),
  imageSrc: (imageData) => resolveImageSrc(imageData),
});
