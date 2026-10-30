//! Errors and warnings returned to the frontend.

use serde::Serialize;
use ts_rs::TS;

/// Stable error codes; the frontend picks a state and message from them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    NotADirectory,
    NoGitvur,
    SchemaInvalid,
    PathEscape,
    Io,
    IndexFailed,
}

/// Serialised as `{ code, message, detail? }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS, thiserror::Error)]
#[error("{message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    #[must_use]
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn io(context: &str, err: &std::io::Error) -> Self {
        Self::new(ErrorCode::Io, context).with_detail(err.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum WarningCode {
    AnnotationsMissing,
    AnnotationsInvalid,
    ReportMissing,
    ReportInvalid,
    ReportStale,
}

/// A problem that still lets the repository open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct AppWarning {
    pub code: WarningCode,
    pub message: String,
}
