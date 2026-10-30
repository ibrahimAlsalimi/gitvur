//! Writes `manifest.json` and `structure.json`.

use std::fs;
use std::io;
use std::path::Path;

use gitvur_schema::to_canonical_json;

use crate::IndexOutput;

/// Writes both files into `dir` (created if missing). Each file is written to a
/// temporary file in the same directory and renamed into place, so readers never see
/// a partial file.
pub fn write_output(dir: &Path, output: &IndexOutput) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    write_atomic(dir, "manifest.json", &to_canonical_json(&output.manifest))?;
    write_atomic(dir, "structure.json", &to_canonical_json(&output.structure))
}

fn write_atomic(dir: &Path, name: &str, contents: &str) -> io::Result<()> {
    let tmp = dir.join(format!(".{name}.tmp"));
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, dir.join(name))
}
