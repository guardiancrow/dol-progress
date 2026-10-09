use super::*;

struct Fixture {
    root: PathBuf,
    paths: PortablePaths,
    custom: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("dol-portable-{}", unique_suffix()));
        let executable_root = root.join("DOL 日本語 Folder");
        let custom = root.join("External Data");
        fs::create_dir_all(&executable_root).unwrap();
        fs::create_dir(&custom).unwrap();
        let paths = PortablePaths::from_executable(&executable_root.join("app.exe")).unwrap();
        Self {
            root,
            paths,
            custom,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

async fn close(database: ActiveDatabase) {
    database.pool().await.close().await;
}

async fn seed(root: &Path) {
    let database = ActiveDatabase::open(root.join(DATABASE_FILE_NAME))
        .await
        .unwrap();
    {
        let pool = database.pool().await;
        crate::migrations::run(&pool).await.unwrap();
        sqlx::query("INSERT INTO profiles (name) VALUES ('retained profile')")
            .execute(&*pool)
            .await
            .unwrap();
    }
    close(database).await;
}

fn custom_locator(root: &Path) -> Bootstrap {
    Bootstrap {
        data_root: Some(root.to_path_buf()),
        mode: RootMode::Custom,
        ..default_bootstrap()
    }
}

#[tokio::test]
async fn storage_display_fields_follow_portable_paths_in_default_and_custom_modes() {
    for custom in [false, true] {
        let fixture = Fixture::new();
        if custom {
            seed(&fixture.custom).await;
            write_committed(&fixture.paths.config_root, &custom_locator(&fixture.custom)).unwrap();
        }
        let (database, info) = initialize_at(&fixture.paths).await.unwrap();
        let expected_root = if custom {
            &fixture.custom
        } else {
            &fixture.paths.default_data_root
        };
        assert_eq!(info.mode, if custom { "custom" } else { "default" });
        assert_eq!(info.data_root, expected_root.display().to_string());
        assert_eq!(
            info.database_path,
            database.database_path().display().to_string()
        );
        let serialized = serde_json::to_value(&info).unwrap();
        for (field, expected) in [
            ("portableRoot", fixture.paths.executable_root.clone()),
            ("defaultDataRoot", fixture.paths.default_data_root.clone()),
            ("configRoot", fixture.paths.config_root.clone()),
            ("defaultDatabasePath", fixture.paths.default_database_path()),
            ("databasePath", expected_root.join(DATABASE_FILE_NAME)),
        ] {
            assert_eq!(serialized[field], expected.display().to_string());
        }
        assert_eq!(info.default_database_exists, !custom);
        close(database).await;
    }
}

#[tokio::test]
async fn first_launch_commits_default_marker_and_restart_keeps_data() {
    let fixture = Fixture::new();
    assert!(!fixture.paths.config_root.exists() && !fixture.paths.default_data_root.exists());
    let (database, info) = initialize_at(&fixture.paths).await.unwrap();
    assert_eq!(
        info.data_root,
        fixture.paths.default_data_root.display().to_string()
    );
    assert_eq!(
        info.database_path,
        fixture.paths.default_database_path().display().to_string()
    );
    assert_eq!(info.default_database_path, info.database_path);
    assert!(info.default_database_exists);
    assert_eq!(
        read_bootstrap(&fixture.paths.primary_bootstrap_path()).unwrap(),
        Some(default_bootstrap())
    );
    assert_eq!(
        read_bootstrap(&fixture.paths.last_good_bootstrap_path()).unwrap(),
        Some(default_bootstrap())
    );
    {
        let pool = database.pool().await;
        sqlx::query("INSERT INTO profiles (name) VALUES ('restart profile')")
            .execute(&*pool)
            .await
            .unwrap();
    }
    close(database).await;
    let (database, _) = initialize_at(&fixture.paths).await.unwrap();
    let name: String = sqlx::query_scalar("SELECT name FROM profiles")
        .fetch_one(&*database.pool().await)
        .await
        .unwrap();
    assert_eq!(name, "restart profile");
    close(database).await;
    assert!(!fixture
        .paths
        .executable_root
        .join(DATABASE_FILE_NAME)
        .exists());
}

#[tokio::test]
async fn absent_bootstrap_adopts_valid_database_and_rejects_invalid_without_overwrite() {
    let fixture = Fixture::new();
    seed(&fixture.paths.default_data_root).await;
    let (database, _) = initialize_at(&fixture.paths).await.unwrap();
    let name: String = sqlx::query_scalar("SELECT name FROM profiles")
        .fetch_one(&*database.pool().await)
        .await
        .unwrap();
    assert_eq!(name, "retained profile");
    close(database).await;
    fs::remove_file(fixture.paths.primary_bootstrap_path()).unwrap();
    fs::remove_file(fixture.paths.last_good_bootstrap_path()).unwrap();
    fs::write(
        fixture.paths.default_database_path(),
        b"not SQLite; preserve this",
    )
    .unwrap();
    assert!(initialize_at(&fixture.paths).await.is_err());
    assert_eq!(
        fs::read(fixture.paths.default_database_path()).unwrap(),
        b"not SQLite; preserve this"
    );
    assert!(!fixture.paths.primary_bootstrap_path().exists());
}

#[tokio::test]
async fn committed_marker_missing_database_never_recreates_data() {
    let fixture = Fixture::new();
    write_committed(&fixture.paths.config_root, &default_bootstrap()).unwrap();
    let recovery = initialize_at(&fixture.paths).await.err().unwrap();
    assert_eq!(
        recovery.configured_root,
        Some(fixture.paths.default_data_root.display().to_string())
    );
    assert!(!fixture.paths.default_database_path().exists());
    assert!(!fixture.paths.default_data_root.exists());
    assert!(validate_recovery_locator(&default_bootstrap(), &fixture.paths).is_err());
    assert!(!fixture.paths.default_data_root.exists());
    fs::remove_file(fixture.paths.primary_bootstrap_path()).unwrap();
    let recovery = initialize_at(&fixture.paths).await.err().unwrap();
    assert_eq!(
        recovery.configured_root,
        Some(fixture.paths.default_data_root.display().to_string())
    );
    assert!(!fixture.paths.default_data_root.exists());
}

#[test]
fn config_and_data_file_collisions_are_native_preflight_failures() {
    for config in [true, false] {
        let fixture = Fixture::new();
        let target = if config {
            &fixture.paths.config_root
        } else {
            &fixture.paths.default_data_root
        };
        fs::write(target, b"keep collision file").unwrap();
        assert!(prepare_startup(fixture.paths.clone()).is_err());
        assert_eq!(fs::read(target).unwrap(), b"keep collision file");
        assert!(!fixture.paths.default_database_path().exists());
    }
}

#[test]
fn config_only_and_data_only_writable_failures_stop_before_database_creation() {
    for config in [true, false] {
        let fixture = Fixture::new();
        let denied = if config {
            &fixture.paths.config_root
        } else {
            &fixture.paths.default_data_root
        };
        let error = prepare_startup_with(fixture.paths.clone(), |root| {
            if root == denied {
                Err(format!("injected permission denied: {}", root.display()))
            } else {
                prepare_portable_directory(root)
            }
        })
        .err()
        .unwrap();
        assert!(error.contains("permission denied"));
        assert!(!fixture.paths.default_database_path().exists());
        assert!(!fixture.paths.primary_bootstrap_path().exists());
    }
}

#[tokio::test]
async fn custom_startup_skips_inactive_default_and_transitions_back_to_portable_data() {
    let fixture = Fixture::new();
    seed(&fixture.custom).await;
    write_committed(&fixture.paths.config_root, &custom_locator(&fixture.custom)).unwrap();
    let (database, info) = initialize_at(&fixture.paths).await.unwrap();
    assert_eq!(info.mode, "custom");
    assert!(!info.default_database_exists && !fixture.paths.default_data_root.exists());
    let second = fixture.root.join("External Second");
    fs::create_dir(&second).unwrap();
    migrate_to_root_at(
        fixture.paths.clone(),
        &database,
        second.clone(),
        RootMode::Custom,
    )
    .await
    .unwrap();
    close(database).await;
    assert!(!fixture.paths.default_data_root.exists());
    let (database, _) = initialize_at(&fixture.paths).await.unwrap();
    migrate_to_root_at(
        fixture.paths.clone(),
        &database,
        fixture.paths.default_data_root.clone(),
        RootMode::Default,
    )
    .await
    .unwrap();
    close(database).await;
    let pending = read_bootstrap(&fixture.paths.primary_bootstrap_path())
        .unwrap()
        .unwrap();
    assert_eq!(pending.mode, RootMode::Default);
    assert!(pending.data_root.is_none());
    assert_eq!(pending.previous.unwrap().data_root, Some(second.clone()));
    let (database, info) = initialize_at(&fixture.paths).await.unwrap();
    assert_eq!(info.mode, "default");
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
        .fetch_one(&*database.pool().await)
        .await
        .unwrap();
    assert_eq!(count, 1);
    close(database).await;
    assert!(
        fixture.custom.join(DATABASE_FILE_NAME).exists()
            && second.join(DATABASE_FILE_NAME).exists()
    );
}

#[tokio::test]
async fn reserved_regions_cannot_be_selected_or_bootstrapped_as_custom() {
    let fixture = Fixture::new();
    for root in [
        &fixture.paths.executable_root,
        &fixture.paths.default_data_root,
        &fixture.paths.config_root,
        &fixture.paths.executable_root.join("custom"),
        &fixture.root,
    ] {
        fs::create_dir_all(root).unwrap();
        assert!(
            validate_custom_root(root, &fixture.paths).is_err(),
            "{}",
            root.display()
        );
    }
    assert!(validate_custom_root(&fixture.custom, &fixture.paths).is_ok());
    write_committed(
        &fixture.paths.config_root,
        &custom_locator(&fixture.paths.default_data_root),
    )
    .unwrap();
    assert!(initialize_at(&fixture.paths).await.is_err());
    assert!(!fixture.paths.default_database_path().exists());
    assert!(validate_custom_root(Path::new("relative"), &fixture.paths).is_err());
}

#[tokio::test]
async fn separate_executable_folders_keep_default_databases_independent() {
    let first = Fixture::new();
    let second = Fixture::new();
    let (database, _) = initialize_at(&first.paths).await.unwrap();
    {
        let pool = database.pool().await;
        sqlx::query("INSERT INTO profiles (name) VALUES ('first folder profile')")
            .execute(&*pool)
            .await
            .unwrap();
    }
    close(database).await;
    let (database, _) = initialize_at(&second.paths).await.unwrap();
    assert_ne!(
        database.database_path(),
        first.paths.default_database_path()
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
        .fetch_one(&*database.pool().await)
        .await
        .unwrap();
    assert_eq!(count, 0);
    close(database).await;
    let (database, _) = initialize_at(&first.paths).await.unwrap();
    let name: String = sqlx::query_scalar("SELECT name FROM profiles")
        .fetch_one(&*database.pool().await)
        .await
        .unwrap();
    assert_eq!(name, "first folder profile");
    close(database).await;
}

#[tokio::test]
async fn copying_closed_default_folder_retains_database_and_bootstrap() {
    let fixture = Fixture::new();
    let (database, _) = initialize_at(&fixture.paths).await.unwrap();
    {
        let pool = database.pool().await;
        sqlx::query("INSERT INTO profiles (name) VALUES ('copied profile')")
            .execute(&*pool)
            .await
            .unwrap();
    }
    close(database).await;
    let copied = fixture.root.join("Copied Folder");
    let copied_paths = PortablePaths::from_executable(&copied.join("app.exe")).unwrap();
    fs::create_dir_all(&copied_paths.default_data_root).unwrap();
    fs::create_dir(&copied_paths.config_root).unwrap();
    for (source, target) in [
        (
            fixture.paths.default_database_path(),
            copied_paths.default_database_path(),
        ),
        (
            fixture.paths.primary_bootstrap_path(),
            copied_paths.primary_bootstrap_path(),
        ),
        (
            fixture.paths.last_good_bootstrap_path(),
            copied_paths.last_good_bootstrap_path(),
        ),
    ] {
        fs::copy(&source, &target).unwrap();
        assert_eq!(fs::read(source).unwrap(), fs::read(target).unwrap());
    }
    let (database, info) = initialize_at(&copied_paths).await.unwrap();
    assert_eq!(info.mode, "default");
    assert_eq!(
        database.database_path(),
        copied_paths.default_database_path()
    );
    let name: String = sqlx::query_scalar("SELECT name FROM profiles")
        .fetch_one(&*database.pool().await)
        .await
        .unwrap();
    assert_eq!(name, "copied profile");
    close(database).await;
    assert_eq!(
        read_bootstrap(&copied_paths.primary_bootstrap_path()).unwrap(),
        Some(default_bootstrap())
    );
    assert_eq!(
        read_bootstrap(&copied_paths.last_good_bootstrap_path()).unwrap(),
        Some(default_bootstrap())
    );
    assert!(fixture.paths.default_database_path().exists());
}

#[tokio::test]
async fn relocating_folder_moves_default_and_config_but_keeps_custom_absolute() {
    let fixture = Fixture::new();
    let (database, _) = initialize_at(&fixture.paths).await.unwrap();
    close(database).await;
    let moved = fixture.root.join("Moved Folder");
    fs::rename(&fixture.paths.executable_root, &moved).unwrap();
    let moved_paths = PortablePaths::from_executable(&moved.join("app.exe")).unwrap();
    let (database, info) = initialize_at(&moved_paths).await.unwrap();
    assert_eq!(
        info.database_path,
        moved
            .join("data")
            .join(DATABASE_FILE_NAME)
            .display()
            .to_string()
    );
    close(database).await;
    seed(&fixture.custom).await;
    write_committed(&moved_paths.config_root, &custom_locator(&fixture.custom)).unwrap();
    let moved_again = fixture.root.join("Moved Again");
    fs::rename(&moved, &moved_again).unwrap();
    let paths = PortablePaths::from_executable(&moved_again.join("app.exe")).unwrap();
    let (database, info) = initialize_at(&paths).await.unwrap();
    assert_eq!(info.data_root, fixture.custom.display().to_string());
    assert_eq!(
        last_good(&paths.config_root).unwrap().unwrap().data_root,
        Some(fixture.custom.clone())
    );
    close(database).await;
    let pending = pending_from_default(&fixture.root.join("missing-custom"));
    write_pending(&paths.config_root, &pending).unwrap();
    let recovery = initialize_at(&paths).await.err().unwrap();
    assert!(recovery.pending_previous_available);
    tokio::task::spawn_blocking(move || validate_recovery_locator(&default_bootstrap(), &paths))
        .await
        .unwrap()
        .unwrap();
}

fn pending_from_default(custom: &Path) -> Bootstrap {
    Bootstrap {
        state: BootstrapState::Pending,
        transition_id: Some("pending-test".into()),
        previous: Some(PreviousRoot {
            mode: RootMode::Default,
            data_root: None,
        }),
        ..custom_locator(custom)
    }
}

#[tokio::test]
async fn startup_plan_is_consumed_once_and_creation_race_never_overwrites() {
    let fixture = Fixture::new();
    let plan = prepare_startup(fixture.paths.clone()).unwrap();
    fs::write(fixture.paths.primary_bootstrap_path(), "{").unwrap();
    fs::write(fixture.paths.default_database_path(), b"race-created-file").unwrap();
    assert!(matches!(
        initialize(plan).await,
        Err(StartupFailure::Filesystem(_))
    ));
    assert_eq!(
        fs::read(fixture.paths.default_database_path()).unwrap(),
        b"race-created-file"
    );
}

#[tokio::test]
async fn first_marker_partial_write_failure_is_filesystem_fatal_and_preserves_primary() {
    let fixture = Fixture::new();
    let plan = prepare_startup(fixture.paths.clone()).unwrap();
    fs::create_dir(fixture.paths.last_good_bootstrap_path()).unwrap();
    assert!(matches!(
        initialize(plan).await,
        Err(StartupFailure::Filesystem(_))
    ));
    assert_eq!(
        read_bootstrap(&fixture.paths.primary_bootstrap_path()).unwrap(),
        Some(default_bootstrap())
    );
    validate_application_database(&fixture.paths.default_database_path())
        .await
        .unwrap();
}

#[test]
fn two_file_commit_preserves_pending_previous_on_primary_failure_and_old_last_good_on_second_failure(
) {
    let fixture = Fixture::new();
    let old = custom_locator(&fixture.custom);
    write_committed(&fixture.paths.config_root, &old).unwrap();
    let pending = pending_from_default(&fixture.custom);
    write_pending(&fixture.paths.config_root, &pending).unwrap();
    let primary = fixture.paths.primary_bootstrap_path();
    let last_good = fixture.paths.last_good_bootstrap_path();
    // Opening an existing file without delete sharing blocks Windows ReplaceFileW safely.
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&primary)
            .unwrap();
        assert!(write_committed(&fixture.paths.config_root, &default_bootstrap()).is_err());
        drop(lock);
        assert_eq!(read_bootstrap(&primary).unwrap(), Some(pending));
        assert_eq!(read_bootstrap(&last_good).unwrap(), Some(old.clone()));
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&last_good)
            .unwrap();
        assert!(write_committed(&fixture.paths.config_root, &default_bootstrap()).is_err());
        drop(lock);
        assert_eq!(read_bootstrap(&primary).unwrap(), Some(default_bootstrap()));
        assert_eq!(read_bootstrap(&last_good).unwrap(), Some(old));
        let info = recovery_from_disk(&fixture.paths, "partial commit");
        assert!(info.last_good_available && !info.pending_previous_available);
    }
    write_committed(&fixture.paths.config_root, &default_bootstrap()).unwrap();
    assert_eq!(
        read_bootstrap(&last_good).unwrap(),
        Some(default_bootstrap())
    );
}
