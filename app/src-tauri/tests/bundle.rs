//! Command logic, tested without a running app.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use gitvur_app::bundle::{MAX_SOURCE_LINES, SourceLanguage, open_repository, read_source};
use gitvur_app::error::{ErrorCode, WarningCode};
use gitvur_app::settings::{self, Settings, Theme};
use gitvur_schema::NodeType;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
        .canonicalize()
        .unwrap()
}

fn s(p: &Path) -> &str {
    p.to_str().unwrap()
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// A writable copy of a fixture, including its committed `.gitvur/`.
fn copy_of(name: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    copy_dir(&fixture(name), dir.path());
    dir
}

#[test]
fn opens_v03_manifest_alongside_legacy_v02_bundles() {
    let dir = copy_of("py-small");
    let path = dir.path().join(".gitvur/manifest.json");
    let text = fs::read_to_string(&path)
        .unwrap()
        .replace("\"0.2\"", "\"0.3\"");
    fs::write(path, text).unwrap();
    let bundle = open_repository(s(dir.path())).unwrap();
    assert_eq!(bundle.manifest.schema_version, "0.3");
    assert_eq!(bundle.structure.entry_points.len(), 0);
}

#[test]
fn opens_py_small_with_all_four_files() {
    let bundle = open_repository(s(&fixture("py-small"))).unwrap();
    assert_eq!(bundle.manifest.project_name, "py-small");
    let files = bundle
        .structure
        .nodes
        .iter()
        .filter(|n| n.node_type == NodeType::File)
        .count();
    assert_eq!(
        (
            files,
            bundle.structure.nodes.len(),
            bundle.structure.edges.len()
        ),
        (7, 35, 18)
    );
    let annotations = bundle.annotations.as_ref().unwrap();
    assert_eq!(annotations.modules.len(), 5);
    let report = bundle.report.as_ref().unwrap();
    assert_eq!((report.summary.documented, report.summary.errors), (39, 0));
    assert!(
        bundle
            .warnings
            .iter()
            .all(|w| w.code != WarningCode::AnnotationsMissing)
    );
}

#[test]
fn opens_ts_small() {
    let bundle = open_repository(s(&fixture("ts-small"))).unwrap();
    assert_eq!(bundle.structure.nodes.len(), 30);
    assert!(bundle.annotations.is_some() && bundle.report.is_some());
}

#[test]
fn not_a_directory() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("f.txt");
    fs::write(&file, "x").unwrap();
    for path in [s(&file), "/definitely/not/here"] {
        assert_eq!(
            open_repository(path).unwrap_err().code,
            ErrorCode::NotADirectory,
            "{path}"
        );
    }
}

#[test]
fn no_gitvur() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        open_repository(s(dir.path())).unwrap_err().code,
        ErrorCode::NoGitvur
    );
    fs::create_dir(dir.path().join(".gitvur")).unwrap();
    assert_eq!(
        open_repository(s(dir.path())).unwrap_err().code,
        ErrorCode::NoGitvur,
        "empty .gitvur"
    );
}

#[test]
fn schema_invalid_structure_or_manifest() {
    let dir = copy_of("py-small");
    fs::write(dir.path().join(".gitvur/structure.json"), "{\"nodes\": 3}").unwrap();
    let err = open_repository(s(dir.path())).unwrap_err();
    assert_eq!(err.code, ErrorCode::SchemaInvalid);
    assert!(err.message.contains("structure.json") && err.detail.is_some());

    let dir = copy_of("py-small");
    let path = dir.path().join(".gitvur/manifest.json");
    let text = fs::read_to_string(&path)
        .unwrap()
        .replace("\"0.2\"", "\"9.9\"");
    fs::write(&path, text).unwrap();
    assert_eq!(
        open_repository(s(dir.path())).unwrap_err().code,
        ErrorCode::SchemaInvalid
    );
}

#[test]
fn optional_files_become_warnings() {
    let dir = copy_of("py-small");
    fs::remove_file(dir.path().join(".gitvur/annotations.json")).unwrap();
    fs::write(dir.path().join(".gitvur/report.json"), "not json").unwrap();
    let bundle = open_repository(s(dir.path())).unwrap();
    assert!(bundle.annotations.is_none() && bundle.report.is_none());
    let codes: Vec<WarningCode> = bundle.warnings.iter().map(|w| w.code).collect();
    assert_eq!(
        codes,
        [WarningCode::AnnotationsMissing, WarningCode::ReportInvalid]
    );

    let dir = copy_of("py-small");
    fs::write(dir.path().join(".gitvur/annotations.json"), "{}").unwrap();
    fs::remove_file(dir.path().join(".gitvur/report.json")).unwrap();
    let codes: Vec<WarningCode> = open_repository(s(dir.path()))
        .unwrap()
        .warnings
        .iter()
        .map(|w| w.code)
        .collect();
    assert_eq!(
        codes,
        [WarningCode::AnnotationsInvalid, WarningCode::ReportMissing]
    );
}

#[test]
fn report_older_than_structure_is_flagged() {
    let dir = copy_of("py-small");
    let report = dir.path().join(".gitvur/report.json");
    let structure = dir.path().join(".gitvur/structure.json");
    let old = fs::File::options().write(true).open(&report).unwrap();
    old.set_modified(std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1))
        .unwrap();
    fs::File::options()
        .write(true)
        .open(&structure)
        .unwrap()
        .set_modified(std::time::SystemTime::now())
        .unwrap();
    let codes: Vec<WarningCode> = open_repository(s(dir.path()))
        .unwrap()
        .warnings
        .iter()
        .map(|w| w.code)
        .collect();
    assert_eq!(codes, [WarningCode::ReportStale]);
}

#[test]
fn read_source_slices_with_context_and_clamping() {
    let root = fixture("py-small");
    let slice = read_source(s(&root), "shop/cache.py", 12, 13, 2).unwrap();
    assert_eq!(slice.start_line, 10);
    assert_eq!(slice.lines.len(), 6, "lines 10..=15");
    assert_eq!(slice.lines[2], "    def save(self, item):");
    assert_eq!(slice.language, SourceLanguage::Python);

    let clamped = read_source(s(&root), "shop/cache.py", 1, 16, 50).unwrap();
    assert_eq!((clamped.start_line, clamped.lines.len()), (1, 16));
    let ts = read_source(s(&fixture("ts-small")), "src/views.ts", 1, 1, 0).unwrap();
    assert_eq!(ts.language, SourceLanguage::Typescript);
    assert_eq!(
        read_source(s(&root), ".gitignore", 1, 1, 0)
            .unwrap()
            .language,
        SourceLanguage::Text
    );
}

#[test]
fn read_source_caps_lines() {
    let dir = tempfile::tempdir().unwrap();
    let mut text = String::new();
    for i in 1..=5_000 {
        writeln!(text, "line {i}").unwrap();
    }
    fs::write(dir.path().join("big.py"), text).unwrap();
    let slice = read_source(s(dir.path()), "big.py", 1, 5_000, 0).unwrap();
    assert_eq!(slice.lines.len(), MAX_SOURCE_LINES as usize);
    assert_eq!(slice.lines.last().unwrap(), "line 2000");
}

#[test]
fn path_escapes_are_rejected() {
    let root = fixture("py-small");
    for file in [
        "../ts-small/src/main.ts",
        "shop/../app.py",
        "/etc/passwd",
        "./app.py",
        "shop\\cache.py",
        "",
    ] {
        let err = read_source(s(&root), file, 1, 1, 0).unwrap_err();
        assert_eq!(err.code, ErrorCode::PathEscape, "{file:?}");
    }
    assert_eq!(
        read_source(s(&root), "missing.py", 1, 1, 0)
            .unwrap_err()
            .code,
        ErrorCode::Io
    );
}

#[cfg(unix)]
#[test]
fn symlinks_to_outside_are_rejected() {
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.py"), "TOKEN = 1\n").unwrap();
    fs::create_dir(outside.path().join(".gitvur")).unwrap();

    let dir = copy_of("py-small");
    std::os::unix::fs::symlink(outside.path().join("secret.py"), dir.path().join("link.py"))
        .unwrap();
    let err = read_source(s(dir.path()), "link.py", 1, 1, 0).unwrap_err();
    assert_eq!(err.code, ErrorCode::PathEscape);

    let repo = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path().join(".gitvur"), repo.path().join(".gitvur"))
        .unwrap();
    assert_eq!(
        open_repository(s(repo.path())).unwrap_err().code,
        ErrorCode::PathEscape
    );
}

#[test]
fn settings_and_recent_live_in_the_config_dir() {
    let config = tempfile::tempdir().unwrap();
    assert_eq!(settings::load(config.path()), Settings::default());
    let custom = Settings {
        explorer_width: 300,
        inspector_width: 400,
        inspector_collapsed: true,
        theme: Theme::Dark,
        guide_seen: true,
    };
    settings::save(config.path(), &custom).unwrap();
    assert_eq!(settings::load(config.path()), custom);

    for (path, name) in [("/a", "a"), ("/b", "b"), ("/a", "a")] {
        settings::remember(config.path(), path, name).unwrap();
    }
    let recent: Vec<String> = settings::recent(config.path())
        .into_iter()
        .map(|r| r.path)
        .collect();
    assert_eq!(recent, ["/a", "/b"], "most recent first, no duplicates");
    for i in 0..20 {
        settings::remember(config.path(), &format!("/r{i}"), "r").unwrap();
    }
    assert_eq!(settings::recent(config.path()).len(), 10);
}
