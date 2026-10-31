//! Scenarios on a temporary copy of `fixtures/py-small` with programmatic annotations.

use std::fs;
use std::path::{Path, PathBuf};

use gitvur_index::{IndexOptions, index, write_output};
use gitvur_schema::{
    Annotations, Description, Edge, EdgeType, Evidence, Module, NodeType, Provenance, Report,
    Severity, Status, Structure, to_canonical_json,
};
use gitvur_validate::{codes, resolve_in_repo, stale_ids, validate_repo};

struct Scenario {
    dir: tempfile::TempDir,
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        if entry.file_name() == ".gitvur" {
            continue; // output of earlier CLI runs on the fixture
        }
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

impl Scenario {
    /// A copy of py-small with a fresh `.gitvur/structure.json` and complete, valid annotations.
    fn documented() -> Self {
        let s = Self::bare();
        s.reindex();
        let annotations = full_annotations(&s.structure());
        s.write_annotations(&annotations);
        s
    }

    /// A copy of py-small with nothing in `.gitvur/`.
    fn bare() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/py-small");
        copy_dir(&fixture, dir.path());
        Self { dir }
    }

    fn root(&self) -> PathBuf {
        self.dir.path().canonicalize().unwrap()
    }

    fn structure(&self) -> Structure {
        index(
            &self.root(),
            &IndexOptions {
                generated_at: "t".into(),
            },
        )
        .unwrap()
        .structure
    }

    fn reindex(&self) {
        let out = index(
            &self.root(),
            &IndexOptions {
                generated_at: "t".into(),
            },
        )
        .unwrap();
        write_output(&self.root().join(".gitvur"), &out).unwrap();
    }

    fn annotations(&self) -> Annotations {
        serde_json::from_str(
            &fs::read_to_string(self.root().join(".gitvur/annotations.json")).unwrap(),
        )
        .unwrap()
    }

    fn write_annotations(&self, annotations: &Annotations) {
        self.write_raw_annotations(&to_canonical_json(annotations));
    }

    fn write_raw_annotations(&self, text: &str) {
        fs::create_dir_all(self.root().join(".gitvur")).unwrap();
        fs::write(self.root().join(".gitvur/annotations.json"), text).unwrap();
    }

    fn edit(&self, relpath: &str, f: impl FnOnce(String) -> String) {
        let path = self.root().join(relpath);
        let text = fs::read_to_string(&path).unwrap();
        let edited = f(text.clone());
        assert_ne!(text, edited, "edit of {relpath} changed nothing");
        fs::write(path, edited).unwrap();
    }

    fn update(&self, f: impl FnOnce(&mut Annotations)) {
        let mut annotations = self.annotations();
        f(&mut annotations);
        self.write_annotations(&annotations);
    }

    fn validate(&self) -> Report {
        validate_repo(&self.root()).unwrap()
    }
}

/// Module `module:app` with `app.py`, `module:shop` with the rest; a description for every
/// node; and one valid AI edge.
fn full_annotations(structure: &Structure) -> Annotations {
    let files: Vec<String> = structure
        .nodes
        .iter()
        .filter(|n| n.node_type == NodeType::File)
        .map(|n| n.id.clone())
        .collect();
    let (app, shop): (Vec<String>, Vec<String>) =
        files.into_iter().partition(|f| f == "file:app.py");
    let module = |id: &str, files| Module {
        id: id.into(),
        name: id.trim_start_matches("module:").into(),
        description: format!("The {id} module."),
        files,
    };
    let descriptions = structure
        .nodes
        .iter()
        .filter(|n| n.node_type != NodeType::Project)
        .map(|n| Description {
            id: n.id.clone(),
            text: format!("Describes {}.", n.name),
            based_on_hash: n.content_hash.clone().unwrap(),
        })
        .collect();
    let mut annotations = Annotations {
        entry_points: Vec::new(),
        flows: Vec::new(),
        modules: vec![module("module:app", app), module("module:shop", shop)],
        descriptions,
        edges: vec![ai_edge(
            "function:shop/orders.py:OrderService.remember",
            "function:shop/cache.py:Cache.save",
            "shop/orders.py",
            21,
        )],
    };
    annotations.canonicalize();
    annotations
}

fn ai_edge(from: &str, to: &str, file: &str, line: u32) -> Edge {
    Edge {
        from: from.into(),
        to: to.into(),
        edge_type: EdgeType::References,
        provenance: Provenance::Ai,
        evidence: Evidence {
            file: file.into(),
            line,
        },
        note: Some("Cheap items are cached instead of stored.".into()),
    }
}

fn codes_of(report: &Report) -> Vec<(&str, Severity)> {
    report
        .issues
        .iter()
        .map(|i| (i.code.as_str(), i.severity))
        .collect()
}

fn has(report: &Report, code: &str, severity: Severity) -> bool {
    report
        .issues
        .iter()
        .any(|i| i.code == code && i.severity == severity)
}

fn element<'r>(report: &'r Report, id: &str) -> &'r gitvur_schema::ElementStatus {
    report
        .elements
        .iter()
        .find(|e| e.id == id)
        .unwrap_or_else(|| panic!("{id} not in report"))
}

fn assert_only(report: &Report, code: &str, severity: Severity) {
    assert!(
        has(report, code, severity),
        "expected {code}: {:?}",
        report.issues
    );
    assert!(
        report.issues.iter().all(|i| i.code == code),
        "unexpected extra issues: {:?}",
        codes_of(report)
    );
}

// --- valid input -----------------------------------------------------------------------

#[test]
fn valid_annotations_have_no_issues() {
    let report = Scenario::documented().validate();
    assert_eq!(report.issues, [], "{:?}", report.issues);
    assert_eq!(report.summary.errors + report.summary.warnings, 0);
    assert_eq!(report.summary.stale + report.summary.undocumented, 0);
    // 34 structure nodes (all but the project) + 2 modules.
    assert_eq!(report.summary.documented, 36);
    assert!(
        report
            .elements
            .iter()
            .all(|e| e.child_changed.is_none() && e.self_changed.is_none())
    );
}

#[test]
fn missing_annotations_means_everything_undocumented() {
    let s = Scenario::bare();
    s.reindex();
    let report = s.validate();
    assert_eq!(report.issues, []);
    assert_eq!(report.summary.undocumented, 34);
    assert!(!report.elements.iter().any(|e| e.id == "project:root"));
}

#[test]
fn report_is_canonical_and_deterministic() {
    let s = Scenario::documented();
    s.edit("shop/models.py", |t| {
        t.replace("self.name.upper()", "self.name.lower()")
    });
    let first = to_canonical_json(&s.validate());
    let second = to_canonical_json(&s.validate());
    assert_eq!(first, second);
    let mut reparsed: Report = serde_json::from_str(&first).unwrap();
    reparsed.canonicalize();
    assert_eq!(to_canonical_json(&reparsed), first);
}

// --- one test per issue code -----------------------------------------------------------

#[test]
fn schema_invalid() {
    let s = Scenario::documented();
    s.write_raw_annotations("{ not json");
    assert_only(&s.validate(), codes::SCHEMA_INVALID, Severity::Error);
    s.write_raw_annotations(r#"{"modules": [], "descriptions": [], "edges": [], "extra": 1}"#);
    let report = s.validate();
    assert_only(&report, codes::SCHEMA_INVALID, Severity::Error);
    assert_eq!(
        report.summary.documented, 0,
        "unusable annotations document nothing"
    );
}

#[test]
fn dangling_ref() {
    let s = Scenario::documented();
    s.update(|a| {
        a.descriptions.push(Description {
            id: "function:shop/gone.py:nothing".into(),
            text: "Gone.".into(),
            based_on_hash: format!("sha256:{}", "0".repeat(64)),
        });
        a.modules[0].files.push("file:missing.py".into());
        a.modules[0].files.push("function:app.py:main".into());
        a.edges.push(ai_edge(
            "function:app.py:main",
            "function:nowhere.py:x",
            "app.py",
            13,
        ));
    });
    let report = s.validate();
    let dangling: Vec<&str> = report
        .issues
        .iter()
        .filter(|i| i.code == codes::DANGLING_REF)
        .map(|i| i.message.as_str())
        .collect();
    assert_eq!(dangling.len(), 4, "{dangling:#?}");
    assert!(dangling.iter().any(|m| m.contains("not a file node")));
    assert!(
        report.issues.iter().all(|i| i.code == codes::DANGLING_REF),
        "{:?}",
        codes_of(&report)
    );
}

#[test]
fn module_not_module() {
    let s = Scenario::documented();
    s.update(|a| {
        a.modules.push(Module {
            id: "Shop Stuff".into(),
            name: "x".into(),
            description: "x".into(),
            files: vec![],
        });
    });
    let report = s.validate();
    assert_only(&report, codes::MODULE_NOT_MODULE, Severity::Error);
    assert!(
        !report.elements.iter().any(|e| e.id == "Shop Stuff"),
        "invalid modules get no status"
    );
}

#[test]
fn file_unassigned() {
    let s = Scenario::documented();
    s.update(|a| a.modules.retain(|m| m.id != "module:app"));
    let report = s.validate();
    assert_only(&report, codes::FILE_UNASSIGNED, Severity::Warning);
    assert_eq!(report.issues[0].id.as_deref(), Some("file:app.py"));
}

#[test]
fn file_multi_assigned() {
    let s = Scenario::documented();
    s.update(|a| a.modules[0].files.push("file:shop/utils.py".into()));
    let report = s.validate();
    assert_only(&report, codes::FILE_MULTI_ASSIGNED, Severity::Error);
    assert_eq!(report.issues[0].id.as_deref(), Some("file:shop/utils.py"));
}

#[test]
fn ai_edge_no_evidence() {
    let s = Scenario::documented();
    let mut value = serde_json::to_value(s.annotations()).unwrap();
    value["edges"][0]
        .as_object_mut()
        .unwrap()
        .remove("evidence");
    s.write_raw_annotations(&serde_json::to_string_pretty(&value).unwrap());
    let report = s.validate();
    assert_only(&report, codes::AI_EDGE_NO_EVIDENCE, Severity::Error);
    assert_eq!(
        report.summary.documented, 36,
        "the rest of the file is still used"
    );
}

#[test]
fn ai_edge_evidence_out_of_range() {
    let s = Scenario::documented();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.py"), "Cache.save\n").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path().join("secret.py"), s.root().join("link.py")).unwrap();
    let from = "function:shop/orders.py:OrderService.remember";
    let to = "function:shop/cache.py:Cache.save";
    for (file, line) in [
        ("shop/orders.py", 999),
        ("shop/orders.py", 0),
        ("shop/missing.py", 1),
        ("../outside.py", 1),
        ("/etc/hostname", 1),
        ("link.py", 1),
    ] {
        s.update(|a| a.edges = vec![ai_edge(from, to, file, line)]);
        let report = s.validate();
        assert_only(
            &report,
            codes::AI_EDGE_EVIDENCE_OUT_OF_RANGE,
            Severity::Error,
        );
    }
}

#[test]
fn ai_edge_evidence_mismatch() {
    let s = Scenario::documented();
    s.update(|a| a.edges[0].evidence.line = 20); // `backend = self.cache if …`, no `save`
    assert_only(
        &s.validate(),
        codes::AI_EDGE_EVIDENCE_MISMATCH,
        Severity::Warning,
    );
}

#[test]
fn ai_edge_duplicates_static() {
    let s = Scenario::documented();
    s.update(|a| {
        let mut edge = ai_edge(
            "function:shop/models.py:Toy.describe",
            "function:shop/models.py:Toy.label",
            "shop/models.py",
            22,
        );
        edge.edge_type = EdgeType::Calls;
        a.edges.push(edge);
    });
    assert_only(
        &s.validate(),
        codes::AI_EDGE_DUPLICATES_STATIC,
        Severity::Warning,
    );
}

#[test]
fn ai_edge_bad_provenance() {
    let s = Scenario::documented();
    s.update(|a| a.edges[0].provenance = Provenance::Syntactic);
    assert_only(
        &s.validate(),
        codes::AI_EDGE_BAD_PROVENANCE,
        Severity::Error,
    );
}

#[test]
fn structure_out_of_date() {
    let s = Scenario::documented();
    fs::remove_file(s.root().join(".gitvur/structure.json")).unwrap();
    assert_only(
        &s.validate(),
        codes::STRUCTURE_OUT_OF_DATE,
        Severity::Warning,
    );

    s.reindex();
    s.edit("app.py", |t| t + "\n# trailing comment\n");
    let report = s.validate();
    assert!(has(
        &report,
        codes::STRUCTURE_OUT_OF_DATE,
        Severity::Warning
    ));
}

#[test]
fn description_empty() {
    let s = Scenario::documented();
    s.update(|a| a.descriptions[0].text = "  \n".into());
    let report = s.validate();
    assert_only(&report, codes::DESCRIPTION_EMPTY, Severity::Warning);
    let id = &s.annotations().descriptions[0].id;
    assert_eq!(element(&report, id).status, Status::Undocumented);
}

#[test]
fn every_code_has_a_test() {
    // Keeps this file in sync with `codes`: each constant must appear in a test above.
    let source = include_str!("validate.rs");
    for code in [
        "SCHEMA_INVALID",
        "DANGLING_REF",
        "MODULE_NOT_MODULE",
        "FILE_UNASSIGNED",
        "FILE_MULTI_ASSIGNED",
        "AI_EDGE_NO_EVIDENCE",
        "AI_EDGE_EVIDENCE_OUT_OF_RANGE",
        "AI_EDGE_EVIDENCE_MISMATCH",
        "AI_EDGE_DUPLICATES_STATIC",
        "AI_EDGE_BAD_PROVENANCE",
        "STRUCTURE_OUT_OF_DATE",
        "DESCRIPTION_EMPTY",
    ] {
        assert!(
            source.matches(&format!("codes::{code}")).count() >= 1,
            "{code}"
        );
    }
}

// --- staleness scenarios ---------------------------------------------------------------

#[test]
fn editing_one_method_marks_only_it_and_its_ancestors_stale() {
    let s = Scenario::documented();
    s.edit("shop/models.py", |t| {
        t.replace("self.name.upper()", "self.name.lower()")
    });
    let report = s.validate();

    let label = element(&report, "function:shop/models.py:Toy.label");
    assert_eq!(
        (label.status, label.child_changed, label.self_changed),
        (Status::Stale, Some(false), Some(true))
    );
    for ancestor in ["class:shop/models.py:Toy", "file:shop/models.py"] {
        let e = element(&report, ancestor);
        assert_eq!(
            (e.status, e.child_changed, e.self_changed),
            (Status::Stale, Some(true), Some(false)),
            "{ancestor}"
        );
    }
    assert_eq!(
        element(&report, "entry:main-guard:app-py").status,
        Status::Undocumented,
        "no flow starts from the main guard"
    );
    let stale: Vec<&str> = report
        .elements
        .iter()
        .filter(|e| e.status != Status::Documented && !e.id.starts_with("entry:"))
        .map(|e| e.id.as_str())
        .collect();
    assert_eq!(
        stale,
        [
            "class:shop/models.py:Toy",
            "file:shop/models.py",
            "function:shop/models.py:Toy.label"
        ],
        "every other element stays documented"
    );
}

#[test]
fn blank_lines_above_a_function_keep_it_documented() {
    let s = Scenario::documented();
    s.edit("shop/utils.py", |t| {
        t.replace("def slugify", "\n\ndef slugify")
    });
    let report = s.validate();
    for id in [
        "function:shop/utils.py:slugify",
        "function:shop/utils.py:to_amount",
        "function:shop/utils.py:to_amount#2",
        "function:shop/utils.py:format_price",
    ] {
        assert_eq!(element(&report, id).status, Status::Documented, "{id}");
    }
    let file = element(&report, "file:shop/utils.py");
    assert_eq!(
        (file.status, file.child_changed, file.self_changed),
        (Status::Stale, Some(false), Some(true))
    );
}

#[test]
fn deleting_a_function_makes_its_description_dangling() {
    let s = Scenario::documented();
    s.edit("shop/models.py", |t| {
        t.replace(
            "    def describe(self):\n        return \"Book: \" + self.name\n",
            "",
        )
    });
    let report = s.validate();
    let dangling: Vec<_> = report
        .issues
        .iter()
        .filter(|i| i.code == codes::DANGLING_REF)
        .collect();
    assert_eq!(dangling.len(), 1, "{:?}", report.issues);
    assert_eq!(
        dangling[0].id.as_deref(),
        Some("function:shop/models.py:Book.describe")
    );
    assert!(report.summary.errors >= 1);
    assert!(
        !report
            .elements
            .iter()
            .any(|e| e.id == "function:shop/models.py:Book.describe")
    );
}

#[test]
fn stale_ids_lists_stale_and_undocumented() {
    let s = Scenario::documented();
    s.edit("shop/models.py", |t| {
        t.replace("self.name.upper()", "self.name.lower()")
    });
    s.update(|a| a.descriptions.retain(|d| d.id != "function:app.py:main"));
    assert_eq!(
        stale_ids(&s.validate()),
        [
            "class:shop/models.py:Toy",
            "file:shop/models.py",
            "function:app.py:main",
            "function:shop/models.py:Toy.label",
        ]
    );
}

#[test]
fn modules_without_description_are_undocumented() {
    let s = Scenario::documented();
    s.update(|a| a.modules[0].description = String::new());
    let report = s.validate();
    assert_eq!(element(&report, "module:app").status, Status::Undocumented);
    assert_eq!(element(&report, "module:shop").status, Status::Documented);
}

// --- path safety -----------------------------------------------------------------------

#[test]
fn resolve_in_repo_rejects_escapes() {
    let s = Scenario::bare();
    let root = s.root();
    assert!(resolve_in_repo(&root, "app.py").is_some());
    assert!(resolve_in_repo(&root, "shop/models.py").is_some());
    for bad in [
        "",
        "../x",
        "shop/../app.py",
        "./app.py",
        "/etc/passwd",
        "shop\\models.py",
        "missing.py",
    ] {
        assert!(resolve_in_repo(&root, bad).is_none(), "{bad}");
    }
}

#[cfg(unix)]
#[test]
fn gitvur_dir_symlinked_outside_is_not_read() {
    let s = Scenario::bare();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("annotations.json"), "{}").unwrap();
    std::os::unix::fs::symlink(outside.path(), s.root().join(".gitvur")).unwrap();
    let report = s.validate();
    assert!(
        has(&report, codes::SCHEMA_INVALID, Severity::Error),
        "{:?}",
        report.issues
    );
    assert!(
        report
            .issues
            .iter()
            .any(|i| i.message.contains("outside the repository"))
    );
}

#[test]
fn non_object_edges_are_schema_invalid() {
    let s = Scenario::documented();
    let mut value = serde_json::to_value(s.annotations()).unwrap();
    value["edges"] = serde_json::json!([42, "x"]);
    s.write_raw_annotations(&value.to_string());
    assert_only(&s.validate(), codes::SCHEMA_INVALID, Severity::Error);
}
