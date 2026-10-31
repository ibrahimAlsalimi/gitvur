//! Issue codes. They are shown in the UI, so they are stable identifiers.

pub const SCHEMA_INVALID: &str = "schema-invalid";
pub const DANGLING_REF: &str = "dangling-ref";
pub const MODULE_NOT_MODULE: &str = "module-not-module";
pub const FILE_UNASSIGNED: &str = "file-unassigned";
pub const FILE_MULTI_ASSIGNED: &str = "file-multi-assigned";
pub const AI_EDGE_NO_EVIDENCE: &str = "ai-edge-no-evidence";
pub const AI_EDGE_EVIDENCE_OUT_OF_RANGE: &str = "ai-edge-evidence-out-of-range";
pub const AI_EDGE_EVIDENCE_MISMATCH: &str = "ai-edge-evidence-mismatch";
pub const AI_EDGE_DUPLICATES_STATIC: &str = "ai-edge-duplicates-static";
pub const AI_EDGE_BAD_PROVENANCE: &str = "ai-edge-bad-provenance";
pub const STRUCTURE_OUT_OF_DATE: &str = "structure-out-of-date";
pub const DESCRIPTION_EMPTY: &str = "description-empty";

/// Entry point and flow codes, owned by `gitvur-flow`.
pub use gitvur_flow::codes::{
    ENTRY_BAD_ID, ENTRY_BAD_PROVENANCE, ENTRY_DANGLING_TARGET, ENTRY_DUPLICATES_STATIC,
    ENTRY_EVIDENCE_MISMATCH, ENTRY_EVIDENCE_OUT_OF_RANGE, ENTRY_NO_EVIDENCE, FLOW_BAD_ID,
    FLOW_BAD_TRANSITION_REF, FLOW_BRANCH_NO_LABEL, FLOW_CALL_UNSUPPORTED, FLOW_DANGLING_ENTRY,
    FLOW_DANGLING_STEP, FLOW_DUPLICATE_STEP_ID, FLOW_EVIDENCE_MISMATCH, FLOW_EVIDENCE_OUT_OF_RANGE,
    FLOW_LABEL_TOO_LONG, FLOW_RETURN_UNSUPPORTED, FLOW_TOO_LONG, FLOW_TRANSITION_NO_EVIDENCE,
    FLOW_TRANSITION_SHOULD_BE_STATIC, FLOW_UNREACHABLE_STEP,
};
