import { BackdropRenderer, StepRenderer, TraceCardRenderer } from "./FlowNodes";

/** Defined once, outside components, so React Flow never sees a new object. */
export const flowNodeTypes = {
  step: StepRenderer,
  trace: TraceCardRenderer,
  backdrop: BackdropRenderer,
};
