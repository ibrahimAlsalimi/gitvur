//! Contract v0.3 execution metadata. Extraction owns static entries; agents own curated flows.
use crate::{Evidence, Provenance};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "kebab-case")]
pub enum EntryKind {
    CliCommand,
    ConsoleScript,
    EventHandler,
    HttpRoute,
    Job,
    /// C `main` or Go `func main` in `package main`; the target is the function.
    MainFunction,
    MainGuard,
    NpmScript,
    Other,
    PackageBin,
    PackageMain,
    Test,
    TopLevelCall,
}

impl EntryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CliCommand => "cli-command",
            Self::ConsoleScript => "console-script",
            Self::EventHandler => "event-handler",
            Self::HttpRoute => "http-route",
            Self::Job => "job",
            Self::MainFunction => "main-function",
            Self::MainGuard => "main-guard",
            Self::NpmScript => "npm-script",
            Self::Other => "other",
            Self::PackageBin => "package-bin",
            Self::PackageMain => "package-main",
            Self::Test => "test",
            Self::TopLevelCall => "top-level-call",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntryPoint {
    #[schemars(regex(pattern = r"^entry:[a-z-]+:[a-z0-9-]+(?:#[2-9][0-9]*|#1[0-9]+)?$"))]
    pub id: String,
    pub kind: EntryKind,
    pub name: String,
    /// A resolved node ID, or null when configuration names code outside the index.
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub raw: Option<String>,
    #[serde(default)]
    pub calls: Vec<String>,
    /// Optional at deserialization so validation can diagnose missing AI evidence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub evidence: Option<Evidence>,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Flow {
    #[schemars(regex(pattern = r"^flow:[a-z0-9-]+$"))]
    pub id: String,
    pub name: String,
    pub description: String,
    pub entry_point: String,
    /// Reading order: canonicalization must not sort or deduplicate steps.
    pub steps: Vec<FlowStep>,
    pub transitions: Vec<FlowTransition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlowStep {
    pub id: String,
    pub node: String,
    pub label: String,
    #[schemars(regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    pub based_on_hash: String,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum TransitionKind {
    Async,
    Branch,
    Call,
    Event,
    Return,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlowTransition {
    pub from: String,
    pub to: String,
    pub kind: TransitionKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub label: Option<String>,
    pub provenance: Provenance,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub evidence: Option<Evidence>,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum FlowState {
    Broken,
    Current,
    Stale,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlowStatus {
    pub id: String,
    pub status: FlowState,
    #[serde(default)]
    pub stale_steps: Vec<String>,
}

pub(crate) fn canonicalize_entries(entries: &mut Vec<EntryPoint>) {
    for entry in entries.iter_mut() {
        entry.calls.sort();
        entry.calls.dedup();
    }
    entries.sort();
    entries.dedup();
}
