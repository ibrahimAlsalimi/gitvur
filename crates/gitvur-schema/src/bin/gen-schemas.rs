//! Writes the JSON Schema files for the contract into the workspace.
//!
//! Usage: `cargo run -p gitvur-schema --bin gen-schemas`

use std::path::Path;
use std::{fs, io};

fn main() -> io::Result<()> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (relpath, contents) in gitvur_schema::schema::generated_files() {
        let path = root.join(relpath);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(&path, contents)?;
        println!("wrote {relpath}");
    }
    Ok(())
}
