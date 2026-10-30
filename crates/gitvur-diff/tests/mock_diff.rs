//! Generates `app/src/api/mockDiff.json`, the browser mock's diff for py-small, from a real
//! scenario: revision A is py-small with hand-made differences, revision B is the fixture
//! itself (so B matches the fixture's committed `.gitvur/structure.json`). The test fails
//! when the committed file is out of date; regenerate with
//! `GITVUR_WRITE_MOCK_DIFF=1 cargo test -p gitvur-diff --test mock_diff`.
//!
//! Between A and B: `slugify` and `Toy.label` are added, `cents` is removed, `receipt` and
//! `Toy.describe` are modified, `format_price` (with `with_symbol`) moves from models.py
//! to utils.py, and orders.py's imports change.

use std::fs;
use std::path::Path;
use std::process::Command;

use gitvur_diff::diff;
use gitvur_diff::revision::{index_revision, list_commits, read_file};
use gitvur_schema::to_canonical_json;

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "Ada Example")
        .env("GIT_AUTHOR_EMAIL", "ada@example.invalid")
        .env("GIT_COMMITTER_NAME", "Ada Example")
        .env("GIT_COMMITTER_EMAIL", "ada@example.invalid")
        .env("GIT_AUTHOR_DATE", "2026-10-28T09:00:00Z")
        .env("GIT_COMMITTER_DATE", "2026-10-28T09:00:00Z")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed");
}

fn edit(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "missing {from:?}");
    text.replacen(from, to, 1)
}

const FORMAT_PRICE: &str = "def format_price(amount, currency=\"EUR\"):\n    def with_symbol(text):\n        symbol = SYMBOLS.get(currency, currency)\n        return symbol + \" \" + text\n\n    return with_symbol(\"%.2f\" % amount)\n";
const SLUGIFY: &str = "def slugify(text):\n    return \"-\".join(text.lower().split())\n";
const FILES: [&str; 7] = [
    ".gitignore",
    "app.py",
    "shop/__init__.py",
    "shop/cache.py",
    "shop/models.py",
    "shop/orders.py",
    "shop/store.py",
];

/// py-small with the differences described at the top of this file.
fn write_revision_a(repo: &Path, read: &dyn Fn(&str) -> String) {
    for f in FILES {
        fs::write(repo.join(f), read(f)).unwrap();
    }
    let utils = edit(&read("shop/utils.py"), &format!("{FORMAT_PRICE}\n\n"), "");
    let utils = edit(
        &utils,
        &format!("{SLUGIFY}\n\n"),
        "def cents(value):\n    return int(round(value * 100))\n\n\n",
    );
    fs::write(repo.join("shop/utils.py"), utils).unwrap();
    let models = edit(
        &read("shop/models.py"),
        "    def label(self):\n        return self.name.upper()\n\n    def describe(self):\n        label = self.label()\n        return \"Toy: \" + label\n",
        "    def describe(self):\n        return \"Toy: \" + self.name.upper()\n",
    );
    fs::write(
        repo.join("shop/models.py"),
        format!("{models}\n\n{FORMAT_PRICE}"),
    )
    .unwrap();
    let orders = edit(
        &read("shop/orders.py"),
        "import shop.utils\nfrom shop.cache import Cache\nfrom shop.utils import format_price as fmt\n",
        "from shop.cache import Cache\nfrom shop.models import format_price as fmt\n",
    );
    let orders = edit(
        &orders,
        "        slug = shop.utils.slugify(item.name)\n        price = fmt(item.price)\n        return slug + \": \" + price\n",
        "        slug = item.name.lower()\n        price = fmt(item.price)\n        return slug + \" - \" + price\n",
    );
    fs::write(repo.join("shop/orders.py"), orders).unwrap();
}

#[test]
fn mock_diff_is_up_to_date() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/py-small");
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path().join("py-small");
    fs::create_dir_all(repo.join("shop")).unwrap();
    let read = |f: &str| fs::read_to_string(fixture.join(f)).unwrap();

    write_revision_a(&repo, &read);
    git(&repo, &["init", "-q", "-b", "main"]);
    git(&repo, &["add", "-A"]);
    git(
        &repo,
        &[
            "commit",
            "-q",
            "-m",
            "Price formatting lives with the models",
        ],
    );

    // Revision B: the fixture as committed.
    for f in [&FILES[..], &["shop/utils.py"]].concat() {
        fs::write(repo.join(f), read(f)).unwrap();
    }
    git(&repo, &["add", "-A"]);
    git(
        &repo,
        &[
            "commit",
            "-q",
            "-m",
            "Move price formatting to utils; slug receipts",
        ],
    );

    let mut a = index_revision(&repo, "HEAD~1").unwrap();
    let mut b = index_revision(&repo, "HEAD").unwrap();
    // This browser snapshot intentionally exercises frozen v0.2 bundles.
    for structure in [&mut a.structure, &mut b.structure] {
        structure.entry_points.clear();
        structure
            .unresolved_calls
            .retain(|call| !call.from.starts_with("entry:"));
    }
    let committed: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(fixture.join(".gitvur/structure.json")).unwrap())
            .unwrap();
    assert_eq!(
        serde_json::to_value(&b.structure).unwrap(),
        committed,
        "B must be the fixture"
    );

    let mut d = diff(&a.structure, &b.structure);
    d.schema_version = "0.2".into();
    d.from_commit.clone_from(&a.sha);
    d.to_commit.clone_from(&b.sha);
    let mut sources = serde_json::Map::new();
    for f in ["shop/models.py", "shop/orders.py", "shop/utils.py"] {
        let text = String::from_utf8(read_file(&repo, &a.sha, f).unwrap().unwrap()).unwrap();
        sources.insert(f.to_owned(), text.into());
    }
    let commits: Vec<serde_json::Value> = list_commits(&repo, 10)
        .unwrap()
        .into_iter()
        .map(|c| {
            serde_json::json!({
                "sha": c.sha, "short": c.short, "subject": c.subject,
                "author": c.author, "date": c.time,
            })
        })
        .collect();
    let mock = serde_json::json!({
        "commits": commits,
        "bundle": { "diff": d, "from": a.structure, "to": b.structure },
        "fromSources": sources,
    });
    let expected = to_canonical_json(&mock);

    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../app/src/api/mockDiff.json");
    if std::env::var_os("GITVUR_WRITE_MOCK_DIFF").is_some() {
        fs::write(&path, &expected).unwrap();
    }
    let actual = fs::read_to_string(&path).unwrap_or_default();
    assert!(
        actual == expected,
        "app/src/api/mockDiff.json is out of date; run \
         GITVUR_WRITE_MOCK_DIFF=1 cargo test -p gitvur-diff --test mock_diff"
    );
}
