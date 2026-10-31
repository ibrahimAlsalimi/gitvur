//! Issue codes for entry points and flows. Stable identifiers, shown in the UI.

pub const ENTRY_DANGLING_TARGET: &str = "entry-dangling-target";
pub const ENTRY_NO_EVIDENCE: &str = "entry-no-evidence";
pub const ENTRY_DUPLICATES_STATIC: &str = "entry-duplicates-static";
pub const ENTRY_BAD_ID: &str = "entry-bad-id";
pub const ENTRY_BAD_PROVENANCE: &str = "entry-bad-provenance";
pub const ENTRY_EVIDENCE_OUT_OF_RANGE: &str = "entry-evidence-out-of-range";
pub const ENTRY_EVIDENCE_MISMATCH: &str = "entry-evidence-mismatch";
pub const FLOW_BAD_ID: &str = "flow-bad-id";
pub const FLOW_DANGLING_ENTRY: &str = "flow-dangling-entry";
pub const FLOW_DANGLING_STEP: &str = "flow-dangling-step";
pub const FLOW_DUPLICATE_STEP_ID: &str = "flow-duplicate-step-id";
pub const FLOW_BAD_TRANSITION_REF: &str = "flow-bad-transition-ref";
pub const FLOW_CALL_UNSUPPORTED: &str = "flow-call-unsupported";
pub const FLOW_RETURN_UNSUPPORTED: &str = "flow-return-unsupported";
pub const FLOW_TRANSITION_NO_EVIDENCE: &str = "flow-transition-no-evidence";
pub const FLOW_EVIDENCE_OUT_OF_RANGE: &str = "flow-evidence-out-of-range";
pub const FLOW_EVIDENCE_MISMATCH: &str = "flow-evidence-mismatch";
pub const FLOW_TRANSITION_SHOULD_BE_STATIC: &str = "flow-transition-should-be-static";
pub const FLOW_BRANCH_NO_LABEL: &str = "flow-branch-no-label";
pub const FLOW_UNREACHABLE_STEP: &str = "flow-unreachable-step";
pub const FLOW_TOO_LONG: &str = "flow-too-long";
pub const FLOW_LABEL_TOO_LONG: &str = "flow-label-too-long";

/// Flows with more steps than this get `flow-too-long`.
pub const MAX_FLOW_STEPS: usize = 25;
/// Step labels longer than this many characters get `flow-label-too-long`.
pub const MAX_STEP_LABEL_CHARS: usize = 60;
