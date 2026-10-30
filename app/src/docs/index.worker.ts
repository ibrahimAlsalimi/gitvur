import { indexDocs } from "./indexDocs";
import type { ModelNode } from "../model/buildModel";
self.onmessage = (
  event: MessageEvent<{
    docs: { path: string; title: string; text: string }[];
    nodes: ModelNode[];
  }>,
) => {
  self.postMessage(indexDocs(event.data.docs, event.data.nodes));
};
